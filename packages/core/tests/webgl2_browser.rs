//! Headless-browser proof that the WebGL2 pipeline compiles, links *and draws the right pixels* on a
//! real driver.
//!
//! Run with:
//!
//! ```bash
//! cd packages/core && wasm-pack test --headless --chrome
//! ```
//!
//! The host `cargo test` cannot cover any of this: there is no `WebGl2RenderingContext` outside a
//! browser, so every renderer test in `src/renderer/webgl2.rs` asserts against shader *source*
//! strings. A GLSL typo therefore passes `cargo test`, `cargo clippy` and `pnpm test`, and then
//! `GlassEngineImpl.initWasm()` swallows the resulting construction error into a silent CSS
//! fallback. These tests are the only gate a real shader compiler ever sees.
//!
//! Compilation is not enough. An earlier revision of this file proved only that the GLSL compiled,
//! and a composite that painted a uniform opaque grey rectangle over the whole panel — hiding the DOM
//! it was supposed to refract — passed it green. So the tests below read the framebuffer back:
//! [`the_panel_refracts_the_backdrop_beneath_it`] asserts the panel interior is non-uniform and that
//! its colour tracks the backdrop quadrant underneath it (which also re-proves the Y orientation of
//! the whole upload/sample/composite chain end to end), and
//! [`no_backdrop_means_a_transparent_canvas`] asserts a renderer that was never handed a backdrop
//! draws nothing at all rather than a grey block.
//!
//! Nor is tracking the backdrop enough. Those per-quadrant checks compare channels against each other
//! (`red[0] > red[1]`), and an *ordering* survives any amount of chroma flattening — so a composite
//! that washed a magenta page to near-neutral grey passed them green while looking markedly worse than
//! the CSS `backdrop-filter` it replaced. Two assertions close that: a chroma floor inside
//! [`the_panel_refracts_the_backdrop_beneath_it`], and [`the_saturation_term_reaches_the_composite`],
//! which renders the same frame at `saturation: 1.0` and at the 1.8 default and requires the measured
//! chroma to grow.
//!
//! Brightness is the third thing pixels can get wrong while every other assertion stays green: a
//! composite can track the backdrop and keep its chroma and still be markedly darker than the CSS
//! overlay the readiness handover removes, which is what made the whole page dim ~780ms after load.
//! [`the_brightness_term_holds_the_handover_luma`] gates that.
//!
//! Bending the light is the fourth. Every assertion above holds for a panel that transmits its
//! interior straight through and only refracts at its 8px rim, because sampling straight down still
//! tracks the backdrop underneath and keeps its chroma and luma — which is exactly what the panel body
//! did before the volumetric lens.
//! [`the_volumetric_curvature_bends_interior_light`] gates that.
//!
//! Depth is the fifth. Every assertion above holds for a pipeline where *everything* behind the glass
//! sits at one calibrated distance, because a single band is all they upload — so wallpaper and a card
//! floating just under the panel refracted identically and moving a panel produced no differential
//! parallax. [`a_deeper_band_parallaxes_further_than_a_near_one`] gates the distance reaching the
//! refraction, [`a_near_band_occludes_the_far_band_it_covers`] that the bands composite near-over-far
//! rather than averaging, and [`releasing_a_band_stops_it_being_sampled`] that an unmounted layer's
//! stale raster stops being refracted.
//!
//! Per-quad blur is the sixth: the composite used to sample one backdrop blurred at the *mean* radius of
//! every submitted quad, so two panels with different `blurRadius` values rendered identically.
//! [`two_panels_blur_at_their_own_radius`] gates that.
//!
//! The whole file is `cfg`'d to `wasm32`, so a host `cargo test --workspace` compiles it to nothing
//! and reports zero tests for this target rather than failing to build.

#![cfg(target_arch = "wasm32")]

use open_glass_core::optical::physics::{self, OpticalParams};
use open_glass_core::renderer::{webgl2::WebGl2Renderer, GlassQuad, GlassRenderer};
use wasm_bindgen::JsCast;
use wasm_bindgen_test::{wasm_bindgen_test, wasm_bindgen_test_configure};
use web_sys::{CanvasRenderingContext2d, HtmlCanvasElement, WebGl2RenderingContext as Gl};

// The default harness runs in Node, which has no WebGL2 at all.
wasm_bindgen_test_configure!(run_in_browser);

/// Canvas size for the pixel tests.
///
/// Big enough that the 5-level mip chain's smallest level (`WIDTH >> 5` x `HEIGHT >> 5` = 16x8) still
/// resolves each backdrop quadrant into an 8x4 block, so quadrant structure survives the blur that
/// the composite samples.
const WIDTH: u32 = 512;
const HEIGHT: u32 = 256;

/// A fragment shader that must fail to compile: `no_such_function` is not declared anywhere.
const INVALID_FRAGMENT_SHADER: &str = r#"#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
void main() {
    fragColor = no_such_function(v_uv);
}
"#;

/// A real `HtmlCanvasElement` — `WebGl2Renderer::new` takes that type specifically, not an
/// `OffscreenCanvas`.
fn create_canvas(width: u32, height: u32) -> HtmlCanvasElement {
    let canvas = web_sys::window()
        .expect("no window in the test harness")
        .document()
        .expect("no document in the test harness")
        .create_element("canvas")
        .expect("create_element(\"canvas\") threw")
        .dyn_into::<HtmlCanvasElement>()
        .expect("created element is not an HtmlCanvasElement");
    canvas.set_width(width);
    canvas.set_height(height);
    canvas
}

/// Saturated primaries: red / green on top, blue / black underneath, in DOM orientation.
///
/// The colours are chosen so a single channel comparison identifies each quadrant even after the blur
/// chain has mixed neighbours into it, and so the composite's uniform additions (a 12% mix toward the
/// tint colour plus a constant specular term) cannot change the ordering.
const PRIMARY_QUADRANTS: [&str; 4] = [
    "rgb(255, 0, 0)",
    "rgb(0, 255, 0)",
    "rgb(0, 0, 255)",
    "rgb(0, 0, 0)",
];

/// The same layout in muted mid-tones, for [`the_saturation_term_reaches_the_composite`].
///
/// [`PRIMARY_QUADRANTS`] cannot measure a chroma *boost*: `rgb(255, 0, 0)` already sits at the edge of
/// the gamut, so `u_saturation`'s `clamp` swallows almost all of the increase (measured: a channel
/// spread of 218 at saturation 1.0 against 251 at 1.8, a ratio of 1.15 for a 1.8x scale). These
/// mid-tones leave headroom on both sides of the luma, which is also the regime the real defect lives
/// in — the playground's magenta heading, not a saturated primary.
const MUTED_QUADRANTS: [&str; 4] = [
    "rgb(176, 96, 160)",
    "rgb(96, 176, 128)",
    "rgb(96, 128, 176)",
    "rgb(64, 64, 64)",
];

