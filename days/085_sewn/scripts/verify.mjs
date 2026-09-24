// verify.mjs — the numbers in NOTES, from three's own projection (not from the formula).
import * as THREE from 'three'
import { EYE, HORIZON, K_PER_H, LAYERS, CHAPTERS, D_WORD, camXFromScroll, pagePxToWorld } from '../src/rig.js'
const cam = (s, W, H) => {
  const c = new THREE.PerspectiveCamera(), n = 0.5, kH = K_PER_H * H
  c.position.set(camXFromScroll(s, H), EYE, 0); c.updateMatrixWorld()
  c.projectionMatrix.makePerspective((-n * W) / 2 / kH, (n * W) / 2 / kH, (n * HORIZON * H) / kH, (-n * (1 - HORIZON) * H) / kH, n, 400)
  c.projectionMatrixInverse.copy(c.projectionMatrix).invert()
  return c
}
const sx = (c, p, W) => (new THREE.Vector3(...p).project(c).x * 0.5 + 0.5) * W
for (const [W, H] of [[1600, 1000], [1280, 720], [390, 844]]) {
  console.log(`■ viewport ${W}×${H}`)
  const k = H / 1000
  for (const l of LAYERS) {
    const r = [300, 2500, 6400].map((sp) => { const s = sp * k; return (sx(cam(0, W, H), [0, EYE, -l.d], W) - sx(cam(s, W, H), [0, EYE, -l.d], W)) / s })
    console.log(`  ${l.label.padEnd(9)} d=${String(l.d).padStart(2)} m  px per scroll px = ${r.map((v) => v.toFixed(6)).join(' / ')}   (D_WORD/d = ${(D_WORD / l.d).toFixed(6)})`)
  }
  // registration: DOM caption left = W/2 + px·k − s  vs  projected orange tick
  let worst = 0
  for (let sp = 0; sp <= 6400; sp += 97) {
    const s = sp * k, c = cam(s, W, H)
    for (const ch of CHAPTERS) worst = Math.max(worst, Math.abs(W / 2 + ch.px * k - s - sx(c, [pagePxToWorld(ch.px), 0, -D_WORD], W)))
  }
  console.log(`  DOM caption vs 3D tick, worst |Δx| over 67 scroll positions = ${worst.toExponential(2)} px`)
}
