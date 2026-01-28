precision highp float;

uniform sampler2D tColor;
uniform sampler2D tPos;
uniform sampler2D tPbr;
uniform int uMode;

in vec2 vUv;

out vec4 fragColor;

vec4 resolveWeighted(sampler2D tex, vec2 uv) {
    vec4 sum = texture(tex, uv);
    float w = sum.a;
    if (w <= 0.0) return vec4(0.0);
    return vec4(sum.rgb / w, clamp(w, 0.0, 1.0));
}

void main() {
    vec4 col = resolveWeighted(tColor, vUv);

    if (uMode == 0) {
        vec4 p = resolveWeighted(tPos, vUv);
        // Debug visualization for view-space position
        fragColor = vec4(p.rgb + 0.5, col.a);
        return;
    }

    if (uMode == 1) {
        vec4 m = resolveWeighted(tPbr, vUv);
        fragColor = vec4(m.rgb, col.a);
        return;
    }

    if (uMode == 2) {
        fragColor = col;
        return;
    }

    fragColor = col;
}
