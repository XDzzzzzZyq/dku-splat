precision highp float;
precision highp usampler2D;
precision highp int;

uniform usampler2D idx_buffer;
uniform highp sampler2D u_texture;
uniform mat4 projection, view;
uniform vec3 focal;

in vec3 position;

out vec4 vColor;
out vec2 vPosition;

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

mat3 unpackCovariance(vec3 v)
{
    vec2 u1 = unpackF32ToHalf2(v.x), u2 = unpackF32ToHalf2(v.y), u3 = unpackF32ToHalf2(v.z);
    // unpack upper triangle: xx, xy, xz, yy, yz, zz
    return mat3(u1.x, u1.y, u2.x, 
                u1.y, u2.y, u3.x, 
                u2.x, u3.x, u3.y);
}

void main()
{
    // load transform
    int id = int(texelFetch(idx_buffer, ivec2(gl_InstanceID % 1024, gl_InstanceID / 1024), 0).r);
    int row = (id % 1024) * 2;
    int col = id / 1024;
    vec4 pix1 = texelFetch(u_texture, ivec2(row  , col), 0);
    vec4 pix2 = texelFetch(u_texture, ivec2(row+1, col), 0);

    vec4 pos_view = view * vec4(pix1.xyz, 1.0); // relative position to camera
    vec4 pos_proj = projection * pos_view;
    float tan_a = focal.y / focal.z;
    float r = focal.x / focal.y;

    mat3 cov = unpackCovariance(pix2.xyz);
    // GLSL fills column-major
    mat3 J = mat3(
        1. / (r * tan_a * pos_view.z), 0., -(pos_view.x) / (pos_view.z * pos_view.z) / (r * tan_a),
        0.,     1. / (tan_a * pos_view.z), -(pos_view.y) / (pos_view.z * pos_view.z) / (tan_a),
        0., 0., 0.
    );

    mat3 T = transpose(J) * mat3(view);
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
    vColor = unpackF32ToRGB8(pix2.a);
}  