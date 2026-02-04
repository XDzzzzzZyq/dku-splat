from fastapi import FastAPI, Query
from fastapi.responses import Response
from fastapi.middleware.cors import CORSMiddleware

import numpy as np
from scipy.special import expit
from plyfile import PlyData
import os

# -----------------------------------------------------------------------------
# FastAPI setup
# -----------------------------------------------------------------------------

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
    expose_headers=["n-vertex", "n-channels", "dtype"],
)

# -----------------------------------------------------------------------------
# Half packing utilities (CASE 2: TRUE BIT PACKING)
# -----------------------------------------------------------------------------

def pack_half2(x: np.ndarray, y: np.ndarray) -> np.ndarray:
    """
    Pack two float32 arrays into one uint32 array as IEEE-754 half2.
    """
    hx = x.astype(np.float16).view(np.uint16).astype(np.uint32)
    hy = y.astype(np.float16).view(np.uint16).astype(np.uint32)
    return hx | (hy << 16)


def pack_half1(x: np.ndarray) -> np.ndarray:
    """
    Pack one float32 array into lower 16 bits of uint32 (upper bits zero).
    """
    return x.astype(np.float16).view(np.uint16).astype(np.uint32)


# -----------------------------------------------------------------------------
# PLY loading
# -----------------------------------------------------------------------------

