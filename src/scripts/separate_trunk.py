
import os
import sys
import numpy as np
import pandas as pd
from plyfile import PlyData
from scipy.special import expit
import json
import argparse

# -----------------------------------------------------------------------------
# Half packing utilities
# -----------------------------------------------------------------------------

def pack_half2(x: np.ndarray, y: np.ndarray) -> np.ndarray:
    hx = x.astype(np.float16).view(np.uint16).astype(np.uint32)
    hy = y.astype(np.float16).view(np.uint16).astype(np.uint32)
    return hx | (hy << 16)

def pack_half1(x: np.ndarray) -> np.ndarray:
    return x.astype(np.float16).view(np.uint16).astype(np.uint32)

# -----------------------------------------------------------------------------
# PLY loading & processing
# -----------------------------------------------------------------------------

def load_ply_process(filename: str, transform: np.ndarray | None = None) -> pd.DataFrame:
    path = os.path.abspath(f"res/{filename}/point_cloud.ply")
    print(f"Loading {path}...")
    ply = PlyData.read(path)
    v = ply["vertex"].data

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

    df = df.dropna()
    q = df[["rot_0", "rot_1", "rot_2", "rot_3"]].to_numpy()
    norm = np.linalg.norm(q, axis=-1)
    df = df[(norm > 1e-8) & (norm < 1e20)]

    clipped_scl = df[["scale_0", "scale_1"]].clip(-20.0, 20.0)
    df[["sx", "sy"]] = np.exp(clipped_scl.to_numpy())

    color_keys_in = ["opacity", "refl_strength", "roughness", "metalness",
                     "ori_color_0", "ori_color_1", "ori_color_2"]
    color_key_out = ["opc", "refl", "rough", "metal", "ori_r", "ori_g", "ori_b"]
    df[color_key_out] = expit(df[color_keys_in].to_numpy())

    if transform is not None:
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
        pos = np.concatenate([pos, np.ones((pos.shape[0], 1), dtype=np.float32)], axis=1)
        pos_transformed = pos @ t.T

        l = t[:3, :3]
        r0 = l[:, 0]; r0 = r0 / (np.linalg.norm(r0) + 1e-8)
        r1 = l[:, 1] - r0 * np.dot(r0, l[:, 1]); r1 = r1 / (np.linalg.norm(r1) + 1e-8)
        r2 = np.cross(r0, r1); r2 = r2 / (np.linalg.norm(r2) + 1e-8)
        rot_l = np.stack([r0, r1, r2], axis=1)

        sh1_triplets = sh1.reshape(-1, 3, 3)
        sh1 = (sh1_triplets @ rot_l.T).reshape(-1, 9)

        norm = np.linalg.norm(q, axis=-1)
        norm[norm == 0] = 1.0
        w, xq, yq, zq = qw/norm, qx/norm, qy/norm, qz/norm

        xx, yy, zz = xq*xq, yq*yq, zq*zq
        xy, xz, yz = xq*yq, xq*zq, yq*zq
        wx, wy, wz = w*xq, w*yq, w*zq

        r00 = 1 - 2*(yy + zz); r01 = 2*(xy - wz); r10 = 2*(xy + wz)
        r11 = 1 - 2*(xx + zz); r20 = 2*(xz - wy); r21 = 2*(yz + wx)

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

    return df

# -----------------------------------------------------------------------------
# Packer
# -----------------------------------------------------------------------------

