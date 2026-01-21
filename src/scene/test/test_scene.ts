import { CONFIG } from "../../config";

export const demoVertexCount = 20

const rowFloats = CONFIG.RAW_FLOAT_PER_SPLAT; // float bytes = 32 / 4
const rowBytes = rowFloats * 4;

export const buf = new ArrayBuffer(demoVertexCount * rowBytes)
const f = new Float32Array(buf)
const u8 = new Uint8Array(buf)
for (let i = 0; i < demoVertexCount; i++) {
  // float view: f_buffer[8*i + 0..2] = position
  f[rowFloats * i + 0] = (Math.random() - 0.5) * 3 // x
  f[rowFloats * i + 1] = (Math.random() - 0.2) * 3 // y
  f[rowFloats * i + 2] = (Math.random() - 0.5) * 3 // z
  // ?
  f[rowFloats * i + 3] = 1.0
  // scale
  f[rowFloats * i + 4] = 0.5 + Math.random() * 0.5
  f[rowFloats * i + 5] = 0.5 + Math.random() * 0.5
  f[rowFloats * i + 6] = 0.5 + Math.random() * 0.5
  // rot
  f[rowFloats * i + 7] = Math.random() * Math.PI * 2
  f[rowFloats * i + 8] = Math.random() * Math.PI * 2
  f[rowFloats * i + 9] = Math.random() * Math.PI * 2

  // colors 
  f[rowFloats * i + 10] = 0.3 + Math.random() * 0.7
  f[rowFloats * i + 11] = 0.3 + Math.random() * 0.7
  f[rowFloats * i + 12] = 0.3 + Math.random() * 0.7
  f[rowFloats * i + 13] = 1.0
}