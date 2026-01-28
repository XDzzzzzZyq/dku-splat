from fastapi import FastAPI, Query
from fastapi.responses import Response
from fastapi.middleware.cors import CORSMiddleware

import numpy as np
from scipy.special import expit

from plyfile import PlyData
import os

app = FastAPI()

# Allow cross-origin requests from the frontend (adjust origins in production)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
    expose_headers=["n-vertex", "n-channels", "dtype"],
)

def quaternion_to_eular(qw, qx, qy, qz):
    q = np.stack(
        [qw, qx, qy, qz],
        axis=1
    ).astype(np.float64)

    # normalize: shape (N, 4)
    q /= np.linalg.norm(q, axis=1, keepdims=True)

    w = q[:, 0]
    x = q[:, 1]
    y = q[:, 2]
    z = q[:, 3]

    # Roll (X)
    roll = np.arctan2(
        2.0 * (w * x + y * z),
        1.0 - 2.0 * (x * x + y * y)
    )

    # Pitch (Y)
    sinp = 2.0 * (w * y - z * x)
    pitch = np.where(
        np.abs(sinp) >= 1.0,
        np.sign(sinp) * (np.pi / 2.0),
        np.arcsin(sinp)
    )

    # Yaw (Z)
    yaw = np.arctan2(
        2.0 * (w * z + x * y),
        1.0 - 2.0 * (y * y + z * z)
    )

    # Euler angles: shape (N, 3)
    return np.stack([roll, pitch, yaw], axis=1)

def _load_ply(filename):
    path = os.path.abspath(f"res/{filename}/point_cloud.ply")

    ply = PlyData.read(path)
    v = ply["vertex"].data

    x = v["x"]; y = v["y"]; z = v["z"]
    opc = expit(v["opacity"])

    sx = np.exp(v["scale_0"]); sy = np.exp(v["scale_1"]); sz = np.zeros_like(sx)
    qw = v["rot_0"]; qx = v["rot_1"]; qy = v["rot_2"]; qz = v["rot_3"]
    rot = quaternion_to_eular(qw, qx, qy, qz)

    refl = expit(v["refl_strength"])
    roughness = expit(v["roughness"])
    metalness = expit(v["metalness"])
    ori_r = expit(v["ori_color_0"])
    ori_g = expit(v["ori_color_1"])
    ori_b = expit(v["ori_color_2"])

    r = v["f_dc_0"]; g = v["f_dc_1"]; b = v["f_dc_2"]
    sh0 = np.stack([r, g, b], axis=1)

    r1 = v["f_rest_0"]; g1 = v["f_rest_1"]; b1 = v["f_rest_2"]
    r2 = v["f_rest_3"]; g2 = v["f_rest_4"]; b2 = v["f_rest_5"]
    r3 = v["f_rest_6"]; g3 = v["f_rest_7"]; b3 = v["f_rest_8"]
    sh1 = np.stack([r1, g1, b1, r2, g2, b2, r3, g3, b3], axis=1)

    X = np.stack([x, y, z, opc, sx, sy, sz], axis=1)
    X = np.concatenate([X, rot, sh0, sh1], axis=1)
    # Append new channels at the end to keep the original first 22-float layout stable.
    # Order: refl, roughness, metalness, ori_r, ori_g, ori_b
    pbr = np.stack([refl, roughness, metalness], axis=1)
    ori = np.stack([ori_r, ori_g, ori_b], axis=1)
    X = np.concatenate([X, pbr, ori], axis=1)
    return X.astype(np.float32)

@app.get("/ply")
def load_ply(filename: str = Query(...)):
    X = _load_ply(filename)
    return Response(
        X.tobytes(), 
        media_type="application/octet-stream",
        headers={
            "n-vertex": str(X.shape[0]),
            "n-channels": str(X.shape[1]),
            "dtype": "float32"
        })

if __name__ == '__main__':
    X = _load_ply()
    print(X.shape, X.nbytes)