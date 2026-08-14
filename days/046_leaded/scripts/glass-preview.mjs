// Write the window's own image out as a PNG, with the tracery drawn on top in
// outline so it is obvious which parts of the picture the integral can actually
// see. Levels of the pyramid are written side by side.
//
//   node scripts/glass-preview.mjs out.png [size]
//
// This exists because the first version of the rose was painted on the mullion —
// dead centre of the window, which is exactly where the stone crosses — and it
// took a render, a squint and a re-render to notice. One look at the source
// image would have caught it immediately.
import { writePng } from './png.mjs'
import { renderCartoon } from '../src/glass.js'
import { WINDOW } from '../src/palette.js'

const out = process.argv[2] || 'glass.png'
const N = Number(process.argv[3] || 512)

// Day 046: two panels side by side, because the day is the difference between
// them. Left is what the pyramid held for five mornings — the cartoon drawn
// through the leads, continuous across the stone, which is the arrangement that
// keeps the tracery from being counted twice. Right is what it holds now: the
// same colour premultiplied by the aperture, with the coverage in alpha.
//
// The left panel is *not* wrong and the right one is not a correction of it. The
// left is the field; the right is the field times the domain, and the point of
// the day is that a box filter of the second, divided by a box filter of the
// mask, is the mean over the domain at any level — which no filter of the first
// can be.
const plain = renderCartoon(N, false)
const px = renderCartoon(N, true)

// A crude display transform: the field is linear radiance around 1, so divide by
// two and gamma it. Nothing here is the renderer's grade; this is a contact sheet.
const W = N * 2
const rgb = new Uint8Array(W * N * 3)
const tone = (v) => Math.round(255 * Math.pow(Math.max(0, Math.min(1, v * 0.5)), 1 / 2.2))
for (let y = 0; y < N; y++) {
  // image row 0 is v = -1, the sill; flip so the PNG reads the way up is up
  const sy = N - 1 - y
  for (let x = 0; x < N; x++) {
    const s = (sy * N + x) * 4
    // left: the cartoon, with the stone dimmed rather than removed, so that the
    // painted layers can be read across the leads the way a glazier draws them
    const a = px[s + 3]
    for (let c = 0; c < 3; c++) {
      rgb[(y * W + x) * 3 + c] = tone(plain[s + c] * (0.28 + 0.72 * a))
      // right: premultiplied, exactly as level 0 of the pyramid holds it
      rgb[(y * W + N + x) * 3 + c] = tone(px[s + c])
    }
  }
}

writePng(out, W, N, rgb)
console.log(`${out}  ${N}x${N}`)
