precision highp float;
precision highp usampler2D;
precision highp int;

uniform usampler2D idx_buffer;
uniform mat4 projection, view;

in vec3 position;

out vec4 vColor;
out vec2 vPosition;

void main()
{
    int id = int(texelFetch(idx_buffer, ivec2(gl_InstanceID, 0), 0).r);
    gl_Position = projection * view * vec4(position + vec3(id), 1.0);

    vPosition = vec2(position);
    vColor = vec4(float(id+1)/(float(id+2)), 0.7, 1.0, 0.9);
}  