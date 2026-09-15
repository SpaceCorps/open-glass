//! The only thing in the build that a WGSL shader compiler ever sees, the way
//! `webgl2_browser.rs` is the only thing a real GLSL driver ever sees.
//!
//! Nothing else validates `src/shaders/*.wgsl`: `include_str!` reaches `glass_composite.wgsl` from
//! two `#[cfg(test)]` modules that only pattern-match its source *text*, `kawase_down.wgsl` and
//! `kawase_up.wgsl` are not read by any Rust at all, and there is no `wgpu` dependency to build a
//! real pipeline from them. A WGSL type error is therefore invisible until the first WebGPU frame,
//! which does not exist yet either — see `WebGpuRenderer::new`, which always returns `Err`.
//!
//! `naga` is a host-only dev-dependency (`target.'cfg(not(target_arch = "wasm32"))'`), so this file
//! is gated the other way from `webgl2_browser.rs`: it only runs under a host `cargo test`, and
//! `wasm-pack test` never has to build a shader compiler to skip it.

#![cfg(not(target_arch = "wasm32"))]

use naga::valid::{Capabilities, ValidationFlags, Validator};
use open_glass_core::renderer::uniforms::GlassCompositeUniforms;
use std::fs;
use std::mem::{offset_of, size_of};
use std::path::Path;

/// Parses then validates a WGSL module, rendering `naga`'s own annotated diagnostic on failure
/// rather than a bare debug-printed error — the same reason `emit_to_string` is used for both error
/// paths.
fn parse_and_validate(name: &str, src: &str) -> naga::Module {
    let module = naga::front::wgsl::parse_str(src)
        .unwrap_or_else(|e| panic!("{name} is not valid WGSL:\n{}", e.emit_to_string(src)));
    let mut validator = Validator::new(ValidationFlags::all(), Capabilities::empty());
    validator
        .validate(&module)
        .unwrap_or_else(|e| panic!("{name} fails naga validation:\n{}", e.emit_to_string(src)));
    module
}

/// Every `*.wgsl` file under `src/shaders`, `(file_name, source)`, sorted so a failure is
/// deterministic regardless of directory iteration order.
fn discover_wgsl_shaders() -> Vec<(String, String)> {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("src/shaders");
    let mut shaders: Vec<(String, String)> = fs::read_dir(&dir)
        .unwrap_or_else(|e| panic!("could not read {}: {e}", dir.display()))
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "wgsl"))
        .map(|path| {
            let name = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or_default()
                .to_string();
            let src = fs::read_to_string(&path)
                .unwrap_or_else(|e| panic!("could not read {}: {e}", path.display()));
            (name, src)
        })
        .collect();
    shaders.sort_by(|a, b| a.0.cmp(&b.0));
    shaders
}

#[test]
fn every_wgsl_shader_parses_and_validates() {
    let shaders = discover_wgsl_shaders();

    let names: Vec<&str> = shaders.iter().map(|(name, _)| name.as_str()).collect();
    for expected in ["glass_composite.wgsl", "kawase_down.wgsl", "kawase_up.wgsl"] {
        assert!(
            names.contains(&expected),
            "expected {expected} in src/shaders, found: {names:?} — a rename or a moved directory \
             would otherwise silently validate nothing"
        );
    }

    for (name, src) in &shaders {
        let module = parse_and_validate(name, src);

        let stages: Vec<naga::ShaderStage> =
            module.entry_points.iter().map(|ep| ep.stage).collect();
        assert!(
            stages.contains(&naga::ShaderStage::Vertex),
            "{name} parses but declares no @vertex entry point — not a pipeline"
        );
        assert!(
            stages.contains(&naga::ShaderStage::Fragment),
            "{name} parses but declares no @fragment entry point — not a pipeline"
        );
    }
}

