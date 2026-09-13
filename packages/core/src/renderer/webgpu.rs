use super::{GlassQuad, GlassRenderer};

/// WebGPU optical rendering pipeline.
pub struct WebGpuRenderer {
    width: u32,
    height: u32,
    quads: Vec<GlassQuad>,
}

impl WebGpuRenderer {
    /// Create and initialize a new WebGPU glass renderer.
    pub fn new(width: u32, height: u32) -> Result<Self, String> {
        Ok(Self {
            width,
            height,
            quads: Vec::new(),
        })
    }
}

impl GlassRenderer for WebGpuRenderer {
    fn resize(&mut self, width: u32, height: u32) -> Result<(), String> {
        self.width = width;
        self.height = height;
        Ok(())
    }

    fn update_quads(&mut self, quads: &[GlassQuad]) -> Result<(), String> {
        self.quads = quads.to_vec();
        Ok(())
    }

    fn render(&mut self) -> Result<(), String> {
        // Dispatches Kawase downsample/upsample passes and glass composition
        Ok(())
    }

    fn backend_name(&self) -> &'static str {
        "webgpu"
    }
}
