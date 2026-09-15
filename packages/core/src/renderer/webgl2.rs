use super::uniforms::GlassCompositeUniforms;
use super::{GlassQuad, GlassRenderer};
use crate::optical::physics;
use wasm_bindgen::{JsCast, JsValue};
use web_sys::{
    HtmlCanvasElement, OffscreenCanvas, WebGl2RenderingContext as Gl, WebGlBuffer,
    WebGlFramebuffer, WebGlProgram, WebGlShader, WebGlTexture, WebGlUniformLocation,
    WebGlVertexArrayObject,
};

/// Vertex stage shared by every pass.
///
/// The repo only ships `.frag` sources, so the fullscreen-triangle vertex stage lives here. Vertices
/// `(-1,-1)`, `(3,-1)`, `(-1,3)` cover the whole clip-space square with a single triangle, and
/// `a_position * 0.5 + 0.5` interpolates to `[0,1]` UVs across the visible region.
const FULLSCREEN_VERTEX_SHADER: &str = r#"#version 300 es
in vec2 a_position;
out vec2 v_uv;
void main() {
    v_uv = a_position * 0.5 + 0.5;
    gl_Position = vec4(a_position, 0.0, 1.0);
}
"#;

/// Dual Kawase 4-tap blur, used for both the downsample and the upsample direction.
const BLUR_FRAGMENT_SHADER: &str = include_str!("../shaders/kawase_blur.frag");

/// Rounded-rect refraction, dispersion, Fresnel sheen and tint composite.
const COMPOSITE_FRAGMENT_SHADER: &str = include_str!("../shaders/glass_composite.frag");

/// Number of ping-pong levels in the blur mip chain.
const MIP_LEVELS: usize = 5;

/// Smallest edge length a mip level may shrink to.
const MIN_MIP_SIZE: u32 = 4;

/// Depth bands the backdrop can be split into: far, mid, near.
///
/// Each band costs one full-size raster plus its own [`MIP_LEVELS`]-deep chain, and one DOM
/// serialization per frame on the capture side, so this is deliberately small. `glass_composite.frag`
/// declares exactly this many named samplers; the two must agree.
pub const MAX_BACKDROP_BANDS: usize = 3;

/// Distinct blur radii a single frame will run the blur chain for.
///
/// Per-quad radius is honoured by blurring once per group of quads sharing a quantized radius, so this
/// bounds the pass count: a frame with more distinct radii than this snaps the rarest ones onto the
/// nearest kept radius rather than paying for another `MAX_BACKDROP_BANDS`-worth of chains.
const MAX_BLUR_GROUPS: usize = 4;

/// Fullscreen triangle in clip space, two floats per vertex.
const FULLSCREEN_TRIANGLE: [f32; 6] = [-1.0, -1.0, 3.0, -1.0, -1.0, 3.0];

/// `a_position` is bound to this slot before linking, so one VAO serves both programs.
const POSITION_ATTRIB_LOCATION: u32 = 0;

/// Cached uniform locations for [`BLUR_FRAGMENT_SHADER`].
struct BlurUniforms {
    texture: Option<WebGlUniformLocation>,
    texel_size: Option<WebGlUniformLocation>,
    offset: Option<WebGlUniformLocation>,
}

/// Cached uniform locations for [`COMPOSITE_FRAGMENT_SHADER`].
struct CompositeUniforms {
    /// One location per named band sampler. Named rather than a `sampler2D[3]` because GLSL ES 3.00
    /// forbids indexing a sampler array with a non-constant expression.
    band_textures: [Option<WebGlUniformLocation>; MAX_BACKDROP_BANDS],
    band_depths: [Option<WebGlUniformLocation>; MAX_BACKDROP_BANDS],
    band_count: Option<WebGlUniformLocation>,
    resolution: Option<WebGlUniformLocation>,
    glass_bounds: Option<WebGlUniformLocation>,
    corner_radius: Option<WebGlUniformLocation>,
    ior: Option<WebGlUniformLocation>,
    dispersion: Option<WebGlUniformLocation>,
    rim_power: Option<WebGlUniformLocation>,
    sheen_intensity: Option<WebGlUniformLocation>,
    light_angle: Option<WebGlUniformLocation>,
    roughness: Option<WebGlUniformLocation>,
    saturation: Option<WebGlUniformLocation>,
    brightness: Option<WebGlUniformLocation>,
    thickness: Option<WebGlUniformLocation>,
    curvature: Option<WebGlUniformLocation>,
    tint_color: Option<WebGlUniformLocation>,
}

/// One level of the ping-pong blur chain: an RGBA texture and the framebuffer rendering into it.
struct MipLevel {
    framebuffer: WebGlFramebuffer,
    texture: WebGlTexture,
    width: u32,
    height: u32,
}

/// One depth band of the backdrop: the raster a content layer was captured into, its own blur chain,
/// and how far behind the glass rear face it sits.
///
/// Bands are contiguous from 0 and ordered far to near, which is the order the composite walks them in.
struct BackdropBand {
    /// The uploaded raster; a 1x1 transparent seed until an upload lands.
    texture: WebGlTexture,
    /// This band's own ping-pong chain. Level 0 is the only level the composite samples.
    mip_chain: Vec<MipLevel>,
    /// Pixels behind the rear face, or [`physics::AUTO_BACKDROP_DEPTH`] when the caller did not say.
    depth: f32,
    /// False until a `set_band_from_*` upload has actually succeeded. The transparent seed deliberately
    /// does not count: see [`GlassRenderer::has_real_background`].
    has_content: bool,
}

