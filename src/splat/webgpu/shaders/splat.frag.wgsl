@fragment
fn main(
  @location(0) vColor : vec4<f32>,
  @location(1) vPosition : vec2<f32>,
  @location(2) vScale : f32
) -> @location(0) vec4<f32> {
  let A = -dot(vPosition, vPosition) * vScale;
  if (A < -4.0) {
    discard;
  }
  let B = exp(A);
  return vec4<f32>(vColor.rgb, B);
}
