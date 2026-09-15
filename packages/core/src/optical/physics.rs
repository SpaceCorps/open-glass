use glam::{Vec2, Vec3};

/// Optical parameters configuring the physical appearance of Apple Glass.
///
/// This is the ergonomic API type and carries no GPU layout obligation: `align_of` is 4 and the size
/// is whatever the fields add up to. The uniform buffer layout the composite binds is owned by
/// [`crate::renderer::uniforms::GlassCompositeUniforms`], and a field added here must be plumbed
/// through its `from_quad`, which destructures this struct exhaustively and therefore will not compile
/// until it is.
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
    pub saturation: f32,
    /// Multiplicative exposure gain applied to the composite after the saturation clamp and before
    /// the additive sheen. `1.0` leaves the composite as the blur chain produced it.
    ///
    /// This replaces the light the CSS fallback's overlay was contributing and the readiness handover
    /// takes away (`GlassWindow` steps `rgba(240,240,245,0.22)` down to `0.05`). It has to be a gain
    /// rather than more white in [`Self::tint_color`], because the two move chroma in opposite
    /// directions: a veil at alpha `a` scales per-pixel channel spread by `1 - a`, while a gain `g`
    /// scales it by `g`. The composite is short on *both* luma and chroma against the CSS fallback
    /// (measured mean luma 110.2 vs 158.0, mean channel spread 19.1 vs 40.1), so only the gain closes
    /// both at once — keeping the 0.22 veil instead would have reached luma 145 while dropping the
    /// spread to ~15.6.
    pub brightness: f32,
    /// Physical thickness of the glass slab in pixels: the distance the refracted ray travels between
    /// the front/top entrance interface and the rear/bottom exit interface.
    ///
    /// This is what makes the panel a *slab* rather than a thin film. The entrance refraction only
    /// gives the ray a direction; a direction becomes a visible displacement only once it propagates,
    /// and this is the distance it propagates over (see [`dual_surface_refraction_offset`]). At `0.0`
    /// the two interfaces coincide and the slab term vanishes, leaving the body lens as the only
    /// source of bending.
    pub thickness: f32,
    /// Volumetric lens curvature of the glass body: the sag of the convex dome spanning the panel
    /// interior, as a fraction of the panel's half-size.
    ///
    /// The previous shader clamped every interior pixel's surface normal to `(0, 0, 1)` once it was
    /// more than `max(corner_radius, 8)` pixels inside the boundary, so the entire window body bent no
    /// light at all. This term is the body's own normal field: it tilts *outward* from the panel centre
    /// (see [`volumetric_lens_normal`]), which is the sign that converges the transmitted rays and
    /// therefore magnifies — a plano-convex lens, not a flat pane.
    pub curvature: f32,
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
            // Calibrated against the measured playground captures so the CSS-to-GPU handover is
            // luma-neutral as well as chroma-neutral. With B the raw backdrop luma, W = 240.4 the
            // luma of `rgba(240,240,245)` and C the composite luma before its own 0.05 overlay:
            // g = (L_css - 0.05 * W) / (0.95 * C) = (158.0 - 12.0) / (0.95 * 103.4) = 1.486,
            // rounded onto the playground slider's 0.05 grid. The additive sheen is deliberately not
            // scaled, so the achieved gain lands slightly under the nominal one.
            brightness: 1.5,
            // A standard slab: thick enough that the bevel band's steep surface tilt translates into a
            // few pixels of visible displacement, thin enough that the body stays a window rather than
            // a paperweight. The playground slider spans 0 (thin sheet) to 30 (heavy glass).
            thickness: 10.0,
            // Subtle macOS parity. `curvature * BODY_LENS_DEPTH_SCALE` sets the body magnification, and
            // 0.10 puts the steepest ring of the dome at ~2.6% of the panel half-size — continuous,
            // dynamic bending across the whole body, without the fisheye of a pronounced lens.
            curvature: 0.10,
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

/// Effective optical depth of the backdrop behind the rear face, as a multiple of the panel's
/// half-height.
///
/// The composite samples a single depth-less blurred raster, so there is no real object distance to
/// propagate the exit ray over — and without one the body lens is invisible: at `thickness = 10` the
/// dome's steepest ring displaces the sample point by 0.13px, which is the flat interior this whole
/// model replaces. Making the depth proportional to the panel's own half-height is what keeps the
/// magnification *scale-invariant*: the same normalized position on a small panel and a large one is
/// pulled by the same percentage of its half-size, instead of a big window reading flat.
///
/// At `curvature = 0.10` this puts the steepest ring of the dome (|u| = 1/sqrt(3)) at ~2.6% of the
/// half-size, i.e. the "subtle, approximately 2-3% centre magnification" macOS parity target.
pub const BODY_LENS_DEPTH_SCALE: f32 = 1.2;

