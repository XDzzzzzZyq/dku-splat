from fastapi import FastAPI, Query
from fastapi.responses import Response, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi import HTTPException

import numpy as np
import pandas as pd
from scipy.special import expit
from plyfile import PlyData
import os
import json

# -----------------------------------------------------------------------------
# FastAPI setup
# -----------------------------------------------------------------------------

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
    expose_headers=["n-vertex", "n-channels", 'width', "dtype"],
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

    # Build a DataFrame for convenient filtering + clipping
    df = pd.DataFrame({
        "x": v["x"], "y": v["y"], "z": v["z"],
        "opacity": v["opacity"],
        "scale_0": v["scale_0"], "scale_1": v["scale_1"],
        "rot_0": v["rot_0"], "rot_1": v["rot_1"], "rot_2": v["rot_2"], "rot_3": v["rot_3"],
        "refl_strength": v["refl_strength"], "roughness": v["roughness"], "metalness": v["metalness"],
        "ori_color_0": v["ori_color_0"], "ori_color_1": v["ori_color_1"], "ori_color_2": v["ori_color_2"],
        "f_dc_0": v["f_dc_0"], "f_dc_1": v["f_dc_1"], "f_dc_2": v["f_dc_2"],
        "f_rest_0": v["f_rest_0"], "f_rest_1": v["f_rest_1"], "f_rest_2": v["f_rest_2"],
        "f_rest_3": v["f_rest_3"], "f_rest_4": v["f_rest_4"], "f_rest_5": v["f_rest_5"],
        "f_rest_6": v["f_rest_6"], "f_rest_7": v["f_rest_7"], "f_rest_8": v["f_rest_8"],
    })

    # drop rows with NaN scales
    df = df.dropna() 
    q = df[["rot_0", "rot_1", "rot_2", "rot_3"]].to_numpy()
    norm = np.linalg.norm(q, axis=-1)
    df = df[(norm > 1e-8) & (norm < 1e20)]

    # clip log-scale inputs to prevent overflow, then compute and clamp final scales
    clipped_scl = df[["scale_0", "scale_1"]].clip(-20.0, 20.0)
    df[["sx", "sy"]] = np.exp(clipped_scl.to_numpy())

    # derived fields
    color_keys_in = ["opacity", "refl_strength", "roughness", "metalness",
                     "ori_color_0", "ori_color_1", "ori_color_2"]
    color_key_out = ["opc", "refl", "rough", "metal", "ori_r", "ori_g", "ori_b"]
    df[color_key_out] = expit(df[color_keys_in].to_numpy())

    if transform is not None:
        # working arrays for transform
        pos = df[["x", "y", "z"]].to_numpy()
        sx = df["sx"].to_numpy()
        sy = df["sy"].to_numpy()
        q = df[["rot_0", "rot_1", "rot_2", "rot_3"]].to_numpy()
        qw, qx, qy, qz = q[:, 0], q[:, 1], q[:, 2], q[:, 3]
        sh1 = df[[
            "f_rest_0", "f_rest_1", "f_rest_2",
            "f_rest_3", "f_rest_4", "f_rest_5",
            "f_rest_6", "f_rest_7", "f_rest_8",
        ]].to_numpy()

        t = np.asarray(transform, dtype=np.float32)
        if t.shape != (4, 4):
            raise ValueError("transform must be 4x4")
        
        # apply transformation to positions
        pos = np.concatenate([pos, np.ones((pos.shape[0], 1), dtype=np.float32)], axis=1)
        pos_transformed = pos @ t.T 

        # apply transformation to scales

        # apply rotation to SHH coefficients
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

        # apply rotation to quaterions
        norm = np.linalg.norm(q, axis=-1)
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

        # write transformed values back to df
        df[["x", "y", "z"]] = pos_transformed[:, :3]
        df["sx"] = sx
        df["sy"] = sy
        df["rot_0"] = qw2
        df["rot_1"] = qx2
        df["rot_2"] = qy2
        df["rot_3"] = qz2
        df[[
            "f_rest_0", "f_rest_1", "f_rest_2",
            "f_rest_3", "f_rest_4", "f_rest_5",
            "f_rest_6", "f_rest_7", "f_rest_8",
        ]] = sh1

    # final filtering based on computed fields
    #df = df[(df["sx"] > 1e-2) & (df["sy"] > 1e-2) & (df["opc"] > 1e-2)]

    # return in the same layout expected downstream
    out_cols = [
        "x", "y", "z", "opc", "sx", "sy",
        "rot_0", "rot_1", "rot_2", "rot_3",
        "f_dc_0", "f_dc_1", "f_dc_2",
        "f_rest_0", "f_rest_1", "f_rest_2",
        "f_rest_3", "f_rest_4", "f_rest_5",
        "f_rest_6", "f_rest_7", "f_rest_8",
        "refl", "rough", "metal",
        "ori_r", "ori_g", "ori_b",
    ]
    return df[out_cols].to_numpy(dtype=np.float32)


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
    q = X[:, 6:10]
    qw, qx, qy, qz = q[:, 0], q[:, 1], q[:, 2], q[:, 3]

    norm = np.linalg.norm(q, axis=-1)
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