/// WebGL2 fallback optical rendering pipeline.
pub struct WebGl2Renderer {
    gl: Gl,
    width: u32,
    height: u32,
    quads: Vec<GlassQuad>,
    blur_program: WebGlProgram,
    composite_program: WebGlProgram,
    blur_uniforms: BlurUniforms,
    composite_uniforms: CompositeUniforms,
    quad_vao: WebGlVertexArrayObject,
    quad_buffer: WebGlBuffer,
    bands: [BackdropBand; MAX_BACKDROP_BANDS],
}

/// Sizes of the blur mip chain, each level half the previous one and floored at [`MIN_MIP_SIZE`].
fn mip_chain_sizes(width: u32, height: u32) -> Vec<(u32, u32)> {
    (0..MIP_LEVELS)
        .map(|level| {
            let shift = level as u32 + 1;
            (
                (width >> shift).max(MIN_MIP_SIZE),
                (height >> shift).max(MIN_MIP_SIZE),
            )
        })
        .collect()
}

/// Partition the submitted quads into groups that can share one run of the blur chain.
///
/// The chain ping-pongs down and back up into level 0, the only level the composite samples, so one run
/// yields exactly one radius. Honouring per-quad `blur_radius` therefore means running the chain once
/// per distinct radius and drawing that radius' quads in between — which the composite pass is split up
/// to allow.
///
/// Radii are quantized to [`physics::BLUR_RADIUS_QUANTUM`] first, so panels that merely differ by a
/// rounding error still share a pass. Beyond [`MAX_BLUR_GROUPS`] distinct radii the *rarest* ones are
/// snapped onto the nearest kept radius: dropping the least-used radius costs the fewest panels their
/// exact blur, and it is what keeps the per-frame pass count bounded no matter how many panels a page
/// mounts.
///
/// Groups come back sorted by ascending radius, each carrying its quads' indices in submission order.
/// Empty input yields no groups at all — `render()` still clears the canvas.
fn blur_groups(quads: &[GlassQuad]) -> Vec<(f32, Vec<usize>)> {
    if quads.is_empty() {
        return Vec::new();
    }

    let radii: Vec<f32> = quads
        .iter()
        .map(|quad| physics::quantize_blur_radius(quad.optical.blur_radius))
        .collect();

    let mut tally: Vec<(f32, usize)> = Vec::new();
    for &radius in &radii {
        match tally.iter_mut().find(|(value, _)| *value == radius) {
            Some((_, count)) => *count += 1,
            None => tally.push((radius, 1)),
        }
    }

    // Most common first, ties broken by ascending radius so the choice is deterministic.
    tally.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.total_cmp(&b.0)));
    let mut kept: Vec<f32> = tally
        .into_iter()
        .take(MAX_BLUR_GROUPS)
        .map(|(radius, _)| radius)
        .collect();
    kept.sort_by(f32::total_cmp);

    let mut groups: Vec<(f32, Vec<usize>)> =
        kept.iter().map(|&radius| (radius, Vec::new())).collect();
    for (index, &radius) in radii.iter().enumerate() {
        // Every kept radius is one some quad actually asked for, so this always finds a slot and every
        // group ends up non-empty.
        let slot = kept
            .iter()
            .position(|&candidate| candidate == radius)
            .unwrap_or_else(|| {
                kept.iter()
                    .enumerate()
                    .min_by(|(_, a), (_, b)| (*a - radius).abs().total_cmp(&(*b - radius).abs()))
                    .map(|(slot, _)| slot)
                    .unwrap_or(0)
            });
        groups[slot].1.push(index);
    }

    groups
}

/// Compile a single shader stage, surfacing the driver's info log on failure.
fn compile_shader(gl: &Gl, kind: u32, source: &str) -> Result<WebGlShader, String> {
    let shader = gl
        .create_shader(kind)
        .ok_or_else(|| "unable to allocate a WebGL shader object".to_string())?;
    gl.shader_source(&shader, source);
    gl.compile_shader(&shader);

    let compiled = gl
        .get_shader_parameter(&shader, Gl::COMPILE_STATUS)
        .as_bool()
        .unwrap_or(false);
    if compiled {
        Ok(shader)
    } else {
        let log = gl
            .get_shader_info_log(&shader)
            .unwrap_or_else(|| "unknown shader compilation error".to_string());
        gl.delete_shader(Some(&shader));
        Err(format!("shader compilation failed: {log}"))
    }
}

/// Link a vertex/fragment pair, surfacing the driver's info log on failure.
fn link_program(gl: &Gl, vs: &WebGlShader, fs: &WebGlShader) -> Result<WebGlProgram, String> {
    let program = gl
        .create_program()
        .ok_or_else(|| "unable to allocate a WebGL program object".to_string())?;
    gl.attach_shader(&program, vs);
    gl.attach_shader(&program, fs);
    // Pin a_position so a single VAO can be reused across both programs.
    gl.bind_attrib_location(&program, POSITION_ATTRIB_LOCATION, "a_position");
    gl.link_program(&program);

    let linked = gl
        .get_program_parameter(&program, Gl::LINK_STATUS)
        .as_bool()
        .unwrap_or(false);
    if linked {
        Ok(program)
    } else {
        let log = gl
            .get_program_info_log(&program)
            .unwrap_or_else(|| "unknown program link error".to_string());
        gl.delete_program(Some(&program));
        Err(format!("program link failed: {log}"))
    }
}

/// Compile [`FULLSCREEN_VERTEX_SHADER`] against `fragment_source` and link the result.
fn build_program(gl: &Gl, fragment_source: &str) -> Result<WebGlProgram, String> {
    let vertex = compile_shader(gl, Gl::VERTEX_SHADER, FULLSCREEN_VERTEX_SHADER)?;
    let fragment = match compile_shader(gl, Gl::FRAGMENT_SHADER, fragment_source) {
        Ok(shader) => shader,
        Err(error) => {
            gl.delete_shader(Some(&vertex));
            return Err(error);
        }
    };

    let program = link_program(gl, &vertex, &fragment);
    // A linked program retains its shaders, so drop our own references either way.
    gl.delete_shader(Some(&vertex));
    gl.delete_shader(Some(&fragment));
    program
}

