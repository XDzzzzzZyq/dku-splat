import unittest
from unittest.mock import patch, MagicMock
import numpy as np

import os
import sys
project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "../"))  
sys.path.insert(0, project_root)

from src.scripts.load_ply import _load_ply
from _read_config import config

class TestLoadPly(unittest.TestCase):

    @patch('src.scripts.load_ply.PlyData.read')
    def test_load_ply(self, mock_read):
        # Create mock vertex data as a structured array
        mock_data = np.array([
            (
                1.0, 2.0, 3.0, 0.5,  # pos + opacity
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

        # Call the function
        result = _load_ply('test')

        # Assert shape and dtype
        self.assertEqual(result.shape, (1, config['RAW_FLOAT_PER_SPLAT']))
        self.assertEqual(result.dtype, np.float32)

        # Check some specific values (approximate due to floating point)
        expected_sx = np.exp(0.1)
        expected_sy = np.exp(0.2)
        expected_sz = 0.0

        np.testing.assert_almost_equal(result[0, 0], 1.0)  # x
        np.testing.assert_almost_equal(result[0, 1], 2.0)  # y
        np.testing.assert_almost_equal(result[0, 2], 3.0)  # z
        np.testing.assert_almost_equal(result[0, 3], 0.5)  # opacity
        np.testing.assert_almost_equal(result[0, 4], expected_sx)  # sx
        np.testing.assert_almost_equal(result[0, 5], expected_sy)  # sy
        np.testing.assert_almost_equal(result[0, 6], expected_sz)  # sz
        # Euler angles would require calculation, skipping for brevity
        # SH0 (dc)
        np.testing.assert_almost_equal(result[0, 10], 0.7)
        np.testing.assert_almost_equal(result[0, 11], 0.8)
        np.testing.assert_almost_equal(result[0, 12], 0.9)
        # SH1 (first order) sequence
        np.testing.assert_almost_equal(result[0, 13], 0.11)
        np.testing.assert_almost_equal(result[0, 14], 0.12)
        np.testing.assert_almost_equal(result[0, 15], 0.13)
        np.testing.assert_almost_equal(result[0, 16], 0.21)
        np.testing.assert_almost_equal(result[0, 17], 0.22)
        np.testing.assert_almost_equal(result[0, 18], 0.23)
        np.testing.assert_almost_equal(result[0, 19], 0.31)
        np.testing.assert_almost_equal(result[0, 20], 0.32)
        np.testing.assert_almost_equal(result[0, 21], 0.33)

        # New channels are appended at the end: refl, roughness, metalness, ori_r, ori_g, ori_b
        # With input 0.0, sigmoid(0.0) == 0.5
        np.testing.assert_almost_equal(result[0, 22], 0.5)  # refl
        np.testing.assert_almost_equal(result[0, 23], 0.5)  # roughness
        np.testing.assert_almost_equal(result[0, 24], 0.5)  # metalness
        np.testing.assert_almost_equal(result[0, 25], 0.5)  # ori_r
        np.testing.assert_almost_equal(result[0, 26], 0.5)  # ori_g
        np.testing.assert_almost_equal(result[0, 27], 0.5)  # ori_b

if __name__ == '__main__':
    unittest.main()
