precision highp float;

uniform float u_alphaEpsilon;

in vec4 vColor;
in vec2 vPosition;
in float scale;

in vec3 vOriColor;
in vec3 vPbr;

in vec3 vWorldPos;
in vec3 vNormal;
in vec3 vAxis0;
in vec3 vAxis1;

#ifdef DEFERRED_GBUFFER
layout(location = 0) out vec4 gColor;
layout(location = 1) out vec4 gPos;
layout(location = 2) out vec4 gPbr;
layout(location = 3) out vec4 gNormal;
#else
out vec4 fragColor;
#endif

void main () {
    float A = -dot(vPosition, vPosition) * scale; if (A < -4.0) discard;
    float B = exp(A);
    // Gaussian weight (also used as alpha). Keep this consistent across all channels.
    float w = vColor.a * B;
    if (w <= u_alphaEpsilon) discard;

#ifdef DEFERRED_GBUFFER
    // Weighted blended accumulation (order-independent): store sum(value * w) and sum(w).
    gColor = vec4(vColor.rgb, w);
    // compute per-fragment sprite world position using RS axes and quad coords
    vec3 spriteWorldPos = vWorldPos + vAxis0 * vPosition.x * scale + vAxis1 * vPosition.y * scale;
    gPos   = vec4(spriteWorldPos, w);
    gPbr   = vec4(vPbr, w);
    // encode normal into 0..1 range and store weight in alpha
    gNormal = vec4(vNormal, w);
#else
    fragColor = vec4(vColor.rgb, w);
#endif
}