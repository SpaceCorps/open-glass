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
//! The whole file is `cfg`'d to `wasm32`, so a host `cargo test --workspace` compiles it to nothing
//! and reports zero tests for this target rather than failing to build.

#![cfg(target_arch = "wasm32")]

use open_glass_core::optical::physics::OpticalParams;
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

/// [`backdrop_canvas`] with the quadrant colours given, clockwise from the DOM top-left.
fn quadrant_canvas(colors: [&str; 4]) -> HtmlCanvasElement {
    let canvas = create_canvas(WIDTH, HEIGHT);
    let ctx = canvas
        .get_context("2d")
        .expect("requesting a 2d context threw")
        .expect("2d is not available on this canvas")
        .dyn_into::<CanvasRenderingContext2d>()
        .expect("the canvas returned a non-2D context");

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

/// Mean [`luma`] over [`interior_samples`].
fn mean_interior_luma(pixels: &[u8]) -> f64 {
    let samples = interior_samples(pixels);
    samples.iter().copied().map(luma).sum::<f64>() / samples.len() as f64
}

/// Mean [`channel_spread`] over [`interior_samples`] — the "mean channel spread" the playground
/// captures are measured on, so a brightness gain that reached white cannot hide here.
fn mean_interior_channel_spread(pixels: &[u8]) -> f64 {
    let samples = interior_samples(pixels);
    samples
        .iter()
        .copied()
        .map(|p| f64::from(channel_spread(p)))
        .sum::<f64>()
        / samples.len() as f64
}

/// Render the backdrop with one inset quad at these optical parameters and read the frame back.
///
/// Uses [`MUTED_QUADRANTS`], not [`backdrop_canvas`]'s primaries: this feeds
/// [`the_saturation_term_reaches_the_composite`], and a primary already sits at the gamut edge, so
/// `u_saturation`'s clamp swallows almost all of a boost (measured: spread 218 at saturation 1.0
/// against 251 at 1.8, a 1.15x ratio for a 1.8x scale — not the 1.3x floor this test needs).
fn render_backdrop_with(optical: OpticalParams) -> Vec<u8> {
    let canvas = create_canvas(WIDTH, HEIGHT);
    let mut renderer =
        WebGl2Renderer::new(&canvas, WIDTH, HEIGHT).expect("WebGl2Renderer::new failed");
    renderer
        .set_background_from_canvas(&quadrant_canvas(MUTED_QUADRANTS))
        .expect("uploading the backdrop failed");
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
