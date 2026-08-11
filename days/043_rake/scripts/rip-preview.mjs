// Write the whole ripmap atlas out as a PNG — 81 cells of the same window, each
// averaged over a different rectangle.
//
//   node scripts/rip-preview.mjs rip.png
//
// Day 041 added `glass-preview.mjs` because the first painted rose was invisible
// and one look at the source image would have said why in a second. This is the
// same argument one level up: today's claim is about *the shape of the filter*,
// and the shape of the filter is a thing you can look at directly. Read the atlas
// left to right and the leads smear horizontally while the quarries stay stacked;
// read it top to bottom and they smear the other way. The diagonal — top-left to
// bottom-right — is Day 041's entire pyramid, and it is a ninth of what is here.
//
// Cell boundaries are drawn in a thin dark rule, and the diagonal cells are left
// undimmed while everything else is knocked back slightly, so the mip chain reads
// as the special case it is.
import { writePng } from './png.mjs'
import { buildGlass, ripRect, GLASS_LEVELS, RIP_ATLAS } from '../src/glass.js'

const out = process.argv[2] || 'rip.png'
const A = RIP_ATLAS
const { cells } = buildGlass()

const rgb = new Uint8Array(A * A * 3)

// The background: the atlas is 2N square and the cells fill all but a 1-texel
// strip, so this is mostly visible along the far edge. Dark, not black, so the
// packing is legible.
rgb.fill(18)

for (let m = 0; m < GLASS_LEVELS; m++) {
  for (let n = 0; n < GLASS_LEVELS; n++) {
    const { x, y, w, h } = ripRect(m, n)
    const src = cells[m][n]
    const dim = m === n ? 1.0 : 0.72
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        // image row 0 is v = -1, the sill; flip so the PNG reads the way up is up
        const s = ((h - 1 - j) * w + i) * 4
        const d = ((y + j) * A + x + i) * 3
        for (let c = 0; c < 3; c++) {
          const v = Math.max(0, Math.min(1, src[s + c] * 0.5 * dim))
          rgb[d + c] = Math.round(255 * v ** (1 / 2.2))
        }
      }
    }
    // the rule along the cell's left and top edges
    for (let j = 0; j < h; j++) {
      const d = ((y + j) * A + x) * 3
      for (let c = 0; c < 3; c++) rgb[d + c] = Math.round(rgb[d + c] * 0.35)
    }
    for (let i = 0; i < w; i++) {
      const d = (y * A + x + i) * 3
      for (let c = 0; c < 3; c++) rgb[d + c] = Math.round(rgb[d + c] * 0.35)
    }
  }
}

writePng(out, A, A, rgb)
console.log(`${out}  ${A}x${A}  ${GLASS_LEVELS}x${GLASS_LEVELS} cells`)
