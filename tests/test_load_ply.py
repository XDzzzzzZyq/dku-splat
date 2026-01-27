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
            (1.0, 2.0, 3.0, 0.5, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9)
        ], dtype=[('x', 'f4'), ('y', 'f4'), ('z', 'f4'), ('opacity', 'f4'),
                  ('scale_0', 'f4'), ('scale_1', 'f4'), ('rot_0', 'f4'), ('rot_1', 'f4'),
                  ('rot_2', 'f4'), ('rot_3', 'f4'), ('f_dc_0', 'f4'),
                  ('f_dc_1', 'f4'), ('f_dc_2', 'f4')])

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
        expected_r = 1 / (1 + np.exp(-0.7))  # expit(0.7)
        expected_g = 1 / (1 + np.exp(-0.8))
        expected_b = 1 / (1 + np.exp(-0.9))

        np.testing.assert_almost_equal(result[0, 0], 1.0)  # x
        np.testing.assert_almost_equal(result[0, 1], 2.0)  # y
        np.testing.assert_almost_equal(result[0, 2], 3.0)  # z
        np.testing.assert_almost_equal(result[0, 3], 0.5)  # opacity
        np.testing.assert_almost_equal(result[0, 4], expected_sx)  # sx
        np.testing.assert_almost_equal(result[0, 5], expected_sy)  # sy
        np.testing.assert_almost_equal(result[0, 6], expected_sz)  # sz
        # Euler angles would require calculation, skipping for brevity
        np.testing.assert_almost_equal(result[0, 10], expected_r)  # r
        np.testing.assert_almost_equal(result[0, 11], expected_g)  # g
        np.testing.assert_almost_equal(result[0, 12], expected_b)  # b

if __name__ == '__main__':
    unittest.main()
