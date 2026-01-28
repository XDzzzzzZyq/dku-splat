export const CONFIG = {
  /* | pos : vec3(3 * 4) |
     | opacity : float(4)|
     | scl : vec3(3 * 4) |
     | rot : vec3(3 * 4) |
     | sh0 : vec3(3 * 4) |
     | sh1 : vec9(9 * 4) |
     | pbr : vec3 (refl, rough, metal) |
     | ori_color : vec3 (rgb) |
  */  
  RAW_FLOAT_PER_SPLAT: 28,
  DATA_TEXTURE_WIDTH: 1024,
} as const;