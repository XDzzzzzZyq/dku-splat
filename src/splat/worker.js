import { CONFIG } from "../config.js";

function createWorker(self) {
    // Adapted processing worker: packs splat buffer into a texture-friendly format,
    // performs a simple depth sort, and posts texdata and depthIndex back to main thread.
    let buffer = null;
    let vertexCount = 0;

    var _floatView = new Float32Array(1);
    var _int32View = new Int32Array(_floatView.buffer);

    var _lastView = new Float32Array(16);

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

    function runSort(viewProj) {
        if (!buffer) return;
        // stride in texdata (4 pixels * 4 channels)
        const TEX_STRIDE = CONFIG.PACKED_FLOAT_PER_SPLAT; // 16

        const f_buffer = new Float32Array(buffer);
        let maxDepth = -Infinity, minDepth = Infinity;
        let sizeList = new Int32Array(vertexCount);
        for (let i = 0; i < vertexCount; i++) {
            const depth = ((viewProj[2] * f_buffer[TEX_STRIDE * i + 0] + viewProj[6] * f_buffer[TEX_STRIDE * i + 1] + viewProj[10] * f_buffer[TEX_STRIDE * i + 2]) * 4096) | 0;
            sizeList[i] = depth;
            if (depth > maxDepth) maxDepth = depth;
            if (depth < minDepth) minDepth = depth;
        }

        let depthInv = (256 * 256 - 1) / (maxDepth - minDepth || 1);
        let counts0 = new Uint32Array(256 * 256);
        for (let i = 0; i < vertexCount; i++) {
            sizeList[i] = ((sizeList[i] - minDepth) * depthInv) | 0;
            counts0[sizeList[i]]++;
        }
        let starts0 = new Uint32Array(256 * 256);
        for (let i = 1; i < 256 * 256; i++) starts0[i] = starts0[i - 1] + counts0[i - 1];
        const w = CONFIG.DATA_TEXTURE_WIDTH;
        const h = Math.ceil(vertexCount / w);
        let depthIndex = new Uint32Array(w * h);
        for (let i = 0; i < vertexCount; i++) depthIndex[starts0[sizeList[i]]++] = i;

        self.postMessage({ depthIndex, viewProj, vertexCount }, [depthIndex.buffer]);
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
            // TODO: better lazy update
            if (e.data.view.every((v, i) => Math.abs(v - _lastView[i]) < 1e-1)) return;

            console.log("Worker received view");
            runSort(e.data.view);

            _lastView = e.data.view;
        }
    };
}

if (typeof self !== 'undefined') {
    createWorker(self);
}
