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

struct OpticalUniforms {
    ior: f32,
    blur_radius: f32,
    dispersion: f32,
    rim_power: f32,
    sheen_intensity: f32,
    light_angle: f32,
    roughness: f32,
    padding: f32,
    tint_color: vec4<f32>,
    resolution: vec2<f32>,
    glass_bounds: vec4<f32>, // x, y, width, height in normalized UV space
    corner_radius: f32,
    padding2: vec3<f32>,
};

@group(0) @binding(0) var<uniform> optical: OpticalUniforms;
@group(0) @binding(1) var blurred_texture: texture_2d<f32>;
@group(0) @binding(2) var texture_sampler: sampler;

// Signed Distance Field (SDF) of rounded rectangle
fn sd_rounded_box(p: vec2<f32>, b: vec2<f32>, r: f32) -> f32 {
    let q = abs(p) - b + vec2<f32>(r, r);
    return min(max(q.x, q.y), 0.0) + length(max(q, vec2<f32>(0.0, 0.0))) - r;
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

    // Curved glass profile towards edges
    let edge_proximity = clamp(-dist / max(optical.corner_radius, 8.0), 0.0, 1.0);
    let curve_z = sqrt(max(1.0 - (1.0 - edge_proximity) * (1.0 - edge_proximity), 0.01));
    let normal = normalize(vec3<f32>(normal_2d * (1.0 - edge_proximity), curve_z));

    // Refraction UV displacement based on IOR (Snell's Law approximation for thin glass)
    let eta = 1.0 / max(optical.ior, 1.0);
    let refraction_disp = normal_2d * (1.0 - eta) * (1.0 - edge_proximity) * 0.05;

    // High-frequency tactile frosting grain
    let grain_hash = sin(dot(in.uv, vec2<f32>(12.9898, 78.233))) * 43758.5453;
    let grain = (fract(grain_hash) - 0.5) * optical.roughness * 0.005;

    // Chromatic aberration dispersion across RGB
    let disp_strength = optical.dispersion * 0.02;
    let uv_r = in.uv + refraction_disp * (1.0 + disp_strength) + grain;
    let uv_g = in.uv + refraction_disp + grain;
    let uv_b = in.uv + refraction_disp * (1.0 - disp_strength) + grain;

    let sample_r = textureSample(blurred_texture, texture_sampler, uv_r).r;
    let sample_g = textureSample(blurred_texture, texture_sampler, uv_g).g;
    let sample_b = textureSample(blurred_texture, texture_sampler, uv_b).b;
    let refracted_color = vec3<f32>(sample_r, sample_g, sample_b);

    // Fresnel rim glow
    let view_dir = vec3<f32>(0.0, 0.0, 1.0);
    let n_dot_v = max(dot(normal, view_dir), 0.0);
    let fresnel = pow(1.0 - n_dot_v, optical.rim_power) * optical.sheen_intensity;

    // Specular highlight from directional light
    let light_dir = normalize(vec3<f32>(cos(optical.light_angle), sin(optical.light_angle), 0.7));
    let half_dir = normalize(view_dir + light_dir);
    let specular = pow(max(dot(normal, half_dir), 0.0), 32.0) * 0.7;

    // Bevel highlight along outer border
    let bevel_border = smoothstep(0.0, -1.5, dist) * smoothstep(-3.0, -1.5, dist);
    let border_light = bevel_border * max(dot(normal_2d, light_dir.xy), 0.0) * 0.8;

    // Final composition with glass tint
    let tinted = mix(refracted_color, optical.tint_color.rgb, optical.tint_color.a);
    let final_rgb = tinted + vec3<f32>(fresnel) + vec3<f32>(specular + border_light);

    return vec4<f32>(final_rgb, alpha);
}
