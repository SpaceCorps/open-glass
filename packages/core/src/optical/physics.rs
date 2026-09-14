use glam::{Vec2, Vec3};

/// Optical parameters configuring the physical appearance of Apple Glass.
#[repr(C)]
#[derive(Debug, Clone, Copy, PartialEq, bytemuck::Pod, bytemuck::Zeroable)]
pub struct OpticalParams {
    /// Index of Refraction (e.g. 1.0 = air, 1.49 = acrylic, 1.52 = crown glass).
    pub ior: f32,
    /// Dual Kawase frosted glass blur radius in pixels.
    pub blur_radius: f32,
    /// Chromatic aberration spectral dispersion coefficient.
    pub dispersion: f32,
    /// Specular rim lighting falloff power.
    pub rim_power: f32,
    /// Fresnel sheen intensity along glass boundaries.
    pub sheen_intensity: f32,
    /// Directional light angle in radians.
    pub light_angle: f32,
    /// Surface micro-roughness / frosting grain intensity.
    pub roughness: f32,
    /// Luma-preserving chroma scale applied after the tint mix. `1.0` leaves the backdrop's
    /// saturation untouched.
    ///
    /// This occupies the slot that used to be reserved padding, so the `#[repr(C)]` layout and the
    /// 16-byte boundary before [`Self::tint_color`] are unchanged.
    pub saturation: f32,
    /// Surface glass tint color (RGBA normalized 0.0 - 1.0).
    pub tint_color: [f32; 4],
}

impl Default for OpticalParams {
    fn default() -> Self {
        Self {
            ior: 1.52,
            blur_radius: 16.0,
            dispersion: 0.04,
            rim_power: 3.5,
            sheen_intensity: 0.75,
            light_angle: std::f32::consts::FRAC_PI_4, // 45 degrees
            roughness: 0.03,
            // 1.8 is exactly the `saturate(180%)` every CSS `backdrop-filter` fallback literal in
            // `packages/react` uses, so the CSS-to-GPU handover is chroma-neutral by construction.
            // Without it the composite is strictly *less* saturated than the fallback it replaces:
            // `tint_color` mixes 12% white in and the blur chain averages chroma out.
            saturation: 1.8,
            tint_color: [1.0, 1.0, 1.0, 0.12],
        }
    }
}

/// Calculate the refraction direction vector using Snell's Law.
///
/// Returns `None` when Total Internal Reflection (TIR) occurs.
///
/// * `incident` - Normalized vector pointing towards the surface interface.
/// * `normal` - Normalized surface normal vector pointing outwards from the surface.
/// * `n1` - Refractive index of the incident medium (e.g. 1.0 for air).
/// * `n2` - Refractive index of the transmitting medium (e.g. 1.52 for crown glass).
pub fn snell_refraction_vector(incident: Vec3, normal: Vec3, n1: f32, n2: f32) -> Option<Vec3> {
    if n2 <= 0.0 || n1 <= 0.0 {
        return None;
    }
    let eta = n1 / n2;
    let mut cos_theta_i = -incident.dot(normal);
    let n = if cos_theta_i < 0.0 {
        cos_theta_i = -cos_theta_i;
        -normal
    } else {
        normal
    };

    let k = 1.0 - eta * eta * (1.0 - cos_theta_i * cos_theta_i);
    if k < 0.0 {
        // Total internal reflection
        None
    } else {
        let refracted = eta * incident + (eta * cos_theta_i - k.sqrt()) * n;
        Some(refracted.normalize())
    }
}

/// Calculate Fresnel reflectance using Schlick's approximation.
///
/// * `cos_theta` - Cosine of the angle between surface normal and view direction (clamped to [0.0, 1.0]).
/// * `n1` - Index of refraction of incident medium.
/// * `n2` - Index of refraction of transmitting medium.
pub fn fresnel_schlick(cos_theta: f32, n1: f32, n2: f32) -> f32 {
    let r0_sqrt = (n1 - n2) / (n1 + n2);
    let r0 = r0_sqrt * r0_sqrt;
    let clamped_cos = cos_theta.clamp(0.0, 1.0);
    let one_minus_cos = 1.0 - clamped_cos;
    let pow5 = one_minus_cos * one_minus_cos * one_minus_cos * one_minus_cos * one_minus_cos;
    r0 + (1.0 - r0) * pow5
}

