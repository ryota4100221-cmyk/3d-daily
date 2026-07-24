import * as THREE from 'three'

// Build a soft procedural studio environment (no HDRI fetch — offline safe).
// A 2D-canvas equirect gradient with a warm key blob + cool fill blob, run
// through PMREM so meshPhysical clearcoat picks up believable reflections.
// Proven lineage: Day 013 / Day 021 canvas -> PMREM procedural env.
export function makeEnv(gl, { top, bottom, key, fill }) {
  const w = 512
  const h = 256
  const cv = document.createElement('canvas')
  cv.width = w
  cv.height = h
  const ctx = cv.getContext('2d')

  // vertical sky gradient
  const g = ctx.createLinearGradient(0, 0, 0, h)
  g.addColorStop(0.0, top)
  g.addColorStop(1.0, bottom)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)

  // warm key light — upper right
  blob(ctx, w * 0.72, h * 0.28, h * 0.55, key)
  // cool fill — upper left, softer
  blob(ctx, w * 0.24, h * 0.34, h * 0.7, fill)
  // faint floor bounce
  blob(ctx, w * 0.5, h * 0.98, h * 0.6, 'rgba(231,225,213,0.5)')

  const tex = new THREE.CanvasTexture(cv)
  tex.mapping = THREE.EquirectangularReflectionMapping
  tex.colorSpace = THREE.SRGBColorSpace

  const pmrem = new THREE.PMREMGenerator(gl)
  pmrem.compileEquirectangularShader()
  const rt = pmrem.fromEquirectangular(tex)
  pmrem.dispose()
  tex.dispose()
  return rt.texture
}

function blob(ctx, x, y, r, color) {
  const rg = ctx.createRadialGradient(x, y, 0, x, y, r)
  rg.addColorStop(0, color)
  rg.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = rg
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
}
