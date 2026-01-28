precision highp float;

in vec4 vColor;
in vec2 vPosition;
in float scale;

in vec3 vOriColor;
in vec3 vPbr;

out vec4 fragColor;

void main () {
    float A = -dot(vPosition, vPosition) * scale;

    if (A < -4.0) discard;
    float B = exp(A);
    fragColor = vec4(vColor.rgb, B);
}