def _load_ply(
    filename: str,
    transform: np.ndarray | None = None,
) -> np.ndarray:
    path = os.path.abspath(f"res/{filename}/point_cloud.ply")

    ply = PlyData.read(path)
    v = ply["vertex"].data

    x = v["x"]; y = v["y"]; z = v["z"]
    opc = expit(v["opacity"])

    sx = np.exp(v["scale_0"])
    sy = np.exp(v["scale_1"])

    qw = v["rot_0"]; qx = v["rot_1"]; qy = v["rot_2"]; qz = v["rot_3"]
    rot = np.stack([qw, qx, qy, qz], axis=1)

    refl = expit(v["refl_strength"])
    rough = expit(v["roughness"])
    metal = expit(v["metalness"])

    ori_r = expit(v["ori_color_0"])
    ori_g = expit(v["ori_color_1"])
    ori_b = expit(v["ori_color_2"])

    sh0 = np.stack([v["f_dc_0"], v["f_dc_1"], v["f_dc_2"]], axis=1)

    sh1 = np.stack([
        v["f_rest_0"], v["f_rest_1"], v["f_rest_2"],
        v["f_rest_3"], v["f_rest_4"], v["f_rest_5"],
        v["f_rest_6"], v["f_rest_7"], v["f_rest_8"],
    ], axis=1)

    if transform is not None:
        t = np.asarray(transform, dtype=np.float32)
        if t.shape != (4, 4):
            raise ValueError("transform must be 4x4")
        pos = np.stack([x, y, z, np.ones_like(x)], axis=1)
        pos = (t @ pos.T).T
        x, y, z = pos[:, 0], pos[:, 1], pos[:, 2]

        l = t[:3, :3]
        r0 = l[:, 0]
        r0 = r0 / (np.linalg.norm(r0) + 1e-8)
        r1 = l[:, 1] - r0 * np.dot(r0, l[:, 1])
        r1 = r1 / (np.linalg.norm(r1) + 1e-8)
        r2 = np.cross(r0, r1)
        r2 = r2 / (np.linalg.norm(r2) + 1e-8)
        rot_l = np.stack([r0, r1, r2], axis=1)

        sh1_triplets = sh1.reshape(-1, 3, 3)
        sh1 = (sh1_triplets @ rot_l.T).reshape(-1, 9)

    if transform is not None:
        qw, qx, qy, qz = rot.T
        norm = np.sqrt(qw*qw + qx*qx + qy*qy + qz*qz)
        norm[norm == 0] = 1.0
        w, xq, yq, zq = qw/norm, qx/norm, qy/norm, qz/norm

        xx, yy, zz = xq*xq, yq*yq, zq*zq
        xy, xz, yz = xq*yq, xq*zq, yq*zq
        wx, wy, wz = w*xq, w*yq, w*zq

        r00 = 1 - 2*(yy + zz)
        r01 = 2*(xy - wz)
        r10 = 2*(xy + wz)
        r11 = 1 - 2*(xx + zz)
        r20 = 2*(xz - wy)
        r21 = 2*(yz + wx)

        col0 = np.stack([r00 * sx, r10 * sx, r20 * sx], axis=1)
        col1 = np.stack([r01 * sy, r11 * sy, r21 * sy], axis=1)

        col0 = col0 @ l.T
        col1 = col1 @ l.T

        sx = np.linalg.norm(col0, axis=1)
        sy = np.linalg.norm(col1, axis=1)
        sx[sx == 0] = 1.0
        sy[sy == 0] = 1.0

        r0n = col0 / sx[:, None]
        r1n = col1 / sy[:, None]
        r2n = np.cross(r0n, r1n)
        r2n_norm = np.linalg.norm(r2n, axis=1)
        r2n_norm[r2n_norm == 0] = 1.0
        r2n = r2n / r2n_norm[:, None]
        r1n = np.cross(r2n, r0n)

        r00n = r0n[:, 0]; r01n = r1n[:, 0]; r02n = r2n[:, 0]
        r10n = r0n[:, 1]; r11n = r1n[:, 1]; r12n = r2n[:, 1]
        r20n = r0n[:, 2]; r21n = r1n[:, 2]; r22n = r2n[:, 2]

        trace = r00n + r11n + r22n
        qw2 = np.zeros_like(trace)
        qx2 = np.zeros_like(trace)
        qy2 = np.zeros_like(trace)
        qz2 = np.zeros_like(trace)

        m0 = trace > 0
        s0 = np.sqrt(trace[m0] + 1.0) * 2
        qw2[m0] = 0.25 * s0
        qx2[m0] = (r21n[m0] - r12n[m0]) / s0
        qy2[m0] = (r02n[m0] - r20n[m0]) / s0
        qz2[m0] = (r10n[m0] - r01n[m0]) / s0

        m1 = (r00n > r11n) & (r00n > r22n) & (~m0)
        s1 = np.sqrt(1.0 + r00n[m1] - r11n[m1] - r22n[m1]) * 2
        qw2[m1] = (r21n[m1] - r12n[m1]) / s1
        qx2[m1] = 0.25 * s1
        qy2[m1] = (r01n[m1] + r10n[m1]) / s1
        qz2[m1] = (r02n[m1] + r20n[m1]) / s1

        m2 = (r11n > r22n) & (~m0) & (~m1)
        s2 = np.sqrt(1.0 + r11n[m2] - r00n[m2] - r22n[m2]) * 2
        qw2[m2] = (r02n[m2] - r20n[m2]) / s2
        qx2[m2] = (r01n[m2] + r10n[m2]) / s2
        qy2[m2] = 0.25 * s2
        qz2[m2] = (r12n[m2] + r21n[m2]) / s2

        m3 = (~m0) & (~m1) & (~m2)
        s3 = np.sqrt(1.0 + r22n[m3] - r00n[m3] - r11n[m3]) * 2
        qw2[m3] = (r10n[m3] - r01n[m3]) / s3
        qx2[m3] = (r02n[m3] + r20n[m3]) / s3
        qy2[m3] = (r12n[m3] + r21n[m3]) / s3
        qz2[m3] = 0.25 * s3

        rot = np.stack([qw2, qx2, qy2, qz2], axis=1)

    X = np.stack([x, y, z, opc, sx, sy], axis=1)
    X = np.concatenate([X, rot, sh0, sh1], axis=1)
    X = np.concatenate([
        X,
        np.stack([refl, rough, metal], axis=1),
        np.stack([ori_r, ori_g, ori_b], axis=1),
    ], axis=1)

    return X.astype(np.float32)


# -----------------------------------------------------------------------------
# Texture packing
# -----------------------------------------------------------------------------