/// Apply the clamped/linear sampling used by every texture in the pipeline.
fn set_texture_sampling(gl: &Gl) {
    gl.tex_parameteri(Gl::TEXTURE_2D, Gl::TEXTURE_WRAP_S, Gl::CLAMP_TO_EDGE as i32);
    gl.tex_parameteri(Gl::TEXTURE_2D, Gl::TEXTURE_WRAP_T, Gl::CLAMP_TO_EDGE as i32);
    gl.tex_parameteri(Gl::TEXTURE_2D, Gl::TEXTURE_MIN_FILTER, Gl::LINEAR as i32);
    gl.tex_parameteri(Gl::TEXTURE_2D, Gl::TEXTURE_MAG_FILTER, Gl::LINEAR as i32);
}

/// Bind a band's texture ready for a DOM-source upload.
///
/// `UNPACK_FLIP_Y_WEBGL` defaults to false, which would land source row 0 — the *top* of the DOM
/// backdrop — at texture `t = 0`, which the fullscreen stage's `v_uv = a_position * 0.5 + 0.5`
/// samples at the *bottom* of the canvas. Flipping on upload keeps DOM-top at canvas-top.
fn bind_band_for_upload(gl: &Gl, texture: &WebGlTexture) {
    gl.bind_texture(Gl::TEXTURE_2D, Some(texture));
    gl.pixel_storei(Gl::UNPACK_FLIP_Y_WEBGL, 1);
    set_texture_sampling(gl);
}

/// Allocate an empty RGBA texture plus the framebuffer that renders into it.
fn create_mip_level(gl: &Gl, width: u32, height: u32) -> Result<MipLevel, String> {
    let texture = gl
        .create_texture()
        .ok_or_else(|| "unable to allocate a blur mip texture".to_string())?;
    gl.bind_texture(Gl::TEXTURE_2D, Some(&texture));
    gl.tex_image_2d_with_i32_and_i32_and_i32_and_format_and_type_and_opt_u8_array(
        Gl::TEXTURE_2D,
        0,
        Gl::RGBA as i32,
        width as i32,
        height as i32,
        0,
        Gl::RGBA,
        Gl::UNSIGNED_BYTE,
        None,
    )
    .map_err(|_| format!("unable to size a blur mip texture to {width}x{height}"))?;
    set_texture_sampling(gl);

    let framebuffer = gl
        .create_framebuffer()
        .ok_or_else(|| "unable to allocate a blur framebuffer".to_string())?;
    gl.bind_framebuffer(Gl::FRAMEBUFFER, Some(&framebuffer));
    gl.framebuffer_texture_2d(
        Gl::FRAMEBUFFER,
        Gl::COLOR_ATTACHMENT0,
        Gl::TEXTURE_2D,
        Some(&texture),
        0,
    );

    let status = gl.check_framebuffer_status(Gl::FRAMEBUFFER);
    gl.bind_framebuffer(Gl::FRAMEBUFFER, None);
    gl.bind_texture(Gl::TEXTURE_2D, None);
    if status != Gl::FRAMEBUFFER_COMPLETE {
        return Err(format!("blur framebuffer is incomplete (status {status})"));
    }

    Ok(MipLevel {
        framebuffer,
        texture,
        width,
        height,
    })
}

/// Build the whole mip chain for the given drawing-buffer size.
fn create_mip_chain(gl: &Gl, width: u32, height: u32) -> Result<Vec<MipLevel>, String> {
    mip_chain_sizes(width, height)
        .into_iter()
        .map(|(level_width, level_height)| create_mip_level(gl, level_width, level_height))
        .collect()
}

/// Allocate every band: a transparent seed raster and its own blur chain.
fn create_bands(
    gl: &Gl,
    width: u32,
    height: u32,
) -> Result<[BackdropBand; MAX_BACKDROP_BANDS], String> {
    let mut bands = Vec::with_capacity(MAX_BACKDROP_BANDS);
    for _ in 0..MAX_BACKDROP_BANDS {
        bands.push(BackdropBand {
            texture: create_band_texture(gl)?,
            mip_chain: create_mip_chain(gl, width, height)?,
            depth: physics::AUTO_BACKDROP_DEPTH,
            has_content: false,
        });
    }
    bands
        .try_into()
        .map_err(|_| "unable to allocate the backdrop bands".to_string())
}

/// Allocate one band's raster, seeded with a single transparent pixel so it is already sampleable
/// before the first `set_band_from_*` call.
fn create_band_texture(gl: &Gl) -> Result<WebGlTexture, String> {
    let texture = gl
        .create_texture()
        .ok_or_else(|| "unable to allocate a backdrop band texture".to_string())?;
    gl.bind_texture(Gl::TEXTURE_2D, Some(&texture));
    gl.tex_image_2d_with_i32_and_i32_and_i32_and_format_and_type_and_opt_u8_array(
        Gl::TEXTURE_2D,
        0,
        Gl::RGBA as i32,
        1,
        1,
        0,
        Gl::RGBA,
        Gl::UNSIGNED_BYTE,
        Some(&[0, 0, 0, 0]),
    )
    .map_err(|_| "unable to seed a backdrop band texture".to_string())?;
    set_texture_sampling(gl);
    gl.bind_texture(Gl::TEXTURE_2D, None);
    Ok(texture)
}

