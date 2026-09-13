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
uniform vec4 u_tint_color;

float sdRoundedBox(vec2 p, vec2 b, float r) {
    vec2 q = abs(p) - b + vec2(r);
    return min(max(q.x, q.y), 0.0) + length(max(q, vec2(0.0))) - r;
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
    vec3 normal = normalize(vec3(normal_2d * (1.0 - edge_proximity), curve_z));

    float eta = 1.0 / max(u_ior, 1.0);
    vec2 refraction_disp = normal_2d * (1.0 - eta) * (1.0 - edge_proximity) * 0.05;

    float grain_hash = sin(dot(v_uv, vec2(12.9898, 78.233))) * 43758.5453;
    float grain = (fract(grain_hash) - 0.5) * u_roughness * 0.005;

    float disp_strength = u_dispersion * 0.02;
    vec2 uv_r = v_uv + refraction_disp * (1.0 + disp_strength) + grain;
    vec2 uv_g = v_uv + refraction_disp + grain;
    vec2 uv_b = v_uv + refraction_disp * (1.0 - disp_strength) + grain;

    float sample_r = texture(u_blurred_texture, uv_r).r;
    float sample_g = texture(u_blurred_texture, uv_g).g;
    float sample_b = texture(u_blurred_texture, uv_b).b;
    vec3 refracted_color = vec3(sample_r, sample_g, sample_b);

    vec3 view_dir = vec3(0.0, 0.0, 1.0);
    float n_dot_v = max(dot(normal, view_dir), 0.0);
    float fresnel = pow(1.0 - n_dot_v, u_rim_power) * u_sheen_intensity;

    vec3 light_dir = normalize(vec3(cos(u_light_angle), sin(u_light_angle), 0.7));
    vec3 half_dir = normalize(view_dir + light_dir);
    float specular = pow(max(dot(normal, half_dir), 0.0), 32.0) * 0.7;

    float bevel_border = smoothstep(0.0, -1.5, dist) * smoothstep(-3.0, -1.5, dist);
    float border_light = bevel_border * max(dot(normal_2d, light_dir.xy), 0.0) * 0.8;

    vec3 tinted = mix(refracted_color, u_tint_color.rgb, u_tint_color.a);
    vec3 final_rgb = tinted + vec3(fresnel) + vec3(specular + border_light);

    fragColor = vec4(final_rgb, alpha);
}
