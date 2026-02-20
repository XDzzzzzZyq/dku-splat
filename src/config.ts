export const CONFIG = {
    /* Layout of raw per-splat floats (server-side):
      pos : vec3 (3 * 4 bytes)
      opacity : float (1 * 4 bytes)
      scale : vec2 (2 * 4 bytes)  -- sz omitted (0)
      rot : quat (4 * 4 bytes)
      sh0 : vec3 (3 * 4 bytes)
      sh1 : vec9 (9 * 4 bytes)
      pbr : vec3 (refl, rough, metal)
      ori_color : vec3 (rgb)
      total floats per splat: 28
    */
  RAW_FLOAT_PER_SPLAT: 28,
  PACKED_FLOAT_PER_SPLAT: 16,
  PACKED_PIX_PER_SPLAT: 4,
  DATA_TEXTURE_WIDTH: 1024,

  USE_TRUNK_BASED_RENDERING: false,
  USE_DEFERRED_RENDERING: true,
  MAX_VISIBLE_TRUNKS: 256,
  ALPHA_DISCARD_EPSILON: 0.005,
} as const;