/// [`MUTED_QUADRANTS`] as numbers, so [`the_brightness_term_holds_the_handover_luma`]'s CSS-fallback
/// luma model is computed from the backdrop the test actually renders instead of a copied constant.
/// That test asserts the two agree, so editing one and not the other fails rather than drifts.
const MUTED_QUADRANT_RGB: [[u8; 3]; 4] =
    [[176, 96, 160], [96, 176, 128], [96, 128, 176], [64, 64, 64]];

/// A backdrop with four distinct solid quadrants, in DOM orientation: row 0 is the *top*.
fn backdrop_canvas() -> HtmlCanvasElement {
    quadrant_canvas(PRIMARY_QUADRANTS)
}

/// The canvas' 2D context, for painting a backdrop raster.
fn canvas_2d(canvas: &HtmlCanvasElement) -> CanvasRenderingContext2d {
    canvas
        .get_context("2d")
        .expect("requesting a 2d context threw")
        .expect("2d is not available on this canvas")
        .dyn_into::<CanvasRenderingContext2d>()
        .expect("the canvas returned a non-2D context")
}

/// [`backdrop_canvas`] with the quadrant colours given, clockwise from the DOM top-left.
fn quadrant_canvas(colors: [&str; 4]) -> HtmlCanvasElement {
    let canvas = create_canvas(WIDTH, HEIGHT);
    let ctx = canvas_2d(&canvas);

    let half_w = f64::from(WIDTH) / 2.0;
    let half_h = f64::from(HEIGHT) / 2.0;
    for (color, x, y) in [
        (colors[0], 0.0, 0.0),
        (colors[1], half_w, 0.0),
        (colors[2], 0.0, half_h),
        (colors[3], half_w, half_h),
    ] {
        ctx.set_fill_style_str(color);
        ctx.fill_rect(x, y, half_w, half_h);
    }

    canvas
}

/// [`MUTED_QUADRANTS`] laid out as a 64px checkerboard rather than four half-canvas blocks, for
/// [`the_volumetric_curvature_bends_interior_light`].
///
/// The quadrant backdrop cannot see the body lens at all: the panel's centre lands exactly on the
/// quadrant cross, so the only edges in the whole backdrop are the two lines through the panel's own
/// optical axis — and the lens displaces the sample *along* those lines (radially, in a body_uv space
/// whose axes are the panel's), leaving the colour it lands on unchanged. A checkerboard puts edges
/// everywhere and in both directions, so a few pixels of displacement anywhere in the body shows up.
fn muted_checkerboard() -> HtmlCanvasElement {
    const CELL: f64 = 64.0;
    let canvas = create_canvas(WIDTH, HEIGHT);
    let ctx = canvas_2d(&canvas);

    let cols = (f64::from(WIDTH) / CELL).ceil() as u32;
    let rows = (f64::from(HEIGHT) / CELL).ceil() as u32;
    for row in 0..rows {
        for col in 0..cols {
            // Cycling all four colours rather than alternating two keeps every cell boundary a real
            // colour step in more than one channel.
            let color = MUTED_QUADRANTS[((row * cols + row + col) % 4) as usize];
            ctx.set_fill_style_str(color);
            ctx.fill_rect(f64::from(col) * CELL, f64::from(row) * CELL, CELL, CELL);
        }
    }

    canvas
}

/// A fully opaque single-colour band raster.
fn solid_canvas(color: &str) -> HtmlCanvasElement {
    let canvas = create_canvas(WIDTH, HEIGHT);
    let ctx = canvas_2d(&canvas);
    ctx.set_fill_style_str(color);
    ctx.fill_rect(0.0, 0.0, f64::from(WIDTH), f64::from(HEIGHT));
    canvas
}

/// A band raster that is opaque over the canvas' left half and *transparent* over its right.
///
/// This is the shape a near content layer actually has: it covers part of the panel and leaves the rest
/// of the panel looking through to whatever is further away. The transparent half is what the band's
/// own alpha has to carry through the blur chain into `accumulateBand`.
fn left_half_canvas(color: &str) -> HtmlCanvasElement {
    let canvas = create_canvas(WIDTH, HEIGHT);
    let ctx = canvas_2d(&canvas);
    ctx.set_fill_style_str(color);
    ctx.fill_rect(0.0, 0.0, f64::from(WIDTH) / 2.0, f64::from(HEIGHT));
    canvas
}

/// A quad inset from every canvas edge, so all four backdrop quadrants sit under the panel interior
/// while the SDF edge falloff stays well away from the sampled points.
fn inset_quad() -> GlassQuad {
    inset_quad_with(OpticalParams::default())
}

/// [`inset_quad`] with the optical parameters replaced, for differential tests.
fn inset_quad_with(optical: OpticalParams) -> GlassQuad {
    GlassQuad {
        x: 32.0,
        y: 32.0,
        width: WIDTH as f32 - 64.0,
        height: HEIGHT as f32 - 64.0,
        corner_radius: 24.0,
        _padding: [0.0; 3],
        optical,
    }
}

/// Chroma of one sample: how far apart its brightest and dimmest channels are.
///
/// This is the quantity the saturation term exists to defend. It is also what the per-quadrant
/// channel-dominance assertions below cannot see: an ordering (`red[0] > red[1]`) survives any amount
/// of chroma flattening, so a composite that washed the whole panel to near-neutral grey kept them
/// green.
fn channel_spread(pixel: [u8; 4]) -> u32 {
    let max = pixel[0].max(pixel[1]).max(pixel[2]);
    let min = pixel[0].min(pixel[1]).min(pixel[2]);
    u32::from(max) - u32::from(min)
}

/// Rec. 709 luma of one sample, in the same 0-255 space as the screenshot analysis scripts.
fn luma(pixel: [u8; 4]) -> f64 {
    0.2126 * f64::from(pixel[0]) + 0.7152 * f64::from(pixel[1]) + 0.0722 * f64::from(pixel[2])
}

/// Walk the panel interior on the same inset grid as the non-uniformity check in
/// [`the_panel_refracts_the_backdrop_beneath_it`], so the SDF edge falloff and the sheen ring stay
/// out of any mean taken over it.
fn interior_samples(pixels: &[u8]) -> Vec<[u8; 4]> {
    let mut samples = Vec::new();
    for y in (48..HEIGHT - 48).step_by(16) {
        for x in (48..WIDTH - 48).step_by(16) {
            samples.push(dom_pixel(pixels, x, y));
        }
    }
    samples
}

