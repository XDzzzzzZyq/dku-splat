from fastapi import FastAPI
from fastapi.responses import Response
from fastapi.middleware.cors import CORSMiddleware
import numpy as np
from plyfile import PlyData
import os

app = FastAPI()

# Allow cross-origin requests from the frontend (adjust origins in production)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)

@app.get("/ply")
def load_ply():
    path = os.path.abspath("res/coffee/point_cloud.ply")

    ply = PlyData.read(path)
    v = ply["vertex"].data

    X = np.stack([v["x"], v["y"], v["z"]], axis=1).astype(np.float32)
    return Response(X.tobytes(), media_type="application/octet-stream")

if __name__ == '__main__':
    load_ply()