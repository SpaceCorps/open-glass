//! The composite pass's uniform buffer layout.
//!
//! [`GlassCompositeUniforms`] is the single owner of the byte layout `glass_composite.wgsl` binds at
//! `@group(0) @binding(0)`. [`OpticalParams`] stays the ergonomic API type — 15 `f32`s, `align_of` 4,
//! free to grow — and this struct is the std140-shaped projection of it plus the per-frame geometry
//! (`resolution`, `glass_bounds`, `corner_radius`) the shader needs and `OpticalParams` does not carry.
//!
//! Two things keep the layout pinned rather than merely documented: the `const _` assertion block
//! below, which fails the build if any 16-aligned member moves off a 16-byte boundary, and
//! [`GlassCompositeUniforms::from_quad`]'s exhaustive destructure, which fails the build when
//! `OpticalParams` or [`GlassQuad`] grows a field nobody has decided a slot for.

use super::GlassQuad;
use crate::optical::physics::OpticalParams;
use std::mem::{align_of, offset_of, size_of};

/// Uniform block for `glass_composite.wgsl`, laid out so `bytemuck::bytes_of` can be uploaded into a
/// WGSL `var<uniform>` buffer directly.
///
/// The field order is not cosmetic. WGSL aligns `vec4<f32>` to 16 bytes and `vec2<f32>` to 8, so the
/// twelve leading scalars are arranged to fill three complete 16-byte rows (bytes 0-47) and the vector
/// members follow on their own boundaries. That is what removes every *implicit* pad byte from the
/// struct — the property the shader's previous `padding: f32` slot was written for and did not have:
/// with nine scalars ahead of it, `padding` sat at offset 36 and WGSL still inserted 8 unnamed bytes
/// before `tint_color`, putting it at 48 instead of the intended 40.
///
/// `corner_radius` is deliberately pulled up into the scalar block and `resolution` / `glass_bounds`
/// pushed down for the same reason. The WGSL declaration is in this order too, and
/// `test_composite_uniforms_match_the_wgsl_declaration` asserts it stays that way.
#[repr(C, align(16))]
#[derive(Debug, Clone, Copy, PartialEq, bytemuck::Pod, bytemuck::Zeroable)]
pub struct GlassCompositeUniforms {
    /// Index of refraction. Byte offset 0.
    pub ior: f32,
    /// Blur radius in pixels, as the composite's own record of the strength the blur chain ran at. 4.
    pub blur_radius: f32,
    /// Spectral dispersion coefficient. 8.
    pub dispersion: f32,
    /// Fresnel rim falloff power. 12.
    pub rim_power: f32,
    /// Fresnel sheen intensity. 16.
    pub sheen_intensity: f32,
    /// Directional light angle in radians. 20.
    pub light_angle: f32,
    /// Frosting grain intensity. 24.
    pub roughness: f32,
    /// Luma-preserving chroma scale. 28.
    pub saturation: f32,
    /// Multiplicative exposure gain. 32.
    pub brightness: f32,
    /// Slab thickness in pixels. 36.
    pub thickness: f32,
    /// Volumetric lens curvature of the glass body. 40.
    pub curvature: f32,
    /// Quad corner radius in pixels. 44 — the twelfth scalar, closing the third 16-byte row.
    pub corner_radius: f32,
    /// Glass tint RGBA. 48, the first `vec4` boundary.
    pub tint_color: [f32; 4],
    /// Quad rect in normalized UV space (`x, y, width, height`), from
    /// [`normalized_glass_bounds`]. 64.
    pub glass_bounds: [f32; 4],
    /// Drawing buffer size in pixels. 80.
    pub resolution: [f32; 2],
    /// Tail padding to the 16-byte multiple WGSL's uniform address space rounds the struct size up
    /// to. Explicit so `size_of` *equals* the shader's stride rather than merely agreeing with it, and
    /// so `bytemuck::Pod` can be derived at all — a `Pod` type may not contain padding the compiler
    /// inserted. 88.
    pub _padding: [f32; 2],
}

// The layout gate. `#[repr(C, align(16))]` raises `align_of` from the 4 that `[f32; 4]` would give to
// the 16 the shader's uniform block has; it moves no field, because the scalar block above already
// fills three whole rows. A member landing off its boundary is a build failure here rather than a
// wrongly-reinterpreted `curvature` in the first WebGPU frame.
const _: () = {
    assert!(size_of::<GlassCompositeUniforms>() == 96);
    assert!(align_of::<GlassCompositeUniforms>() == 16);
    assert!(offset_of!(GlassCompositeUniforms, tint_color) == 48);
    assert!(offset_of!(GlassCompositeUniforms, glass_bounds) == 64);
    assert!(offset_of!(GlassCompositeUniforms, resolution) == 80);
    assert!(offset_of!(GlassCompositeUniforms, _padding) == 88);
    // Every 16-aligned member starts on a 16-byte boundary.
    assert!(offset_of!(GlassCompositeUniforms, tint_color) % 16 == 0);
    assert!(offset_of!(GlassCompositeUniforms, glass_bounds) % 16 == 0);
};

