import * as THREE from 'three'

/**
 * A studio environment with zero network I/O.
 *
 * We paint a tiny equirectangular HDR by hand (float RGBA, 128x64) — a warm
 * paper sky, a cool bounce from the floor, one big soft key panel and a small
 * cold rim panel — then run it through PMREMGenerator so it can drive real
 * roughness-aware IBL on physical materials. Days 003/004 built their studio out
 * of drei <Lightformer> meshes; here the environment is literally a texture we
 * authored pixel by pixel, which keeps the whole look under our control (and
 * offline-safe: nothing is fetched).
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
    // el: +PI/2 at the top of the equirect, -PI/2 at the bottom
    const v = (y + 0.5) / H
    const el = (0.5 - v) * Math.PI
    for (let x = 0; x < W; x++) {
      const u = (x + 0.5) / W
      const az = (u - 0.5) * Math.PI * 2

      const up = Math.max(0, Math.sin(el))
      const down = Math.max(0, -Math.sin(el))

      // base gradient: warm paper dome over a dim, slightly cooler floor bounce
      let r = 0.26 + up * 0.22 + down * -0.12
      let g = 0.25 + up * 0.22 + down * -0.13
      let b = 0.24 + up * 0.23 + down * -0.13

      // horizon haze keeps the reflections from banding hard at eye level
      const haze = Math.exp(-((el / 0.22) ** 2)) * 0.07
      r += haze
      g += haze
      b += haze * 1.04

      // key: large soft panel, high and to the left — the "window"
      const k = panel(az, el, -0.72, 0.72, 1.15, 0.95) * 2.6
      r += k * 1.0
      g += k * 0.97
      b += k * 0.9

      // fill: broad, low intensity, opposite side
      const f = panel(az, el, 1.9, 0.25, 1.5, 1.1) * 0.4
      r += f * 0.86
      g += f * 0.9
      b += f * 1.0

      // rim: narrow cold strip behind the subject, for the porcelain edges
      const rim = panel(az, el, Math.PI * 0.94, 0.34, 0.5, 0.55) * 1.2
      r += rim * 0.8
      g += rim * 0.88
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
