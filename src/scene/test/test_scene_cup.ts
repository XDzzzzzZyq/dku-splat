import { CONFIG } from "../../config";

const res = await fetch("http://localhost:8000/ply");
const raw_byte = await res.arrayBuffer();
const srcFloats = new Float32Array(raw_byte);
export const buf: ArrayBuffer = srcFloats.buffer;

const verts = Math.floor(srcFloats.length / CONFIG.RAW_FLOAT_PER_SPLAT);
export const demoVertexCount = verts;