impl WebGl2Renderer {
    /// Create and initialize a new WebGL2 glass renderer owning the canvas' GL context.
    pub fn new(canvas: &HtmlCanvasElement, width: u32, height: u32) -> Result<Self, String> {
        let gl = Self::request_context(canvas)?;

        let blur_program = build_program(&gl, BLUR_FRAGMENT_SHADER)?;
        let composite_program = build_program(&gl, COMPOSITE_FRAGMENT_SHADER)?;

        let blur_uniforms = BlurUniforms {
            texture: gl.get_uniform_location(&blur_program, "u_texture"),
            texel_size: gl.get_uniform_location(&blur_program, "u_texel_size"),
            offset: gl.get_uniform_location(&blur_program, "u_offset"),
        };
        let composite_uniforms = CompositeUniforms {
            band_textures: [
                gl.get_uniform_location(&composite_program, "u_band_texture_0"),
                gl.get_uniform_location(&composite_program, "u_band_texture_1"),
                gl.get_uniform_location(&composite_program, "u_band_texture_2"),
            ],
            band_depths: [
                gl.get_uniform_location(&composite_program, "u_band_depth_0"),
                gl.get_uniform_location(&composite_program, "u_band_depth_1"),
                gl.get_uniform_location(&composite_program, "u_band_depth_2"),
            ],
            band_count: gl.get_uniform_location(&composite_program, "u_band_count"),
            resolution: gl.get_uniform_location(&composite_program, "u_resolution"),
            glass_bounds: gl.get_uniform_location(&composite_program, "u_glass_bounds"),
            corner_radius: gl.get_uniform_location(&composite_program, "u_corner_radius"),
            ior: gl.get_uniform_location(&composite_program, "u_ior"),
            dispersion: gl.get_uniform_location(&composite_program, "u_dispersion"),
            rim_power: gl.get_uniform_location(&composite_program, "u_rim_power"),
            sheen_intensity: gl.get_uniform_location(&composite_program, "u_sheen_intensity"),
            light_angle: gl.get_uniform_location(&composite_program, "u_light_angle"),
            roughness: gl.get_uniform_location(&composite_program, "u_roughness"),
            saturation: gl.get_uniform_location(&composite_program, "u_saturation"),
            brightness: gl.get_uniform_location(&composite_program, "u_brightness"),
            thickness: gl.get_uniform_location(&composite_program, "u_thickness"),
            curvature: gl.get_uniform_location(&composite_program, "u_curvature"),
            tint_color: gl.get_uniform_location(&composite_program, "u_tint_color"),
        };

        let (quad_vao, quad_buffer) = Self::create_fullscreen_triangle(&gl)?;
        let bands = create_bands(&gl, width, height)?;

        Ok(Self {
            gl,
            width,
            height,
            quads: Vec::new(),
            blur_program,
            composite_program,
            blur_uniforms,
            composite_uniforms,
            quad_vao,
            quad_buffer,
            bands,
        })
    }

    /// Acquire the canvas' `webgl2` context with the same options the TS side requests.
    ///
    /// A canvas caches its context per type, so the TS `getContext("webgl2", ...)` call and this one
    /// resolve to the very same context object.
    fn request_context(canvas: &HtmlCanvasElement) -> Result<Gl, String> {
        let options = js_sys::Object::new();
        for (key, value) in [
            ("alpha", true),
            ("premultipliedAlpha", false),
            ("antialias", true),
        ] {
            js_sys::Reflect::set(
                &options,
                &JsValue::from_str(key),
                &JsValue::from_bool(value),
            )
            .map_err(|_| format!("unable to set the webgl2 context option '{key}'"))?;
        }

        canvas
            .get_context_with_context_options("webgl2", &options)
            .map_err(|_| "requesting a webgl2 context threw".to_string())?
            .ok_or_else(|| "webgl2 is not available on this canvas".to_string())?
            .dyn_into::<Gl>()
            .map_err(|_| "the canvas returned a non-WebGL2 context".to_string())
    }

    /// Upload the fullscreen triangle and wire `a_position` into a reusable VAO.
    fn create_fullscreen_triangle(
        gl: &Gl,
    ) -> Result<(WebGlVertexArrayObject, WebGlBuffer), String> {
        let buffer = gl
            .create_buffer()
            .ok_or_else(|| "unable to allocate the fullscreen triangle buffer".to_string())?;
        let vao = gl
            .create_vertex_array()
            .ok_or_else(|| "unable to allocate the fullscreen triangle VAO".to_string())?;

        gl.bind_vertex_array(Some(&vao));
        gl.bind_buffer(Gl::ARRAY_BUFFER, Some(&buffer));
        gl.buffer_data_with_u8_array(
            Gl::ARRAY_BUFFER,
            bytemuck::cast_slice(&FULLSCREEN_TRIANGLE),
            Gl::STATIC_DRAW,
        );
        gl.enable_vertex_attrib_array(POSITION_ATTRIB_LOCATION);
        gl.vertex_attrib_pointer_with_i32(POSITION_ATTRIB_LOCATION, 2, Gl::FLOAT, false, 0, 0);
        gl.bind_vertex_array(None);
        gl.bind_buffer(Gl::ARRAY_BUFFER, None);

        Ok((vao, buffer))
    }

    /// How many bands the composite may sample: the leading run of bands that have real content.
    ///
    /// Leading run rather than a count, because the shader walks bands 0..count with no gaps — a band
    /// that was never filled must not be sampled just because a nearer one was.
    fn active_bands(&self) -> usize {
        self.bands
            .iter()
            .take_while(|band| band.has_content)
            .count()
    }

    /// Validate a caller-supplied band index against [`MAX_BACKDROP_BANDS`].
    fn check_band(&self, band: u32) -> Result<usize, String> {
        let index = band as usize;
        if index < MAX_BACKDROP_BANDS {
            Ok(index)
        } else {
            Err(format!(
                "backdrop band {band} is out of range; this backend has {MAX_BACKDROP_BANDS}"
            ))
        }
    }