impl GlassCompositeUniforms {
    /// Project one submitted quad and the current drawing-buffer size into the composite's uniform
    /// block.
    ///
    /// The two `let` destructures are the growth gate, and the **missing `..` rest pattern in each is
    /// load-bearing — do not add one.** Adding a field to [`OpticalParams`] or [`GlassQuad`] is a
    /// compile error right here until someone decides where it goes in the uniform buffer, which is
    /// strictly stronger than an assertion on `size_of`: it cannot be satisfied by editing a number.
    pub fn from_quad(quad: &GlassQuad, width: u32, height: u32) -> Self {
        let GlassQuad {
            x: _,
            y: _,
            width: _,
            height: _,
            corner_radius,
            _padding: _,
            optical,
        } = *quad;
        let OpticalParams {
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
            tint_color,
        } = optical;

        Self {
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
            corner_radius,
            tint_color,
            glass_bounds: normalized_glass_bounds(quad, width, height),
            resolution: [width as f32, height as f32],
            _padding: [0.0; 2],
        }
    }
}

/// Quad rect in normalized UV space, as `u_glass_bounds` expects (`x, y, width, height`).
///
/// `quad.y` arrives as a top-down `getBoundingClientRect` pixel offset, while `u_glass_bounds` is
/// consumed as bottom-up UV by `glass_composite.frag`, so the y origin is flipped here: a quad
/// 50px from the top of a 400px canvas sits at `1.0 - (50 + height) / 400` in UV space.
///
/// Lives here rather than in either backend so the two cannot disagree about which way is up.
pub(crate) fn normalized_glass_bounds(quad: &GlassQuad, width: u32, height: u32) -> [f32; 4] {
    let w = width.max(1) as f32;
    let h = height.max(1) as f32;
    [
        quad.x / w,
        (h - quad.y - quad.height) / h,
        quad.width / w,
        quad.height / h,
    ]
}

/// WGSL source of the composite pass, read here only so the tests can assert its uniform block
/// matches [`GlassCompositeUniforms`]. `tests/wgsl_shaders.rs` is where a real shader compiler
/// (naga) actually parses and validates it; this file only pattern-matches the source text.
#[cfg(test)]
const COMPOSITE_WGSL: &str = include_str!("../shaders/glass_composite.wgsl");

#[cfg(test)]
mod tests {
    use super::*;

    /// `(field_name, wgsl_type)` pairs from the `struct GlassCompositeUniforms { ... }` block of
    /// [`COMPOSITE_WGSL`], in declaration order, with comments and blank lines dropped.
    fn wgsl_uniform_fields() -> Vec<(String, String)> {
        let start = COMPOSITE_WGSL
            .find("struct GlassCompositeUniforms {")
            .expect("glass_composite.wgsl declares no `struct GlassCompositeUniforms`");
        let body = &COMPOSITE_WGSL[start..];
        let open = body.find('{').expect("struct declaration has no body");
        let close = body.find('}').expect("struct body is never closed");

        body[open + 1..close]
            .lines()
            .map(|line| line.split("//").next().unwrap_or("").trim())
            .filter(|line| !line.is_empty())
            .map(|line| {
                let line = line.trim_end_matches(',');
                let (name, ty) = line
                    .split_once(':')
                    .unwrap_or_else(|| panic!("field declaration without a type: {line}"));
                (name.trim().to_string(), ty.trim().to_string())
            })
            .collect()
    }

    #[test]
    fn test_composite_uniforms_layout_is_std140() {
        // The `const _` block above is the primary gate; this asserts what a const cannot — that the
        // bytes bytemuck hands the GPU carry each vector member at the offset the shader reads it
        // from. This is the assertion that would have caught `padding: f32`-at-36 putting
        // `tint_color` at 48 while the shader author believed it was at 40.
        let uniforms = GlassCompositeUniforms {
            tint_color: [0.25, 0.5, 0.75, 1.0],
            glass_bounds: [0.125, 0.375, 0.5, 0.5],
            resolution: [800.0, 400.0],
            ..GlassCompositeUniforms::from_quad(&GlassQuad::default(), 800, 400)
        };

        let bytes = bytemuck::bytes_of(&uniforms);
        assert_eq!(bytes.len(), 96, "uniform block is not a 16-byte multiple");

        let read_f32 = |offset: usize| {
            f32::from_ne_bytes(
                bytes[offset..offset + 4]
                    .try_into()
                    .expect("four bytes at a valid offset"),
            )
        };
        assert_eq!(read_f32(0), uniforms.ior);
        assert_eq!(read_f32(44), uniforms.corner_radius);
        assert_eq!(read_f32(48), uniforms.tint_color[0]);
        assert_eq!(read_f32(64), uniforms.glass_bounds[0]);
        assert_eq!(read_f32(80), uniforms.resolution[0]);
        // The tail is padding, not a value the shader may read as one.
        assert_eq!(read_f32(88), 0.0);
        assert_eq!(read_f32(92), 0.0);
    }

