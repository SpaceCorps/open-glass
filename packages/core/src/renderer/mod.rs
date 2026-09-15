pub mod uniforms;
pub mod webgl2;
pub mod webgpu;

use crate::optical::physics::OpticalParams;
use wasm_bindgen::prelude::*;

/// Representation of a glass UI element quad submitted to the GPU.
///
/// This is a CPU-side batch element, iterated per frame rather than uploaded, so its layout is
/// deliberately not a std140 one. The uniform buffer layout lives in
/// [`uniforms::GlassCompositeUniforms`], and a field added here has to be plumbed through
/// [`uniforms::GlassCompositeUniforms::from_quad`], which will not compile until it is.
#[repr(C)]
#[derive(Debug, Clone, Copy, PartialEq, bytemuck::Pod, bytemuck::Zeroable)]
pub struct GlassQuad {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
    pub corner_radius: f32,
    pub _padding: [f32; 3],
    pub optical: OpticalParams,
}

impl Default for GlassQuad {
    fn default() -> Self {
        Self {
            x: 0.0,
            y: 0.0,
            width: 200.0,
            height: 150.0,
            corner_radius: 16.0,
            _padding: [0.0; 3],
            optical: OpticalParams::default(),
        }
    }
}

/// Abstract renderer trait unifying WebGPU and WebGL2 optical passes.
pub trait GlassRenderer {
    /// Handle canvas resize and reallocate offscreen ping-pong buffers.
    fn resize(&mut self, width: u32, height: u32) -> Result<(), String>;
    /// Update the batch of glass quads to render.
    fn update_quads(&mut self, quads: &[GlassQuad]) -> Result<(), String>;
    /// Execute optical passes (Kawase down/up blur, refraction, composite).
    fn render(&mut self) -> Result<(), String>;
    /// Retrieve the active graphics backend identifier.
    fn backend_name(&self) -> &'static str;

    /// Whether a real backdrop raster has ever been uploaded into this renderer.
    ///
    /// This is the difference between "a background texture exists" and "a background texture holds
    /// content". `glass_composite.frag` writes `alpha = 1.0` everywhere inside the rounded-box SDF
    /// and adds a backdrop-independent sheen floor, so compositing over an empty backdrop paints a
    /// uniform opaque rectangle that hides the DOM behind it — strictly worse than the CSS fallback
    /// it replaces. The opaque output is correct once the texture holds real content; the bug is
    /// compositing, and claiming readiness, before it does. Both `render()` and the TypeScript
    /// readiness gate key off this, so a backend that never receives a backdrop degrades to a
    /// transparent canvas rather than a grey block.
    fn has_real_background(&self) -> bool {
        false
    }

    /// Upload a rasterized DOM backdrop from an `HTMLCanvasElement` into the background texture.
    fn set_background_from_canvas(
        &mut self,
        _canvas: &web_sys::HtmlCanvasElement,
    ) -> Result<(), String> {
        Err("backend does not support background texture ingestion".to_string())
    }

    /// Upload a rasterized DOM backdrop from an `OffscreenCanvas` into the background texture.
    fn set_background_from_offscreen_canvas(
        &mut self,
        _canvas: &web_sys::OffscreenCanvas,
    ) -> Result<(), String> {
        Err("backend does not support background texture ingestion".to_string())
    }
}

#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RendererBackend {
    Auto,
    WebGpu,
    WebGl2,
}