def _pack_data(
    X: np.ndarray,
    pixels_per_splat,
) -> tuple[np.ndarray, int]:
    """
    Pack splat data into uint32 texture buffer.
    Layout is identical to original code.
    """
    vcount = X.shape[0]
    FLOATS_PER_PIX = 4

    raw_data = np.zeros(vcount * pixels_per_splat * FLOATS_PER_PIX, dtype=np.uint32)
    tex_u32 = raw_data.reshape((vcount, pixels_per_splat * FLOATS_PER_PIX))
    tex_f32 = raw_data.view(np.float32).reshape((vcount, pixels_per_splat * FLOATS_PER_PIX))
    tex_u8 = raw_data.view(np.uint8).reshape((vcount, pixels_per_splat * FLOATS_PER_PIX * 4))

    # -------------------------------------------------------------------------
    # pos.xyz + opacity
    # -------------------------------------------------------------------------

    tex_f32[:, 0:4] = X[:, 0:4]

    # -------------------------------------------------------------------------
    # Rotation * Scale (RS) → half2
    # -------------------------------------------------------------------------

    sx = X[:, 4]
    sy = X[:, 5]
    qw, qx, qy, qz = X[:, 6:10].T

    norm = np.sqrt(qw*qw + qx*qx + qy*qy + qz*qz)
    norm[norm == 0] = 1.0
    w, x, y, z = qw/norm, qx/norm, qy/norm, qz/norm

    xx, yy, zz = x*x, y*y, z*z
    xy, xz, yz = x*y, x*z, y*z
    wx, wy, wz = w*x, w*y, w*z

    RS0 = (1 - 2*(yy + zz)) * sx
    RS1 = (2*(xy - wz))     * sy
    RS2 = (2*(xy + wz))     * sx
    RS3 = (1 - 2*(xx + zz)) * sy
    RS4 = (2*(xz - wy))     * sx
    RS5 = (2*(yz + wx))     * sy

    tex_u32[:, 4] = pack_half2(RS0, RS1)
    tex_u32[:, 5] = pack_half2(RS2, RS3)
    tex_u32[:, 6] = pack_half2(RS4, RS5)

    # -------------------------------------------------------------------------
    # Base color from SH0 → RGBA8
    # -------------------------------------------------------------------------

    C0 = 0.28209479177387814
    base = 0.5 + C0 * X[:, 10:13]
    base_u8 = np.clip(np.round(base * 255), 0, 255).astype(np.uint8)

    off = 7 * 4
    tex_u8[:, off + 0] = base_u8[:, 0]
    tex_u8[:, off + 1] = base_u8[:, 1]
    tex_u8[:, off + 2] = base_u8[:, 2]
    tex_u8[:, off + 3] = 255

    # -------------------------------------------------------------------------
    # SH1 (9 floats → 5 half2)
    # -------------------------------------------------------------------------

    sh1 = X[:, 13:22]

    tex_u32[:,  8] = pack_half2(sh1[:, 0], sh1[:, 1])
    tex_u32[:,  9] = pack_half2(sh1[:, 2], sh1[:, 3])
    tex_u32[:, 10] = pack_half2(sh1[:, 4], sh1[:, 5])
    tex_u32[:, 11] = pack_half2(sh1[:, 6], sh1[:, 7])
    tex_u32[:, 12] = pack_half1(sh1[:, 8])

    # -------------------------------------------------------------------------
    # Origin color RGB8
    # -------------------------------------------------------------------------

    ori = X[:, 25:28]
    ori_u8 = np.clip(np.round(ori * 255), 0, 255).astype(np.uint8)

    off = 13 * 4
    tex_u8[:, off + 0] = ori_u8[:, 0]
    tex_u8[:, off + 1] = ori_u8[:, 1]
    tex_u8[:, off + 2] = ori_u8[:, 2]
    tex_u8[:, off + 3] = 255

    # -------------------------------------------------------------------------
    # PBR (refl, rough, metal)
    # -------------------------------------------------------------------------

    tex_u32[:, 14] = pack_half2(X[:, 22], X[:, 23])
    tex_u32[:, 15] = pack_half1(X[:, 24])

    return raw_data, vcount


# -----------------------------------------------------------------------------
# API endpoint
# -----------------------------------------------------------------------------

@app.get("/ply")
def load_ply(filename: str = Query(...)):
    from src.scripts._read_config import config
    rot_x_180 = np.array([
        [1.0, 0.0, 0.0, 0.0],
        [0.0, -1.0, 0.0, 0.0],
        [0.0, 0.0, -1.0, 0.0],
        [0.0, 0.0, 0.0, 1.0],
    ], dtype=np.float32)
    cache_dir = os.path.abspath(f"res/{filename}")
    cache_path = os.path.join(cache_dir, f"packed_{config['PACKED_PIX_PER_SPLAT']}.npz")

    if os.path.exists(cache_path):
        cached = np.load(cache_path)
        raw_data = cached["raw_data"]
        vertexCount = int(cached["vertexCount"])
    else:
        X = _load_ply(
            filename,
            transform=rot_x_180,
        )
        raw_data, vertexCount = _pack_data(X, config['PACKED_PIX_PER_SPLAT'])
        np.savez(cache_path, raw_data=raw_data, vertexCount=np.int32(vertexCount))

    return Response(
        raw_data.tobytes(),
        media_type="application/octet-stream",
        headers={
            "n-vertex": str(vertexCount),
            "n-channels": str(16),
            "dtype": "float32"
        })


# -----------------------------------------------------------------------------
# Debug
# -----------------------------------------------------------------------------

if __name__ == "__main__":
    print("Module loaded successfully.")