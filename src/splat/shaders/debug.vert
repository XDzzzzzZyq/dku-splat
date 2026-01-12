precision highp float;

in vec3 position;
in int index;

uniform mat4 projection, view;

out vec4 vColor;
out vec2 vPosition;

void main()
{
    gl_Position = projection * view * vec4(position, 1.0);

    vPosition = vec2(position);
    vColor = vec4(0.3, 0.7, 1.0, 1.0);
}  