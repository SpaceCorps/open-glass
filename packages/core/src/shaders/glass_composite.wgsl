struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) in_vertex_index: u32) -> VertexOutput {
    var out: VertexOutput;
    let x = f32(i32(in_vertex_index == 1u) * 4 - 1);
    let y = f32(i32(in_vertex_index == 2u) * 4 - 1);
    out.position = vec4<f32>(x, y, 0.0, 1.0);
    out.uv = vec2<f32>((x + 1.0) * 0.5, (1.0 - y) * 0.5);
    return out;
}

// The one uniform block this pass binds. Its layout is owned by `GlassCompositeUniforms` in
// packages/core/src/renderer/uniforms.rs, which is `#[repr(C, align(16))]` + `bytemuck::Pod` and
// asserts every offset below at compile time; `test_composite_uniforms_match_the_wgsl_declaration`
// parses this declaration and pins the two field-for-field, because nothing here is compiled yet.
//
// The order is the layout. Twelve scalars fill three complete 16-byte rows (bytes 0-47), so the two
// `vec4<f32>` members land on their 16-byte boundaries with no *implicit* padding anywhere in the
// struct — which the previous `padding: f32` slot did not achieve: with nine scalars ahead of it, it
// sat at offset 36 and WGSL still inserted 8 unnamed bytes before `tint_color`, putting it at 48
// rather than the intended 40. Do not append a field without deciding its slot in `uniforms.rs` first.
struct GlassCompositeUniforms {
    ior: f32,             //  0
    blur_radius: f32,     //  4
    dispersion: f32,      //  8
    rim_power: f32,       // 12
    sheen_intensity: f32, // 16
    light_angle: f32,     // 20
    roughness: f32,       // 24
    saturation: f32,      // 28
    brightness: f32,      // 32
    thickness: f32,       // 36
    curvature: f32,       // 40
    corner_radius: f32,   // 44
    tint_color: vec4<f32>,   // 48
    glass_bounds: vec4<f32>, // 64 — x, y, width, height in normalized UV space
    resolution: vec2<f32>,   // 80
    _padding: vec2<f32>,     // 88 — explicit tail to the 96-byte stride WGSL rounds the block up to
};

// Effective optical depth of the backdrop behind the rear face, as a multiple of the panel's
// half-height. Mirrors `BODY_LENS_DEPTH_SCALE` in packages/core/src/optical/physics.rs.
const BODY_LENS_DEPTH_SCALE: f32 = 1.2;

@group(0) @binding(0) var<uniform> optical: GlassCompositeUniforms;
@group(0) @binding(1) var blurred_texture: texture_2d<f32>;
@group(0) @binding(2) var texture_sampler: sampler;

// Signed Distance Field (SDF) of rounded rectangle
fn sd_rounded_box(p: vec2<f32>, b: vec2<f32>, r: f32) -> f32 {
    let q = abs(p) - b + vec2<f32>(r, r);
    return min(max(q.x, q.y), 0.0) + length(max(q, vec2<f32>(0.0, 0.0))) - r;
}

// Snell's law refraction. WGSL has no built-in `refract`, so this is GLSL's, including its convention
// of returning the zero vector on total internal reflection.
fn refract_ray(incident: vec3<f32>, normal: vec3<f32>, eta: f32) -> vec3<f32> {
    let cos_i = dot(normal, incident);
    let k = 1.0 - eta * eta * (1.0 - cos_i * cos_i);
    if (k < 0.0) {
        return vec3<f32>(0.0, 0.0, 0.0);
    }
    return eta * incident - (eta * cos_i + sqrt(k)) * normal;
}

// Screen-space translation, in pixels, of a ray travelling `depth` pixels away from the viewer.
fn screen_translation(dir: vec3<f32>, depth: f32) -> vec2<f32> {
    return dir.xy / max(-dir.z, 0.2) * depth;
}