/// [`interior_samples`] for one quad of a multi-panel frame, so each panel can be measured on its own.
///
/// Same 48px inset and 16px step as [`interior_samples`], but relative to the quad's own rect rather
/// than the canvas'.
fn interior_samples_of(pixels: &[u8], quad: &GlassQuad) -> Vec<[u8; 4]> {
    const INSET: u32 = 48;
    let left = quad.x as u32 + INSET;
    let top = quad.y as u32 + INSET;
    let right = (quad.x + quad.width) as u32 - INSET;
    let bottom = (quad.y + quad.height) as u32 - INSET;

    let mut samples = Vec::new();
    for y in (top..bottom).step_by(16) {
        for x in (left..right).step_by(16) {
            samples.push(dom_pixel(pixels, x, y));
        }
    }
    samples
}

/// Mean [`luma`] over [`interior_samples`].
fn mean_interior_luma(pixels: &[u8]) -> f64 {
    let samples = interior_samples(pixels);
    samples.iter().copied().map(luma).sum::<f64>() / samples.len() as f64
}

/// Mean [`channel_spread`] over the given samples — the "mean channel spread" the playground captures
/// are measured on, so a brightness gain that reached white cannot hide here.
fn mean_channel_spread(samples: &[[u8; 4]]) -> f64 {
    samples
        .iter()
        .copied()
        .map(|p| f64::from(channel_spread(p)))
        .sum::<f64>()
        / samples.len() as f64
}

/// [`mean_channel_spread`] over [`interior_samples`].
fn mean_interior_channel_spread(pixels: &[u8]) -> f64 {
    mean_channel_spread(&interior_samples(pixels))
}

/// Mean absolute luma step between horizontally adjacent samples across the interior of `quad`.
///
/// This is the measure of *blur strength*, and channel spread is not: destroying local contrast is the
/// whole job of a blur, whereas averaging two muted colours together leaves each pixel about as
/// chromatic as it started. Measured on one panel over [`muted_checkerboard`], going from a 2px radius to
/// a 30px one moves the mean interior channel spread from 62.2 to 54.3 — a 1.15x ratio for a 15x radius,
/// which no honest threshold fits between — while it moves the mean luma step from 5.19 to 1.00. The step
/// collapses because it *is* the detail the kernel removes.
///
/// The 8px stride is deliberately finer than [`interior_samples_of`]'s 16px: adjacent samples have to be
/// close enough together that a narrow blur leaves the step between them intact.
fn mean_interior_luma_step(pixels: &[u8], quad: &GlassQuad) -> f64 {
    const INSET: u32 = 48;
    const STRIDE: u32 = 8;
    let left = quad.x as u32 + INSET;
    let top = quad.y as u32 + INSET;
    let right = (quad.x + quad.width) as u32 - INSET;
    let bottom = (quad.y + quad.height) as u32 - INSET;

    let mut steps = Vec::new();
    for y in (top..bottom).step_by(STRIDE as usize) {
        for x in (left..right.saturating_sub(STRIDE)).step_by(STRIDE as usize) {
            let here = luma(dom_pixel(pixels, x, y));
            let next = luma(dom_pixel(pixels, x + STRIDE, y));
            steps.push((here - next).abs());
        }
    }
    steps.iter().sum::<f64>() / steps.len().max(1) as f64
}

/// Largest single-channel difference between two frames at each [`interior_samples`] point.
///
/// The differential every optical test in this file is built on: two frames that differ in exactly one
/// parameter, compared where only the panel body can have moved the result.
fn interior_sample_deltas(a: &[u8], b: &[u8]) -> Vec<u32> {
    interior_samples(a)
        .into_iter()
        .zip(interior_samples(b))
        .map(|(p, q)| {
            (0..3)
                .map(|c| u32::from(p[c]).abs_diff(u32::from(q[c])))
                .max()
                .unwrap_or(0)
        })
        .collect()
}

/// Render the backdrop with one inset quad at these optical parameters and read the frame back.
///
/// Uses [`MUTED_QUADRANTS`], not [`backdrop_canvas`]'s primaries: this feeds
/// [`the_saturation_term_reaches_the_composite`], and a primary already sits at the gamut edge, so
/// `u_saturation`'s clamp swallows almost all of a boost (measured: spread 218 at saturation 1.0
/// against 251 at 1.8, a 1.15x ratio for a 1.8x scale — not the 1.3x floor this test needs).
fn render_backdrop_with(optical: OpticalParams) -> Vec<u8> {
    render_over(&quadrant_canvas(MUTED_QUADRANTS), optical)
}

/// [`render_backdrop_with`] over an arbitrary backdrop.
fn render_over(backdrop: &HtmlCanvasElement, optical: OpticalParams) -> Vec<u8> {
    render_quads_over(backdrop, &[inset_quad_with(optical)])
}

/// [`render_over`] with the quads given, for frames that carry more than one panel.
fn render_quads_over(backdrop: &HtmlCanvasElement, quads: &[GlassQuad]) -> Vec<u8> {
    let canvas = create_canvas(WIDTH, HEIGHT);
    let mut renderer =
        WebGl2Renderer::new(&canvas, WIDTH, HEIGHT).expect("WebGl2Renderer::new failed");
    renderer
        .set_background_from_canvas(backdrop)
        .expect("uploading the backdrop failed");
    renderer.update_quads(quads).expect("update_quads failed");
    renderer.render().expect("render failed");
    read_canvas(&request_context(&canvas))
}

/// Render one inset quad over a stack of depth bands, band 0 first (farthest), and read the frame back.
///
/// Each entry is a raster and the distance in pixels behind the glass rear face that raster sits at, or
/// `physics::AUTO_BACKDROP_DEPTH` for the calibrated fallback.
fn render_bands(bands: &[(&HtmlCanvasElement, f32)], optical: OpticalParams) -> Vec<u8> {
    let canvas = create_canvas(WIDTH, HEIGHT);
    let mut renderer =
        WebGl2Renderer::new(&canvas, WIDTH, HEIGHT).expect("WebGl2Renderer::new failed");
    for (band, (raster, depth)) in bands.iter().enumerate() {
        renderer
            .set_band_from_canvas(band as u32, raster, *depth)
            .unwrap_or_else(|error| panic!("uploading band {band} failed: {error}"));
    }
    renderer
        .update_quads(&[inset_quad_with(optical)])
        .expect("update_quads failed");
    renderer.render().expect("render failed");
    read_canvas(&request_context(&canvas))
}

/// Read the whole default framebuffer back as RGBA bytes.
///
/// `read_pixels` indexes from the framebuffer's *bottom* row, which is the opposite of the DOM's
/// top-down convention — [`dom_pixel`] does that conversion, and the difference is exactly what makes
/// these tests a Y-orientation check as well as a colour check.
fn read_canvas(gl: &Gl) -> Vec<u8> {
    let mut pixels = vec![0u8; (WIDTH * HEIGHT * 4) as usize];
    gl.read_pixels_with_opt_u8_array(
        0,
        0,
        WIDTH as i32,
        HEIGHT as i32,
        Gl::RGBA,
        Gl::UNSIGNED_BYTE,
        Some(&mut pixels),
    )
    .expect("read_pixels threw");
    pixels
}