/// Sentinel a caller passes for a backdrop band whose distance behind the glass is unknown.
///
/// Negative because a real depth never is, so one `float` uniform carries both "this band is 480px
/// away" and "nobody said" without a companion flag.
pub const AUTO_BACKDROP_DEPTH: f32 = -1.0;

/// Distance from the rear face to a backdrop band, resolving [`AUTO_BACKDROP_DEPTH`] against the
/// panel's own geometry.
///
/// This is the one place [`BODY_LENS_DEPTH_SCALE`] survives: a band that declares its own depth is
/// traced over that real distance, and only a band with no declared depth falls back to the
/// calibrated, scale-invariant approximation. Mirrored verbatim as `resolveBackdropDepth` in
/// `glass_composite.frag`; the two must not drift.
pub fn resolve_backdrop_depth(band_depth: f32, panel_half_height: f32) -> f32 {
    if band_depth < 0.0 {
        panel_half_height * BODY_LENS_DEPTH_SCALE
    } else {
        band_depth
    }
}

/// Granularity, in `blur_radius` units, at which distinct panel radii are merged into one blur chain.
///
/// One unit of `blur_radius` is [`CSS_BLUR_PIXELS_PER_RADIUS`] CSS blur pixels, so a 1.0 quantum is
/// half a CSS pixel of sigma — below what a reader can distinguish — and it is what bounds how many
/// blur chains a single frame can be asked to run.
pub const BLUR_RADIUS_QUANTUM: f32 = 1.0;

/// Snap a blur radius to the nearest [`BLUR_RADIUS_QUANTUM`], clamping negatives to zero.
pub fn quantize_blur_radius(radius: f32) -> f32 {
    (radius.max(0.0) / BLUR_RADIUS_QUANTUM).round() * BLUR_RADIUS_QUANTUM
}

/// Surface normal of the convex dome that spans the glass body, at panel-relative position `p`.
///
/// The dome is `z = curvature * (1 - |u|^2)` over the normalized interior coordinate
/// `u = p / half_size`, so its gradient tilts the normal **outward** from the centre, growing from
/// zero at the centre to zero again at the boundary and peaking at `|u| = 1/sqrt(3)`.
///
/// Outward is the sign that magnifies. Entering a denser medium bends the ray *towards* the normal,
/// which for an outward-tilting normal means towards the panel axis: the transmitted rays converge, so
/// the body samples a smaller region of the backdrop and shows it larger. (An inward-tilting normal
/// gives the opposite — a diverging, minifying pane.)
pub fn volumetric_lens_normal(p: Vec2, half_size: Vec2, curvature: f32) -> Vec3 {
    let half = Vec2::new(half_size.x.abs().max(1.0), half_size.y.abs().max(1.0));
    let u = p / half;
    // Clamped at the boundary so the dome never inverts outside the panel, where the SDF bevel normal
    // takes over anyway.
    let dome = (1.0 - u.length_squared()).max(0.0);
    let tilt = u * dome * curvature;
    Vec3::new(tilt.x, tilt.y, 1.0).normalize()
}

/// Screen-space translation, in pixels, of a ray travelling `depth` pixels away from the viewer.
///
/// `dir.z` is negative for a ray heading into the screen; the `0.2` floor is the same grazing-ray guard
/// the shaders use, so a ray refracted almost parallel to the surface cannot produce an unbounded
/// offset.
fn screen_translation(dir: Vec3, depth: f32) -> Vec2 {
    Vec2::new(dir.x, dir.y) / (-dir.z).max(0.2) * depth
}

