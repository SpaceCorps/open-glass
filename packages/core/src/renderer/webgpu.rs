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
    use crate::optical::physics;

    const COMPOSITE_WGSL: &str = include_str!("../shaders/glass_composite.wgsl");
    const COMPOSITE_FRAG: &str = include_str!("../shaders/glass_composite.frag");
    const KAWASE_DOWN_WGSL: &str = include_str!("../shaders/kawase_down.wgsl");
    const KAWASE_UP_WGSL: &str = include_str!("../shaders/kawase_up.wgsl");

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

    /// Parses `const <name>: f32 = <value>;` from a WGSL source at module scope.
    fn wgsl_f32_const(src: &str, name: &str) -> f32 {
        let needle = format!("const {name}: f32 =");
        let start = src
            .find(&needle)
            .unwrap_or_else(|| panic!("expected `{needle}` declaration in WGSL source"));
        let value = src[start + needle.len()..]
            .split(';')
            .next()
            .unwrap_or_else(|| panic!("`{needle}` declaration is never terminated with `;`"))
            .trim();
        value
            .parse::<f32>()
            .unwrap_or_else(|_| panic!("`{needle}` value `{value}` is not a valid f32"))
    }

    #[test]
    fn test_wgsl_composite_declares_every_frag_uniform() {
        let frag_names = frag_uniform_names(COMPOSITE_FRAG);
        assert_eq!(frag_names.len(), 15, "expected 15 uniforms in glass_composite.frag");

        let mut wgsl_names = wgsl_struct_field_names(COMPOSITE_WGSL);
        wgsl_names.extend(wgsl_binding_names(COMPOSITE_WGSL));

        let missing: Vec<&String> = frag_names.iter().filter(|n| !wgsl_names.contains(n)).collect();
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

        let tinted_at = COMPOSITE_WGSL.find("let tinted").expect("must compute `tinted`");
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

    #[test]
    fn test_wgsl_blur_shaders_use_the_calibrated_step_scale() {
        for (name, src) in [
            ("kawase_down.wgsl", KAWASE_DOWN_WGSL),
            ("kawase_up.wgsl", KAWASE_UP_WGSL),
        ] {
            let scale = wgsl_f32_const(src, "KAWASE_STEP_SCALE");
            assert_eq!(
                scale,
                physics::KAWASE_STEP_SCALE,
                "{name}'s KAWASE_STEP_SCALE ({scale}) does not match physics::KAWASE_STEP_SCALE \
                 ({}); the scale is calibrated in physics.rs and changing it in one place only \
                 reintroduces the WebGL2/WebGPU sigma split",
                physics::KAWASE_STEP_SCALE
            );

            let step_line = src
                .lines()
                .find(|line| line.trim_start().starts_with("let step ="))
                .unwrap_or_else(|| panic!("{name} has no `let step =` line"));
            assert!(
                !step_line.contains("0.25"),
                "{name}'s step expression still contains the stale literal 0.25: {step_line}"
            );
        }
    }

    #[test]
    fn test_wgsl_blur_step_expressions_match_the_cpu_kernels() {
        assert!(
            KAWASE_DOWN_WGSL.contains(
                "(uniforms.iteration + 1.0) * max(uniforms.blur_radius * KAWASE_STEP_SCALE, 1.0)"
            ),
            "kawase_down.wgsl's step expression must match dual_kawase_down_step's shape"
        );
        let down_offset_line = KAWASE_DOWN_WGSL
            .lines()
            .find(|line| line.trim_start().starts_with("let offset ="))
            .expect("kawase_down.wgsl has no `let offset =` line");
        assert_eq!(
            down_offset_line.trim(),
            "let offset = uniforms.texel_size * step;",
            "kawase_down.wgsl's offset must be the full step with no extra factor, matching \
             dual_kawase_down_offsets and kawase_blur.frag (the name `half_offset` in physics.rs \
             refers to the diagonal split into 4 taps, not a halved step)"
        );

        assert!(
            KAWASE_UP_WGSL.contains(
                "(uniforms.iteration + 0.5) * max(uniforms.blur_radius * KAWASE_STEP_SCALE, 1.0)"
            ),
            "kawase_up.wgsl's step expression must match dual_kawase_up_step's shape"
        );
        let up_offset_line = KAWASE_UP_WGSL
            .lines()
            .find(|line| line.trim_start().starts_with("let offset ="))
            .expect("kawase_up.wgsl has no `let offset =` line");
        assert_eq!(
            up_offset_line.trim(),
            "let offset = uniforms.texel_size * step;",
            "kawase_up.wgsl's offset must carry no extra factor; the tent filter's own inner ring \
             (`let half_offset = offset * 0.5;`) is a separate, correct line"
        );
    }

    #[test]
    fn test_wgsl_blur_chain_hits_the_css_blur_target() {
        // Mirrors physics::kawase_pyramid_sigma's variance sum, but driven by the scale parsed out
        // of kawase_down.wgsl / kawase_up.wgsl rather than physics::KAWASE_STEP_SCALE, so this test
        // moves when the shader text moves rather than trivially agreeing with itself.
        //
        // Before this plan's fix (stale 0.25 scale, extra `* 0.5` on the down offset): 27.99px,
        // -12.5% against the 32.0px CSS target, outside the +/-10% band. After: 31.71px, -0.9%.
        let down_scale = wgsl_f32_const(KAWASE_DOWN_WGSL, "KAWASE_STEP_SCALE");
        let up_scale = wgsl_f32_const(KAWASE_UP_WGSL, "KAWASE_STEP_SCALE");

        let down_step =
            |iteration: u32, blur_radius: f32| (iteration as f32 + 1.0) * (blur_radius * down_scale).max(1.0);
        let up_step =
            |iteration: u32, blur_radius: f32| (iteration as f32 + 0.5) * (blur_radius * up_scale).max(1.0);

        let levels = 5u32;
        let blur_radius = 16.0f32;
        let mut variance = 0.0f32;
        for iteration in 0..levels {
            let down = down_step(iteration, blur_radius);
            variance += down * down;
        }
        for iteration in 0..levels.saturating_sub(1) {
            let up = up_step(iteration, blur_radius);
            variance += up * up;
        }
        for level in 0..levels {
            let box_width = (1u32 << (level + 1)) as f32;
            variance += 2.0 * box_width * box_width / 12.0;
        }
        let sigma = variance.sqrt();

        let expected = physics::kawase_pyramid_sigma(blur_radius, levels);
        assert!(
            (sigma - expected).abs() <= 0.01,
            "WGSL step formulas produce sigma {sigma}px, expected {expected}px matching the \
             CPU/WebGL2 chain, within 0.01px"
        );

        let target = physics::CSS_BLUR_PIXELS_PER_RADIUS * blur_radius;
        assert!(
            (sigma - target).abs() <= target * 0.10,
            "WGSL chain sigma at blur_radius {blur_radius} is {sigma}px, outside +/-10% of the \
             {target}px CSS equivalent"
        );
    }
}
