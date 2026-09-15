#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_blurred_texture;
uniform vec2 u_resolution;
uniform vec4 u_glass_bounds; // x, y, width, height (normalized UV)
uniform float u_corner_radius;
uniform float u_ior;
uniform float u_dispersion;
uniform float u_rim_power;
uniform float u_sheen_intensity;
uniform float u_light_angle;
uniform float u_roughness;
uniform float u_saturation;
uniform float u_brightness;
uniform float u_thickness;
uniform float u_curvature;
uniform vec4 u_tint_color;

// Effective optical depth of the backdrop behind the rear face, as a multiple of the panel's
// half-height. Mirrors `BODY_LENS_DEPTH_SCALE` in packages/core/src/optical/physics.rs, where the
// calibration is derived and asserted: the composite samples a depth-less raster, so scaling this with
// the panel's own size is what keeps the body magnification scale-invariant instead of vanishing on a
// large window (u_thickness alone puts the body displacement at ~0.1px, which is the flat interior this
// model replaces).
const float BODY_LENS_DEPTH_SCALE = 1.2;

float sdRoundedBox(vec2 p, vec2 b, float r) {
    vec2 q = abs(p) - b + vec2(r);
    return min(max(q.x, q.y), 0.0) + length(max(q, vec2(0.0))) - r;
}

// Screen-space translation, in pixels, of a ray travelling `depth` pixels away from the viewer.
// The 0.2 floor guards a ray refracted almost parallel to the surface from producing an unbounded
// offset.
vec2 screenTranslation(vec3 dir, float depth) {
    return dir.xy / max(-dir.z, 0.2) * depth;
}

// UV displacement of the backdrop sample for one wavelength, taken through both optical interfaces of
// the slab: entry at `normal_front`, propagation across `u_thickness`, exit at `normal_rear`, then on to
// a backdrop `backdrop_depth` pixels behind the rear face. Reference implementation and tests:
// `dual_surface_refraction_offset_at_depth` in packages/core/src/optical/physics.rs.
vec2 dualSurfaceDisplacement(vec3 normal_front, vec3 normal_rear, float ior, float backdrop_depth) {
    vec3 view_in = vec3(0.0, 0.0, -1.0);
    float ior_glass = max(ior, 1.0);

    // Entry, air -> glass. Cannot total-internally-reflect in this direction; guarded anyway so a
    // degenerate normal cannot zero the whole displacement.
    vec3 internal = refract(view_in, normal_front, 1.0 / ior_glass);
    if (dot(internal, internal) < 1e-8) {
        internal = view_in;
    }

    // Exit, glass -> air. This is the dense-to-rare interface, so it amplifies the deviation the entry
    // introduced — and it is the one that can total-internally-reflect. On TIR the ray keeps its
    // internal heading rather than collapsing to zero displacement, and the inner bevel band below
    // lights that region.
    vec3 exit_dir = refract(internal, normal_rear, ior_glass);
    if (dot(exit_dir, exit_dir) < 1e-8) {
        exit_dir = internal;
    }

    return (screenTranslation(internal, u_thickness) +
            screenTranslation(exit_dir, backdrop_depth)) / u_resolution.y;
}

