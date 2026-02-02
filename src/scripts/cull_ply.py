import numpy as np
import open3d as o3d
from plyfile import PlyData, PlyElement

# ----------------------------
# Parameters
# ----------------------------
site = 'car'
mesh_path = f"res/{site}/mesh.ply"
gs_ply_path = f"res/{site}/point_cloud.ply"
out_path = f"res/{site}/point_cloud_filtered.ply"
distance_thresh = 0.02  # meters

# ----------------------------
# Load mesh (geometry only)
# ----------------------------
mesh = o3d.io.read_triangle_mesh(mesh_path)
mesh.compute_vertex_normals()

scene = o3d.t.geometry.RaycastingScene()
mesh_t = o3d.t.geometry.TriangleMesh.from_legacy(mesh)
scene.add_triangles(mesh_t)

# ----------------------------
# Load GS PLY (ALL properties)
# ----------------------------
ply = PlyData.read(gs_ply_path)
vertex = ply["vertex"]

# Extract XYZ
points = np.stack([vertex["x"], vertex["y"], vertex["z"]], axis=1)

# ----------------------------
# Distance query (vectorized)
# ----------------------------
query = o3d.core.Tensor(points, dtype=o3d.core.Dtype.Float32)
dist = scene.compute_distance(query).numpy()

mask = dist < distance_thresh
print(f"Keeping {mask.sum()} / {len(mask)} Gaussians")

# ----------------------------
# Filter ALL vertex properties
# ----------------------------
filtered_vertex_data = {}
for name in vertex.data.dtype.names:
    filtered_vertex_data[name] = vertex[name][mask]

# Rebuild structured array
filtered_vertex = np.empty(
    mask.sum(),
    dtype=vertex.data.dtype
)
for name in filtered_vertex_data:
    filtered_vertex[name] = filtered_vertex_data[name]

# ----------------------------
# Write filtered PLY
# ----------------------------
filtered_elem = PlyElement.describe(filtered_vertex, "vertex")

PlyData(
    [filtered_elem],
    text=ply.text,
    byte_order=ply.byte_order
).write(out_path)