/// The RGBA value the DOM-space coordinate `(x, y)` — y measured downward from the top — ended up as.
fn dom_pixel(pixels: &[u8], x: u32, y: u32) -> [u8; 4] {
    let flipped_y = HEIGHT - 1 - y;
    let offset = ((flipped_y * WIDTH + x) * 4) as usize;
    [
        pixels[offset],
        pixels[offset + 1],
        pixels[offset + 2],
        pixels[offset + 3],
    ]
}

/// Acquire a bare `webgl2` context, bypassing `WebGl2Renderer`, for the negative control.
fn request_context(canvas: &HtmlCanvasElement) -> Gl {
    canvas
        .get_context("webgl2")
        .expect("requesting a webgl2 context threw")
        .expect("webgl2 is not available in this browser")
        .dyn_into::<Gl>()
        .expect("the canvas returned a non-WebGL2 context")
}

/// One `WebGl2Renderer::new` covers both programs: it builds `BLUR_FRAGMENT_SHADER` and
/// `COMPOSITE_FRAGMENT_SHADER` in sequence, so a typo in either surfaces here as the driver's own
/// info log via `shader compilation failed: {log}` / `program link failed: {log}`.
#[wasm_bindgen_test]
fn both_glass_programs_compile_and_link() {
    let canvas = create_canvas(256, 128);
    if let Err(error) = WebGl2Renderer::new(&canvas, 256, 128) {
        panic!("WebGl2Renderer::new(256x128) failed on a real driver: {error}");
    }
}

/// A non-power-of-two, odd-height size drives `create_mip_chain` / `MIN_MIP_SIZE` against real
/// framebuffer-completeness checks rather than the arithmetic-only host test.
#[wasm_bindgen_test]
fn constructs_at_a_non_power_of_two_size() {
    let canvas = create_canvas(300, 150);
    if let Err(error) = WebGl2Renderer::new(&canvas, 300, 150) {
        panic!("WebGl2Renderer::new(300x150) failed on a real driver: {error}");
    }
}

/// Negative control, so the tests above cannot pass vacuously: prove this driver actually reports
/// compile errors instead of silently accepting whatever it is handed.
#[wasm_bindgen_test]
fn the_driver_rejects_invalid_glsl() {
    let gl = request_context(&create_canvas(64, 64));
    let shader = gl
        .create_shader(Gl::FRAGMENT_SHADER)
        .expect("unable to allocate a WebGL shader object");
    gl.shader_source(&shader, INVALID_FRAGMENT_SHADER);
    gl.compile_shader(&shader);

    let compiled = gl
        .get_shader_parameter(&shader, Gl::COMPILE_STATUS)
        .as_bool()
        .unwrap_or(false);
    assert!(
        !compiled,
        "the driver accepted a call to an undefined function, so a passing \
         both_glass_programs_compile_and_link proves nothing"
    );

    let log = gl.get_shader_info_log(&shader).unwrap_or_default();
    assert!(
        !log.trim().is_empty(),
        "the driver rejected invalid GLSL but reported an empty info log, so build_program would \
         have nothing to surface"
    );

    gl.delete_shader(Some(&shader));
}

/// The composite must show the backdrop, not replace it.
///
/// Three things are asserted from one rendered frame:
///
/// 1. the panel interior is **not** a single uniform colour — the exact failure that shipped as a flat
///    opaque grey rectangle while every compile-and-link test stayed green;
/// 2. each interior sample tracks the backdrop quadrant beneath it, so what is on screen really is the
///    content behind the glass rather than a colour the shader invented;
/// 3. the quadrant that lands where each sample looks is the *DOM* quadrant beneath it, which pins the
///    Y orientation across the whole chain — `UNPACK_FLIP_Y_WEBGL` on upload, `v_uv` in the fullscreen
///    stage, and `normalized_glass_bounds`' DOM-to-UV flip. Any one of them dropped or applied twice
///    swaps the red/blue rows and fails this test.
#[wasm_bindgen_test]
fn the_panel_refracts_the_backdrop_beneath_it() {
    let canvas = create_canvas(WIDTH, HEIGHT);
    let mut renderer =
        WebGl2Renderer::new(&canvas, WIDTH, HEIGHT).expect("WebGl2Renderer::new failed");

    renderer
        .set_background_from_canvas(&backdrop_canvas())
        .expect("uploading the backdrop failed");
    renderer
        .update_quads(&[inset_quad()])
        .expect("update_quads failed");
    assert!(
        renderer.has_real_background(),
        "a successful upload must mark the backdrop real, or render() will skip the composite"
    );
    renderer.render().expect("render failed");

    let gl = request_context(&canvas);
    let pixels = read_canvas(&gl);

    // A quarter of the way into each quadrant: inside the panel, and far enough from both quadrant
    // boundaries that the quadrant's own colour dominates the blur kernel.
    let (qx, qy) = (WIDTH / 4, HEIGHT / 4);
    let red = dom_pixel(&pixels, qx, qy);
    let green = dom_pixel(&pixels, WIDTH - qx, qy);
    let blue = dom_pixel(&pixels, qx, HEIGHT - qy);
    let black = dom_pixel(&pixels, WIDTH - qx, HEIGHT - qy);

    assert!(
        red != green || red != blue || red != black,
        "the panel interior is a single uniform colour ({red:?}) — the composite is painting over the \
         backdrop instead of refracting it"
    );

    assert!(
        red[0] > red[1] && red[0] > red[2],
        "the DOM top-left quadrant is red but sampled as {red:?}; either the backdrop is not reaching \
         the composite or the Y orientation is inverted"
    );

    // Chroma floor. The dominance assertions either side of this one survive any amount of
    // desaturation, which is how a composite that washed the panel to near-neutral grey passed them.
    // The source quadrant is `rgb(255, 0, 0)` — a spread of 255 — and no blur can preserve that, so the
    // floor is set from measurement rather than from the source: the finished shader reads 92 here, and
    // 72 is a round ~80% of that. Dropping the saturation term takes this to 46.
    const RED_QUADRANT_CHROMA_FLOOR: u32 = 72;
    let red_spread = channel_spread(red);
    assert!(
        red_spread >= RED_QUADRANT_CHROMA_FLOOR,
        "the composited red quadrant's channel spread is {red_spread} ({red:?}), below the \
         {RED_QUADRANT_CHROMA_FLOOR} floor; the panel is washing the backdrop's colour out (the \
         source quadrant's own spread is 255)"
    );
    assert!(
        green[1] > green[0] && green[1] > green[2],
        "the DOM top-right quadrant is green but sampled as {green:?}"
    );
    assert!(
        blue[2] > blue[0] && blue[2] > blue[1],
        "the DOM bottom-left quadrant is blue but sampled as {blue:?}; a red reading here means the \
         upload flip and the bounds flip disagree"
    );

    let brightness = |p: [u8; 4]| u32::from(p[0]) + u32::from(p[1]) + u32::from(p[2]);
    assert!(
        brightness(black) < brightness(red)
            && brightness(black) < brightness(green)
            && brightness(black) < brightness(blue),
        "the DOM bottom-right quadrant is black but sampled brighter than its neighbours: \
         black={black:?} red={red:?} green={green:?} blue={blue:?}"
    );

    // Non-uniformity, measured rather than inferred from four points: scan a grid across the interior
    // and require real spread. A uniform grey rectangle has a spread of zero on every channel.
    let mut min = [255u8; 3];
    let mut max = [0u8; 3];
    for y in (48..HEIGHT - 48).step_by(16) {
        for x in (48..WIDTH - 48).step_by(16) {
            let pixel = dom_pixel(&pixels, x, y);
            for channel in 0..3 {
                min[channel] = min[channel].min(pixel[channel]);
                max[channel] = max[channel].max(pixel[channel]);
            }
        }
    }
    for (channel, name) in ["red", "green", "blue"].iter().enumerate() {
        let spread = u32::from(max[channel]) - u32::from(min[channel]);
        assert!(
            spread > 32,
            "the {name} channel varies by only {spread} across the panel interior \
             (min {min:?}, max {max:?}); the panel is effectively a flat block"
        );
    }
}

