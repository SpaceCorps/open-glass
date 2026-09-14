//! Headless-browser proof that the WebGL2 pipeline's GLSL compiles and links on a real driver.
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
//! The whole file is `cfg`'d to `wasm32`, so a host `cargo test --workspace` compiles it to nothing
//! and reports zero tests for this target rather than failing to build.

#![cfg(target_arch = "wasm32")]

use open_glass_core::renderer::webgl2::WebGl2Renderer;
use wasm_bindgen::JsCast;
use wasm_bindgen_test::{wasm_bindgen_test, wasm_bindgen_test_configure};
use web_sys::{HtmlCanvasElement, WebGl2RenderingContext as Gl};

// The default harness runs in Node, which has no WebGL2 at all.
wasm_bindgen_test_configure!(run_in_browser);

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