    #[test]
    fn test_composite_uniforms_match_the_wgsl_declaration() {
        // `tests/wgsl_shaders.rs` now asserts the same struct's byte offsets against naga's own
        // layout, which is the authority on where the shader actually reads each field from. This
        // text assertion keeps a narrower job that test doesn't cover: declaration *order* and WGSL
        // type *spelling* (`vec4<f32>` vs four scalars share an offset but not a type), with a
        // failure message about a swapped field name rather than a byte offset. Same pattern as
        // `test_composite_fragment_shader_declares_expected_uniforms` in webgl2.rs.
        let expected: [(&str, &str); 15] = [
            ("ior", "f32"),
            ("blur_radius", "f32"),
            ("dispersion", "f32"),
            ("rim_power", "f32"),
            ("sheen_intensity", "f32"),
            ("light_angle", "f32"),
            ("roughness", "f32"),
            ("saturation", "f32"),
            ("brightness", "f32"),
            ("thickness", "f32"),
            ("curvature", "f32"),
            ("corner_radius", "f32"),
            ("tint_color", "vec4<f32>"),
            ("glass_bounds", "vec4<f32>"),
            ("resolution", "vec2<f32>"),
        ];

        let actual = wgsl_uniform_fields();
        let named: Vec<(String, String)> = actual
            .iter()
            .filter(|(name, _)| !name.starts_with('_'))
            .cloned()
            .collect();

        assert_eq!(
            named.len(),
            expected.len(),
            "glass_composite.wgsl declares {} non-padding fields, the Rust struct has {}: {named:?}",
            named.len(),
            expected.len()
        );
        for (index, ((name, ty), (want_name, want_ty))) in named.iter().zip(expected).enumerate() {
            assert_eq!(
                name, want_name,
                "field {index} of the WGSL uniform block is `{name}`, expected `{want_name}` — the \
                 order is the layout, so a swap here is a wrongly-read uniform, not a rename"
            );
            assert_eq!(
                ty, want_ty,
                "WGSL field `{name}` is `{ty}`, but the Rust field is the equivalent of `{want_ty}`"
            );
        }

        // The declaration must also close the struct with the same explicit tail padding, or the
        // shader's stride is 96 by WGSL's rounding rule while the Rust struct says so out loud.
        let tail = actual
            .last()
            .expect("the WGSL uniform block declares no fields");
        assert_eq!(
            (tail.0.as_str(), tail.1.as_str()),
            ("_padding", "vec2<f32>"),
            "the WGSL uniform block must end with the same explicit `_padding: vec2<f32>` tail"
        );
    }

    #[test]
    fn test_wgsl_composite_applies_saturation_and_brightness() {
        // Both terms exist in glass_composite.frag and reached the WGSL only with this plan; a
        // WebGPU frame without them renders the unsaturated, 1.4x-too-dark composite Plans 00625 and
        // 00653 fixed, and does it silently because nothing compiles this file.
        for reference in ["optical.saturation", "optical.brightness"] {
            assert!(
                COMPOSITE_WGSL.contains(reference),
                "glass_composite.wgsl never reads {reference}"
            );
        }
        // Presence is not enough: computing the two terms and then compositing from `tinted` anyway
        // reads the same as the drift this test guards. Pin the chain, so each term has to feed the
        // next — and in the frag's order, because the sheen is additive and scaling it would blow
        // highlights.
        for link in [
            "clamp(mix(vec3<f32>(luma), tinted, optical.saturation)",
            "let brightened = clamp(saturated * optical.brightness",
            "let final_rgb = brightened +",
        ] {
            assert!(
                COMPOSITE_WGSL.contains(link),
                "glass_composite.wgsl breaks the tint -> saturate -> brighten -> sheen chain at: {link}"
            );
        }
    }