/// Total screen-space offset of the backdrop point seen through a glass slab, in pixels.
///
/// Three stages, which is what makes this *dual*-surface rather than the single thin-film
/// approximation it replaces:
///
/// 1. **Entry.** `incident` refracts at the front/top interface `normal_front` from air into the glass
///    (Snell's law, via [`snell_refraction_vector`]).
/// 2. **Internal propagation.** The refracted ray crosses the slab, translating the sample point by
///    `thickness` pixels' worth of its own direction.
/// 3. **Exit.** It refracts again at the rear/bottom interface `normal_rear` from glass back into air —
///    the interface that can total-internally-reflect, since this is the dense-to-rare direction — and
///    travels on to the backdrop.
///
/// Both normals point towards the viewer (`+z`), as the shaders' do. The backdrop is taken to sit one
/// slab thickness behind the rear face; [`dual_surface_refraction_offset_at_depth`] takes that distance
/// explicitly, which is what the shaders use with [`BODY_LENS_DEPTH_SCALE`].
///
/// Pixels rather than UV: converting to UV needs a resolution this signature does not carry, and the
/// shaders divide by `u_resolution.y` at exactly this point.
pub fn dual_surface_refraction_offset(
    incident: Vec3,
    normal_front: Vec3,
    normal_rear: Vec3,
    ior: f32,
    thickness: f32,
) -> Vec2 {
    dual_surface_refraction_offset_at_depth(
        incident,
        normal_front,
        normal_rear,
        ior,
        thickness,
        thickness,
    )
}

