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

    const COMPOSITE_WGSL: &str = include_str!("../shaders/glass_composite.wgsl");
    const COMPOSITE_FRAG: &str = include_str!("../shaders/glass_composite.frag");

    /// Every `uniform <type> u_name;` declaration in the frag, with the `u_` prefix stripped.
    fn frag_uniform_names(src: &str) -> Vec<String> {
        src.lines()
            .filter_map(|line| {
                let trimmed = line.trim();
                if !trimmed.starts_with("uniform ") {
                    return None;
                }
                let before_semicolon = trimmed.split(';').next()?;
                let last_token = before_semicolon.split_whitespace().last()?;
                let name = last_token.split('[').next()?;
                name.strip_prefix("u_").map(str::to_string)
            })
            .collect()
    }

    /// Field names declared inside `struct GlassCompositeUniforms { ... }`.
    ///
    /// The block was called `OpticalUniforms` until its layout was pinned to
    /// [`super::uniforms::GlassCompositeUniforms`], which is the Rust struct it must match byte for
    /// byte. This test and its sibling below check a different axis to
    /// `test_composite_uniforms_match_the_wgsl_declaration` over there: that one pins the WGSL against
    /// the *Rust* struct's fields and offsets, these two pin its *parameter surface* against the GLSL
    /// composite, so a term added to one shader and not the other is caught either way round.
    fn wgsl_struct_field_names(src: &str) -> Vec<String> {
        let struct_start = src
            .find("struct GlassCompositeUniforms")
            .expect("glass_composite.wgsl must declare GlassCompositeUniforms");
        let brace_start = src[struct_start..].find('{').unwrap() + struct_start;
        let brace_end = src[brace_start..].find('}').unwrap() + brace_start;
        src[brace_start + 1..brace_end]
            .lines()
            .filter_map(|line| {
                let trimmed = line.trim();
                if trimmed.is_empty() || trimmed.starts_with("//") {
                    return None;
                }
                let name = trimmed.split(':').next()?.trim();
                (!name.is_empty()).then(|| name.to_string())
            })
            .collect()
    }

    /// Module-scope `@group(...) @binding(...) var[<...>] name: T` binding names.
    fn wgsl_binding_names(src: &str) -> Vec<String> {
        src.lines()
            .filter_map(|line| {
                let trimmed = line.trim();
                if !trimmed.starts_with("@group") {
                    return None;
                }
                let after_var = trimmed.split("var").nth(1)?.trim_start();
                let after_var = if let Some(rest) = after_var.strip_prefix('<') {
                    rest.split_once('>')?.1.trim_start()
                } else {
                    after_var
                };
                after_var.split(':').next().map(|s| s.trim().to_string())
            })
            .collect()
    }

    #[test]
    fn test_wgsl_composite_declares_every_frag_uniform() {
        let frag_names = frag_uniform_names(COMPOSITE_FRAG);
        assert_eq!(
            frag_names.len(),
            15,
            "expected 15 uniforms in glass_composite.frag"
        );

        let mut wgsl_names = wgsl_struct_field_names(COMPOSITE_WGSL);
        wgsl_names.extend(wgsl_binding_names(COMPOSITE_WGSL));

        let missing: Vec<&String> = frag_names
            .iter()
            .filter(|n| !wgsl_names.contains(n))
            .collect();
        assert!(
            missing.is_empty(),
            "glass_composite.wgsl is missing {missing:?}, which glass_composite.frag declares. \
             A WebGPU backend built against this file would silently drop those terms."
        );
    }

    #[test]
    fn test_wgsl_composite_has_no_unexplained_extra_parameters() {
        // WGSL-only names and why each is allowed:
        // - `optical`: the uniform block variable itself; GLSL has no block.
        // - `texture_sampler`: GLSL folds the sampler into `sampler2D u_blurred_texture`.
        // - `blur_radius`: mirrors `OpticalParams`; consumed by the Kawase passes, not the composite.
        // - `_padding`: the block's explicit tail to the 96-byte stride WGSL rounds it up to. It
        //   replaced the earlier `padding` / `padding2` pair, whose offsets did not do what their
        //   names suggested — see `super::uniforms::GlassCompositeUniforms`.
        const ALLOWLIST: [&str; 4] = ["optical", "texture_sampler", "blur_radius", "_padding"];

        let frag_names = frag_uniform_names(COMPOSITE_FRAG);
        let mut wgsl_names = wgsl_struct_field_names(COMPOSITE_WGSL);
        wgsl_names.extend(wgsl_binding_names(COMPOSITE_WGSL));

        let unexplained: Vec<&String> = wgsl_names
            .iter()
            .filter(|n| !frag_names.contains(n) && !ALLOWLIST.contains(&n.as_str()))
            .collect();
        assert!(
            unexplained.is_empty(),
            "glass_composite.wgsl declares {unexplained:?}, which glass_composite.frag does not. \
             Add the field to the WGSL's frag counterpart, or add it to this test's allowlist with a reason."
        );
    }

    #[test]
    fn test_wgsl_composite_applies_saturation_then_brightness_then_sheen() {
        assert!(
            COMPOSITE_WGSL.contains("optical.saturation"),
            "composite must read optical.saturation"
        );
        assert!(
            COMPOSITE_WGSL.contains("optical.brightness"),
            "composite must read optical.brightness"
        );
        assert!(
            COMPOSITE_WGSL.contains("0.2126, 0.7152, 0.0722"),
            "luma weights must match the frag's Rec. 709 coefficients"
        );

        let tinted_at = COMPOSITE_WGSL
            .find("let tinted")
            .expect("must compute `tinted`");
        let saturation_at = COMPOSITE_WGSL
            .find("optical.saturation")
            .expect("must read optical.saturation");
        let brightness_at = COMPOSITE_WGSL
            .find("optical.brightness")
            .expect("must read optical.brightness");
        assert!(
            tinted_at < saturation_at && saturation_at < brightness_at,
            "chroma scale must run after the tint mix and before the brightness gain"
        );

        let final_rgb_line = COMPOSITE_WGSL
            .lines()
            .find(|line| line.contains("let final_rgb"))
            .expect("must assign final_rgb");
        assert!(
            final_rgb_line.contains("brightened"),
            "final_rgb must add the sheen on top of `brightened`, not `tinted` or `saturated`, \
             so the additive sheen lands outside the brightness gain"
        );
    }

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