def pack_data(df: pd.DataFrame, pixels_per_splat: int) -> tuple[np.ndarray, int]:
    X = df[[
        "x", "y", "z", "opc", "sx", "sy",
        "rot_0", "rot_1", "rot_2", "rot_3",
        "f_dc_0", "f_dc_1", "f_dc_2",
        "f_rest_0", "f_rest_1", "f_rest_2",
        "f_rest_3", "f_rest_4", "f_rest_5",
        "f_rest_6", "f_rest_7", "f_rest_8",
        "refl", "rough", "metal",
        "ori_r", "ori_g", "ori_b",
    ]].to_numpy(dtype=np.float32)

    vcount = X.shape[0]
    FLOATS_PER_PIX = 4
    raw_data = np.zeros(vcount * pixels_per_splat * FLOATS_PER_PIX, dtype=np.uint32)
    tex_u32 = raw_data.reshape((vcount, pixels_per_splat * FLOATS_PER_PIX))
    tex_f32 = raw_data.view(np.float32).reshape((vcount, pixels_per_splat * FLOATS_PER_PIX))
    tex_u8 = raw_data.view(np.uint8).reshape((vcount, pixels_per_splat * FLOATS_PER_PIX * 4))

    # pos + opacity
    tex_f32[:, 0:4] = X[:, 0:4]

    # scale + rot -> packing
    sx = X[:, 4]; sy = X[:, 5]
    q = X[:, 6:10]
    qw, qx, qy, qz = q[:, 0], q[:, 1], q[:, 2], q[:, 3]
    norm = np.linalg.norm(q, axis=-1); norm[norm == 0] = 1.0
    w, x, y, z = qw/norm, qx/norm, qy/norm, qz/norm
    xx, yy, zz = x*x, y*y, z*z
    xy, xz, yz = x*y, x*z, y*z
    wx, wy, wz = w*x, w*y, w*z
    RS0 = (1 - 2*(yy + zz)) * sx
    RS1 = (2*(xy - wz)) * sy
    RS2 = (2*(xy + wz)) * sx
    RS3 = (1 - 2*(xx + zz)) * sy
    RS4 = (2*(xz - wy)) * sx
    RS5 = (2*(yz + wx)) * sy
    tex_u32[:, 4] = pack_half2(RS0, RS1)
    tex_u32[:, 5] = pack_half2(RS2, RS3)
    tex_u32[:, 6] = pack_half2(RS4, RS5)

    # Base color SH0
    C0 = 0.28209479177387814
    base = 0.5 + C0 * X[:, 10:13]
    base_u8 = np.clip(np.round(base * 255), 0, 255).astype(np.uint8)
    off = 7 * 4
    tex_u8[:, off + 0] = base_u8[:, 0]
    tex_u8[:, off + 1] = base_u8[:, 1]
    tex_u8[:, off + 2] = base_u8[:, 2]
    tex_u8[:, off + 3] = 255

    # SH1
    sh1 = X[:, 13:22]
    tex_u32[:,  8] = pack_half2(sh1[:, 0], sh1[:, 1])
    tex_u32[:,  9] = pack_half2(sh1[:, 2], sh1[:, 3])
    tex_u32[:, 10] = pack_half2(sh1[:, 4], sh1[:, 5])
    tex_u32[:, 11] = pack_half2(sh1[:, 6], sh1[:, 7])
    tex_u32[:, 12] = pack_half1(sh1[:, 8])

    # Ori color
    ori = X[:, 25:28]
    ori_u8 = np.clip(np.round(ori * 255), 0, 255).astype(np.uint8)
    off = 13 * 4
    tex_u8[:, off + 0] = ori_u8[:, 0]
    tex_u8[:, off + 1] = ori_u8[:, 1]
    tex_u8[:, off + 2] = ori_u8[:, 2]
    tex_u8[:, off + 3] = 255

    # PBR
    tex_u32[:, 14] = pack_half2(X[:, 22], X[:, 23])
    tex_u32[:, 15] = pack_half1(X[:, 24])

    return raw_data, vcount

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--filename", type=str, required=True, help="Name of the scene (folder in res/)")
    parser.add_argument("--trunk_size", type=float, default=2.0, help="Size of each trunk cube")
    args = parser.parse_args()

    filename = args.filename
    trunk_size = args.trunk_size

    rot_x_180 = np.array([
        [1.0, 0.0, 0.0, 0.0],
        [0.0, -1.0, 0.0, 0.0],
        [0.0, 0.0, -1.0, 0.0],
        [0.0, 0.0, 0.0, 1.0],
    ], dtype=np.float32)

    df = load_ply_process(filename, transform=rot_x_180)
    
    # Determine bounds
    min_x, max_x = df["x"].min(), df["x"].max()
    min_y, max_y = df["y"].min(), df["y"].max()
    min_z, max_z = df["z"].min(), df["z"].max()

    print(f"Scene bounds: ({min_x:.2f}, {min_y:.2f}, {min_z:.2f}) -> ({max_x:.2f}, {max_y:.2f}, {max_z:.2f})")

    # Align strict grid
    start_x = np.floor(min_x / trunk_size) * trunk_size
    start_y = np.floor(min_y / trunk_size) * trunk_size
    start_z = np.floor(min_z / trunk_size) * trunk_size

    # Assign each point to a chunk index
    df["cx"] = np.floor((df["x"] - start_x) / trunk_size).astype(int)
    df["cy"] = np.floor((df["y"] - start_y) / trunk_size).astype(int)
    df["cz"] = np.floor((df["z"] - start_z) / trunk_size).astype(int)

    output_dir = f"res/{filename}/chunks"
    os.makedirs(output_dir, exist_ok=True)

    grouped = df.groupby(["cx", "cy", "cz"])
    chunks_meta = []

    PACKED_PIX_PER_SPLAT = 4 # Default from config

    for (cx, cy, cz), chunk_df in grouped:
        if len(chunk_df) == 0:
            continue
        
        chunk_min_x = start_x + cx * trunk_size
        chunk_min_y = start_y + cy * trunk_size
        chunk_min_z = start_z + cz * trunk_size
        
        # Pack
        raw_data, vcount = pack_data(chunk_df, PACKED_PIX_PER_SPLAT)
        
        chunk_filename = f"{cx}_{cy}_{cz}.npz"
        save_path = os.path.join(output_dir, chunk_filename)
        np.savez(save_path, raw_data=raw_data, vertexCount=vcount)
        
        chunks_meta.append({
            "id": f"{cx}_{cy}_{cz}",
            "file": chunk_filename,
            "bounds": {
                "min": [chunk_min_x, chunk_min_y, chunk_min_z],
                "max": [chunk_min_x + trunk_size, chunk_min_y + trunk_size, chunk_min_z + trunk_size]
            },
            "vertexCount": int(vcount)
        })

    # Save metadata
    with open(os.path.join(output_dir, "metadata.json"), "w") as f:
        json.dump({"chunks": chunks_meta, "trunk_size": trunk_size, "total_vertex": int(len(df))}, f, indent=2)

    print(f"Segmented into {len(chunks_meta)} chunks. Saved to {output_dir}")

if __name__ == "__main__":
    # Example usage: python src/scripts/separate_trunk.py --filename classroom --trunk_size 32.0
    main()
