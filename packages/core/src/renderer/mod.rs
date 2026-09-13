pub mod webgl2;
pub mod webgpu;

use crate::optical::physics::OpticalParams;
use wasm_bindgen::prelude::*;

/// Representation of a glass UI element quad submitted to the GPU.
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
}

#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RendererBackend {
    Auto,
    WebGpu,
    WebGl2,
}