/// The `saturation` field must actually reach `glass_composite.frag`'s `u_saturation`.
///
/// Differential rather than absolute, so it cannot pass vacuously and needs no magic number: the same
/// backdrop and quad are rendered twice, once at `saturation: 1.0` (the neutral pass-through) and once
/// at the 1.8 default, and the composited chroma has to grow. It fails if the uniform location is never
/// resolved, if it is never uploaded per quad, if the TS-to-Rust `add_quad` argument order swaps
/// saturation for a tint channel, or if a future edit drops the `mix` from the shader — none of which
/// the absolute floor in [`the_panel_refracts_the_backdrop_beneath_it`] would distinguish from a driver
/// difference.
///
/// Both passes pin `brightness: 1.0`, which is the *only* thing about this test that changed when the
/// gain landed. It is not a relaxation — the 1.3x threshold and all three guards below are untouched —
/// it isolates the term under test. At the calibrated default gain these mid-tones clip: the magenta
/// quadrant reads `[255, 155, 255]` against `[255, 177, 255]`, so two of three channels are pinned to
/// white in both passes and the measured ratio falls to 1.28 no matter how well `u_saturation` works.
/// That is the same clipping hazard that made [`MUTED_QUADRANTS`] necessary in the first place, one
/// step further along the shader.
#[wasm_bindgen_test]
fn the_saturation_term_reaches_the_composite() {
    let neutral = render_backdrop_with(OpticalParams {
        saturation: 1.0,
        brightness: 1.0,
        ..OpticalParams::default()
    });
    let boosted = render_backdrop_with(OpticalParams {
        brightness: 1.0,
        ..OpticalParams::default()
    });

    let (qx, qy) = (WIDTH / 4, HEIGHT / 4);
    let neutral_red = dom_pixel(&neutral, qx, qy);
    let boosted_red = dom_pixel(&boosted, qx, qy);

    let neutral_spread = channel_spread(neutral_red);
    let boosted_spread = channel_spread(boosted_red);

    assert!(
        neutral_spread > 0,
        "the neutral-saturation pass read {neutral_red:?}, a perfectly grey pixel — the backdrop is \
         not reaching the composite at all, so this test would compare two zeros"
    );
    assert!(
        f64::from(boosted_spread) >= f64::from(neutral_spread) * 1.3,
        "saturation 1.8 gave a channel spread of {boosted_spread} ({boosted_red:?}) against \
         {neutral_spread} at saturation 1.0 ({neutral_red:?}); the default is 1.8, so u_saturation is \
         either not uploaded or not applied"
    );
    assert!(
        OpticalParams::default().saturation > 1.0,
        "this test assumes the default boosts chroma; a default of \
         {} makes it vacuous",
        OpticalParams::default().saturation
    );
}

