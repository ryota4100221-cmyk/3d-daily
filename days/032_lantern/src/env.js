import * as THREE from 'three'

/**
 * The hall's image-based lighting: 128×64 float pixels written by hand and run
 * through PMREM. No network I/O (Day 028 started this; every day since has
 * authored a different room).
 *
 * Today's room is the darkest yet, and deliberately so. The subject of this
 * piece is a beam of light in the air, and a beam is only a beam if the air
 * around it is nearly black. Everything the environment map does here is keep
 * porcelain from reading as paper cut-out: one dim cold roof, one warm rim on
 * the light's side, and nothing else.
 */

function panel(az, el, dAz, dEl, sizeAz, sizeEl) {
  const a = Math.abs(((az - dAz + Math.PI * 3) % (Math.PI * 2)) - Math.PI)
  const e = Math.abs(el - dEl)
  const fa = Math.max(0, 1 - (a / sizeAz) ** 2)
  const fe = Math.max(0, 1 - (e / sizeEl) ** 2)
  return fa * fa * fe * fe
}

export function makeStudioEnvironment(renderer) {
  const W = 128
  const H = 64
  const data = new Float32Array(W * H * 4)

  for (let y = 0; y < H; y++) {
    const v = (y + 0.5) / H
    const el = (0.5 - v) * Math.PI
    for (let x = 0; x < W; x++) {
      const u = (x + 0.5) / W
      const az = (u - 0.5) * Math.PI * 2

      const up = Math.max(0, Math.sin(el))
      const down = Math.max(0, -Math.sin(el))

      let r = 0.0125 + up * 0.020 - down * 0.008
      let g = 0.0135 + up * 0.023 - down * 0.008
      let b = 0.0175 + up * 0.031 - down * 0.007

      // the opening the shafts come through: high, right, and narrow. Cold
      // today — the only warm light in this room is inside the glass.
      const k = panel(az, el, -0.52, 0.50, 0.42, 0.70) * 1.10
      r += k * 0.72
      g += k * 0.83
      b += k * 1.0

      // a warm sliver low on the near side: the lamp's spill, so the shadowed
      // half of a form is a form rather than a hole in the frame
      const f = panel(az, el, 2.35, 0.06, 1.45, 0.80) * 0.075
      r += f * 1.0
      g += f * 0.66
      b += f * 0.40

      const i = (y * W + x) * 4
      data[i] = r
      data[i + 1] = g
      data[i + 2] = b
      data[i + 3] = 1
    }
  }

  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.FloatType)
  tex.mapping = THREE.EquirectangularReflectionMapping
  tex.colorSpace = THREE.LinearSRGBColorSpace
  tex.minFilter = THREE.LinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.needsUpdate = true

  const pmrem = new THREE.PMREMGenerator(renderer)
  pmrem.compileEquirectangularShader()
  const envMap = pmrem.fromEquirectangular(tex).texture
  pmrem.dispose()
  tex.dispose()

  return envMap
}