/// Chromatic aberration spectral offsets for RGB color channels along the refraction vector.
///
/// Returns relative UV offsets `(red_offset, green_offset, blue_offset)`.
pub fn chromatic_aberration_offsets(
    refraction_dir_uv: Vec2,
    dispersion: f32,
) -> (Vec2, Vec2, Vec2) {
    let base_displacement = refraction_dir_uv * dispersion;
    let red_offset = base_displacement * (1.0 + dispersion);
    let green_offset = base_displacement;
    let blue_offset = base_displacement * (1.0 - dispersion);
    (red_offset, green_offset, blue_offset)
}

/// CSS `blur()` pixels one unit of `blur_radius` buys.
///
/// `blur_radius` R composites like CSS `blur(2R px)`, so the playground's 16px default matches the
/// `blur(32px) saturate(180%)` fallback literal `GlassWindow` drops when the renderer comes up. CSS
/// `blur(<length>)` is a Gaussian whose *standard deviation* is that length, so the target is
/// sigma = 32px at R = 16.
pub const CSS_BLUR_PIXELS_PER_RADIUS: f32 = 2.0;

/// Per-level tap step scale, calibrated so [`kawase_pyramid_sigma`] hits
/// [`CSS_BLUR_PIXELS_PER_RADIUS`] at R = 16.
///
/// Solving `76 * (16 * s)^2 + 227 = 32^2` for the two variance contributions described on
/// [`kawase_pyramid_sigma`] gives s ~= 0.20; the previous 0.25 put the 5-level chain at sigma ~= 38px
/// against a 32px target, i.e. a 16px slider setting reading roughly like `blur(38px)`.
///
/// `kawase_pyramid_sigma(16.0, 5)` evaluates to 31.71px at this scale, 0.9% under the 32px target.
/// Measured against a real capture (Plan 00625's acceptance run, playground window body,
/// 400x130 region): the GPU composite's per-channel sigma came in at 33.86 / 33.26 / 30.80 against
/// the CSS `blur(32px) saturate(180%)` fallback's own 34.25 / 31.69 / 24.27 — matching or exceeding it
/// on two of three channels and within 1.1% on the third, up from 27.3 / 26.7 / 25.1 at the previous
/// `0.25`. The model and the measurement agree closely enough that no further retune is needed.
pub const KAWASE_STEP_SCALE: f32 = 0.20;

/// Dual Kawase downsample sampling step in texels for a given iteration.
///
/// Shared by [`dual_kawase_down_offsets`] and the GPU blur passes so the CPU reference kernels and
/// the shader `u_offset` uniform always use the identical formula.
pub fn dual_kawase_down_step(iteration: u32, blur_radius: f32) -> f32 {
    (iteration as f32 + 1.0) * (blur_radius * KAWASE_STEP_SCALE).max(1.0)
}

/// Dual Kawase upsample sampling step in texels for a given iteration.
///
/// Shared by [`dual_kawase_up_offsets`] and the GPU blur passes so the CPU reference kernels and
/// the shader `u_offset` uniform always use the identical formula.
pub fn dual_kawase_up_step(iteration: u32, blur_radius: f32) -> f32 {
    (iteration as f32 + 0.5) * (blur_radius * KAWASE_STEP_SCALE).max(1.0)
}

/// Gaussian sigma, in full-resolution pixels, that a `levels`-deep dual-Kawase pyramid accumulates.
///
/// Two independent contributions, both per-axis variances, which add:
///
/// * **Tap offsets.** Each 4-tap pass at diagonal offset `d` contributes variance `d^2` per axis, and
///   `d` is exactly what [`dual_kawase_down_step`] / [`dual_kawase_up_step`] hand the shader — so this
///   function cannot drift from the kernels it models. Over 5 down and 4 up passes that is
///   `(55 + 21) * (R * s)^2`, i.e. `sqrt(76) * R * s ~= 8.72 * R * s`.
/// * **Pyramid resampling.** Each halving averages a `2^(l+1)`-pixel box in full-resolution terms
///   (variance `b^2 / 12`), and the bilinear re-magnification on the way back up contributes
///   comparably, so the term is doubled. Over 5 levels that is ~227, i.e. ~15.1px of sigma that
///   `blur_radius` does not control at all — which is why a small radius is otherwise drowned.
///
/// Dual Kawase is not a Gaussian, so this is a variance-matched approximation: it omits the up-chain
/// tent filter's shape and the driver's exact bilinear behaviour. It is accurate enough to calibrate
/// [`KAWASE_STEP_SCALE`] and to bound [`kawase_levels_for_radius`], and both are checked against a
/// real capture (see [`KAWASE_STEP_SCALE`]).
pub fn kawase_pyramid_sigma(blur_radius: f32, levels: u32) -> f32 {
    let mut variance = 0.0f32;
    for iteration in 0..levels {
        let down = dual_kawase_down_step(iteration, blur_radius);
        variance += down * down;
    }
    // One fewer upsample pass than downsample passes: the deepest level is only ever read.
    for iteration in 0..levels.saturating_sub(1) {
        let up = dual_kawase_up_step(iteration, blur_radius);
        variance += up * up;
    }
    for level in 0..levels {
        let box_width = (1u32 << (level + 1)) as f32;
        variance += 2.0 * box_width * box_width / 12.0;
    }
    variance.sqrt()
}

