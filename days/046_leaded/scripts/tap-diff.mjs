// Where does the day actually land on the frame?
//
//   node scripts/tap-diff.mjs a.png b.png [out.png]
//
// Day 042 established that this render cannot *score* a filtering change: two
// captures of the same URL differ by however many TAA frames they happened to
// accumulate, which is worth an order of magnitude more than the effect. That
// argument is about ranking two builds by a statistic. It says nothing about the
// weaker and still useful question this script asks — **which pixels moved** —
// because temporal noise is spread over the whole frame and a footprint change
// is not.
//
// So: the absolute luminance difference of two captures, printed as a
// distribution and written out as a map. The grain floor shows up as a low,
// even haze everywhere; the day shows up as structure. If the two look the same,
// the uniform did nothing, and that is worth finding out before writing a page
// about it.
//
// Take both captures at the same SHOT_BUDGET. It does not make them the same
// age — Day 042 measured that it does not — but it stops the ladder from handing
// one of them an extra 1.6 seconds of convergence, which is a much larger effect
// than the one being looked for.
import { readPng, writePng } from './png.mjs'

const [pa, pb, out] = process.argv.slice(2)
if (!pa || !pb) {
  console.error('usage: node scripts/tap-diff.mjs a.png b.png [out.png]')
  process.exit(1)
}

const A = readPng(pa)
const B = readPng(pb)
if (A.w !== B.w || A.h !== B.h) {
  console.error(`size mismatch: ${A.w}x${A.h} vs ${B.w}x${B.h}`)
  process.exit(1)
}

const lum = (img, i) => 0.2126 * img.px[i] + 0.7152 * img.px[i + 1] + 0.0722 * img.px[i + 2]

const d = new Float32Array(A.w * A.h)
let sum = 0
let sum2 = 0
let max = 0
for (let i = 0; i < d.length; i++) {
  const v = Math.abs(lum(A, i * A.bpp) - lum(B, i * B.bpp))
  d[i] = v
  sum += v
  sum2 += v * v
  if (v > max) max = v
}
const n = d.length
const mean = sum / n
const rms = Math.sqrt(sum2 / n)

// The distribution matters more than the mean. A uniform noise floor puts almost
// everything in the first bucket and nothing in the last; a real change puts a
// tail there.
const LEVELS = [1, 2, 4, 8, 16, 32]
const over = LEVELS.map((t) => d.reduce((c, v) => c + (v >= t ? 1 : 0), 0))

// The number that separates the two kinds of difference, and the reason this
// script is worth having at all.
//
// Temporal noise is uncorrelated between neighbouring pixels: two captures of
// one build differ by a speckle field, and a speckle field's horizontal
// neighbour correlation is zero. A change to what a lobe averages is not
// speckle — it is the picture, or a piece of it, and the picture has structure
// at the scale of the leads. So two diffs of the same magnitude can still be
// told apart, and the *magnitude* is the statistic Day 042 proved this render
// cannot supply.
let c0 = 0
let c1 = 0
let cn = 0
for (let y = 0; y < A.h; y++) {
  for (let x = 0; x + 1 < A.w; x++) {
    const i = y * A.w + x
    c0 += (d[i] - mean) * (d[i] - mean)
    c1 += (d[i] - mean) * (d[i + 1] - mean)
    cn++
  }
}
const rho = c1 / Math.max(c0, 1e-9)

console.log(`${pa}\n${pb}\n`)
console.log(`  ${A.w}x${A.h}   mean |dL| = ${mean.toFixed(3)}   rms = ${rms.toFixed(3)}   max = ${max.toFixed(0)}`)
console.log(`  neighbour correlation of the difference: ${rho.toFixed(3)}   (0 = speckle, 1 = an image)`)
console.log('\n  levels   pixels        share')
for (let i = 0; i < LEVELS.length; i++) {
  console.log(
    `  >= ${String(LEVELS[i]).padStart(2)}   ${String(over[i]).padStart(8)}   ` +
      `${((100 * over[i]) / n).toFixed(3).padStart(7)} %`
  )
}

if (out) {
  // A plain grey map at 8x gain, so a difference of one level is visible and the
  // structure is legible without a palette to argue about.
  const rgb = new Uint8Array(A.w * A.h * 3)
  for (let i = 0; i < n; i++) {
    const v = Math.min(255, Math.round(d[i] * 8))
    rgb[i * 3] = v
    rgb[i * 3 + 1] = v
    rgb[i * 3 + 2] = v
  }
  writePng(out, A.w, A.h, rgb)
  console.log(`\n  wrote ${out}  (|dL| x 8, grey)`)
}
