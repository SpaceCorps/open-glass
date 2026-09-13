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
    /// Reserved padding for GPU uniform alignment (16-byte boundary).
    pub _padding: f32,
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
            _padding: 0.0,
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
pub fn chromatic_aberration_offsets(refraction_dir_uv: Vec2, dispersion: f32) -> (Vec2, Vec2, Vec2) {
    let base_displacement = refraction_dir_uv * dispersion;
    let red_offset = base_displacement * (1.0 + dispersion);
    let green_offset = base_displacement;
    let blue_offset = base_displacement * (1.0 - dispersion);
    (red_offset, green_offset, blue_offset)
}

/// Dual Kawase downsample offset kernels for a given iteration step.
///
/// Downsample pass uses 4 half-texel offset sample points around the center.
pub fn dual_kawase_down_offsets(iteration: u32, texel_size: Vec2, blur_radius: f32) -> [Vec2; 4] {
    let step = (iteration as f32 + 1.0) * (blur_radius * 0.25).max(1.0);
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
    let step = (iteration as f32 + 0.5) * (blur_radius * 0.25).max(1.0);
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
    fn test_specular_rim_light() {
        let view_dir = Vec3::new(0.0, 0.0, 1.0);
        let normal = Vec3::new(FRAC_1_SQRT_2, 0.0, FRAC_1_SQRT_2);
        let light_dir = Vec3::new(1.0, 1.0, 1.0).normalize();
        let rim = specular_rim_light(view_dir, normal, light_dir, 3.0, 0.8);
        assert!(rim > 0.0 && rim <= 1.0);
    }
}