    /// Clear the default framebuffer to fully transparent, drawing nothing else.
    ///
    /// This is what `render()` does instead of compositing when there is no real backdrop: a
    /// transparent canvas lets the DOM — and each component's CSS `backdrop-filter` — show through
    /// untouched, which is the behaviour the readiness gate promises consumers.
    fn clear_canvas(&self) {
        let gl = &self.gl;
        gl.bind_framebuffer(Gl::FRAMEBUFFER, None);
        gl.viewport(0, 0, self.width as i32, self.height as i32);
        gl.clear_color(0.0, 0.0, 0.0, 0.0);
        gl.clear(Gl::COLOR_BUFFER_BIT);
    }

    /// Release every band's mip chain GPU objects.
    fn delete_mip_chain(&mut self) {
        for band in &mut self.bands {
            for level in std::mem::take(&mut band.mip_chain) {
                self.gl.delete_framebuffer(Some(&level.framebuffer));
                self.gl.delete_texture(Some(&level.texture));
            }
        }
    }

    /// Blur one band down and back up through its own mip chain, leaving the result in its level 0.
    ///
    /// The chain is *allocated* at [`MIP_LEVELS`] but only traversed as deep as this radius asks for
    /// ([`physics::kawase_levels_for_radius`]): each halving contributes a fixed ~15px of sigma that
    /// `blur_radius` cannot modulate, so walking all five levels for a 2px radius produced a blur an
    /// order of magnitude wider than the slider said. The level count is floored at 1, so level 0 —
    /// the only level [`Self::draw_quad_group`] samples — is always written.
    fn run_blur_passes(&self, band: usize, blur_radius: f32) {
        let Some(band) = self.bands.get(band) else {
            return;
        };

        let gl = &self.gl;
        gl.use_program(Some(&self.blur_program));
        gl.uniform1i(self.blur_uniforms.texture.as_ref(), 0);
        gl.active_texture(Gl::TEXTURE0);

        let levels = (physics::kawase_levels_for_radius(blur_radius, MIP_LEVELS as u32) as usize)
            .min(band.mip_chain.len());

        // Downsample: level 0 samples the band's raster, level n samples level n-1.
        for level in 0..levels {
            let source_texture = if level == 0 {
                &band.texture
            } else {
                &band.mip_chain[level - 1].texture
            };
            self.draw_blur_pass(
                &band.mip_chain[level],
                source_texture,
                physics::dual_kawase_down_step(level as u32, blur_radius),
            );
        }

        // Upsample: walk the same levels back towards level 0 with the half-step kernel.
        for level in (0..levels.saturating_sub(1)).rev() {
            let source = &band.mip_chain[level + 1];
            self.draw_blur_pass(
                &band.mip_chain[level],
                &source.texture,
                physics::dual_kawase_up_step(level as u32, blur_radius),
            );
        }
    }

    /// Render one 4-tap Kawase pass from `source` into `target`.
    ///
    /// `u_texel_size` is the *drawing buffer's* texel size, deliberately not the source mip level's.
    /// `dual_kawase_*_step` returns a step in full-resolution pixels that grows with the level
    /// (`(level + 1) * blur_radius / 4`), while each level is half the size of the one above it — so
    /// dividing by the level's own dimensions inflated the same step into an ever-larger *fraction of
    /// the image*. At level 4 of a 512x256 canvas that was a 20-texel offset against a 32x16 texture:
    /// 0.625 in UV, over half the frame per tap. The chain averaged the entire backdrop into one flat
    /// colour, which is why a panel over a colourful page still rendered as uniform grey. Expressing
    /// the offset against the full-resolution size keeps it a fixed physical distance at every level,
    /// which is what the pyramid expects: the depth supplies the radius, each tap stays local.
    fn draw_blur_pass(&self, target: &MipLevel, source: &WebGlTexture, offset: f32) {
        let gl = &self.gl;
        gl.bind_framebuffer(Gl::FRAMEBUFFER, Some(&target.framebuffer));
        gl.viewport(0, 0, target.width as i32, target.height as i32);
        gl.bind_texture(Gl::TEXTURE_2D, Some(source));
        gl.uniform2f(
            self.blur_uniforms.texel_size.as_ref(),
            1.0 / self.width.max(1) as f32,
            1.0 / self.height.max(1) as f32,
        );
        gl.uniform1f(self.blur_uniforms.offset.as_ref(), offset);
        gl.draw_arrays(Gl::TRIANGLES, 0, 3);
    }

    /// Detach every band's textures from their sampler units before the blur chain writes into them.
    ///
    /// Mip level 0 is both the composite's source and the last upsample pass' render target. A draw
    /// whose colour attachment is also bound to one of its samplers is a feedback loop, which WebGL2
    /// answers with INVALID_OPERATION and no write at all — so after the first group of a frame had
    /// composited, every later group's blur was silently dropped and kept sampling the first group's
    /// radius. That is the shared-blur bug wearing a different hat, and it only shows up with two
    /// distinct radii in one frame.
    fn unbind_band_textures(&self) {
        let gl = &self.gl;
        for index in 0..MAX_BACKDROP_BANDS {
            gl.active_texture(Gl::TEXTURE0 + index as u32);
            gl.bind_texture(Gl::TEXTURE_2D, None);
        }
        gl.active_texture(Gl::TEXTURE0);
    }

    /// Clear the default framebuffer once, before any group draws over it.
    fn begin_composite(&self) {
        let gl = &self.gl;
        gl.bind_framebuffer(Gl::FRAMEBUFFER, None);
        gl.viewport(0, 0, self.width as i32, self.height as i32);
        gl.clear_color(0.0, 0.0, 0.0, 0.0);
        gl.clear(Gl::COLOR_BUFFER_BIT);
    }