def _load_map(
    filename: str,
    transform: np.ndarray | None = None,
) -> np.ndarray:
    path = os.path.abspath(f"res/{filename}/map1.npz")
    map = np.load(path)['arr_0']

    assert map.dtype == np.float32
    assert map.shape[1] == map.shape[2]

    if map.shape[-1] == 3:
        alpha = np.ones((*map.shape[:3], 1), dtype=np.float32)
        map = np.concatenate([map, alpha], axis=-1)

    return map


def _load_chunks_metadata(filename: str) -> dict:
    metadata_path = os.path.abspath(f"res/{filename}/chunks/metadata.json")
    if not os.path.exists(metadata_path):
        raise FileNotFoundError(f"Chunk metadata not found: {metadata_path}")
    with open(metadata_path, "r", encoding="utf-8") as f:
        return json.load(f)


# -----------------------------------------------------------------------------
# API endpoint
# -----------------------------------------------------------------------------

@app.get("/ply")
def load_ply(filename: str = Query(...)):
    USE_CACHE = True

    from src.scripts._read_config import config
    rot_x_180 = np.array([
        [1.0, 0.0, 0.0, 0.0],
        [0.0, -1.0, 0.0, 0.0],
        [0.0, 0.0, -1.0, 0.0],
        [0.0, 0.0, 0.0, 1.0],
    ], dtype=np.float32)
    cache_dir = os.path.abspath(f"res/{filename}")
    cache_path = os.path.join(cache_dir, f"packed_{config['PACKED_PIX_PER_SPLAT']}.npz")

    if os.path.exists(cache_path) and USE_CACHE:
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


@app.get("/map")
def load_map(filename: str = Query(...)):

    from src.scripts._read_config import config
    map = _load_map(
        filename,
    )
    map = np.ascontiguousarray(map, dtype=np.float32)

    return Response(
        map.tobytes(),
        media_type="application/octet-stream",
        headers={
            "width": str(map.shape[1])
        })


@app.get("/get_chunk_meta")
def get_chunk_meta(
    filename: str = Query(...),
):
    metadata = _load_chunks_metadata(filename)
    chunks = metadata.get("chunks", [])

    chunk_entries = []
    for chunk in chunks:
        entry = {
            "id": chunk["id"],
            "file": chunk["file"],
            "bounds": chunk["bounds"],
            "vertexCount": int(chunk["vertexCount"]),
        }

        chunk_entries.append(entry)

    return JSONResponse({
        "scene": filename,
        "trunk_size": metadata.get("trunk_size"),
        "total_vertex": metadata.get("total_vertex"),
        "chunks": chunk_entries,
    })


@app.get("/load_chunk")
def load_chunk(
    filename: str = Query(...),
    chunk_id: str = Query(...),
):
    metadata = _load_chunks_metadata(filename)
    chunks = metadata.get("chunks", [])

    chunk_meta = next((chunk for chunk in chunks if chunk.get("id") == chunk_id), None)
    if chunk_meta is None:
        raise HTTPException(status_code=404, detail=f"Chunk not found: {chunk_id}")

    chunk_file = chunk_meta.get("file")
    chunk_path = os.path.abspath(f"res/{filename}/chunks/{chunk_file}")

    if not os.path.exists(chunk_path):
        raise HTTPException(status_code=404, detail=f"Chunk file not found: {chunk_file}")

    npz = np.load(chunk_path)
    raw_data = np.ascontiguousarray(npz["raw_data"])
    vertex_count = int(chunk_meta.get("vertexCount", 0))

    return Response(
        raw_data.tobytes(),
        media_type="application/octet-stream",
        headers={
            "n-vertex": str(vertex_count),
            "n-channels": str(16),
            "dtype": "float32",
            "chunk-id": str(chunk_id),
        },
    )


# -----------------------------------------------------------------------------
# Debug
# -----------------------------------------------------------------------------

if __name__ == "__main__":
    print("Module loaded successfully.")