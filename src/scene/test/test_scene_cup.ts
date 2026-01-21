const res = await fetch("http://localhost:8000/ply");
const raw_byte = await res.arrayBuffer();
const srcFloats = new Float32Array(raw_byte);

const verts = Math.floor(srcFloats.length / 3);
export const demoVertexCount = verts;

const rowFloats = 11;
const rowBytes = rowFloats * 4;

export const buf = new ArrayBuffer(verts * rowBytes);
const f = new Float32Array(buf);
const u8 = new Uint8Array(buf);

for (let i = 0; i < verts; i++) {
	// copy position (x,y,z)
	f[rowFloats * i + 0] = srcFloats[3 * i + 0];
	f[rowFloats * i + 1] = srcFloats[3 * i + 1];
	f[rowFloats * i + 2] = srcFloats[3 * i + 2];

	// w
	f[rowFloats * i + 3] = 1.0;
	// scale (r,g,b scale multipliers)
	f[rowFloats * i + 4] = 0.5 + Math.random() * 0.5;
	f[rowFloats * i + 5] = 0.5 + Math.random() * 0.5;
	f[rowFloats * i + 6] = 0.5 + Math.random() * 0.5;
	// rot
	f[rowFloats * i + 7] = Math.random() * Math.PI * 2;
	f[rowFloats * i + 8] = Math.random() * Math.PI * 2;
	f[rowFloats * i + 9] = Math.random() * Math.PI * 2;

	// colors placed at byte offset 48..51 per-row (10 floats * 4)
	const base = i * rowBytes + 10 * 4;
	u8[base + 0] = Math.floor(200 + Math.random() * 55);
	u8[base + 1] = Math.floor(100 + Math.random() * 155);
	u8[base + 2] = Math.floor(50 + Math.random() * 205);
	u8[base + 3] = Math.floor(200 + Math.random() * 55);
}