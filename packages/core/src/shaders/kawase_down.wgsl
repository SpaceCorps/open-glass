struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) in_vertex_index: u32) -> VertexOutput {
    var out: VertexOutput;
    // Fullscreen quad from single triangle
    let x = f32(i32(in_vertex_index == 1u) * 4 - 1);
    let y = f32(i32(in_vertex_index == 2u) * 4 - 1);
    out.position = vec4<f32>(x, y, 0.0, 1.0);
    out.uv = vec2<f32>((x + 1.0) * 0.5, (1.0 - y) * 0.5);
    return out;
}

struct DownsampleUniforms {
    texel_size: vec2<f32>,
    iteration: f32,
    blur_radius: f32,
};

@group(0) @binding(0) var<uniform> uniforms: DownsampleUniforms;
@group(0) @binding(1) var source_texture: texture_2d<f32>;
@group(0) @binding(2) var texture_sampler: sampler;

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    let step = (uniforms.iteration + 1.0) * max(uniforms.blur_radius * 0.25, 1.0);
    let offset = uniforms.texel_size * step * 0.5;

    var color = textureSample(source_texture, texture_sampler, in.uv + vec2<f32>(-offset.x, -offset.y));
    color += textureSample(source_texture, texture_sampler, in.uv + vec2<f32>(offset.x, -offset.y));
    color += textureSample(source_texture, texture_sampler, in.uv + vec2<f32>(-offset.x, offset.y));
    color += textureSample(source_texture, texture_sampler, in.uv + vec2<f32>(offset.x, offset.y));

    return color * 0.25;
}
