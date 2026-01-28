precision highp float;

in vec4 vColor;
in vec2 vPosition;
in float scale;

in vec3 vOriColor;
in vec3 vPbr;

in vec3 vWorldPos;

#ifdef DEFERRED_GBUFFER
layout(location = 0) out vec4 gColor;
layout(location = 1) out vec4 gPos;
layout(location = 2) out vec4 gPbr;
#else
out vec4 fragColor;
#endif

void main () {
    float A = -dot(vPosition, vPosition) * scale;

    if (A < -4.0) discard;
    float B = exp(A);
    // Gaussian weight (also used as alpha). Keep this consistent across all channels.
    float w = vColor.a * B;

#ifdef DEFERRED_GBUFFER
    // Weighted blended accumulation (order-independent): store sum(value * w) and sum(w).
    gColor = vec4(vColor.rgb, w);
    gPos   = vec4(vWorldPos, w);
    gPbr   = vec4(vPbr, w);
#else
    fragColor = vec4(vColor.rgb, w);
#endif
}