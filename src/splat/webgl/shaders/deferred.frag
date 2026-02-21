precision highp float;

uniform sampler2D tColor;
uniform sampler2D tPos;
uniform sampler2D tPbr;
uniform sampler2D tNormal;
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
    vec3 m = resolveWeighted(tPbr, vUv).rgb;
    vec3 p = resolveWeighted(tPos, vUv).rgb;
    vec3 n = normalize(resolveWeighted(tNormal, vUv).rgb);
    
    if (uMode == 0) {
        // Debug visualization for view-space position
        fragColor = vec4(p + 0.5, col.a);
    }else if (uMode == 1) {
        fragColor = vec4(m, col.a);
    }else if (uMode == 2) {
        fragColor = col;
    }else if (uMode == 3) {
        fragColor = vec4(n, col.a);
    }else{
        fragColor = col;
    }
}