/// The `brightness` gain must carry the luma the readiness handover takes away.
///
/// Every panel drops its CSS overlay from a near-white alpha 0.22 to 0.05 the instant the renderer
/// reports ready, so the composite underneath has to be at least as bright as the veil it replaces or
/// the whole page visibly darkens at ~780ms. `brightness` is that lever, and this is the gate that
/// stops it silently going away.
///
/// **One-sided, not a band.** The synthetic scene here does not reproduce the playground's deficit:
/// the panel covers the whole backdrop, so no darker surround is averaged into the blur, and at
/// `brightness: 1.0` the composite already sits near the CSS-overlay model. An absolute two-sided
/// parity assertion would therefore fail correct code — the same hazard that made
/// [`the_saturation_term_reaches_the_composite`] use muted mid-tones instead of primaries. So: a floor
/// plus a differential.
///
/// The floor models what the CSS fallback paints over this exact backdrop —
/// `0.78 * backdrop_luma + 0.22 * 240.4`, `GlassWindow`'s `rgba(240, 240, 245, 0.22)` over the
/// backdrop — and relies on two properties of the chains being compared: the blur is mean-preserving
/// (a normalized kernel over a backdrop whose quadrants all sit under the panel), and CSS `saturate()`
/// and `u_saturation` are both luma-preserving, so neither side's chroma scale shifts the mean.
#[wasm_bindgen_test]
fn the_brightness_term_holds_the_handover_luma() {
    for (rgb, css) in MUTED_QUADRANT_RGB.iter().zip(MUTED_QUADRANTS) {
        assert_eq!(
            format!("rgb({}, {}, {})", rgb[0], rgb[1], rgb[2]),
            css,
            "MUTED_QUADRANT_RGB and MUTED_QUADRANTS disagree, so the luma model below is not \
             describing the backdrop this test renders"
        );
    }

    // Luma of `rgba(240, 240, 245)`, the overlay colour GlassWindow fades.
    const OVERLAY_LUMA: f64 = 0.2126 * 240.0 + 0.7152 * 240.0 + 0.0722 * 245.0;
    let backdrop_luma = MUTED_QUADRANT_RGB
        .iter()
        .map(|rgb| luma([rgb[0], rgb[1], rgb[2], 255]))
        .sum::<f64>()
        / MUTED_QUADRANT_RGB.len() as f64;
    let css_fallback_luma = 0.78 * backdrop_luma + 0.22 * OVERLAY_LUMA;

    let neutral = render_backdrop_with(OpticalParams {
        brightness: 1.0,
        ..OpticalParams::default()
    });
    let boosted = render_backdrop_with(OpticalParams::default());

    let neutral_luma = mean_interior_luma(&neutral);
    let boosted_luma = mean_interior_luma(&boosted);

    // Anti-vacuous, in the spirit of the three on `the_saturation_term_reaches_the_composite`:
    // (a) the default must actually be a boost, or the differential compares a value to itself;
    assert!(
        OpticalParams::default().brightness > 1.0,
        "this test assumes the default gain lifts luma; a default of {} makes it vacuous",
        OpticalParams::default().brightness
    );
    // (b) the neutral pass must have headroom, or a 1.25x rise is not representable in 8 bits;
    assert!(
        neutral_luma < 200.0,
        "the brightness: 1.0 pass already reads {neutral_luma:.1} mean interior luma, too close to \
         white for a 1.25x rise to be representable — this test could only pass by clipping"
    );
    // (c) the boosted pass must not simply have been cranked to white, which is how "raise g until it
    //     passes" would satisfy the floor while looking worse than the CSS it replaces.
    assert!(
        boosted_luma < 245.0,
        "the default-brightness pass reads {boosted_luma:.1} mean interior luma — the composite has \
         been driven to near-white, not calibrated"
    );
    let boosted_spread = mean_interior_channel_spread(&boosted);
    assert!(
        boosted_spread > 16.0,
        "the default-brightness pass has a mean interior channel spread of {boosted_spread:.1}; the \
         gain has clipped the backdrop's colour away instead of lifting it (the brightness lever \
         exists precisely because a white veil would do this)"
    );

    assert!(
        boosted_luma >= css_fallback_luma,
        "the composite reads {boosted_luma:.1} mean interior luma against the {css_fallback_luma:.1} \
         the CSS fallback paints over the same backdrop (0.78 * {backdrop_luma:.1} + 0.22 * \
         {OVERLAY_LUMA:.1}); the readiness handover would darken the page by \
         {:.0}%",
        (1.0 - boosted_luma / css_fallback_luma) * 100.0
    );
    assert!(
        boosted_luma >= neutral_luma * 1.25,
        "brightness {} gave {boosted_luma:.1} mean interior luma against {neutral_luma:.1} at 1.0 — \
         a ratio of {:.2}, so u_brightness is either not resolved, not uploaded per quad, swapped \
         into a tint channel by the positional add_quad order, or dropped from the shader",
        OpticalParams::default().brightness,
        boosted_luma / neutral_luma
    );
}

/// The panel *body* must bend the light it transmits, not only its 8px perimeter.
///
/// This is the whole point of the volumetric lens. Before it, `(1 - edge_proximity)` scaled the front
/// normal to exactly `(0, 0, 1)` everywhere more than `corner_radius` inside the boundary, so
/// `refract` returned the view ray unchanged and the interior sampled the backdrop it sat directly on
/// top of — a flat frosted pane with a bevelled rim. Every other pixel test in this file passes under
/// that behaviour, including the refraction one: sampling straight down still tracks the quadrant
/// underneath.
///
/// So this is a differential: the same frame at `curvature: 0.15, thickness: 15.0` against
/// `curvature: 0.0, thickness: 0.0`, which reproduces exactly the old flat interior. Sampling only
/// [`interior_samples`] — 48px in from every edge, twice the 24px `corner_radius` bevel band — keeps
/// the rim's own refraction, and the inner bevel highlight, out of the comparison, so the difference
/// can only have come from the body.
///
/// Measured, with the lens in place: 220 of the 260 interior samples move, by a mean of 4.09 levels.
/// With `lens_tilt` forced to zero in the shader — the flat interior — 18 samples move, by a mean of
/// 0.24, and those 18 are the outermost ring, where the bevel's own tilt still refracts. The
/// thresholds below sit between the two.
#[wasm_bindgen_test]
fn the_volumetric_curvature_bends_interior_light() {
    let flat_optical = OpticalParams {
        curvature: 0.0,
        thickness: 0.0,
        ..OpticalParams::default()
    };
    let curved_optical = OpticalParams {
        curvature: 0.15,
        thickness: 15.0,
        ..OpticalParams::default()
    };

    let backdrop = muted_checkerboard();
    let flat = render_over(&backdrop, flat_optical);
    let flat_again = render_over(&backdrop, flat_optical);
    let curved = render_over(&backdrop, curved_optical);

    // The control: this pipeline is deterministic, so re-rendering the flat pass must reproduce it
    // byte for byte. Without this, driver dither or an uninitialised sample would look like bending.
    let control = interior_sample_deltas(&flat, &flat_again);
    assert_eq!(
        control.iter().copied().max().unwrap_or(0),
        0,
        "two renders of the identical flat frame disagree, so the differential below cannot \
         attribute anything to the curvature"
    );

    // Anti-vacuous: the backdrop must actually carry structure through the blur where the body samples
    // it, or a displacement of any size would land on the same colour and this test could not fail.
    let flat_spread = mean_interior_channel_spread(&flat);
    assert!(
        flat_spread > 16.0,
        "the flat pass has a mean interior channel spread of only {flat_spread:.1}; the checkerboard \
         has been blurred into a flat field, so displacing the sample point could not change a pixel"
    );

    let deltas = interior_sample_deltas(&flat, &curved);
    let bent = deltas.iter().filter(|d| **d >= 2).count();
    let mean_delta = deltas.iter().sum::<u32>() as f64 / deltas.len() as f64;

    assert!(
        bent * 4 >= deltas.len(),
        "only {bent} of {} interior samples moved at all between curvature 0.15 and a flat pane \
         (mean delta {mean_delta:.2}); the body is still transmitting light straight through, which \
         is the flat interior this lens replaces",
        deltas.len()
    );
    assert!(
        mean_delta >= 2.0,
        "the interior differs from the flat pane by a mean of only {mean_delta:.2} levels; the \
         curvature is reaching the shader but bending the light by a fraction of a pixel, so nothing \
         visible happens across the window body"
    );
}

