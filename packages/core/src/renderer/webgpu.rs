use super::{GlassQuad, GlassRenderer};

/// WebGPU optical rendering pipeline.
///
/// Not implemented yet: [`WebGpuRenderer::new`] always fails so that `RendererBackend::Auto`
/// falls through to the real WebGL2 pipeline instead of silently selecting a no-op backend.
pub struct WebGpuRenderer {
    quads: Vec<GlassQuad>,
}

impl WebGpuRenderer {
    /// Attempt to create and initialize a new WebGPU glass renderer.
    ///
    /// Always returns `Err` until the WGSL pipeline lands, so callers fall back to
    /// [`super::webgl2::WebGl2Renderer`].
    pub fn new(_width: u32, _height: u32) -> Result<Self, String> {
        Err("WebGPU backend not yet implemented".to_string())
    }
}

impl GlassRenderer for WebGpuRenderer {
    fn resize(&mut self, _width: u32, _height: u32) -> Result<(), String> {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_webgpu_renderer_construction_always_fails() {
        let result = WebGpuRenderer::new(800, 600);
        assert!(
            result.is_err(),
            "WebGpuRenderer::new must fail so RendererBackend::Auto falls back to WebGL2"
        );
        assert_eq!(
            result.err().unwrap(),
            "WebGPU backend not yet implemented",
            "error text is surfaced to JS through WasmGlassEngine::new"
        );
    }

    #[test]
    fn test_webgpu_trait_impl_retained_for_future_pipeline() {
        let mut renderer = WebGpuRenderer { quads: Vec::new() };
        assert_eq!(renderer.backend_name(), "webgpu");
        assert!(renderer.resize(1024, 768).is_ok());
        assert!(renderer.update_quads(&[GlassQuad::default()]).is_ok());
        assert_eq!(renderer.quads.len(), 1);
        assert!(renderer.render().is_ok());
    }
}