// UV displacement of the backdrop sample for one wavelength, taken through both optical interfaces of
// the slab: entry at `normal_front`, propagation across `optical.thickness`, exit at `normal_rear`, then
// on to a backdrop `backdrop_depth` pixels behind the rear face. Reference implementation and tests:
// `dual_surface_refraction_offset_at_depth` in packages/core/src/optical/physics.rs.
fn dual_surface_displacement(
    normal_front: vec3<f32>,
    normal_rear: vec3<f32>,
    ior: f32,
    backdrop_depth: f32,
) -> vec2<f32> {
    let view_in = vec3<f32>(0.0, 0.0, -1.0);
    let ior_glass = max(ior, 1.0);

    // Entry, air -> glass: cannot total-internally-reflect in this direction, guarded anyway.
    var internal = refract_ray(view_in, normal_front, 1.0 / ior_glass);
    if (dot(internal, internal) < 1e-8) {
        internal = view_in;
    }

    // Exit, glass -> air: the dense-to-rare interface, which amplifies the entry deviation and is the one
    // that can total-internally-reflect. On TIR the ray keeps its internal heading.
    var exit_dir = refract_ray(internal, normal_rear, ior_glass);
    if (dot(exit_dir, exit_dir) < 1e-8) {
        exit_dir = internal;
    }

    return (screen_translation(internal, optical.thickness) +
            screen_translation(exit_dir, backdrop_depth)) / optical.resolution.y;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    let pixel_pos = in.uv * optical.resolution;
    let glass_center = (optical.glass_bounds.xy + optical.glass_bounds.zw * 0.5) * optical.resolution;
    let glass_half_size = (optical.glass_bounds.zw * 0.5) * optical.resolution;
    let p = pixel_pos - glass_center;

    let dist = sd_rounded_box(p, glass_half_size, optical.corner_radius);

    // If outside glass shape with antialiasing feather
    let alpha = 1.0 - smoothstep(-1.0, 1.0, dist);
    if (alpha <= 0.0) {
        discard;
    }

    // Surface normal estimation from SDF gradient
    let eps = 1.0;
    let dx = sd_rounded_box(p + vec2<f32>(eps, 0.0), glass_half_size, optical.corner_radius) -
             sd_rounded_box(p - vec2<f32>(eps, 0.0), glass_half_size, optical.corner_radius);
    let dy = sd_rounded_box(p + vec2<f32>(0.0, eps), glass_half_size, optical.corner_radius) -
             sd_rounded_box(p - vec2<f32>(0.0, eps), glass_half_size, optical.corner_radius);
    let normal_2d = normalize(vec2<f32>(dx, dy));

    let edge_proximity = clamp(-dist / max(optical.corner_radius, 8.0), 0.0, 1.0);
    let curve_z = sqrt(max(1.0 - (1.0 - edge_proximity) * (1.0 - edge_proximity), 0.01));

    // Front/top interface: the outer bevel's SDF-gradient tilt, which `edge_proximity` extinguishes 8px
    // in, plus the body's own volumetric lens dome spanning the whole panel. The dome tilts *outward*
    // from the centre, which is the sign that converges the transmitted rays and therefore magnifies.
    let body_uv = p / max(glass_half_size, vec2<f32>(1.0, 1.0));
    let dome = max(1.0 - dot(body_uv, body_uv), 0.0);
    let lens_tilt = body_uv * dome * optical.curvature;
    let normal_front = normalize(vec3<f32>(normal_2d * (1.0 - edge_proximity) + lens_tilt, curve_z));

    // Rear/bottom interface: flat across the body, rolling over into an inner bevel just inside the
    // perimeter, peaking mid-roll-over.
    let inner_bevel_ramp = smoothstep(-optical.corner_radius, -optical.corner_radius - 4.0, dist);
    let inner_bevel = 4.0 * inner_bevel_ramp * (1.0 - inner_bevel_ramp);
    let normal_rear = normalize(vec3<f32>(-normal_2d * inner_bevel * 0.35, 1.0));

    // Faded in across the bevel band, where the ~45-degree surface tilt would otherwise smear the rim
    // over the body's whole optical depth.
    let backdrop_depth = glass_half_size.y * BODY_LENS_DEPTH_SCALE * edge_proximity;

    // High-frequency tactile frosting grain
    let grain_hash = sin(dot(in.uv, vec2<f32>(12.9898, 78.233))) * 43758.5453;
    let grain = (fract(grain_hash) - 0.5) * optical.roughness * 0.005;

    // Chromatic aberration as real dispersion: the index of refraction varies with wavelength, so each
    // channel refracts differently at *both* interfaces and accumulates its own slab translation. Blue is
    // the most deviated, as in real crown glass.
    let ior_spread = clamp(optical.dispersion, 0.0, 0.25);
    let disp_r = dual_surface_displacement(normal_front, normal_rear, optical.ior * (1.0 - ior_spread), backdrop_depth);
    let disp_g = dual_surface_displacement(normal_front, normal_rear, optical.ior, backdrop_depth);
    let disp_b = dual_surface_displacement(normal_front, normal_rear, optical.ior * (1.0 + ior_spread), backdrop_depth);

    let uv_r = in.uv + disp_r + grain;
    let uv_g = in.uv + disp_g + grain;
    let uv_b = in.uv + disp_b + grain;

    let sample_r = textureSample(blurred_texture, texture_sampler, uv_r).r;
    let sample_g = textureSample(blurred_texture, texture_sampler, uv_g).g;
    let sample_b = textureSample(blurred_texture, texture_sampler, uv_b).b;
    let refracted_color = vec3<f32>(sample_r, sample_g, sample_b);

    // Fresnel rim glow, from the front interface's normal so the body dome carries it too
    let view_dir = vec3<f32>(0.0, 0.0, 1.0);
    let n_dot_v = max(dot(normal_front, view_dir), 0.0);
    let fresnel = pow(1.0 - n_dot_v, optical.rim_power) * optical.sheen_intensity;

    // Specular highlight from directional light
    let light_dir = normalize(vec3<f32>(cos(optical.light_angle), sin(optical.light_angle), 0.7));
    let half_dir = normalize(view_dir + light_dir);
    let specular = pow(max(dot(normal_front, half_dir), 0.0), 32.0) * 0.7;

    // Bevel highlight along outer border
    let bevel_border = smoothstep(0.0, -1.5, dist) * smoothstep(-3.0, -1.5, dist);
    let border_light = bevel_border * max(dot(normal_2d, light_dir.xy), 0.0) * 0.8;
    // The rear face's inner bevel faces the other way, so it catches the same light on the opposite side:
    // the bright inner line just inside the perimeter of thick glass.
    let inner_bevel_light = inner_bevel * max(dot(-normal_2d, light_dir.xy), 0.0) * 0.35;

    // Final composition with glass tint
    let tinted = mix(refracted_color, optical.tint_color.rgb, optical.tint_color.a);
    // CSS `saturate(N%)` is a luma-preserving chroma scale, and the fallback literals all use 180-190%.
    // Without this the composite is strictly less saturated than the CSS it replaces: the tint mix above
    // pulls 12% white *in*, and the blur below averages chroma out.
    let luma = dot(tinted, vec3<f32>(0.2126, 0.7152, 0.0722));
    // The clamp matters: `mix` with a factor above 1.0 extrapolates and can drive a channel out of
    // [0, 1] before the additive sheen ever lands on it.
    let saturated = clamp(mix(vec3<f32>(luma), tinted, optical.saturation), vec3<f32>(0.0), vec3<f32>(1.0));
    // The CSS fallback's brightness came from a near-white overlay at alpha 0.22 that the handover
    // drops to 0.05. Buying that luma back with more white tint would cost chroma (a veil scales
    // per-pixel channel spread by 1 - a); a gain scales spread by g instead, which is the direction
    // the chroma gap needs. Before the sheen: the sheen is additive, so scaling it blows highlights.
    let brightened = clamp(saturated * optical.brightness, vec3<f32>(0.0), vec3<f32>(1.0));
    let final_rgb = brightened + vec3<f32>(fresnel) + vec3<f32>(specular + border_light + inner_bevel_light);

    return vec4<f32>(final_rgb, alpha);
}