/// [`dual_surface_refraction_offset`] with the distance from the rear face to the backdrop given
/// explicitly.
///
/// On total internal reflection at the exit interface the ray is kept on its internal heading rather
/// than dropped: the shaders light that band as an inner bevel highlight, and a zeroed direction here
/// would read as "no displacement at all" precisely where the glass bends light hardest.
pub fn dual_surface_refraction_offset_at_depth(
    incident: Vec3,
    normal_front: Vec3,
    normal_rear: Vec3,
    ior: f32,
    thickness: f32,
    backdrop_depth: f32,
) -> Vec2 {
    let ior = ior.max(1.0);
    let internal =
        snell_refraction_vector(incident, normal_front, 1.0, ior).unwrap_or(incident.normalize());
    let exit = snell_refraction_vector(internal, normal_rear, ior, 1.0).unwrap_or(internal);
    screen_translation(internal, thickness) + screen_translation(exit, backdrop_depth)
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
    fn test_default_brightness_replaces_the_dropped_css_overlay() {
        // Calibrated so the GPU composite matches the CSS fallback's measured mean luma of 158.0
        // through the readiness handover: g = (158.0 - 0.05 * 240.4) / (0.95 * 103.4) = 1.486, taken
        // to the 0.05 slider grid. Above 1.0 is what makes the browser luma differential meaningful.
        assert!((OpticalParams::default().brightness - 1.5).abs() < 1e-6);
        assert!(OpticalParams::default().brightness > 1.0);
    }

    // `test_optical_params_layout_matches_the_uniform_upload` used to live here, asserting
    // `size_of::<OpticalParams>() == 60`. It was deleted rather than updated: the struct grew three
    // times (48 -> 52 -> 60) and the only effect each time was that this number was edited to match,
    // which is not a gate. The layout that actually reaches a GPU buffer is
    // `renderer::uniforms::GlassCompositeUniforms`, pinned by compile-time offset assertions and by
    // `from_quad`'s exhaustive destructure of this struct. Keeping a second, weaker size assertion here
    // would only invite the next plan to edit a number instead of deciding a slot.

    #[test]
    fn test_default_thickness_and_curvature() {
        let default = OpticalParams::default();
        assert!((default.thickness - 10.0).abs() < 1e-6);
        assert!((default.curvature - 0.10).abs() < 1e-6);
        // Both must be non-zero for the body to bend any light at all: `thickness` is the lever arm the
        // entry refraction propagates over, `curvature` is the only source of interior surface tilt.
        assert!(default.thickness > 0.0);
        assert!(default.curvature > 0.0);
    }

    #[test]
    fn test_volumetric_lens_normal_magnification() {
        let half_size = Vec2::new(200.0, 120.0);
        let curvature = 0.10;

        // Dead centre: the dome's apex, so the normal faces the viewer exactly.
        let centre = volumetric_lens_normal(Vec2::ZERO, half_size, curvature);
        assert!(centre.x.abs() < 1e-6 && centre.y.abs() < 1e-6);
        assert!((centre.z - 1.0).abs() < 1e-6);

        // Off-centre: the normal tilts *outward*, i.e. the same direction as the offset from centre.
        // This is the convex-dome sign; an inward tilt would be a diverging pane.
        let right = volumetric_lens_normal(Vec2::new(100.0, 0.0), half_size, curvature);
        assert!(right.x > 0.0, "the dome normal must tilt away from centre");
        assert!(right.y.abs() < 1e-6);
        let below = volumetric_lens_normal(Vec2::new(0.0, 60.0), half_size, curvature);
        assert!(below.y > 0.0);

        // The tilt peaks at |u| = 1/sqrt(3) and returns to zero at the boundary, where the SDF bevel
        // normal takes over.
        let peak = volumetric_lens_normal(
            Vec2::new(half_size.x / 3.0f32.sqrt(), 0.0),
            half_size,
            curvature,
        );
        assert!(peak.x > right.x);
        let boundary = volumetric_lens_normal(Vec2::new(half_size.x, 0.0), half_size, curvature);
        assert!(boundary.x.abs() < 1e-6 && (boundary.z - 1.0).abs() < 1e-6);

        // Zero curvature is a flat pane everywhere, which is the "flat slab, thickness only" profile.
        let flat = volumetric_lens_normal(Vec2::new(100.0, 60.0), half_size, 0.0);
        assert!((flat.z - 1.0).abs() < 1e-6);

        // And the point of the outward tilt: the transmitted ray converges towards the panel axis, so
        // the body samples *inwards* and magnifies. `offset.x < 0` at a point right of centre is that.
        let offset = dual_surface_refraction_offset(
            Vec3::new(0.0, 0.0, -1.0),
            peak,
            Vec3::new(0.0, 0.0, 1.0),
            1.52,
            10.0,
        );
        assert!(
            offset.x < 0.0,
            "a convex dome must pull the sample point towards the centre (magnify), got {offset:?}"
        );
    }

    #[test]
    fn test_dual_surface_refraction_displacement() {
        let incident = Vec3::new(0.0, 0.0, -1.0);
        let flat = Vec3::new(0.0, 0.0, 1.0);
        // A front surface tilted like the dome's steepest ring, and a flat rear face (plano-convex).
        let tilted = Vec3::new(0.04, 0.0, 1.0).normalize();

        // Thickness is what turns a refracted *direction* into a visible displacement.
        let thick = dual_surface_refraction_offset(incident, tilted, flat, 1.52, 12.0);
        assert!(
            thick.length() > 0.0,
            "a tilted interface with thickness > 0 must displace the sample point"
        );
        let thin = dual_surface_refraction_offset(incident, tilted, flat, 1.52, 4.0);
        assert!(
            thick.length() > thin.length(),
            "a thicker slab must displace further: {thick:?} vs {thin:?}"
        );
        assert_eq!(
            dual_surface_refraction_offset(incident, tilted, flat, 1.52, 0.0),
            Vec2::ZERO,
            "a zero-thickness slab has no internal path and no gap behind it, so nothing displaces"
        );

        // Normal incidence on parallel faces: the ray passes straight through, exactly as through a
        // window pane held square to the eye.
        let square = dual_surface_refraction_offset(incident, flat, flat, 1.52, 20.0);
        assert!(
            square.length() < 1e-6,
            "expected no displacement, got {square:?}"
        );

        // The exit interface is the dense-to-rare one, so it *amplifies* the deviation the entry
        // interface introduced. Compare the full dual-surface offset against the internal leg alone.
        let internal_only = screen_translation(
            snell_refraction_vector(incident, tilted, 1.0, 1.52).expect("entry cannot TIR"),
            12.0,
        );
        assert!(
            thick.length() > internal_only.length() * 1.5,
            "the rear interface must bend the ray further out, not merely pass it through: \
             {thick:?} vs {internal_only:?}"
        );

        // Air-to-air is a no-op whatever the geometry: no interface, no bending.
        let no_glass = dual_surface_refraction_offset(incident, tilted, flat, 1.0, 12.0);
        assert!(
            no_glass.length() < 1e-6,
            "ior 1.0 is not glass, so nothing should bend: {no_glass:?}"
        );
    }

    #[test]
    fn test_dual_surface_exit_total_internal_reflection_is_survivable() {
        // A steeply tilted rear face sends the internal ray past the critical angle of the glass-air
        // interface. The offset must stay finite and keep the internal heading rather than collapsing to
        // zero, which is what the shaders' inner-bevel band relies on.
        let incident = Vec3::new(0.0, 0.0, -1.0);
        let front = Vec3::new(0.5, 0.0, 1.0).normalize();
        let steep_rear = Vec3::new(0.9, 0.0, 0.3).normalize();
        assert!(
            snell_refraction_vector(
                snell_refraction_vector(incident, front, 1.0, 1.52).unwrap(),
                steep_rear,
                1.52,
                1.0,
            )
            .is_none(),
            "this geometry is meant to total-internally-reflect; the test is vacuous otherwise"
        );

        let offset = dual_surface_refraction_offset(incident, front, steep_rear, 1.52, 10.0);
        assert!(offset.is_finite());
        assert!(offset.length() > 0.0);
    }

    #[test]
    fn test_body_lens_depth_scale_lands_on_the_macos_magnification_target() {
        // The calibration behind BODY_LENS_DEPTH_SCALE, asserted rather than left in prose: at the
        // default curvature the steepest ring of the dome must pull the sample point by 2-3% of the
        // panel half-size, which is the "subtle macOS parity" profile.
        let half_size = Vec2::new(200.0, 120.0);
        let params = OpticalParams::default();
        let p = Vec2::new(half_size.x / 3.0f32.sqrt(), 0.0);
        let offset = dual_surface_refraction_offset_at_depth(
            Vec3::new(0.0, 0.0, -1.0),
            volumetric_lens_normal(p, half_size, params.curvature),
            Vec3::new(0.0, 0.0, 1.0),
            params.ior,
            params.thickness,
            half_size.y * BODY_LENS_DEPTH_SCALE,
        );
        let magnification = offset.length() / half_size.y;
        assert!(
            (0.02..=0.03).contains(&magnification),
            "the default body lens magnifies by {:.1}% of the panel half-size, outside the 2-3% macOS \
             parity band; BODY_LENS_DEPTH_SCALE or the default curvature needs recalibrating",
            magnification * 100.0
        );
    }

    #[test]
    fn test_resolve_backdrop_depth_falls_back_to_the_calibrated_scale() {
        // A band that never said how far away it is keeps Plan 00661's look exactly: the calibrated
        // multiple of the panel's own half-height.
        let half_height = 65.0;
        assert_eq!(
            resolve_backdrop_depth(AUTO_BACKDROP_DEPTH, half_height),
            half_height * BODY_LENS_DEPTH_SCALE
        );
    }

    #[test]
    fn test_resolve_backdrop_depth_passes_an_explicit_distance_through() {
        // An explicit distance is a real distance: panel size must not scale it, or two panels of
        // different sizes would disagree about where the same wallpaper is.
        assert_eq!(resolve_backdrop_depth(480.0, 65.0), 480.0);
        assert_eq!(resolve_backdrop_depth(480.0, 600.0), 480.0);
        assert_eq!(resolve_backdrop_depth(0.0, 65.0), 0.0, "0 is at the glass");
    }

    #[test]
    fn test_backdrop_depth_produces_proportional_parallax() {
        // The property this whole depth-banding exists to deliver, asserted on the reference
        // implementation and not only in the shader: a farther band's sample point travels further.
        let half_size = Vec2::new(200.0, 120.0);
        let params = OpticalParams::default();
        let p = Vec2::new(half_size.x / 3.0f32.sqrt(), 0.0);
        let front = volumetric_lens_normal(p, half_size, params.curvature);
        let at = |depth: f32| {
            dual_surface_refraction_offset_at_depth(
                Vec3::new(0.0, 0.0, -1.0),
                front,
                Vec3::new(0.0, 0.0, 1.0),
                params.ior,
                params.thickness,
                depth,
            )
            .length()
        };

        let near = at(100.0);
        let far = at(400.0);
        assert!(near > 0.0, "the near band must displace at all");
        assert!(far > 0.0, "the far band must displace at all");
        let ratio = far / near;
        assert!(
            (3.0..=5.0).contains(&ratio),
            "4x the distance must buy roughly 4x the displacement (the fixed internal leg dilutes it \
             slightly); got {ratio:.2}x from {near:.3}px and {far:.3}px"
        );
    }

    #[test]
    fn test_quantize_blur_radius_snaps_to_the_quantum() {
        assert_eq!(quantize_blur_radius(16.4), 16.0);
        assert_eq!(quantize_blur_radius(15.6), 16.0);
        assert_eq!(quantize_blur_radius(16.0), 16.0);
        assert_eq!(
            quantize_blur_radius(-4.0),
            0.0,
            "a negative radius is not a blur; it clamps rather than producing a negative tap step"
        );
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