#[test]
fn the_composite_uniform_block_matches_the_rust_struct() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("src/shaders");
    let src = fs::read_to_string(dir.join("glass_composite.wgsl"))
        .expect("could not read glass_composite.wgsl");
    let module = parse_and_validate("glass_composite.wgsl", &src);

    let (members, span) = module
        .types
        .iter()
        .find_map(|(_handle, ty)| match ty.inner {
            naga::TypeInner::Struct { ref members, span }
                if ty.name.as_deref() == Some("GlassCompositeUniforms") =>
            {
                Some((members.clone(), span))
            }
            _ => None,
        })
        .expect("glass_composite.wgsl declares no `struct GlassCompositeUniforms`");

    assert_eq!(
        span as usize,
        size_of::<GlassCompositeUniforms>(),
        "naga's own span for GlassCompositeUniforms disagrees with size_of::<GlassCompositeUniforms>() \
         — the shader and the Rust struct would upload a reinterpreted uniform block, not crash"
    );

    // (field, expected offset) in the order the Rust struct declares them. `_padding` is tail
    // padding the shader does not name as a field, so it is checked via `span` above instead.
    let expected_offsets: [(&str, usize); 15] = [
        ("ior", offset_of!(GlassCompositeUniforms, ior)),
        (
            "blur_radius",
            offset_of!(GlassCompositeUniforms, blur_radius),
        ),
        ("dispersion", offset_of!(GlassCompositeUniforms, dispersion)),
        ("rim_power", offset_of!(GlassCompositeUniforms, rim_power)),
        (
            "sheen_intensity",
            offset_of!(GlassCompositeUniforms, sheen_intensity),
        ),
        (
            "light_angle",
            offset_of!(GlassCompositeUniforms, light_angle),
        ),
        ("roughness", offset_of!(GlassCompositeUniforms, roughness)),
        ("saturation", offset_of!(GlassCompositeUniforms, saturation)),
        ("brightness", offset_of!(GlassCompositeUniforms, brightness)),
        ("thickness", offset_of!(GlassCompositeUniforms, thickness)),
        ("curvature", offset_of!(GlassCompositeUniforms, curvature)),
        (
            "corner_radius",
            offset_of!(GlassCompositeUniforms, corner_radius),
        ),
        ("tint_color", offset_of!(GlassCompositeUniforms, tint_color)),
        (
            "glass_bounds",
            offset_of!(GlassCompositeUniforms, glass_bounds),
        ),
        ("resolution", offset_of!(GlassCompositeUniforms, resolution)),
    ];

    for (field, expected_offset) in expected_offsets {
        let member = members
            .iter()
            .find(|m| m.name.as_deref() == Some(field))
            .unwrap_or_else(|| {
                panic!("glass_composite.wgsl's GlassCompositeUniforms has no field named {field}")
            });
        assert_eq!(
            member.offset as usize, expected_offset,
            "GlassCompositeUniforms.{field}: naga says the shader reads it at byte offset {}, but \
             GlassCompositeUniforms::{field} sits at {expected_offset} — a reinterpreted uniform, \
             not a crash",
            member.offset
        );
    }
}

#[test]
fn the_glsl_style_scalar_clamp_is_rejected() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("src/shaders");
    let src = fs::read_to_string(dir.join("glass_composite.wgsl"))
        .expect("could not read glass_composite.wgsl");

    let vector_clamp =
        "clamp(mix(vec3<f32>(luma), tinted, optical.saturation), vec3<f32>(0.0), vec3<f32>(1.0))";
    let scalar_clamp = "clamp(mix(vec3<f32>(luma), tinted, optical.saturation), 0.0, 1.0)";

    assert!(
        src.contains(vector_clamp),
        "glass_composite.wgsl's saturation clamp no longer reads `{vector_clamp}` — this test's \
         negative control needs updating to match the current wording, or it will silently pass \
         without ever exercising the substitution below"
    );

    let reverted = src.replacen(vector_clamp, scalar_clamp, 1);
    assert_ne!(
        reverted, src,
        "the vector-bounds clamp substitution did not apply"
    );

    assert!(
        naga::front::wgsl::parse_str(&reverted).is_err(),
        "reverting the saturation clamp to GLSL-style scalar bounds (`clamp(v, 0.0, 1.0)`) should be \
         invalid WGSL — clamp's three arguments must share a type — but naga accepted it. This is a \
         negative control: if it fails, the validation this file runs has been loosened (a permissive \
         Capabilities set, or a dropped ValidationFlags bit) to the point it would have missed the \
         real incident in commit 1dde3f9."
    );
}
