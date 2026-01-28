precision highp float;
precision highp usampler2D;
precision highp int;

uniform usampler2D idx_buffer;
uniform highp sampler2D u_data;
uniform mat4 projection, view;
uniform vec3 focal;

in vec3 position;

out vec4 vColor;
out vec2 vPosition;

out vec3 vOriColor;
out vec3 vPbr;

out vec3 vWorldPos;

out float scale;

vec4 unpackF32ToRGB8(float v)
{
    uint bits = floatBitsToUint(v);
    return vec4(
        (bits >>  0) & 0xFFu,
        (bits >>  8) & 0xFFu,
        (bits >> 16) & 0xFFu,
        (bits >> 24) & 0xFFu
    ) / 255.0;
}

vec2 unpackF32ToHalf2(float raw){
    return unpackHalf2x16(floatBitsToUint(raw));
}

mat3 unpackRS(vec3 v)
{
    vec2 u1 = unpackF32ToHalf2(v.x), u2 = unpackF32ToHalf2(v.y), u3 = unpackF32ToHalf2(v.z);
    // unpack upper triangle: xx, xy, xz, yy, yz, zz
    return transpose(mat3(u1.x, u1.y, 0.0, 
                          u2.x, u2.y, 0.0, 
                          u3.x, u3.y, 0.0));
}

vec3 evalSh1(vec3 baseColor, vec3 dir, vec3 c1, vec3 c2, vec3 c3) {
    // first-order SH basis (approx): C1 * [x,y,z]
    float C1 = 0.4886025119;
    return baseColor + C1 * (dir.x * c1 + dir.y * c2 + dir.z * c3);
}

void main()
{
    // load transform
    int id = int(texelFetch(idx_buffer, ivec2(gl_InstanceID % 1024, gl_InstanceID / 1024), 0).r);
    int row = (id % 1024) * 4;
    int col = id / 1024;
    vec4 pix0 = texelFetch(u_data, ivec2(row  , col), 0);
    vec4 pix1 = texelFetch(u_data, ivec2(row+1, col), 0);
    vec4 pix2 = texelFetch(u_data, ivec2(row+2, col), 0);
    vec4 pix3 = texelFetch(u_data, ivec2(row+3, col), 0);

    vec4 pos_view = view * vec4(pix0.xyz, 1.0); // relative position to camera
    vec4 pos_proj = projection * pos_view;

    vWorldPos = pix0.xyz;
    float tan_a = focal.y / focal.z;
    float r = focal.x / focal.y;

    mat3 RS = unpackRS(pix1.xyz);
    // GLSL fills column-major
    mat3 J = transpose(mat3(
        1. / (r * tan_a * pos_view.z), 0., -(pos_view.x) / (pos_view.z * pos_view.z) / (r * tan_a),
        0.,     1. / (tan_a * pos_view.z), -(pos_view.y) / (pos_view.z * pos_view.z) / (tan_a),
        0., 0., 0.
    ));

    mat3 T = J * mat3(view);
    mat3 cov = RS * transpose(RS);
    mat2 cov_scr = mat2(T * cov * transpose(T));

    // Eigen decomposition
    float mid = (cov_scr[0][0] + cov_scr[1][1]) * 0.5; // (\lambda_1 + \lambda_2)/2 = Tr(\Sigma) / 2 
    float radius = length(vec2((cov_scr[0][0] - cov_scr[1][1]) / 2.0, cov_scr[0][1]));
    float lambda1 = mid + radius, lambda2 = mid - radius;
    if (lambda2 < 0.0) return;
    vec2 ax_diag = normalize(vec2(cov_scr[0][1], lambda1 - cov_scr[0][0]));
    
    vec2 center = vec2(pos_proj) / pos_proj.w;
    vec2 ax_1 = min(sqrt(lambda1), 1024.0) * ax_diag;
    vec2 ax_2 = min(sqrt(lambda2), 1024.0) * vec2(ax_diag.y, -ax_diag.x);

    scale = 6.0;
    gl_Position = vec4(center + position.x * ax_1 * scale + position.y * ax_2 * scale, 0.0, 1.0);


    vPosition = vec2(position);

    // base color packed as RGB8 in pix1.a
    vec3 baseColor = unpackF32ToRGB8(pix1.a).rgb;

    // unpack SH1 (9 half floats) from pix2/pix3
    vec2 sh01 = unpackF32ToHalf2(pix2.x);
    vec2 sh23 = unpackF32ToHalf2(pix2.y);
    vec2 sh45 = unpackF32ToHalf2(pix2.z);
    vec2 sh67 = unpackF32ToHalf2(pix2.w);
    vec2 sh89 = unpackF32ToHalf2(pix3.x);

    vec3 c1 = vec3(sh01.x, sh01.y, sh23.x); // r1,g1,b1
    vec3 c2 = vec3(sh23.y, sh45.x, sh45.y); // r2,g2,b2
    vec3 c3 = vec3(sh67.x, sh67.y, sh89.x); // r3,g3,b3

    vec3 dir = normalize(-pos_view.xyz);
    vec3 rgb = clamp(evalSh1(baseColor, dir, c1, c2, c3), 0.0, 1.0);
    vColor = vec4(rgb, pix0.a);

    // New packed attributes (stored in pix3.yzw)
    vOriColor = unpackF32ToRGB8(pix3.y).rgb;
    vec2 rr = unpackF32ToHalf2(pix3.z); // refl, roughness
    vec2 m0 = unpackF32ToHalf2(pix3.w); // metalness, pad
    vPbr = vec3(rr.x, rr.y, m0.x);
}  