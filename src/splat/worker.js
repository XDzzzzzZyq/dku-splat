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

    // \Sigma = RSS^TR^T 
    function to_covariance(s_x, s_y, s_z, r_x, r_y, r_z){
        // Compute rotation matrix from Euler angles (XYZ order)
        const cos_x = Math.cos(r_x), sin_x = Math.sin(r_x);
        const cos_y = Math.cos(r_y), sin_y = Math.sin(r_y);
        const cos_z = Math.cos(r_z), sin_z = Math.sin(r_z);

        // Rotation matrices
        const Rx = [1,     0,      0, 
                    0, cos_x, -sin_x, 
                    0, sin_x, cos_x];

        const Ry = [ cos_y, 0, sin_y, 
                    0,      1,     0, 
                    -sin_y, 0, cos_y];

        const Rz = [cos_z, -sin_z, 0, 
                    sin_z,  cos_z, 0, 
                    0,          0, 1];

        // R = Rz * Ry * Rx
        const R = multiply3x3(Rz, multiply3x3(Ry, Rx));

        // Scale squared
        const S2 = [s_x * s_x, 0, 0, 
                          0, s_y * s_y, 0, 
                          0, 0, s_z * s_z];

        // Covariance = temp * R^T
        const cov = multiply3x3(R, multiply3x3(S2, transpose3x3(R)));

        // Return upper triangle: xx, xy, xz, yy, yz, zz
        return [cov[0], cov[1], cov[2], cov[4], cov[5], cov[8]];
    }

    function multiply3x3(A, B) {
        return [
            A[0]*B[0] + A[1]*B[3] + A[2]*B[6], A[0]*B[1] + A[1]*B[4] + A[2]*B[7], A[0]*B[2] + A[1]*B[5] + A[2]*B[8],
            A[3]*B[0] + A[4]*B[3] + A[5]*B[6], A[3]*B[1] + A[4]*B[4] + A[5]*B[7], A[3]*B[2] + A[4]*B[5] + A[5]*B[8],
            A[6]*B[0] + A[7]*B[3] + A[8]*B[6], A[6]*B[1] + A[7]*B[4] + A[8]*B[7], A[6]*B[2] + A[7]*B[5] + A[8]*B[8]
        ];
    }

    function transpose3x3(M) {
        return [M[0], M[3], M[6], M[1], M[4], M[7], M[2], M[5], M[8]];
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
    | pos : vec3(3 * 4) | opacity : float(4) | scl : vec3(3 * 4) | rot : vec3(3 * 4) | color : vec4(4 * 4) |

    Data Texture Layout:
    | pos : vec3(3 * 4) | opacity : float(4) | cov : hvec3(3 * 4) | color : rgba(4) |
    */
    // TODO: Using compute shader
    function generateTexture() {
        if (!buffer) return;
        const f_buffer = new Float32Array(buffer);

        // CONFIG.DATA_TEXTURE_WIDTH splats per row
        // 4 pixels per splat:
        //  p0: pos.xyz, opacity
        //  p1: covPack.xyz (half2x16 packed), baseColorPackedRGBA8
        //  p2/p3: sh1 packed as half2x16 (5 u32 words = 9 halfs + pad)
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

            // pack covariance halves
            const cov = to_covariance(
                f_buffer[rowFloats_buffer * i + 4], 
                f_buffer[rowFloats_buffer * i + 5], 
                f_buffer[rowFloats_buffer * i + 6], 
                f_buffer[rowFloats_buffer * i + 7], 
                f_buffer[rowFloats_buffer * i + 8], 
                f_buffer[rowFloats_buffer * i + 9]
            );
            texdata[rowFloats * i + 4] = packHalf2x16(cov[0], cov[1]);
            texdata[rowFloats * i + 5] = packHalf2x16(cov[2], cov[3]);
            texdata[rowFloats * i + 6] = packHalf2x16(cov[4], cov[5]);
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
