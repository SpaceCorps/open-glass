use super::{GlassQuad, GlassRenderer};

/// WebGL2 fallback optical rendering pipeline.
pub struct WebGl2Renderer {
    width: u32,
    height: u32,
    quads: Vec<GlassQuad>,
}

impl WebGl2Renderer {
    /// Create and initialize a new WebGL2 glass renderer.
    pub fn new(width: u32, height: u32) -> Result<Self, String> {
        Ok(Self {
            width,
            height,
            quads: Vec::new(),
        })
    }
}

impl GlassRenderer for WebGl2Renderer {
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
        // Ping-pong FBO Kawase blur and composite
        Ok(())
    }

    fn backend_name(&self) -> &'static str {
        "webgl2"
    }
}
