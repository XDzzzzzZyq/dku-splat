import unittest
from unittest.mock import patch, MagicMock
import numpy as np

import os
import sys
project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "../"))  
sys.path.insert(0, project_root)

from src.scripts.load_resource import _load_ply, _load_map, _pack_data, pack_half2, pack_half1
from src.scripts._read_config import config

class TestLoadPly(unittest.TestCase):

    @patch('src.scripts.load_resource.PlyData.read')
    def test_load_ply(self, mock_read):
        # Create mock vertex data as a structured array
        mock_data = np.array([
            (
                1.0, 2.0, 3.0, 0.0,  # pos + opacity
                0.1, 0.2,            # scales (sz derived as 0)
                0.0, 0.0, 0.0, 0.0,  # rot quaternion (identity-ish)
                # PBR (sigmoid is applied in loader)
                0.0, 0.0, 0.0,        # refl_strength, roughness, metalness
                # origin color (sigmoid is applied in loader)
                0.0, 0.0, 0.0,        # ori_color_0/1/2
                # SH0 (dc)
                0.7, 0.8, 0.9,
                # SH1 (first order)
                0.11, 0.12, 0.13,
                0.21, 0.22, 0.23,
                0.31, 0.32, 0.33,
            )
        ], dtype=[
            ('x', 'f4'), ('y', 'f4'), ('z', 'f4'), ('opacity', 'f4'),
            ('scale_0', 'f4'), ('scale_1', 'f4'),
            ('rot_0', 'f4'), ('rot_1', 'f4'), ('rot_2', 'f4'), ('rot_3', 'f4'),
            ('refl_strength', 'f4'), ('roughness', 'f4'), ('metalness', 'f4'),
            ('ori_color_0', 'f4'), ('ori_color_1', 'f4'), ('ori_color_2', 'f4'),
            ('f_dc_0', 'f4'), ('f_dc_1', 'f4'), ('f_dc_2', 'f4'),
            ('f_rest_0', 'f4'), ('f_rest_1', 'f4'), ('f_rest_2', 'f4'),
            ('f_rest_3', 'f4'), ('f_rest_4', 'f4'), ('f_rest_5', 'f4'),
            ('f_rest_6', 'f4'), ('f_rest_7', 'f4'), ('f_rest_8', 'f4'),
        ])

        mock_vertex = MagicMock()
        mock_vertex.data = mock_data

        mock_ply = MagicMock()
        mock_ply.__getitem__.return_value = mock_vertex

        mock_read.return_value = mock_ply

        rot_x_180 = np.array([
            [1.0, 0.0, 0.0, 0.0],
            [0.0, -1.0, 0.0, 0.0],
            [0.0, 0.0, -1.0, 0.0],
            [0.0, 0.0, 0.0, 1.0],
        ], dtype=np.float32)

        # Call the function
        result = _load_ply('test', transform=rot_x_180)

        # Assert shape and dtype
        self.assertEqual(result.shape, (1, config['RAW_FLOAT_PER_SPLAT']))
        self.assertEqual(result.dtype, np.float32)

        # Check some specific values (approximate due to floating point)
        expected_sx = np.exp(0.1)
        expected_sy = np.exp(0.2)

        np.testing.assert_almost_equal(result[0, 0], 1.0)  # x
        np.testing.assert_almost_equal(result[0, 1], -2.0)  # y (rotated)
        np.testing.assert_almost_equal(result[0, 2], -3.0)  # z (rotated)
        np.testing.assert_almost_equal(result[0, 3], 0.5)  # opacity
        np.testing.assert_almost_equal(result[0, 4], expected_sx)  # sx
        np.testing.assert_almost_equal(result[0, 5], expected_sy)  # sy
        # Quaternion check skipped for brevity
        # SH0 (dc)
        np.testing.assert_almost_equal(result[0, 10], 0.7)
        np.testing.assert_almost_equal(result[0, 11], 0.8)
        np.testing.assert_almost_equal(result[0, 12], 0.9)
        # SH1 (first order) sequence
        np.testing.assert_almost_equal(result[0, 13], 0.11)
        np.testing.assert_almost_equal(result[0, 14], -0.12)
        np.testing.assert_almost_equal(result[0, 15], -0.13)
        np.testing.assert_almost_equal(result[0, 16], 0.21)
        np.testing.assert_almost_equal(result[0, 17], -0.22)
        np.testing.assert_almost_equal(result[0, 18], -0.23)
        np.testing.assert_almost_equal(result[0, 19], 0.31)
        np.testing.assert_almost_equal(result[0, 20], -0.32)
        np.testing.assert_almost_equal(result[0, 21], -0.33)

        # New channels are appended at the end: refl, roughness, metalness, ori_r, ori_g, ori_b
        # With input 0.0, sigmoid(0.0) == 0.5
        np.testing.assert_almost_equal(result[0, 22], 0.5)  # refl
        np.testing.assert_almost_equal(result[0, 23], 0.5)  # roughness
        np.testing.assert_almost_equal(result[0, 24], 0.5)  # metalness
        np.testing.assert_almost_equal(result[0, 25], 0.5)  # ori_r
        np.testing.assert_almost_equal(result[0, 26], 0.5)  # ori_g
        np.testing.assert_almost_equal(result[0, 27], 0.5)  # ori_b

    def test_pack_data(self):
        # Create a single splat X already in RAW format (values post-_load_ply)
        pixels = config['PACKED_PIX_PER_SPLAT']
        RAW = config['RAW_FLOAT_PER_SPLAT']
        X = np.zeros((1, RAW), dtype=np.float32)
        X[0, 0:4] = [1.0, 2.0, 3.0, 0.5]  # pos + opacity
        X[0, 4] = 1.0  # sx
        X[0, 5] = 1.0  # sy
        X[0, 6:10] = [1.0, 0.0, 0.0, 0.0]  # quaternion (w,x,y,z)
        X[0, 10:13] = [0.7, 0.8, 0.9]  # SH0 (dc)
        X[0, 13:22] = [0.11, 0.12, 0.13, 0.21, 0.22, 0.23, 0.31, 0.32, 0.33]
        X[0, 22:25] = [0.5, 0.5, 0.5]  # refl, rough, metal
        X[0, 25:28] = [0.5, 0.5, 0.5]  # origin color

        raw_data, vcount = _pack_data(X, pixels)
        self.assertEqual(vcount, 1)

        # Float view: first 4 floats are pos+opacity
        tex_f32 = raw_data.view(np.float32).reshape((vcount, pixels * 4))
        np.testing.assert_allclose(tex_f32[0, 0:4], X[0, 0:4])

        # Base color (from SH0) should be written as bytes at offset 7*4
        C0 = 0.28209479177387814
        base = 0.5 + C0 * X[0, 10:13]
        base_u8 = np.clip(np.round(base * 255), 0, 255).astype(np.uint8)
        tex_u8 = raw_data.view(np.uint8).reshape((vcount, pixels * 4 * 4))
        off = 7 * 4
        np.testing.assert_array_equal(tex_u8[0, off:off + 3], base_u8)
        self.assertEqual(tex_u8[0, off + 3], 255)

        # SH1 packing: compare uint32 words using pack_half2 / pack_half1
        tex_u32 = raw_data.view(np.uint32).reshape((vcount, pixels * 4))
        sh1 = X[0, 13:22]
        np.testing.assert_array_equal(tex_u32[0, 8], pack_half2(np.array([sh1[0]], dtype=np.float32), np.array([sh1[1]], dtype=np.float32))[0])
        np.testing.assert_array_equal(tex_u32[0, 9], pack_half2(np.array([sh1[2]], dtype=np.float32), np.array([sh1[3]], dtype=np.float32))[0])
        np.testing.assert_array_equal(tex_u32[0, 10], pack_half2(np.array([sh1[4]], dtype=np.float32), np.array([sh1[5]], dtype=np.float32))[0])
        np.testing.assert_array_equal(tex_u32[0, 11], pack_half2(np.array([sh1[6]], dtype=np.float32), np.array([sh1[7]], dtype=np.float32))[0])
        np.testing.assert_array_equal(tex_u32[0, 12], pack_half1(np.array([sh1[8]], dtype=np.float32))[0])

    @patch('src.scripts.load_resource.np.load')
    def test_load_map(self, mock_load):
        fake_map = np.ones((6, 128, 128, 3), dtype=np.float32)
        mock_load.return_value = {'arr_0': fake_map}

        result = _load_map('test')

        self.assertEqual(result.shape, (6, 128, 128, 3))
        self.assertEqual(result.dtype, np.float32)
        args, _ = mock_load.call_args
        self.assertTrue(args[0].endswith(os.path.join('res', 'test', 'map1.npz')))

if __name__ == '__main__':
    unittest.main()
