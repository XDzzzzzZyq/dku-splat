precision highp float;

uniform sampler2D tColor;
uniform sampler2D tPos;
uniform sampler2D tPbr;
uniform sampler2D tNormal;
uniform samplerCube uEnvMap;
uniform float uEnvMapEnabled;

uniform mat4 uProj;
uniform mat4 uInvProj;
uniform mat4 uInvView;
uniform vec3 uCameraPos;
uniform vec2 uResolution;
uniform float uMaxDistance;
uniform float uStride;
uniform int uMaxSteps;
uniform float uThickness;
uniform float uJitter;

uniform int uMode;

in vec2 vUv;

out vec4 fragColor;

vec4 resolveWeighted(sampler2D tex, vec2 uv) {
    vec4 sum = texture(tex, uv);
    float w = sum.a;
    if (w <= 0.0) return vec4(0.0);
    return vec4(sum.rgb / w, clamp(w, 0.0, 1.0));
}

float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

vec2 projectToUv(vec3 viewPos) {
    vec4 clip = uProj * vec4(viewPos, 1.0);
    vec3 ndc = clip.xyz / max(clip.w, 1e-6);
    return ndc.xy * 0.5 + 0.5;
}

vec3 fresnelSchlick(float cosTheta, vec3 F0) {
    return F0 + (1.0 - F0) * pow(1.0 - cosTheta, 5.0);
}

vec3 sampleEnv(vec3 dir) {
    return texture(uEnvMap, normalize(dir)).rgb * uEnvMapEnabled;
}

vec3 getWorldRay(vec2 uv) {
    vec2 ndc = uv * 2.0 - 1.0;
    vec4 clip = vec4(ndc, 1.0, 1.0);
    vec4 view = uInvProj * clip;
    vec3 viewDir = normalize(view.xyz / max(view.w, 1e-6));
    vec3 worldDir = normalize((uInvView * vec4(viewDir, 0.0)).xyz);
    return worldDir;
}

void main() {
    vec4 col = resolveWeighted(tColor, vUv);
    vec3 m = resolveWeighted(tPbr, vUv).rgb;
    vec3 p = resolveWeighted(tPos, vUv).rgb;
    vec3 n = normalize(resolveWeighted(tNormal, vUv).rgb);

    if (col.a <= 0.0) {
        vec3 bgDir = getWorldRay(vUv);
        fragColor = vec4(sampleEnv(bgDir), 1.0);
        return;
    }

    // PBR layout: refl_strength (r), roughness (g), metallic (b)
    float roughness = mix(0.5, 1.0, clamp(m.g, 0.0, 1.0));
    float metallic = mix(0.0, 0.1, clamp(m.b, 0.0, 1.0)); // threshold metallic for simplicity
    float ao = 1.0; // TODO: SSAO

    vec3 viewDir = normalize(p - uCameraPos);
    vec3 reflDir = normalize(reflect(viewDir, n));

    float hit = 0.0;
    vec3 hitColor = vec3(0.0);

    float jitter = (hash12(vUv * uResolution) - 0.5) * uJitter;
    float t = max(uStride + jitter * uStride, 0.0);

    for (int i = 0; i < 512; ++i) {
        if (i >= uMaxSteps) break;
        if (t > uMaxDistance) break;

        vec3 rayPos = p + reflDir * t;
        vec2 uv = projectToUv(rayPos);
        if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) break;

        vec3 samplePos = resolveWeighted(tPos, uv).rgb;
        float dz = samplePos.z - rayPos.z;
        if (abs(dz) < uThickness) {
            hit = 1.0;
            hitColor = resolveWeighted(tColor, uv).rgb;
            break;
        }

        t += uStride * mix(1.0, 1.5, roughness);
    }

    float cosTheta = max(dot(n, -viewDir), 0.0);
    vec3 F0 = mix(vec3(0.04), col.rgb, metallic);
    vec3 F = fresnelSchlick(cosTheta, F0);

    float specWeight = (1.0 - roughness);
    vec3 specSource = mix(sampleEnv(reflDir), hitColor, hit);
    vec3 specular = specSource * F * specWeight;
    vec3 diffuse = col.rgb * (1.0 - F) * (1.0 - metallic);

    vec3 outColor = (diffuse + specular) * ao;
    fragColor = vec4(mix(sampleEnv(viewDir), outColor, col.a), 1.0);
}
