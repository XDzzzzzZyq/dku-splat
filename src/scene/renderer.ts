import * as THREE from 'three';

const preferWebGPU = true; // set true when scene materials are WebGPU-ready
let renderer: THREE.WebGLRenderer | any;

const canvas = document.createElement('canvas');
document.body.appendChild(canvas);

async function initRenderer() {
    if (preferWebGPU && 'gpu' in navigator) {
        try {
            const { default: WebGPURenderer } = await import(
                'three/addons/renderers/webgpu/WebGPURenderer.js'
            );

            renderer = new WebGPURenderer({ canvas });
            renderer.setPixelRatio(window.devicePixelRatio);
            renderer.setSize(window.innerWidth, window.innerHeight);

            console.log('Using WebGPU Renderer');
            return;
        } catch (e) {
            console.warn('WebGPU available but renderer failed:', e);
        }
    }

    // Fallback: WebGL
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(0x111111, 1);
    console.log('Using WebGL Renderer');
}

await initRenderer();

window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
});

export { renderer }