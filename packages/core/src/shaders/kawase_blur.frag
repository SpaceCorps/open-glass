#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_texture;
uniform vec2 u_texel_size;
uniform float u_offset;

void main() {
    vec2 offset = u_texel_size * u_offset;
    vec4 color = texture(u_texture, v_uv + vec2(-offset.x, -offset.y));
    color += texture(u_texture, v_uv + vec2(offset.x, -offset.y));
    color += texture(u_texture, v_uv + vec2(-offset.x, offset.y));
    color += texture(u_texture, v_uv + vec2(offset.x, offset.y));
    fragColor = color * 0.25;
}
