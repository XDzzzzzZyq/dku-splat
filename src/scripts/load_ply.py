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

def _load_ply(filename: str) -> np.ndarray:
    path = os.path.abspath(f"res/{filename}/point_cloud_filtered.ply")

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

def _pack_data(X: np.ndarray, pixels_per_splat) -> tuple[np.ndarray, int]:
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
    X = _load_ply(filename)
    raw_data, vertexCount = _pack_data(X, config['PACKED_PIX_PER_SPLAT'])

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