    #[test]
    fn test_from_quad_carries_every_optical_field() {
        // The exhaustive destructure in `from_quad` is the compile-time half of the growth gate. This
        // is the runtime half: it catches a field wired into the wrong slot, which compiles fine.
        // Every value below is distinct and none is a default, which is what makes a swapped pair of
        // slots fail rather than coincide.
        let quad = GlassQuad {
            x: 100.0,
            y: 50.0,
            width: 400.0,
            height: 200.0,
            corner_radius: 24.0,
            _padding: [0.0; 3],
            optical: OpticalParams {
                ior: 1.61,
                blur_radius: 22.0,
                dispersion: 0.07,
                rim_power: 4.25,
                sheen_intensity: 0.63,
                light_angle: 1.1,
                roughness: 0.09,
                saturation: 1.35,
                brightness: 1.45,
                thickness: 12.5,
                curvature: 0.18,
                tint_color: [0.2, 0.4, 0.6, 0.31],
            },
        };

        let uniforms = GlassCompositeUniforms::from_quad(&quad, 800, 400);

        assert_eq!(uniforms.ior, 1.61);
        assert_eq!(uniforms.blur_radius, 22.0);
        assert_eq!(uniforms.dispersion, 0.07);
        assert_eq!(uniforms.rim_power, 4.25);
        assert_eq!(uniforms.sheen_intensity, 0.63);
        assert_eq!(uniforms.light_angle, 1.1);
        assert_eq!(uniforms.roughness, 0.09);
        assert_eq!(uniforms.saturation, 1.35);
        assert_eq!(uniforms.brightness, 1.45);
        assert_eq!(uniforms.thickness, 12.5);
        assert_eq!(uniforms.curvature, 0.18);
        assert_eq!(uniforms.corner_radius, 24.0);
        assert_eq!(uniforms.tint_color, [0.2, 0.4, 0.6, 0.31]);
        assert_eq!(
            uniforms.glass_bounds,
            normalized_glass_bounds(&quad, 800, 400)
        );
        assert_eq!(uniforms.resolution, [800.0, 400.0]);
        assert_eq!(uniforms._padding, [0.0; 2]);
    }

    #[test]
    fn test_default_quad_uniforms_are_finite() {
        // The `width.max(1)` guard in `normalized_glass_bounds` has to survive the move out of
        // webgl2.rs: a zero-sized drawing buffer must not produce a NaN in the uniform block.
        let uniforms = GlassCompositeUniforms::from_quad(&GlassQuad::default(), 0, 0);
        let floats: &[f32] = bytemuck::cast_slice(bytemuck::bytes_of(&uniforms));
        assert!(floats.iter().all(|value| value.is_finite()));
        assert_eq!(uniforms.resolution, [0.0, 0.0]);
    }

    #[test]
    fn test_normalized_glass_bounds_flips_dom_y_to_uv_y() {
        let quad = GlassQuad {
            x: 100.0,
            y: 50.0,
            width: 400.0,
            height: 200.0,
            ..GlassQuad::default()
        };
        // 50px from the DOM top of a 400px canvas leaves 150px below it: (400 - 50 - 200) / 400.
        let bounds = normalized_glass_bounds(&quad, 800, 400);
        assert_eq!(bounds, [0.125, 0.375, 0.5, 0.5]);
    }

    #[test]
    fn test_normalized_glass_bounds_pins_flip_direction_for_asymmetric_rect() {
        // Near the top of a tall canvas: the un-flipped math would give y = 0.05, the flipped
        // math y = 0.85, so this case fails loudly if the flip is dropped or applied twice.
        let quad = GlassQuad {
            x: 40.0,
            y: 50.0,
            width: 100.0,
            height: 100.0,
            ..GlassQuad::default()
        };
        let bounds = normalized_glass_bounds(&quad, 200, 1000);
        assert!(
            (bounds[0] - 0.2).abs() < 1e-6,
            "x is not flipped: {bounds:?}"
        );
        assert!(
            (bounds[1] - 0.85).abs() < 1e-6,
            "y flip is wrong: {bounds:?}"
        );
        assert!((bounds[2] - 0.5).abs() < 1e-6);
        assert!((bounds[3] - 0.1).abs() < 1e-6);
        // The top edge in UV space is the bottom edge in DOM space.
        assert!(bounds[1] + bounds[3] > 0.5, "quad landed in the lower half");
    }

    #[test]
    fn test_normalized_glass_bounds_guards_zero_dimensions() {
        let quad = GlassQuad::default();
        let bounds = normalized_glass_bounds(&quad, 0, 0);
        assert!(bounds.iter().all(|value| value.is_finite()));
        // width/height clamp to 1, so the flip reduces to 1 - y - height on a unit canvas.
        assert_eq!(bounds[1], 1.0 - quad.y - quad.height);
    }
}
