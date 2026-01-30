import { CONFIG } from "../../config";

const filename = "coffee";
const res = await fetch(`http://localhost:8000/ply?filename=${encodeURIComponent(filename)}`);
const raw_byte = await res.arrayBuffer();
const srcFloats = new Float32Array(raw_byte);
export const buf: ArrayBuffer = srcFloats.buffer;

const verts = Math.floor(srcFloats.length / CONFIG.PACKED_FLOAT_PER_SPLAT);
export const demoVertexCount = verts;

if (!(verts == Number(res.headers.get("n-vertex"))) || !(CONFIG.PACKED_FLOAT_PER_SPLAT == Number(res.headers.get("n-channels")))) {
    console.log("Vertex:", verts, Number(res.headers.get("n-vertex")))
    console.log("Channels:", CONFIG.PACKED_FLOAT_PER_SPLAT, Number(res.headers.get("n-channels")))
    throw new Error("Point Cloud Dimension Unmatched");
}
