pub mod optical;
pub mod renderer;

use optical::physics::{self, OpticalParams};
use renderer::{
    webgl2::WebGl2Renderer, webgpu::WebGpuRenderer, GlassQuad, GlassRenderer, RendererBackend,
};
use wasm_bindgen::prelude::*;
use web_sys::{HtmlCanvasElement, OffscreenCanvas};

#[wasm_bindgen]
pub fn init_panic_hook() {
    console_error_panic_hook::set_once();
}

#[wasm_bindgen]
pub struct WasmGlassEngine {
    renderer: Box<dyn GlassRenderer>,
    quads: Vec<GlassQuad>,
}

#[wasm_bindgen]
impl WasmGlassEngine {
    #[wasm_bindgen(constructor)]
    pub fn new(
        canvas: HtmlCanvasElement,
        backend: RendererBackend,
        width: u32,
        height: u32,
    ) -> Result<WasmGlassEngine, JsValue> {
        let renderer: Box<dyn GlassRenderer> = match backend {
            RendererBackend::Auto | RendererBackend::WebGpu => {
                // In auto mode, try WebGpu first, then fallback to WebGl2
                match WebGpuRenderer::new(width, height) {
                    Ok(r) => Box::new(r),
                    Err(_) => Box::new(
                        WebGl2Renderer::new(&canvas, width, height)
                            .map_err(|e| JsValue::from_str(&e))?,
                    ),
                }
            }
            RendererBackend::WebGl2 => Box::new(
                WebGl2Renderer::new(&canvas, width, height).map_err(|e| JsValue::from_str(&e))?,
            ),
        };

        Ok(Self {
            renderer,
            quads: Vec::new(),
        })
    }

    /// Whether a real backdrop raster has ever been uploaded successfully.
    ///
    /// The TypeScript facade's `isRenderReady()` requires this on top of a live engine. Without it,
    /// readiness meant only "the renderer was constructed", and the composite pass painted a uniform
    /// opaque rectangle over the DOM while every consumer had already dropped its CSS
    /// `backdrop-filter`.
    #[wasm_bindgen]
    pub fn has_real_background(&self) -> bool {
        self.renderer.has_real_background()
    }

    /// Upload a rasterized DOM backdrop from an `HTMLCanvasElement` into the background texture.
    #[wasm_bindgen]
    pub fn set_background_from_canvas(&mut self, canvas: HtmlCanvasElement) -> Result<(), JsValue> {
        self.renderer
            .set_background_from_canvas(&canvas)
            .map_err(|e| JsValue::from_str(&e))
    }

    /// Upload a rasterized DOM backdrop from an `OffscreenCanvas` into the background texture.
    #[wasm_bindgen]
    pub fn set_background_from_offscreen_canvas(
        &mut self,
        canvas: OffscreenCanvas,
    ) -> Result<(), JsValue> {
        self.renderer
            .set_background_from_offscreen_canvas(&canvas)
            .map_err(|e| JsValue::from_str(&e))
    }

    #[wasm_bindgen]
    pub fn resize(&mut self, width: u32, height: u32) -> Result<(), JsValue> {
        self.renderer
            .resize(width, height)
            .map_err(|e| JsValue::from_str(&e))
    }

    #[wasm_bindgen]
    pub fn clear_quads(&mut self) {
        self.quads.clear();
    }

    #[wasm_bindgen]
    #[allow(clippy::too_many_arguments)]
    pub fn add_quad(
        &mut self,
        x: f32,
        y: f32,
        width: f32,
        height: f32,
        corner_radius: f32,
        ior: f32,
        blur_radius: f32,
        dispersion: f32,
        rim_power: f32,
        sheen_intensity: f32,
        light_angle: f32,
        roughness: f32,
        saturation: f32,
        brightness: f32,
        thickness: f32,
        curvature: f32,
        tint_r: f32,
        tint_g: f32,
        tint_b: f32,
        tint_a: f32,
    ) {
        self.quads.push(GlassQuad {
            x,
            y,
            width,
            height,
            corner_radius,
            _padding: [0.0; 3],
            optical: OpticalParams {
                ior,
                blur_radius,
                dispersion,
                rim_power,
                sheen_intensity,
                light_angle,
                roughness,
                saturation,
                brightness,
                thickness,
                curvature,
                tint_color: [tint_r, tint_g, tint_b, tint_a],
            },
        });
    }

    #[wasm_bindgen]
    pub fn render(&mut self) -> Result<(), JsValue> {
        self.renderer
            .update_quads(&self.quads)
            .map_err(|e| JsValue::from_str(&e))?;
        self.renderer.render().map_err(|e| JsValue::from_str(&e))
    }

    #[wasm_bindgen]
    pub fn backend_name(&self) -> String {
        self.renderer.backend_name().to_string()
    }
}

/// Helper function to calculate Fresnel reflectance using Schlick's approximation.
#[wasm_bindgen]
pub fn calculate_fresnel(cos_theta: f32, n1: f32, n2: f32) -> f32 {
    physics::fresnel_schlick(cos_theta, n1, n2)
}
