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

const px = renderCartoon(N)

// A crude display transform: the field is linear radiance around 1, so divide by
// two and gamma it. Nothing here is the renderer's grade; this is a contact sheet.
const rgb = new Uint8Array(N * N * 3)
for (let i = 0; i < N * N; i++) {
  for (let c = 0; c < 3; c++) {
    const v = Math.max(0, Math.min(1, px[i * 4 + c] * 0.5))
    rgb[i * 3 + c] = Math.round(255 * Math.pow(v, 1 / 2.2))
  }
}

// The stone, as an outline. Everything outside a pane is dimmed by half, which is
// not what the shader does — the shader simply does not integrate there — but it
// is what a reader needs to see.
const inPane = (u, v) => {
  for (const [cy, hy] of WINDOW.rows) {
    for (const [cx, hx] of WINDOW.cols) {
      if (
        Math.abs(u * WINDOW.half[0] - cx) <= hx &&
        Math.abs(v * WINDOW.half[1] - cy) <= hy
      ) {
        return true
      }
    }
  }
  return false
}
for (let y = 0; y < N; y++) {
  for (let x = 0; x < N; x++) {
    // image row 0 is v = -1, the sill; flip so the PNG reads the way up is up
    const u = ((x + 0.5) / N) * 2 - 1
    const v = 1 - ((y + 0.5) / N) * 2
    if (!inPane(u, v)) {
      const i = (y * N + x) * 3
      for (let c = 0; c < 3; c++) rgb[i + c] = Math.round(rgb[i + c] * 0.28)
    }
  }
}

writePng(out, N, N, rgb)
console.log(`${out}  ${N}x${N}`)
