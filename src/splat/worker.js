import { CONFIG } from "../config.js";

function createWorker(self) {
    // Adapted processing worker: packs splat buffer into a texture-friendly format,
    // performs a simple depth sort, and posts texdata and depthIndex back to main thread.
    let buffer = null;
    let vertexCount = 0;

    function multiplyMat4(out, a, b) {
        // column-major out = a * b
        const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
        const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
        const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
        const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];

        const b00 = b[0], b01 = b[1], b02 = b[2], b03 = b[3];
        const b10 = b[4], b11 = b[5], b12 = b[6], b13 = b[7];
        const b20 = b[8], b21 = b[9], b22 = b[10], b23 = b[11];
        const b30 = b[12], b31 = b[13], b32 = b[14], b33 = b[15];

        out[0] = a00 * b00 + a10 * b01 + a20 * b02 + a30 * b03;
        out[1] = a01 * b00 + a11 * b01 + a21 * b02 + a31 * b03;
        out[2] = a02 * b00 + a12 * b01 + a22 * b02 + a32 * b03;
        out[3] = a03 * b00 + a13 * b01 + a23 * b02 + a33 * b03;
        out[4] = a00 * b10 + a10 * b11 + a20 * b12 + a30 * b13;
        out[5] = a01 * b10 + a11 * b11 + a21 * b12 + a31 * b13;
        out[6] = a02 * b10 + a12 * b11 + a22 * b12 + a32 * b13;
        out[7] = a03 * b10 + a13 * b11 + a23 * b12 + a33 * b13;
        out[8] = a00 * b20 + a10 * b21 + a20 * b22 + a30 * b23;
        out[9] = a01 * b20 + a11 * b21 + a21 * b22 + a31 * b23;
        out[10] = a02 * b20 + a12 * b21 + a22 * b22 + a32 * b23;
        out[11] = a03 * b20 + a13 * b21 + a23 * b22 + a33 * b23;
        out[12] = a00 * b30 + a10 * b31 + a20 * b32 + a30 * b33;
        out[13] = a01 * b30 + a11 * b31 + a21 * b32 + a31 * b33;
        out[14] = a02 * b30 + a12 * b31 + a22 * b32 + a32 * b33;
        out[15] = a03 * b30 + a13 * b31 + a23 * b32 + a33 * b33;
        return out;
    }

    function generateTexture() {
        if (!buffer) return;

        // CONFIG.DATA_TEXTURE_WIDTH splats per row
        // 4 pixels per splat:
        //  p0: pos.xyz, opacity
        //  p1: covPack.xyz (half2x16 packed), baseColorPackedRGBA8
        //  p2: sh1 packed as half2x16 (5 u32 words = 9 halfs + pad)
        //  p3: sh1 packed as half2x16 & roughness/metallic/originColor

        const rowSplats = CONFIG.DATA_TEXTURE_WIDTH;
        const pix_per_splat = CONFIG.PACKED_PIX_PER_SPLAT;
        const texwidth = rowSplats * pix_per_splat;
        const texheight = Math.ceil(vertexCount / rowSplats);

        // RGBA_F32 -> 4 pixels per splat (16 floats per splat)
        // Create a Float32Array view for the texture and copy directly from the incoming buffer
        var texdata = new Float32Array(texwidth * texheight * 4);
        const f_buffer = new Float32Array(buffer);
        // copy as many floats as available (should match vertexCount * PACKED_FLOAT_PER_SPLAT)
        const copyCount = Math.min(f_buffer.length, texdata.length);
        texdata.set(f_buffer.subarray(0, copyCount));

        console.log(">> Worker gen texture:", texwidth, texheight, texdata.byteLength);
        // Post Float32Array (DataTexture consumer will reinterpret as Float32)
        self.postMessage({ texdata, texwidth, texheight }, [texdata.buffer]);
    }

    function runSort(view, projection) {
        if (!buffer) return;
        // stride in texdata (4 pixels * 4 channels)
        const TEX_STRIDE = CONFIG.PACKED_FLOAT_PER_SPLAT; // 16
        const viewProj = new Float32Array(16);
        multiplyMat4(viewProj, projection, view);

        const f_buffer = new Float32Array(buffer);
        let maxDepth = -Infinity, minDepth = Infinity;
        let sizeList = new Int32Array(vertexCount);
        let visibleIndices = new Uint32Array(vertexCount);
        let visibleCount = 0;

        for (let i = 0; i < vertexCount; i++) {
            const x = f_buffer[TEX_STRIDE * i + 0];
            const y = f_buffer[TEX_STRIDE * i + 1];
            const z = f_buffer[TEX_STRIDE * i + 2];
            // view-space z (Three.js camera looks down -Z, so z > 0 is behind camera)
            const viewZ = (view[2] * x + view[6] * y + view[10] * z + view[14]);
            if (viewZ > 0) continue;

            const clipX = viewProj[0] * x + viewProj[4] * y + viewProj[8] * z + viewProj[12];
            const clipY = viewProj[1] * x + viewProj[5] * y + viewProj[9] * z + viewProj[13];
            const clipZ = viewProj[2] * x + viewProj[6] * y + viewProj[10] * z + viewProj[14];
            const clipW = viewProj[3] * x + viewProj[7] * y + viewProj[11] * z + viewProj[15];
            if (clipW <= 0) continue;
            const ndcX = clipX / clipW;
            const ndcY = clipY / clipW;
            const ndcZ = clipZ / clipW;
            const margin = 0.25;
            if (ndcX < -1 - margin || ndcX > 1 + margin || ndcY < -1 - margin || ndcY > 1 + margin || ndcZ < -1 - margin || ndcZ > 1 + margin) continue;

            const depth = (viewZ * 4096) | 0;
            sizeList[visibleCount] = depth;
            visibleIndices[visibleCount] = i;
            if (depth > maxDepth) maxDepth = depth;
            if (depth < minDepth) minDepth = depth;
            visibleCount++;
        }

        if (visibleCount === 0) {
            const depthIndex = new Uint32Array(0);
            self.postMessage({ depthIndex, view, vertexCount: 0 }, [depthIndex.buffer]);
            return;
        }

        let depthInv = (256 * 256 - 1) / (maxDepth - minDepth || 1);
        let counts0 = new Uint32Array(256 * 256);
        for (let i = 0; i < visibleCount; i++) {
            sizeList[i] = ((sizeList[i] - minDepth) * depthInv) | 0;
            counts0[sizeList[i]]++;
        }
        let starts0 = new Uint32Array(256 * 256);
        for (let i = 1; i < 256 * 256; i++) starts0[i] = starts0[i - 1] + counts0[i - 1];
        const w = CONFIG.DATA_TEXTURE_WIDTH;
        const h = Math.ceil(visibleCount / w);
        let depthIndex = new Uint32Array(w * h);
        for (let i = 0; i < visibleCount; i++) depthIndex[starts0[sizeList[i]]++] = visibleIndices[i];
        console.log(">> Worker sorted splats:", visibleCount, "depth range:", minDepth, maxDepth);
        self.postMessage({ depthIndex, view, vertexCount: visibleCount }, [depthIndex.buffer]);
    }

    self.onmessage = (e) => {
        if (e.data.buffer) {
            // Receive pre-packed buffer from main thread / server
            console.log("Worker received buffer");
            buffer = e.data.buffer;
            vertexCount = e.data.vertexCount;
            console.log(">> buffer size (byte):", buffer.byteLength, "vertexCount:", vertexCount);
            console.log(buffer);

            generateTexture();

        } else if (e.data.view) {
            // Update the view, sort and chunk the splats
            runSort(e.data.view, e.data.projection);
        }
    };
}

if (typeof self !== 'undefined') {
    createWorker(self);
}