/// A band declared farther away must refract further than a near one.
///
/// This is the parallax the depth banding exists for, and nothing above can see it: every earlier test
/// uploads a single band at the calibrated fallback depth, so the *distance* the exit ray travels was a
/// constant derived from the panel's own half-height. Two panels over the same backdrop moved
/// identically no matter what was actually behind them.
///
/// So this is a differential in the band's depth alone: the same checkerboard uploaded as band 0 at 40px
/// versus at 400px, at `curvature: 0.15, thickness: 15.0` (the same optics the curvature gate uses, so
/// the front normal is tilted enough for the distance to matter). Everything else — the panel, the
/// raster, the blur radius — is identical, so any pixel that moves moved because the ray travelled
/// further.
///
/// Measured: 238 of the 260 interior samples move, by a mean of 13.39 levels and a maximum of 65. With
/// `resolveBackdropDepth` forced to ignore its argument and always return the calibrated fallback — the
/// pre-banding behaviour — 0 samples move and the mean delta is 0.00. The thresholds below sit between
/// the two.
#[wasm_bindgen_test]
fn a_deeper_band_parallaxes_further_than_a_near_one() {
    let optical = OpticalParams {
        curvature: 0.15,
        thickness: 15.0,
        ..OpticalParams::default()
    };

    let backdrop = muted_checkerboard();
    let near = render_bands(&[(&backdrop, 40.0)], optical);
    let near_again = render_bands(&[(&backdrop, 40.0)], optical);
    let far = render_bands(&[(&backdrop, 400.0)], optical);

    // The control: the pipeline is deterministic, so the same depth twice must be byte-identical.
    let control = interior_sample_deltas(&near, &near_again);
    assert_eq!(
        control.iter().copied().max().unwrap_or(0),
        0,
        "two renders of the identical 40px-depth frame disagree, so the differential below cannot \
         attribute anything to the depth"
    );

    // Anti-vacuous: the backdrop must still carry structure through the blur where the body samples it,
    // or displacing the sample point by any distance would land on the same colour.
    let near_spread = mean_interior_channel_spread(&near);
    assert!(
        near_spread > 16.0,
        "the near-band pass has a mean interior channel spread of only {near_spread:.1}; the \
         checkerboard has been blurred into a flat field, so travelling further could not change a pixel"
    );

    let deltas = interior_sample_deltas(&near, &far);
    let moved = deltas.iter().filter(|delta| **delta >= 2).count();
    let mean_delta = deltas.iter().sum::<u32>() as f64 / deltas.len() as f64;

    assert!(
        moved * 2 > deltas.len(),
        "only {moved} of {} interior samples moved between a 40px band and a 400px one (mean delta \
         {mean_delta:.2}); the band depth is not reaching the refraction, so everything behind the \
         glass still sits at one calibrated distance",
        deltas.len()
    );
    assert!(
        mean_delta >= 2.0,
        "the 400px band differs from the 40px one by a mean of only {mean_delta:.2} levels; the depth \
         reaches the shader but moves the sample point by a fraction of a pixel, so no differential \
         parallax is visible"
    );
}

/// A near band must paint *over* the far band where it covers it, not be averaged into it.
///
/// Band 0 is an opaque cool colour across the whole canvas; band 1 covers only the left half and is
/// transparent over the right. If the bands were averaged — or composited in the wrong order — the left
/// half would read as a blend and the right half would be tinted by a layer that does not cover it.
/// Instead the left half must track band 1 and the right half band 0, which is what `accumulateBand`'s
/// `mix(acc, band, band_alpha)` over a far-to-near walk buys.
///
/// The red-minus-blue sign is the discriminator: it survives the tint mix, the saturation scale and the
/// brightness gain, all of which are monotonic in it, and it does not depend on absolute levels.
#[wasm_bindgen_test]
fn a_near_band_occludes_the_far_band_it_covers() {
    const COOL: &str = "rgb(48, 72, 200)";
    const WARM: &str = "rgb(200, 96, 32)";

    let far = solid_canvas(COOL);
    let near = left_half_canvas(WARM);
    let quad = inset_quad();

    let warmth = |pixels: &[u8], x_from: u32, x_to: u32| -> f64 {
        let mut samples = Vec::new();
        for y in (64..HEIGHT - 64).step_by(16) {
            for x in (x_from..x_to).step_by(16) {
                samples.push(dom_pixel(pixels, x, y));
            }
        }
        samples
            .iter()
            .map(|p| f64::from(p[0]) - f64::from(p[2]))
            .sum::<f64>()
            / samples.len() as f64
    };

    // Sampled well clear of the halves' boundary: the blur chain's sigma is ~32px at the default radius,
    // and the refraction moves the sample point on top of that.
    let left = 64..160;
    let right = 352..448;

    // The control: with only the far band, both halves are the same cool colour, so any warmth
    // difference between them in the banded frame came from band 1 and not from the panel's own shading.
    let far_only = render_bands(
        &[(&far, physics::AUTO_BACKDROP_DEPTH)],
        OpticalParams::default(),
    );
    let control_left = warmth(&far_only, left.start, left.end);
    let control_right = warmth(&far_only, right.start, right.end);
    assert!(
        control_left < 0.0 && control_right < 0.0,
        "the far band alone must read cool on both halves, got left {control_left:.1} and right \
         {control_right:.1}"
    );

    let banded = render_bands(
        &[
            (&far, physics::AUTO_BACKDROP_DEPTH),
            (&near, physics::AUTO_BACKDROP_DEPTH),
        ],
        OpticalParams::default(),
    );
    let banded_left = warmth(&banded, left.start, left.end);
    let banded_right = warmth(&banded, right.start, right.end);

    assert!(
        banded_left > 0.0,
        "the covered half reads {banded_left:.1} red-minus-blue; the near band is not occluding the \
         far one, so a layer floating over the wallpaper is being averaged into it"
    );
    assert!(
        banded_right < 0.0,
        "the uncovered half reads {banded_right:.1} red-minus-blue; the near band's transparent region \
         is bleeding into where it does not cover, so its alpha is not gating the mix"
    );
    // And the uncovered half must be untouched by the near band, not merely still cool.
    assert!(
        (banded_right - control_right).abs() < 4.0,
        "the uncovered half moved from {control_right:.1} to {banded_right:.1} when a band that does \
         not cover it was added"
    );
    // Anti-vacuous: the panel interior must still be showing real content rather than a flat field.
    let interior = interior_samples_of(&banded, &quad);
    let spread = mean_channel_spread(&interior);
    assert!(
        spread > 16.0,
        "the banded frame has a mean interior channel spread of only {spread:.1}, so the two bands' \
         colours have been washed out and the comparison above means little"
    );
}