    /// Aim the composite at the canvas, and bind every band's blurred level 0 to its own texture unit.
    ///
    /// Called before each group's draws rather than once per frame, because the blur run in between
    /// leaves the GL state pointed somewhere else entirely: its last pass has a mip level's framebuffer
    /// bound and that level's viewport set, the blur program current, and its own source on unit 0. Skip
    /// any part of this and the group composites into band 0's mip texture instead of the canvas.
    fn bind_bands_for_composite(&self) {
        let gl = &self.gl;
        gl.bind_framebuffer(Gl::FRAMEBUFFER, None);
        gl.viewport(0, 0, self.width as i32, self.height as i32);
        gl.use_program(Some(&self.composite_program));

        let uniforms = &self.composite_uniforms;
        for (index, band) in self.bands.iter().enumerate() {
            gl.active_texture(Gl::TEXTURE0 + index as u32);
            if let Some(level) = band.mip_chain.first() {
                gl.bind_texture(Gl::TEXTURE_2D, Some(&level.texture));
            }
            gl.uniform1i(uniforms.band_textures[index].as_ref(), index as i32);
            gl.uniform1f(uniforms.band_depths[index].as_ref(), band.depth);
        }
        gl.active_texture(Gl::TEXTURE0);

        gl.uniform1i(uniforms.band_count.as_ref(), self.active_bands() as i32);
        gl.uniform2f(
            uniforms.resolution.as_ref(),
            self.width as f32,
            self.height as f32,
        );
    }

    /// Composite the given quads over the canvas, sampling each band's blurred level 0.
    ///
    /// Blending is enabled here and disabled again on the way out, so the blur chain that runs between
    /// groups keeps writing its passes straight into the mip levels rather than blending them.
    fn draw_quad_group(&self, indices: &[usize]) {
        let gl = &self.gl;
        self.bind_bands_for_composite();
        gl.enable(Gl::BLEND);
        gl.blend_func(Gl::SRC_ALPHA, Gl::ONE_MINUS_SRC_ALPHA);

        let uniforms = &self.composite_uniforms;
        for quad in indices.iter().filter_map(|&index| self.quads.get(index)) {
            // Sourced from the WebGPU-facing uniform block rather than from `quad.optical` directly,
            // so the layout owner has a consumer in the backend that actually ships: an optical field
            // left out of `GlassCompositeUniforms::from_quad` stops reaching this shader too, instead
            // of only mattering on a code path nothing runs yet. The GL calls, their order and their
            // values are unchanged, so the composite output is pixel-identical.
            let u = GlassCompositeUniforms::from_quad(quad, self.width, self.height);
            gl.uniform4f(
                uniforms.glass_bounds.as_ref(),
                u.glass_bounds[0],
                u.glass_bounds[1],
                u.glass_bounds[2],
                u.glass_bounds[3],
            );
            gl.uniform1f(uniforms.corner_radius.as_ref(), u.corner_radius);
            gl.uniform1f(uniforms.ior.as_ref(), u.ior);
            gl.uniform1f(uniforms.dispersion.as_ref(), u.dispersion);
            gl.uniform1f(uniforms.rim_power.as_ref(), u.rim_power);
            gl.uniform1f(uniforms.sheen_intensity.as_ref(), u.sheen_intensity);
            gl.uniform1f(uniforms.light_angle.as_ref(), u.light_angle);
            gl.uniform1f(uniforms.roughness.as_ref(), u.roughness);
            gl.uniform1f(uniforms.saturation.as_ref(), u.saturation);
            gl.uniform1f(uniforms.brightness.as_ref(), u.brightness);
            gl.uniform1f(uniforms.thickness.as_ref(), u.thickness);
            gl.uniform1f(uniforms.curvature.as_ref(), u.curvature);
            gl.uniform4f(
                uniforms.tint_color.as_ref(),
                u.tint_color[0],
                u.tint_color[1],
                u.tint_color[2],
                u.tint_color[3],
            );
            gl.draw_arrays(Gl::TRIANGLES, 0, 3);
        }

        gl.disable(Gl::BLEND);
    }
}

impl GlassRenderer for WebGl2Renderer {
    fn resize(&mut self, width: u32, height: u32) -> Result<(), String> {
        if self.width == width && self.height == height {
            return Ok(());
        }
        self.width = width;
        self.height = height;
        self.delete_mip_chain();
        for band in &mut self.bands {
            band.mip_chain = create_mip_chain(&self.gl, width, height)?;
        }
        Ok(())
    }

    fn update_quads(&mut self, quads: &[GlassQuad]) -> Result<(), String> {
        self.quads = quads.to_vec();
        Ok(())
    }

    fn render(&mut self) -> Result<(), String> {
        if self.width == 0 || self.height == 0 {
            return Ok(());
        }

        self.gl.disable(Gl::BLEND);

        // Nothing to refract yet. Compositing here would blur a transparent 1x1 seed into a flat
        // colour and then paint it at `alpha = 1.0` over the whole panel, hiding the content the
        // glass is supposed to show. Clear instead, and leave the CSS fallback in charge.
        if !self.has_real_background() {
            self.clear_canvas();
            return Ok(());
        }

        self.gl.bind_vertex_array(Some(&self.quad_vao));

        // Clear before the loop so a frame with no quads still clears, and so each group draws over
        // the previous group's output rather than wiping it.
        self.begin_composite();

        // One chain run per band per distinct radius. In the common case — every panel sharing one
        // radius — that is exactly the pass count before this was per-quad. Overlapping panels with
        // *different* radii now composite in group order (ascending radius) rather than submission
        // order; layers.ts:13-14 already documents overlapping glass as unsupported.
        for (radius, indices) in blur_groups(&self.quads) {
            self.unbind_band_textures();
            for band in 0..self.active_bands() {
                self.run_blur_passes(band, radius);
            }
            self.draw_quad_group(&indices);
        }

        self.gl.bind_vertex_array(None);
        Ok(())
    }

