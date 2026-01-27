struct Uniforms {
  projection : mat4x4<f32>,
  view       : mat4x4<f32>,
  focal      : vec3<f32>,
  _pad       : f32,
};

@group(0) @binding(0) var idx_buffer : texture_2d<u32>;
@group(0) @binding(1) var splat_tex  : texture_2d<f32>;
@group(0) @binding(2) var splat_sampler : sampler;
@group(0) @binding(3) var<uniform> uniforms : Uniforms;

struct VSOut {
  @builtin(position) position : vec4<f32>,
  @location(0) vColor    : vec4<f32>,
  @location(1) vPosition : vec2<f32>,
  @location(2) vScale    : f32,
};

fn unpackF32ToRGB8(v : f32) -> vec4<f32> {
  let bits = bitcast<u32>(v);
  return vec4<f32>(
    f32((bits >> 0u)  & 0xffu),
    f32((bits >> 8u)  & 0xffu),
    f32((bits >> 16u) & 0xffu),
    f32((bits >> 24u) & 0xffu)
  ) / 255.0;
}

fn unpackF32ToHalf2(raw : f32) -> vec2<f32> {
  return unpack2x16float(bitcast<u32>(raw));
}

fn unpackCovariance(v : vec3<f32>) -> mat3x3<f32> {
  let u1 = unpackF32ToHalf2(v.x);
  let u2 = unpackF32ToHalf2(v.y);
  let u3 = unpackF32ToHalf2(v.z);
  // column-major construction
  return mat3x3<f32>(
    vec3<f32>(u1.x, u1.y, u2.x),
    vec3<f32>(u1.y, u2.y, u3.x),
    vec3<f32>(u2.x, u3.x, u3.y)
  );
}

@vertex
fn main(@location(0) position : vec3<f32>, @builtin(instance_index) instance_index : u32) -> VSOut {
  let idx_tex = textureLoad(idx_buffer, vec2<i32>(i32(instance_index % 1024u), i32(instance_index / 1024u)), 0);
  let id = i32(idx_tex.r);
  let row = (id % 1024) * 2;
  let col = id / 1024;

  let pix1 = textureLoad(splat_tex, vec2<i32>(row, col), 0);
  let pix2 = textureLoad(splat_tex, vec2<i32>(row + 1, col), 0);

  let pos_view = uniforms.view * vec4<f32>(pix1.xyz, 1.0);
  let pos_proj = uniforms.projection * pos_view;

  let tan_a = uniforms.focal.y / uniforms.focal.z;
  let r = uniforms.focal.x / uniforms.focal.y;

  let cov = unpackCovariance(pix2.xyz);

  let J = mat3x3<f32>(
    vec3<f32>(1.0 / (r * tan_a * pos_view.z), 0.0, -(pos_view.x) / (pos_view.z * pos_view.z) / (r * tan_a)),
    vec3<f32>(0.0, 1.0 / (tan_a * pos_view.z), -(pos_view.y) / (pos_view.z * pos_view.z) / (tan_a)),
    vec3<f32>(0.0, 0.0, 0.0)
  );

  let view3 = mat3x3<f32>(
    vec3<f32>(uniforms.view[0].xyz),
    vec3<f32>(uniforms.view[1].xyz),
    vec3<f32>(uniforms.view[2].xyz)
  );

  let T = transpose(J) * view3;
  let cov_scr3 = T * cov * transpose(T);
  let cov_scr = mat2x2<f32>(
    vec2<f32>(cov_scr3[0].x, cov_scr3[0].y),
    vec2<f32>(cov_scr3[1].x, cov_scr3[1].y)
  );

  let mid = 0.5 * (cov_scr[0][0] + cov_scr[1][1]);
  let radius = length(vec2<f32>((cov_scr[0][0] - cov_scr[1][1]) * 0.5, cov_scr[0][1]));
  let lambda1 = mid + radius;
  let lambda2 = mid - radius;

  if (lambda2 < 0.0) {
    return VSOut(vec4<f32>(0.0), vec4<f32>(0.0), vec2<f32>(0.0), 0.0);
  }

  let ax_diag = normalize(vec2<f32>(cov_scr[0][1], lambda1 - cov_scr[0][0]));
  let center = pos_proj.xy / pos_proj.w;
  let ax_1 = min(sqrt(lambda1), 1024.0) * ax_diag;
  let ax_2 = min(sqrt(lambda2), 1024.0) * vec2<f32>(ax_diag.y, -ax_diag.x);

  let scale = 6.0;
  let clip_xy = center + position.x * ax_1 * scale + position.y * ax_2 * scale;

  var out : VSOut;
  out.position = vec4<f32>(clip_xy, 0.0, 1.0);
  out.vPosition = position.xy;
  out.vColor = unpackF32ToRGB8(pix2.a);
  out.vScale = scale;
  return out;
}