void main() {
    vec2 pixel_pos = v_uv * u_resolution;
    vec2 glass_center = (u_glass_bounds.xy + u_glass_bounds.zw * 0.5) * u_resolution;
    vec2 glass_half_size = (u_glass_bounds.zw * 0.5) * u_resolution;
    vec2 p = pixel_pos - glass_center;

    float dist = sdRoundedBox(p, glass_half_size, u_corner_radius);
    float alpha = 1.0 - smoothstep(-1.0, 1.0, dist);
    if (alpha <= 0.0) {
        discard;
    }

    float eps = 1.0;
    float dx = sdRoundedBox(p + vec2(eps, 0.0), glass_half_size, u_corner_radius) -
               sdRoundedBox(p - vec2(eps, 0.0), glass_half_size, u_corner_radius);
    float dy = sdRoundedBox(p + vec2(0.0, eps), glass_half_size, u_corner_radius) -
               sdRoundedBox(p - vec2(0.0, eps), glass_half_size, u_corner_radius);
    vec2 normal_2d = normalize(vec2(dx, dy));

    float edge_proximity = clamp(-dist / max(u_corner_radius, 8.0), 0.0, 1.0);
    float curve_z = sqrt(max(1.0 - (1.0 - edge_proximity) * (1.0 - edge_proximity), 0.01));

    // Front/top interface. Two contributions, and the second is the one the interior used to lack
    // entirely: the outer bevel's SDF-gradient tilt, which `edge_proximity` extinguishes 8px in, plus the
    // body's own volumetric lens dome, which spans the whole panel. `(1 - edge_proximity)` on its own
    // pinned every interior normal to (0, 0, 1), so the window body bent no light at all.
    vec2 body_uv = p / max(glass_half_size, vec2(1.0));
    float dome = max(1.0 - dot(body_uv, body_uv), 0.0);
    // Tilting *outward* from the centre is the convex-plano sign: entering the denser medium bends the
    // ray towards the normal, hence towards the panel axis, so the body converges and magnifies.
    vec2 lens_tilt = body_uv * dome * u_curvature;
    vec3 normal_front = normalize(vec3(normal_2d * (1.0 - edge_proximity) + lens_tilt, curve_z));

    // Rear/bottom interface. Flat across the body (a plano-convex slab), rolling over into an inner bevel
    // just inside the perimeter: `inner_bevel_ramp` is 0 at the rim and 1 by corner_radius + 4px in, and
    // the band is the roll-over itself, peaking mid-ramp.
    float inner_bevel_ramp = smoothstep(-u_corner_radius, -u_corner_radius - 4.0, dist);
    float inner_bevel = 4.0 * inner_bevel_ramp * (1.0 - inner_bevel_ramp);
    vec3 normal_rear = normalize(vec3(-normal_2d * inner_bevel * 0.35, 1.0));

    // The backdrop-depth term fades in across the bevel band. Inside the band the surface tilt reaches
    // ~45 degrees, and propagating that over the body's optical depth would smear the rim by ~80px; the
    // bevel keeps its own thickness-scale displacement instead, and the ramp keeps the transition smooth.
    float backdrop_depth = glass_half_size.y * BODY_LENS_DEPTH_SCALE * edge_proximity;

    // Chromatic aberration, now as real dispersion: the index of refraction itself varies with
    // wavelength, so each channel refracts differently at *both* interfaces and accumulates its own
    // slab translation. Blue is the most deviated, which is the direction real crown glass disperses in
    // (the previous shader scaled one shared displacement by `u_dispersion * 0.02` — a 0.08% spread at
    // the default, i.e. nothing, and with red as the outermost channel).
    float ior_spread = clamp(u_dispersion, 0.0, 0.25);
    vec2 disp_r = dualSurfaceDisplacement(normal_front, normal_rear, u_ior * (1.0 - ior_spread), backdrop_depth);
    vec2 disp_g = dualSurfaceDisplacement(normal_front, normal_rear, u_ior, backdrop_depth);
    vec2 disp_b = dualSurfaceDisplacement(normal_front, normal_rear, u_ior * (1.0 + ior_spread), backdrop_depth);

    float grain_hash = sin(dot(v_uv, vec2(12.9898, 78.233))) * 43758.5453;
    float grain = (fract(grain_hash) - 0.5) * u_roughness * 0.005;

    vec2 uv_r = v_uv + disp_r + grain;
    vec2 uv_g = v_uv + disp_g + grain;
    vec2 uv_b = v_uv + disp_b + grain;

    float sample_r = texture(u_blurred_texture, uv_r).r;
    float sample_g = texture(u_blurred_texture, uv_g).g;
    float sample_b = texture(u_blurred_texture, uv_b).b;
    vec3 refracted_color = vec3(sample_r, sample_g, sample_b);

    // Shading uses the front interface's normal, so the body dome also carries the Fresnel and specular
    // response across the interior instead of only at the perimeter.
    vec3 view_dir = vec3(0.0, 0.0, 1.0);
    float n_dot_v = max(dot(normal_front, view_dir), 0.0);
    float fresnel = pow(1.0 - n_dot_v, u_rim_power) * u_sheen_intensity;

    vec3 light_dir = normalize(vec3(cos(u_light_angle), sin(u_light_angle), 0.7));
    vec3 half_dir = normalize(view_dir + light_dir);
    float specular = pow(max(dot(normal_front, half_dir), 0.0), 32.0) * 0.7;

    float bevel_border = smoothstep(0.0, -1.5, dist) * smoothstep(-3.0, -1.5, dist);
    float border_light = bevel_border * max(dot(normal_2d, light_dir.xy), 0.0) * 0.8;
    // The rear face's inner bevel faces the other way, so it catches the same light on the opposite side
    // of the panel: the bright inner line just inside the perimeter of thick glass.
    float inner_bevel_light = inner_bevel * max(dot(-normal_2d, light_dir.xy), 0.0) * 0.35;

    vec3 tinted = mix(refracted_color, u_tint_color.rgb, u_tint_color.a);
    // CSS `saturate(N%)` is a luma-preserving chroma scale, and the fallback literals all use 180-190%.
    // Without this the composite is strictly less saturated than the CSS it replaces: the tint mix above
    // pulls 12% white *in*, and the blur below averages chroma out.
    float luma = dot(tinted, vec3(0.2126, 0.7152, 0.0722));
    // The clamp matters: `mix` with a factor above 1.0 extrapolates and can drive a channel out of
    // [0, 1] before the additive sheen ever lands on it.
    vec3 saturated = clamp(mix(vec3(luma), tinted, u_saturation), 0.0, 1.0);
    // The CSS fallback's brightness came from a near-white overlay at alpha 0.22 that the handover
    // drops to 0.05. Buying that luma back with more white tint would cost chroma (a veil scales
    // per-pixel channel spread by 1 - a); a gain scales spread by g instead, which is the direction
    // the chroma gap needs. Before the sheen: the sheen is additive, so scaling it blows highlights.
    vec3 brightened = clamp(saturated * u_brightness, 0.0, 1.0);
    vec3 final_rgb = brightened + vec3(fresnel) + vec3(specular + border_light + inner_bevel_light);

    fragColor = vec4(final_rgb, alpha);
}