/// Releasing a band must stop it being sampled at all.
///
/// A content layer that unmounts leaves its raster resident in the band's texture. If `has_content` did
/// not gate `u_band_count`, the composite would keep refracting a stale snapshot of DOM that is no
/// longer on the page. The frame after a release must therefore be byte-identical to one where the band
/// was never uploaded.
#[wasm_bindgen_test]
fn releasing_a_band_stops_it_being_sampled() {
    let far = muted_checkerboard();
    let near = left_half_canvas("rgb(200, 96, 32)");

    let render = |with_near: bool| -> Vec<u8> {
        let canvas = create_canvas(WIDTH, HEIGHT);
        let mut renderer =
            WebGl2Renderer::new(&canvas, WIDTH, HEIGHT).expect("WebGl2Renderer::new failed");
        renderer
            .set_band_from_canvas(0, &far, 120.0)
            .expect("uploading band 0 failed");
        if with_near {
            renderer
                .set_band_from_canvas(1, &near, 40.0)
                .expect("uploading band 1 failed");
            assert!(
                renderer.has_real_background(),
                "two uploaded bands must count as a real backdrop"
            );
            renderer.release_bands_from(1);
            assert!(
                renderer.has_real_background(),
                "releasing band 1 must leave band 0 sampled"
            );
        }
        renderer
            .update_quads(&[inset_quad()])
            .expect("update_quads failed");
        renderer.render().expect("render failed");
        read_canvas(&request_context(&canvas))
    };

    let band_zero_only = render(false);
    let released = render(true);

    // Anti-vacuous: the near band really would have changed the frame had it stayed active. Without
    // this, a released band and an ignored one look the same because neither ever mattered.
    let still_active = render_bands(&[(&far, 120.0), (&near, 40.0)], OpticalParams::default());
    let effect = interior_sample_deltas(&band_zero_only, &still_active);
    assert!(
        effect.iter().copied().max().unwrap_or(0) >= 2,
        "adding the near band changed nothing, so this test cannot tell a released band from an \
         unsampled one"
    );

    assert_eq!(
        released, band_zero_only,
        "the frame after release_bands_from(1) differs from a band-0-only frame, so a released band is \
         still being refracted"
    );
}

/// Two panels must each blur at their own radius.
///
/// The renderer used to blur once at the *mean* of every submitted quad's `blur_radius` and have the
/// composite sample that single result, so a 2px panel and a 30px panel both rendered at 16px and looked
/// identical — the "per-quad blurRadius is not honoured" limitation. Now the chain runs once per
/// quantized radius, with that group's quads drawn in between.
///
/// [`mean_interior_luma_step`] is the measure, and each panel is compared against *itself* at the sharp
/// radius rather than against its neighbour: the two positions sit over different parts of the
/// checkerboard, and at an equal radius they already read 5.19 and 6.97, a 34% spread that no
/// panel-against-panel threshold can see past.
#[wasm_bindgen_test]
fn two_panels_blur_at_their_own_radius() {
    // Two panels side by side, comfortably non-overlapping: overlapping glass is unsupported, and with
    // per-group draws an overlap would composite in radius order rather than submission order.
    let panel = |x: f32, blur_radius: f32| GlassQuad {
        x,
        y: 32.0,
        width: 216.0,
        height: HEIGHT as f32 - 64.0,
        corner_radius: 24.0,
        _padding: [0.0; 3],
        optical: OpticalParams {
            blur_radius,
            ..OpticalParams::default()
        },
    };
    const SHARP: f32 = 2.0;
    const FROSTED: f32 = 30.0;
    let left = |blur_radius| panel(32.0, blur_radius);
    let right = |blur_radius| panel(264.0, blur_radius);

    let backdrop = muted_checkerboard();
    let control = render_quads_over(&backdrop, &[left(SHARP), right(SHARP)]);
    let differential = render_quads_over(&backdrop, &[left(SHARP), right(FROSTED)]);

    let control_left = mean_interior_luma_step(&control, &left(SHARP));
    let control_right = mean_interior_luma_step(&control, &right(SHARP));
    // Anti-vacuous: there has to be interior detail for a wider radius to destroy. A flat backdrop, or a
    // narrow radius that had already flattened it, would let the assertions below pass on nothing.
    assert!(
        control_left > 3.0 && control_right > 3.0,
        "the control frame's panels read {control_left:.2} and {control_right:.2} mean interior luma \
         step; the sharp radius has already flattened the checkerboard, so a wider one could not flatten \
         it further"
    );

    let sharp = mean_interior_luma_step(&differential, &left(SHARP));
    let frosted = mean_interior_luma_step(&differential, &right(FROSTED));
    assert!(
        control_right > frosted * 3.0,
        "the {FROSTED}px panel reads {frosted:.2} mean interior luma step where the same panel at \
         {SHARP}px read {control_right:.2} — a ratio of only {:.2}. The wider radius is not reaching \
         this quad, which is the shared-blur limitation this replaces",
        control_right / frosted.max(f64::EPSILON)
    );
    // And the sharp panel must be untouched by its neighbour's radius: it is drawn in its own group,
    // against its own run of the chain. This is the half a *mean* radius could never satisfy — under the
    // old code both panels would have moved to 16px together.
    assert!(
        (sharp - control_left).abs() / control_left < 0.1,
        "the sharp panel moved from {control_left:.2} to {sharp:.2} when only its *neighbour's* radius \
         changed, so the groups are still sharing one blurred backdrop"
    );
}

/// A renderer that was never handed a backdrop must draw nothing.
///
/// `glass_composite.frag` writes `alpha = 1.0` across the whole rounded-box SDF and adds a
/// backdrop-independent sheen floor, so compositing over the 1x1 transparent seed that
/// `create_background_texture` allocates yields a *constant opaque* colour — a grey rectangle hiding
/// the DOM behind it, which is worse than the CSS fallback it replaces. `render()` therefore skips the
/// composite entirely until an upload has succeeded, and that is what this pins.
#[wasm_bindgen_test]
fn no_backdrop_means_a_transparent_canvas() {
    let canvas = create_canvas(WIDTH, HEIGHT);
    let mut renderer =
        WebGl2Renderer::new(&canvas, WIDTH, HEIGHT).expect("WebGl2Renderer::new failed");

    assert!(
        !renderer.has_real_background(),
        "the 1x1 transparent seed must not count as a real backdrop"
    );

    renderer
        .update_quads(&[inset_quad()])
        .expect("update_quads failed");
    renderer.render().expect("render failed");

    let gl = request_context(&canvas);
    let pixels = read_canvas(&gl);

    // Dead centre of the quad: where an unguarded composite would have painted its most opaque pixel.
    let centre = dom_pixel(&pixels, WIDTH / 2, HEIGHT / 2);
    assert_eq!(
        centre[3], 0,
        "with no backdrop uploaded the panel centre read {centre:?}; anything but alpha 0 means the \
         composite ran over an empty texture and is hiding the DOM"
    );

    for y in (48..HEIGHT - 48).step_by(32) {
        for x in (48..WIDTH - 48).step_by(32) {
            let pixel = dom_pixel(&pixels, x, y);
            assert_eq!(
                pixel[3], 0,
                "pixel at DOM ({x}, {y}) read {pixel:?} with no backdrop uploaded"
            );
        }
    }
}
