import * as THREE from 'three'

/**
 * A hand-painted room for the image-based lighting, run through PMREM.
 * No network I/O — 128×64 float pixels written one at a time in JS
 * (the idea arrived on Day 028; each day since has authored a different room).
 *
 * Today's room is much darker and much harder than Day 029's dusk. A kinetic
 * piece needs *edges* — a specular line that travels along a form as it turns
 * is what makes the turning readable — so the key is a narrow high panel
 * rather than a wide soft sheet, and almost everything else is ink.
 */

// smooth angular falloff for a "light panel" centred at (dAz, dEl), in radians
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
    const el = (0.5 - v) * Math.PI // +PI/2 at the top
    for (let x = 0; x < W; x++) {
      const u = (x + 0.5) / W
      const az = (u - 0.5) * Math.PI * 2

      const up = Math.max(0, Math.sin(el))
      const down = Math.max(0, -Math.sin(el))

      // the room: near-black, a touch of cold in the roof, ink underfoot
      let r = 0.030 + up * 0.055 - down * 0.022
      let g = 0.032 + up * 0.062 - down * 0.022
      let b = 0.038 + up * 0.078 - down * 0.020

      // key: a narrow, tall panel, high and to the right. Narrow on purpose —
      // it draws one bright line down each porcelain form, and that line is
      // what travels when the form rotates.
      const k = panel(az, el, 0.68, 0.92, 0.62, 0.80) * 3.4
      r += k * 1.0
      g += k * 0.985
      b += k * 0.95

      // the warm slot standing behind the piece (the one the plate mirrors)
      const w = panel(az, el, Math.PI * 0.86, 0.10, 0.26, 0.86) * 2.1
      r += w * 1.0
      g += w * 0.56
      b += w * 0.29

      // cold wash, broad and low on the left — separates porcelain from ink
      const f = panel(az, el, -1.95, 0.14, 1.75, 1.05) * 0.30
      r += f * 0.68
      g += f * 0.82
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
