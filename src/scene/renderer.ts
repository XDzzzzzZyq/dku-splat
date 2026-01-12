import * as THREE from 'three'

const canvas = document.createElement('canvas');
document.body.appendChild(canvas);

const gl = canvas.getContext('webgl2');
if (!gl) {
    alert('WebGL2 is not supported in your browser.');
}

export const renderer = new THREE.WebGLRenderer({ 
    canvas: canvas,
    context: gl,
    antialias: true,
    alpha: true,
})
renderer.setPixelRatio(devicePixelRatio)
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.setClearColor(0x111111)