    fn backend_name(&self) -> &'static str {
        "webgl2"
    }

    fn has_real_background(&self) -> bool {
        self.active_bands() > 0
    }

    fn set_band_from_canvas(
        &mut self,
        band: u32,
        canvas: &HtmlCanvasElement,
        depth: f32,
    ) -> Result<(), String> {
        let index = self.check_band(band)?;
        let gl = &self.gl;
        bind_band_for_upload(gl, &self.bands[index].texture);
        gl.tex_image_2d_with_u32_and_u32_and_html_canvas_element(
            Gl::TEXTURE_2D,
            0,
            Gl::RGBA as i32,
            Gl::RGBA,
            Gl::UNSIGNED_BYTE,
            canvas,
        )
        .map_err(|_| format!("unable to upload the canvas backdrop into band {band}"))?;
        // Only a successful upload earns readiness. A `SecurityError` from a tainted canvas lands in
        // the `map_err` above and leaves the flag false, so a failed upload degrades instead of
        // compositing over whatever the texture happened to hold.
        self.bands[index].depth = depth;
        self.bands[index].has_content = true;
        Ok(())
    }

    fn set_band_from_offscreen_canvas(
        &mut self,
        band: u32,
        canvas: &OffscreenCanvas,
        depth: f32,
    ) -> Result<(), String> {
        let index = self.check_band(band)?;
        let gl = &self.gl;
        bind_band_for_upload(gl, &self.bands[index].texture);
        gl.tex_image_2d_with_u32_and_u32_and_offscreen_canvas(
            Gl::TEXTURE_2D,
            0,
            Gl::RGBA as i32,
            Gl::RGBA,
            Gl::UNSIGNED_BYTE,
            canvas,
        )
        .map_err(|_| format!("unable to upload the offscreen backdrop into band {band}"))?;
        self.bands[index].depth = depth;
        self.bands[index].has_content = true;
        Ok(())
    }

    fn release_bands_from(&mut self, first: u32) {
        for band in self.bands.iter_mut().skip(first as usize) {
            band.has_content = false;
            band.depth = physics::AUTO_BACKDROP_DEPTH;
        }
    }

    fn set_background_from_canvas(&mut self, canvas: &HtmlCanvasElement) -> Result<(), String> {
        // The single-layer path: one band at the calibrated fallback depth, and every nearer band
        // released, so an app that never mentions depth renders exactly as it did before banding.
        self.set_band_from_canvas(0, canvas, physics::AUTO_BACKDROP_DEPTH)?;
        self.release_bands_from(1);
        Ok(())
    }

    fn set_background_from_offscreen_canvas(
        &mut self,
        canvas: &OffscreenCanvas,
    ) -> Result<(), String> {
        self.set_band_from_offscreen_canvas(0, canvas, physics::AUTO_BACKDROP_DEPTH)?;
        self.release_bands_from(1);
        Ok(())
    }
}

