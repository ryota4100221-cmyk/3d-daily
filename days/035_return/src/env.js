import * as THREE from 'three'

/**
 * The court's image-based lighting: 128×64 float pixels written by hand and run
 * through PMREM. No network I/O (Day 028 started this; every day since has
 * authored a different room).
 *
 * Darker than Day 032's, and it has to be. The subject of this piece is light
 * that has bounced twice *in the air*, and the fastest way to make that
 * invisible is to leave a general ambient lying around that already lit
 * everything. What is here is one narrow warm opening high on the right — the
 * same direction the key comes from, at the same elevation — and a cold floor
 * bounce so pale forms have a bottom edge. Nothing else.
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

      let r = 0.0098 + up * 0.014 - down * 0.005
      let g = 0.0106 + up * 0.016 - down * 0.005
      let b = 0.0138 + up * 0.022 - down * 0.004

      // the opening the shafts come through: high (54°, the key's own
      // elevation), right, and narrow
      const k = panel(az, el, -0.87, 0.95, 0.40, 0.62) * 1.05
      r += k * 1.0
      g += k * 0.95
      b += k * 0.88

      // the floor, returning a little of it — cold, because the stone is
      const f = panel(az, el, 1.2, -0.55, 2.2, 0.9) * 0.030
      r += f * 0.62
      g += f * 0.72
      b += f * 1.0

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