/// Deepest level count whose [`kawase_pyramid_sigma`] still fits the CSS-equivalent target for this
/// radius, clamped to `1..=max_levels`.
///
/// The pyramid's resampling variance does not scale with `blur_radius`, so a fixed depth makes a small
/// radius read far wider than it asks for: at R = 2 the target is `blur(4px)` while 5 levels deliver
/// sigma ~= 16px. Trimming depth is the only lever that reaches that end of the slider. The floor of 1
/// matters to the renderer: mip level 0 is what the composite pass samples, so it must always be
/// written.
pub fn kawase_levels_for_radius(blur_radius: f32, max_levels: u32) -> u32 {
    let max_levels = max_levels.max(1);
    let target = blur_radius * CSS_BLUR_PIXELS_PER_RADIUS;
    let mut levels = 1;
    for candidate in 1..=max_levels {
        if kawase_pyramid_sigma(blur_radius, candidate) > target {
            break;
        }
        levels = candidate;
    }
    levels
}

/// Dual Kawase downsample offset kernels for a given iteration step.
///
/// Downsample pass uses 4 half-texel offset sample points around the center.
pub fn dual_kawase_down_offsets(iteration: u32, texel_size: Vec2, blur_radius: f32) -> [Vec2; 4] {
    let step = dual_kawase_down_step(iteration, blur_radius);
    let half_offset = texel_size * step;
    [
        Vec2::new(-half_offset.x, -half_offset.y),
        Vec2::new(half_offset.x, -half_offset.y),
        Vec2::new(-half_offset.x, half_offset.y),
        Vec2::new(half_offset.x, half_offset.y),
    ]
}

/// Dual Kawase upsample offset kernels with 8-tap tent filter.
pub fn dual_kawase_up_offsets(iteration: u32, texel_size: Vec2, blur_radius: f32) -> [Vec2; 8] {
    let step = dual_kawase_up_step(iteration, blur_radius);
    let offset = texel_size * step;
    let half_x = offset.x * 0.5;
    let half_y = offset.y * 0.5;
    let full_x = offset.x;
    let full_y = offset.y;

    [
        Vec2::new(-full_x, 0.0),
        Vec2::new(-half_x, half_y),
        Vec2::new(0.0, full_y),
        Vec2::new(half_x, half_y),
        Vec2::new(full_x, 0.0),
        Vec2::new(half_x, -half_y),
        Vec2::new(0.0, -full_y),
        Vec2::new(-half_x, -half_y),
    ]
}

/// Specular rim lighting and Fresnel sheen combination.
///
/// * `view_dir` - Normalized vector from surface to camera.
/// * `normal` - Normalized surface normal.
/// * `light_dir` - Normalized directional light vector.
/// * `rim_power` - Falloff exponent for the rim glow.
/// * `sheen_intensity` - Multiplier for Fresnel edge sheen.
pub fn specular_rim_light(
    view_dir: Vec3,
    normal: Vec3,
    light_dir: Vec3,
    rim_power: f32,
    sheen_intensity: f32,
) -> f32 {
    let n_dot_v = normal.dot(view_dir).clamp(0.0, 1.0);
    let rim = (1.0 - n_dot_v).powf(rim_power.max(0.1));

    // Directional highlight along rim
    let half_vec = (view_dir + light_dir).normalize();
    let n_dot_h = normal.dot(half_vec).clamp(0.0, 1.0);
    let specular = n_dot_h.powf(32.0);

    (rim * sheen_intensity + specular * 0.4).clamp(0.0, 1.0)
}

