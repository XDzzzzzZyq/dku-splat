precision highp float;
precision highp usampler2D;
precision highp int;

uniform usampler2D idx_buffer;
uniform highp sampler2D u_texture;
uniform mat4 projection, view;

in vec3 position;

out vec4 vColor;
out vec2 vPosition;

vec4 unpackFloatToRGB8(float v)
{
    uint bits = floatBitsToUint(v);
    return vec4(
        (bits >>  0) & 0xFFu,
        (bits >>  8) & 0xFFu,
        (bits >> 16) & 0xFFu,
        (bits >> 24) & 0xFFu
    ) / 255.0;
}

void main()
{
    int id = int(texelFetch(idx_buffer, ivec2(gl_InstanceID, 0), 0).r);
    int row = id / 1024;
    int col = (id % 1024) * 2;
    vec4 pix1 = texelFetch(u_texture, ivec2(col  , row), 0);
    vec4 pix2 = texelFetch(u_texture, ivec2(col+1, row), 0);

    gl_Position = projection * view * vec4(position + pix1.xyz, 1.0);

    vPosition = vec2(position);
    vColor = vec4(float(id+1)/(float(id+2)), 0.7, 1.0, pix1.a);
    vColor = unpackFloatToRGB8(pix2.a);
}  