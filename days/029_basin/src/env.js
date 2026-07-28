import * as THREE from 'three'

/**
 * A hand-painted studio environment, no network I/O.
 *
 * Day 028 introduced this idea (a tiny float equirect run through PMREM).
 * Today's room is a different one: a very high, very wide overhead sheet — the
 * kind of light you get over still water at the end of the day — plus a warm
 * band sitting exactly on the horizon, because at a grazing angle the water is
 * going to mirror that band across the whole lower half of the frame.
 */

// smooth angular falloff for a "light panel" centred at (az, el), in radians
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
    const el = (0.5 - v) * Math.PI // +PI/2 at top
    for (let x = 0; x < W; x++) {
      const u = (x + 0.5) / W
      const az = (u - 0.5) * Math.PI * 2

      const up = Math.max(0, Math.sin(el))
      const down = Math.max(0, -Math.sin(el))

      // dome: cool paper above, deep ink below (the basin owns the lower half)
      let r = 0.30 + up * 0.30 - down * 0.24
      let g = 0.30 + up * 0.31 - down * 0.24
      let b = 0.31 + up * 0.34 - down * 0.23

      // horizon band — warm, narrow, and the single most visible thing in the
      // reflection, so it is worth authoring on purpose
      const band = Math.exp(-((el / 0.13) ** 2))
      r += band * 0.30
      g += band * 0.24
      b += band * 0.18

      // key: a wide overhead sheet, slightly left
      const k = panel(az, el, -0.55, 1.02, 1.45, 0.95) * 2.4
      r += k * 1.0
      g += k * 0.98
      b += k * 0.94

      // fill: broad and low on the right
      const f = panel(az, el, 1.85, 0.20, 1.6, 1.0) * 0.34
      r += f * 0.84
      g += f * 0.9
      b += f * 1.0

      // rim: a cold strip behind the subjects for porcelain edges
      const rim = panel(az, el, Math.PI * 0.96, 0.30, 0.46, 0.5) * 1.15
      r += rim * 0.74
      g += rim * 0.84
      b += rim * 1.0

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