impl Drop for WebGl2Renderer {
    fn drop(&mut self) {
        self.delete_mip_chain();
        for band in &self.bands {
            self.gl.delete_texture(Some(&band.texture));
        }
        self.gl.delete_buffer(Some(&self.quad_buffer));
        self.gl.delete_vertex_array(Some(&self.quad_vao));
        self.gl.delete_program(Some(&self.blur_program));
        self.gl.delete_program(Some(&self.composite_program));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_fullscreen_vertex_shader_source() {
        assert!(FULLSCREEN_VERTEX_SHADER.starts_with("#version 300 es"));
        assert!(FULLSCREEN_VERTEX_SHADER.contains("in vec2 a_position;"));
        assert!(FULLSCREEN_VERTEX_SHADER.contains("out vec2 v_uv;"));
        assert!(FULLSCREEN_VERTEX_SHADER.contains("gl_Position"));
    }

    #[test]
    fn test_blur_fragment_shader_declares_expected_uniforms() {
        assert!(BLUR_FRAGMENT_SHADER.starts_with("#version 300 es"));
        // The vertex stage's `out vec2 v_uv` must match the fragment stage's input.
        assert!(BLUR_FRAGMENT_SHADER.contains("in vec2 v_uv;"));
        for uniform in ["u_texture", "u_texel_size", "u_offset"] {
            assert!(
                BLUR_FRAGMENT_SHADER.contains(uniform),
                "kawase_blur.frag is missing {uniform}, which the renderer caches a location for"
            );
        }
    }

    #[test]
    fn test_composite_fragment_shader_declares_expected_uniforms() {
        assert!(COMPOSITE_FRAGMENT_SHADER.starts_with("#version 300 es"));
        assert!(COMPOSITE_FRAGMENT_SHADER.contains("in vec2 v_uv;"));
        for uniform in [
            "u_band_texture_0",
            "u_band_texture_1",
            "u_band_texture_2",
            "u_band_depth_0",
            "u_band_depth_1",
            "u_band_depth_2",
            "u_band_count",
            "u_resolution",
            "u_glass_bounds",
            "u_corner_radius",
            "u_ior",
            "u_dispersion",
            "u_rim_power",
            "u_sheen_intensity",
            "u_light_angle",
            "u_roughness",
            "u_saturation",
            "u_brightness",
            "u_thickness",
            "u_curvature",
            "u_tint_color",
        ] {
            assert!(
                COMPOSITE_FRAGMENT_SHADER.contains(uniform),
                "glass_composite.frag is missing {uniform}, which the renderer caches a location for"
            );
        }
    }

    #[test]
    fn test_blur_depth_tracks_the_blur_radius() {
        // `run_blur_passes` traverses this many of the allocated MIP_LEVELS. A small radius must not
        // pay the full pyramid's fixed sigma; a large one must use the whole chain.
        let shallow = physics::kawase_levels_for_radius(2.0, MIP_LEVELS as u32);
        assert!(
            shallow >= 1 && (shallow as usize) < MIP_LEVELS,
            "a 2px radius traverses {shallow} of {MIP_LEVELS} levels"
        );
        assert_eq!(
            physics::kawase_levels_for_radius(32.0, MIP_LEVELS as u32) as usize,
            MIP_LEVELS
        );
        // The composite pass only ever samples level 0, so it must always be written.
        assert!(physics::kawase_levels_for_radius(0.0, MIP_LEVELS as u32) >= 1);
    }

    #[test]
    fn test_fullscreen_triangle_covers_clip_space() {
        assert_eq!(FULLSCREEN_TRIANGLE.len(), 6, "3 vertices of 2 floats each");
        // v_uv = a_position * 0.5 + 0.5 must span at least [0,1] on both axes.
        let uvs: Vec<(f32, f32)> = FULLSCREEN_TRIANGLE
            .chunks(2)
            .map(|xy| (xy[0] * 0.5 + 0.5, xy[1] * 0.5 + 0.5))
            .collect();
        assert_eq!(uvs[0], (0.0, 0.0));
        assert!(uvs.iter().any(|uv| uv.0 >= 1.0));
        assert!(uvs.iter().any(|uv| uv.1 >= 1.0));
    }

    #[test]
    fn test_mip_chain_sizes_halve_each_level() {
        let sizes = mip_chain_sizes(1920, 1080);
        assert_eq!(sizes.len(), MIP_LEVELS);
        assert_eq!(sizes[0], (960, 540));
        assert_eq!(sizes[1], (480, 270));
        assert_eq!(sizes[4], (60, 33));
        for pair in sizes.windows(2) {
            assert!(pair[1].0 <= pair[0].0);
            assert!(pair[1].1 <= pair[0].1);
        }
    }

    #[test]
    fn test_mip_chain_sizes_floor_at_min_size() {
        let sizes = mip_chain_sizes(8, 2);
        assert_eq!(sizes.len(), MIP_LEVELS);
        for (width, height) in sizes {
            assert!(width >= MIN_MIP_SIZE);
            assert!(height >= MIN_MIP_SIZE);
        }
        // A zero-sized canvas still yields allocatable levels; render() bails out before using them.
        for (width, height) in mip_chain_sizes(0, 0) {
            assert_eq!((width, height), (MIN_MIP_SIZE, MIN_MIP_SIZE));
        }
    }

    /// A quad that asks for exactly this blur radius.
    fn quad_blurred(blur_radius: f32) -> GlassQuad {
        let mut quad = GlassQuad::default();
        quad.optical.blur_radius = blur_radius;
        quad
    }

    #[test]
    fn test_blur_groups_splits_distinct_radii() {
        // The case that used to render both panels at the mean of 20: two radii, two chain runs, and
        // each quad drawn with the blur it asked for.
        let quads = [quad_blurred(10.0), quad_blurred(30.0), quad_blurred(10.0)];
        let groups = blur_groups(&quads);

        assert_eq!(groups.len(), 2);
        assert_eq!(groups[0].0, 10.0);
        assert_eq!(groups[0].1, vec![0, 2], "indices stay in submission order");
        assert_eq!(groups[1].0, 30.0);
        assert_eq!(groups[1].1, vec![1]);
    }

    #[test]
    fn test_blur_groups_merge_within_the_quantum() {
        // Half a CSS blur pixel apart is not worth a second full chain run.
        let quads = [quad_blurred(16.0), quad_blurred(16.4)];
        let groups = blur_groups(&quads);

        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].0, 16.0);
        assert_eq!(groups[0].1, vec![0, 1]);
    }

    #[test]
    fn test_blur_groups_cap_at_max_blur_groups() {
        // Six distinct radii, with 4.0 and 40.0 the most common, so those two are certainly kept and
        // the rarest four compete for the remaining slots.
        let quads = [
            quad_blurred(4.0),
            quad_blurred(4.0),
            quad_blurred(40.0),
            quad_blurred(40.0),
            quad_blurred(8.0),
            quad_blurred(12.0),
            quad_blurred(20.0),
            quad_blurred(28.0),
        ];
        let groups = blur_groups(&quads);

        assert!(
            groups.len() <= MAX_BLUR_GROUPS,
            "the pass count must stay bounded, got {} groups",
            groups.len()
        );
        let kept: Vec<f32> = groups.iter().map(|(radius, _)| *radius).collect();
        assert!(
            kept.windows(2).all(|pair| pair[0] < pair[1]),
            "groups must come back in ascending radius order: {kept:?}"
        );
        assert!(kept.contains(&4.0) && kept.contains(&40.0));

        let mut placed: Vec<usize> = groups
            .iter()
            .flat_map(|(_, indices)| indices.iter().copied())
            .collect();
        placed.sort_unstable();
        assert_eq!(
            placed,
            (0..quads.len()).collect::<Vec<_>>(),
            "every quad must be drawn exactly once"
        );

        // A snapped quad lands on the nearest kept radius, not just any of them.
        for (radius, indices) in &groups {
            for &index in indices {
                let asked = quads[index].optical.blur_radius;
                let nearest = kept
                    .iter()
                    .copied()
                    .min_by(|a, b| (a - asked).abs().total_cmp(&(b - asked).abs()))
                    .expect("at least one group");
                assert_eq!(
                    *radius, nearest,
                    "quad {index} asked for {asked} and was snapped to {radius} rather than {nearest}"
                );
            }
        }
    }

    #[test]
    fn test_blur_groups_are_empty_without_quads() {
        // No quads means no blur work at all. `render()` still calls `begin_composite`, which clears
        // the canvas, so an empty frame is transparent rather than stale.
        assert!(blur_groups(&[]).is_empty());
    }

    // The `normalized_glass_bounds` tests moved to `renderer::uniforms` with the function itself, so
    // the UV flip has one definition and one test suite for both backends.
}
