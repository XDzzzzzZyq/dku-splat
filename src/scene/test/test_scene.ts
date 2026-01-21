import * as THREE from 'three'

export const demoVertexCount = 20

const rowFloats = 11; // float bytes = 32 / 4
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

  // colors placed at byte offset 48..51 per-row
  const base = i * rowBytes + 10 * 4
  u8[base + 0] = Math.floor(200 + Math.random() * 55)
  u8[base + 1] = Math.floor(100 + Math.random() * 155)
  u8[base + 2] = Math.floor(50 + Math.random() * 205)
  u8[base + 3] = Math.floor(200 + Math.random() * 55)
}