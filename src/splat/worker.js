import { CONFIG } from "../config.js";

function createWorker(self) {
    // Adapted processing worker: packs splat buffer into a texture-friendly format,
    // performs a simple depth sort, and posts texdata and depthIndex back to main thread.
    let buffer = null;
    let vertexCount = 0;

    var _floatView = new Float32Array(1);
    var _int32View = new Int32Array(_floatView.buffer);

    var _lastView = new Float32Array(16);

    function floatToHalf(float) {
        _floatView[0] = float;
        var f = _int32View[0];

        var sign = (f >> 31) & 0x0001;
        var exp = (f >> 23) & 0x00ff;
        var frac = f & 0x007fffff;

        var newExp;
        if (exp == 0) {
            newExp = 0;
        } else if (exp < 113) {
            newExp = 0;
            frac |= 0x00800000;
            frac = frac >> (113 - exp);
            if (frac & 0x01000000) {
                newExp = 1;
                frac = 0;
            }
        } else if (exp < 142) {
            newExp = exp - 112;
        } else {
            newExp = 31;
            frac = 0;
        }

        return (sign << 15) | (newExp << 10) | (frac >> 13);
    }

    function packHalf2x16(x, y) {
        return (floatToHalf(x) | (floatToHalf(y) << 16)) >>> 0;
    }

    // Rotation * Scaling (optimized for s_z = 0)
    // Compute rotation matrix from quaternion (w, x, y, z) and apply sx/sy
    function to_RS(s_x, s_y, qw, qx, qy, qz){
        // normalize quaternion
        const norm = Math.hypot(qw, qx, qy, qz) || 1.0;
        const w = qw / norm, x = qx / norm, y = qy / norm, z = qz / norm;

        const xx = x * x, yy = y * y, zz = z * z;
        const xy = x * y, xz = x * z, yz = y * z;
        const wx = w * x, wy = w * y, wz = w * z;

        // row-major 3x3 rotation matrix
        const R0 = 1 - 2 * (yy + zz);
        const R1 = 2 * (xy - wz);
        const R2 = 2 * (xz + wy);

        const R3 = 2 * (xy + wz);
        const R4 = 1 - 2 * (xx + zz);
        const R5 = 2 * (yz - wx);

        const R6 = 2 * (xz - wy);
        const R7 = 2 * (yz + wx);
        const R8 = 1 - 2 * (xx + yy);

        // Return upper-triangle entries scaled by sx/sy (s_z assumed 0)
        return [R0 * s_x, R1 * s_y, R3 * s_x, R4 * s_y, R6 * s_x, R7 * s_y];
    }

    function multiply3x3(A, B) {
        return [
            A[0]*B[0] + A[1]*B[3] + A[2]*B[6], A[0]*B[1] + A[1]*B[4] + A[2]*B[7], A[0]*B[2] + A[1]*B[5] + A[2]*B[8],
            A[3]*B[0] + A[4]*B[3] + A[5]*B[6], A[3]*B[1] + A[4]*B[4] + A[5]*B[7], A[3]*B[2] + A[4]*B[5] + A[5]*B[8],
            A[6]*B[0] + A[7]*B[3] + A[8]*B[6], A[6]*B[1] + A[7]*B[4] + A[8]*B[7], A[6]*B[2] + A[7]*B[5] + A[8]*B[8]
        ];
    }

    function float_to_byte(v){
        return Math.min(Math.max(Math.round(v * 255), 0), 255)
    }

    // Base color only: 0.5 + C0 * sh0
    function calc_sh0_base_color(sh0_r, sh0_g, sh0_b){
        const C0 = 0.28209479177387814;
        const r = 0.5 + C0 * sh0_r;
        const g = 0.5 + C0 * sh0_g;
        const b = 0.5 + C0 * sh0_b;
        return [r, g, b];
    }

    /*
    Buffer Layout:
    | pos : vec3(3 * 4) | opacity : float(4) | scl : vec2(2 * 4) | rot : quat(4 * 4) | sh0 : vec3 | sh1 : vec9 | pbr : vec3 | ori_color : vec3 |

    Data Texture Layout:
    | pos : vec3(3 * 4) | opacity : float(4) | RS : hvec3(3 * 4) | color : rgba(4) |
    */
    // TODO: Using compute shader
    function generateTexture() {
        if (!buffer) return;
        const f_buffer = new Float32Array(buffer);

        // CONFIG.DATA_TEXTURE_WIDTH splats per row
        // 4 pixels per splat:
        //  p0: pos.xyz, opacity
        //  p1: covPack.xyz (half2x16 packed), baseColorPackedRGBA8
        //  p2: sh1 packed as half2x16 (5 u32 words = 9 halfs + pad)
        //  p3: sh1 packed as half2x16 & roughness/metallic/originColor
        const pix_per_splat = 4;
        const rowFloats = pix_per_splat * 4;

        const rowFloats_buffer = CONFIG.RAW_FLOAT_PER_SPLAT;

        const rowSplats = CONFIG.DATA_TEXTURE_WIDTH;
        const texwidth = rowSplats * pix_per_splat;
        const texheight = Math.ceil(vertexCount / rowSplats);

        // RGBA_F32 -> 2 pixels per splat
        var texdata = new Uint32Array(texwidth * texheight * 4);
        var texdata_c = new Uint8Array(texdata.buffer);
        var texdata_f = new Float32Array(texdata.buffer);

        for (let i = 0; i < vertexCount; i++) {
            // positions
            texdata_f[rowFloats * i + 0] = f_buffer[rowFloats_buffer * i + 0];
            texdata_f[rowFloats * i + 1] = f_buffer[rowFloats_buffer * i + 1];
            texdata_f[rowFloats * i + 2] = f_buffer[rowFloats_buffer * i + 2];
            // opcacity
            texdata_f[rowFloats * i + 3] = f_buffer[rowFloats_buffer * i + 3];

            // pack RS halves
            // buffer layout: ... sx, sy, qw, qx, qy, qz, sh0..., sh1...
            const RS = to_RS(
                f_buffer[rowFloats_buffer * i + 4], // sx
                f_buffer[rowFloats_buffer * i + 5], // sy
                f_buffer[rowFloats_buffer * i + 6], // qw
                f_buffer[rowFloats_buffer * i + 7], // qx
                f_buffer[rowFloats_buffer * i + 8], // qy
                f_buffer[rowFloats_buffer * i + 9]  // qz
            );
            texdata[rowFloats * i + 4] = packHalf2x16(RS[0], RS[1]);
            texdata[rowFloats * i + 5] = packHalf2x16(RS[2], RS[3]);
            texdata[rowFloats * i + 6] = packHalf2x16(RS[4], RS[5]);
            // base color (SH0 only) packed into RGBA8 (stored in pix1.a as float bits)
            const sh0_r = f_buffer[rowFloats_buffer * i + 10];
            const sh0_g = f_buffer[rowFloats_buffer * i + 11];
            const sh0_b = f_buffer[rowFloats_buffer * i + 12];
            const base = calc_sh0_base_color(sh0_r, sh0_g, sh0_b);
            texdata_c[4 * (rowFloats * i + 7) + 0] = float_to_byte(base[0]);
            texdata_c[4 * (rowFloats * i + 7) + 1] = float_to_byte(base[1]);
            texdata_c[4 * (rowFloats * i + 7) + 2] = float_to_byte(base[2]);
            texdata_c[4 * (rowFloats * i + 7) + 3] = 255;

            // SH1 (9 floats) packed into half2x16 words and stored as float bit-patterns
            // Order matches load_ply: [r1,g1,b1,r2,g2,b2,r3,g3,b3]
            const sh1 = new Float32Array(f_buffer.buffer, (rowFloats_buffer * i + 13) * Float32Array.BYTES_PER_ELEMENT, 9);
            texdata[rowFloats * i +  8] = packHalf2x16(sh1[0], sh1[1]);
            texdata[rowFloats * i +  9] = packHalf2x16(sh1[2], sh1[3]);
            texdata[rowFloats * i + 10] = packHalf2x16(sh1[4], sh1[5]);
            texdata[rowFloats * i + 11] = packHalf2x16(sh1[6], sh1[7]);
            texdata[rowFloats * i + 12] = packHalf2x16(sh1[8], 0.0);

            // New attributes (appended to raw buffer):
            //  - refl/rough/metal packed as two half2x16 words
            //  - origin color packed as RGB8
            const refl = f_buffer[rowFloats_buffer * i + 22];
            const rough = f_buffer[rowFloats_buffer * i + 23];
            const metal = f_buffer[rowFloats_buffer * i + 24];
            const ori_r = f_buffer[rowFloats_buffer * i + 25];
            const ori_g = f_buffer[rowFloats_buffer * i + 26];
            const ori_b = f_buffer[rowFloats_buffer * i + 27];

            // pix4.y: origin color RGB8
            texdata_c[4 * (rowFloats * i + 13) + 0] = float_to_byte(ori_r);
            texdata_c[4 * (rowFloats * i + 13) + 1] = float_to_byte(ori_g);
            texdata_c[4 * (rowFloats * i + 13) + 2] = float_to_byte(ori_b);
            texdata_c[4 * (rowFloats * i + 13) + 3] = 255;

            // pix4.z / pix4.w: PBR packed as half floats
            texdata[rowFloats * i + 14] = packHalf2x16(refl, rough);
            texdata[rowFloats * i + 15] = packHalf2x16(metal, 0.0);
        }

        console.log(">> Worker gen texture:", texwidth, texheight, texdata.byteLength);
        self.postMessage({ texdata, texwidth, texheight }, [texdata.buffer]);
    }

    function runSort(viewProj) {
        if (!buffer) return;
        const rowFloats_buffer = CONFIG.RAW_FLOAT_PER_SPLAT;

        const f_buffer = new Float32Array(buffer);
        let maxDepth = -Infinity, minDepth = Infinity;
        let sizeList = new Int32Array(vertexCount);
        for (let i = 0; i < vertexCount; i++) {
            const depth = ((viewProj[2] * f_buffer[rowFloats_buffer * i + 0] + viewProj[6] * f_buffer[rowFloats_buffer * i + 1] + viewProj[10] * f_buffer[rowFloats_buffer * i + 2]) * 4096) | 0;
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
            console.log("Worker received buffer");
            buffer = e.data.buffer;
            vertexCount = e.data.vertexCount;

            console.log(">> buffer size:", buffer.byteLength, "vertexCount:", vertexCount);

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