/// Procedural pseudo-random micro-roughness perturbation for frosting grain.
pub fn frosting_grain_perturbation(uv: Vec2, roughness: f32) -> Vec2 {
    if roughness <= 0.0 {
        return Vec2::ZERO;
    }
    // High-frequency pseudo-random hash
    let n1 = (uv.x * 12.9898 + uv.y * 78.233).sin() * 43758.547;
    let n2 = (uv.x * 39.346 + uv.y * 11.135).sin() * 22537.123;
    let hash_x = (n1.fract() - 0.5) * 2.0;
    let hash_y = (n2.fract() - 0.5) * 2.0;
    Vec2::new(hash_x, hash_y) * roughness * 0.01
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::f32::consts::FRAC_1_SQRT_2;

    #[test]
    fn test_snell_refraction_normal_incidence() {
        let incident = Vec3::new(0.0, 0.0, -1.0);
        let normal = Vec3::new(0.0, 0.0, 1.0);
        let refracted = snell_refraction_vector(incident, normal, 1.0, 1.52);
        assert!(refracted.is_some());
        let r = refracted.unwrap();
        // At normal incidence, the refracted ray continues straight through
        assert!((r.x).abs() < 1e-5);
        assert!((r.y).abs() < 1e-5);
        assert!((r.z - (-1.0)).abs() < 1e-5);
    }

    #[test]
    fn test_snell_refraction_angled() {
        let incident = Vec3::new(FRAC_1_SQRT_2, 0.0, -FRAC_1_SQRT_2).normalize();
        let normal = Vec3::new(0.0, 0.0, 1.0);
        let refracted = snell_refraction_vector(incident, normal, 1.0, 1.5);
        assert!(refracted.is_some());
        let r = refracted.unwrap();
        // Light bends towards normal (lower angle with -Z) when entering denser medium
        assert!(r.x > 0.0);
        assert!(r.x < incident.x);
        assert!(r.z < 0.0);
    }

    #[test]
    fn test_snell_total_internal_reflection() {
        // Going from dense (1.5) to rare (1.0) at steep angle (e.g. 60 degrees)
        let incident = Vec3::new(0.866025, 0.0, -0.5).normalize();
        let normal = Vec3::new(0.0, 0.0, 1.0);
        let refracted = snell_refraction_vector(incident, normal, 1.5, 1.0);
        assert!(refracted.is_none(), "Expected total internal reflection");
    }

    #[test]
    fn test_fresnel_schlick_normal_and_grazing() {
        let n1 = 1.0;
        let n2 = 1.5;
        // Normal incidence: cos(theta) = 1.0 -> R0 = ((1 - 1.5)/(1 + 1.5))^2 = (0.5/2.5)^2 = 0.04
        let r_normal = fresnel_schlick(1.0, n1, n2);
        assert!((r_normal - 0.04).abs() < 1e-4);

        // Grazing incidence: cos(theta) = 0.0 -> R = 1.0
        let r_grazing = fresnel_schlick(0.0, n1, n2);
        assert!((r_grazing - 1.0).abs() < 1e-4);
    }

    #[test]
    fn test_chromatic_aberration_offsets() {
        let dir = Vec2::new(1.0, 0.0);
        let dispersion = 0.05;
        let (r, g, b) = chromatic_aberration_offsets(dir, dispersion);
        assert!(r.x > g.x);
        assert!(g.x > b.x);
        assert_eq!(r.y, 0.0);
        assert_eq!(g.y, 0.0);
        assert_eq!(b.y, 0.0);
    }

    #[test]
    fn test_dual_kawase_kernel_offsets() {
        let texel_size = Vec2::new(1.0 / 1920.0, 1.0 / 1080.0);
        let down_offsets = dual_kawase_down_offsets(0, texel_size, 16.0);
        assert_eq!(down_offsets.len(), 4);
        assert!(down_offsets[0].x < 0.0 && down_offsets[0].y < 0.0);
        assert!(down_offsets[3].x > 0.0 && down_offsets[3].y > 0.0);

        let up_offsets = dual_kawase_up_offsets(0, texel_size, 16.0);
        assert_eq!(up_offsets.len(), 8);
    }

    #[test]
    fn test_dual_kawase_steps_match_offset_kernels() {
        let texel_size = Vec2::new(1.0 / 1920.0, 1.0 / 1080.0);
        let blur_radius = 16.0;

        for iteration in 0..5 {
            // Down: the kernel's outermost tap is exactly texel_size * step.
            let down_step = dual_kawase_down_step(iteration, blur_radius);
            let down_offsets = dual_kawase_down_offsets(iteration, texel_size, blur_radius);
            assert!((down_offsets[3].x - texel_size.x * down_step).abs() < 1e-9);
            assert!((down_offsets[3].y - texel_size.y * down_step).abs() < 1e-9);

            // Up: the tent filter's axial taps are exactly texel_size * step.
            let up_step = dual_kawase_up_step(iteration, blur_radius);
            let up_offsets = dual_kawase_up_offsets(iteration, texel_size, blur_radius);
            assert!((up_offsets[4].x - texel_size.x * up_step).abs() < 1e-9);
            assert!((up_offsets[2].y - texel_size.y * up_step).abs() < 1e-9);
        }
    }

    #[test]
    fn test_default_saturation_matches_the_css_fallback() {
        // The CSS literals this replaces are `saturate(180%)`, so the handover is chroma-neutral.
        assert!((OpticalParams::default().saturation - 1.8).abs() < 1e-6);
    }

    #[test]
    fn test_optical_params_layout_is_unchanged_by_saturation() {
        // 7 leading f32 + saturation + a 4-float tint = 48 bytes. `saturation` took the reserved
        // padding slot, so the `#[repr(C)]` layout the GPU uniform upload assumes did not grow.
        assert_eq!(std::mem::size_of::<OpticalParams>(), 48);
        assert_eq!(std::mem::align_of::<OpticalParams>(), 4);
    }

    #[test]
    fn test_kawase_pyramid_sigma_matches_the_css_blur_mapping() {
        // The documented mapping, asserted rather than asserted-in-prose: R = 16 must composite like
        // CSS `blur(32px)`.
        let target = CSS_BLUR_PIXELS_PER_RADIUS * 16.0;
        let sigma = kawase_pyramid_sigma(16.0, 5);
        assert!(
            (sigma - target).abs() <= target * 0.10,
            "5-level sigma at blur_radius 16 is {sigma}px, outside +/-10% of the {target}px CSS \
             equivalent; KAWASE_STEP_SCALE needs recalibrating"
        );
    }

    #[test]
    fn test_kawase_pyramid_sigma_is_monotonic() {
        for levels in 1..=5 {
            let mut previous = 0.0;
            for radius in [1.0f32, 4.0, 8.0, 16.0, 32.0, 64.0] {
                let sigma = kawase_pyramid_sigma(radius, levels);
                assert!(
                    sigma >= previous,
                    "sigma fell at radius {radius}, levels {levels}"
                );
                previous = sigma;
            }
        }
        for radius in [1.0f32, 16.0, 32.0] {
            let mut previous = 0.0;
            for levels in 1..=5 {
                let sigma = kawase_pyramid_sigma(radius, levels);
                assert!(
                    sigma >= previous,
                    "sigma fell at levels {levels}, radius {radius}"
                );
                previous = sigma;
            }
        }
    }

    #[test]
    fn test_kawase_levels_shrink_for_small_radii_and_saturate_for_large() {
        // A 2px radius asks for `blur(4px)`; a full-depth pyramid delivers ~16px regardless of the
        // taps, so the depth has to come down for the mapping to hold at this end of the slider.
        let shallow = kawase_levels_for_radius(2.0, 5);
        assert!(shallow < 5, "a 2px radius still traverses {shallow} levels");
        assert!(
            shallow >= 1,
            "the level count must never reach 0: level 0 feeds the composite"
        );

        assert_eq!(kawase_levels_for_radius(32.0, 5), 5);
        assert_eq!(kawase_levels_for_radius(16.0, 5), 5);
        // Degenerate inputs still leave level 0 to sample.
        assert_eq!(kawase_levels_for_radius(0.0, 5), 1);
        assert_eq!(kawase_levels_for_radius(16.0, 0), 1);
    }

    #[test]
    fn test_dual_kawase_steps_clamp_small_blur_radius() {
        // (blur_radius * KAWASE_STEP_SCALE).max(1.0) floors the step scale at one texel.
        assert!((dual_kawase_down_step(0, 0.0) - 1.0).abs() < 1e-6);
        assert!((dual_kawase_down_step(1, 2.0) - 2.0).abs() < 1e-6);
        assert!((dual_kawase_up_step(0, 0.0) - 0.5).abs() < 1e-6);

        // Down steps grow monotonically with iteration; up steps trail them by half a step.
        assert!(dual_kawase_down_step(1, 16.0) > dual_kawase_down_step(0, 16.0));
        assert!(dual_kawase_up_step(3, 16.0) < dual_kawase_down_step(3, 16.0));
    }

    #[test]
    fn test_specular_rim_light() {
        let view_dir = Vec3::new(0.0, 0.0, 1.0);
        let normal = Vec3::new(FRAC_1_SQRT_2, 0.0, FRAC_1_SQRT_2);
        let light_dir = Vec3::new(1.0, 1.0, 1.0).normalize();
        let rim = specular_rim_light(view_dir, normal, light_dir, 3.0, 0.8);
        assert!(rim > 0.0 && rim <= 1.0);
    }
}
