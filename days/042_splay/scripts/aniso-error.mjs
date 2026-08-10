// How wrong is each footprint rule? Measured against the thing all three of them
// are approximating, on the CPU, where there is no TAA and no grain.
//
//   node scripts/aniso-error.mjs [samples]
//
// This script exists because the render would not answer the question. Two
// builds that differ by one uniform still differ by however many frames the
// headless capture happened to accumulate, and on this scene that is worth about
// ten levels of luminance sd — an order of magnitude more than the effect. Four
// captures of the same URL came back at 1.81, 1.83, 2.02 and 2.07 MB of PNG, and
// the *quietest* isotropic frame scored better than the noisiest anisotropic one
// on every statistic, for reasons that had nothing to do with filtering.
//
// So the measurement moved off the GPU. Everything below is the same arithmetic
// the shader does, run against a ground truth the shader cannot afford:
//
//   ground truth  the mean of level 0 over the *actual* elliptical footprint,
//                 4096 stratified samples. This is what an ideal anisotropic
//                 filter returns, by definition.
//   ripmap        Day 042. Two levels from the ellipse's axis-aligned bounding
//                 box (the row norms of the map that makes it), bilinear across
//                 the four neighbouring cells.
//   Day 041       one level, log2 of sqrt(AB) — and that identity is not a
//                 guess. Day 041 used d = dist/sqrt(area), and working that
//                 through the same Jacobian gives 1/sqrt(det J), which is
//                 exactly the geometric mean of the ellipse's two semi-axes.
//   conservative  one level, log2 of A, the major semi-axis: the circle that
//                 circumscribes the ellipse, which is what a GPU picks for a mip
//                 chain because it is the choice that cannot alias.
//
// The two isotropic rules bracket the anisotropic one, and the interesting
// result is which side each of them errs on.
import { buildGlass, GLASS_SIZE, GLASS_LEVELS } from '../src/glass.js'

const NS = Number(process.argv[2] || 4096)
const { cells } = buildGlass()
const N = GLASS_SIZE
const LMAX = GLASS_LEVELS - 1

/** Bilinear sample of ripmap cell (m, n), uv in [0,1], clamped like the shader. */
function cell(uv, m, n) {
  const w = N >> m
  const h = N >> n
  const src = cells[m][n]
  const x = Math.min(Math.max(uv[0], 0.5 / w), 1 - 0.5 / w) * w - 0.5
  const y = Math.min(Math.max(uv[1], 0.5 / h), 1 - 0.5 / h) * h - 0.5
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const fx = x - x0
  const fy = y - y0
  const out = [0, 0, 0]
  for (let j = 0; j < 2; j++) {
    for (let i = 0; i < 2; i++) {
      const xi = Math.min(Math.max(x0 + i, 0), w - 1)
      const yi = Math.min(Math.max(y0 + j, 0), h - 1)
      const wgt = (i ? fx : 1 - fx) * (j ? fy : 1 - fy)
      const s = (yi * w + xi) * 4
      for (let c = 0; c < 3; c++) out[c] += wgt * src[s + c]
    }
  }
  return out
}

/** The shader's ripFetch: bilinear across the four neighbouring cells. */
function ripFetch(uv, lodU, lodV) {
  const lu = Math.min(Math.max(lodU, 0), LMAX)
  const lv = Math.min(Math.max(lodV, 0), LMAX)
  const u0 = Math.floor(lu)
  const v0 = Math.floor(lv)
  const u1 = Math.min(u0 + 1, LMAX)
  const v1 = Math.min(v0 + 1, LMAX)
  const fu = lu - u0
  const fv = lv - v0
  const a = cell(uv, u0, v0)
  const b = cell(uv, u1, v0)
  const c = cell(uv, u0, v1)
  const d = cell(uv, u1, v1)
  return [0, 1, 2].map((k) =>
    (a[k] * (1 - fu) + b[k] * fu) * (1 - fv) + (c[k] * (1 - fu) + d[k] * fu) * fv
  )
}

/** The mean of level 0 over the ellipse { R(t) diag(A,B) w : |w| <= 1 }. */
function reference(uv, A, B, t, taps = 4096) {
  const ct = Math.cos(t)
  const st = Math.sin(t)
  const out = [0, 0, 0]
  // A sunflower spiral: equal area in radius, golden angle in phase.
  for (let i = 0; i < taps; i++) {
    const rr = Math.sqrt((i + 0.5) / taps)
    const ph = (i + 0.5) * 2.399963229728653
    const wx = rr * Math.cos(ph) * A
    const wy = rr * Math.sin(ph) * B
    const du = (ct * wx - st * wy) / N
    const dv = (st * wx + ct * wy) / N
    const s = cell([uv[0] + du, uv[1] + dv], 0, 0)
    for (let c = 0; c < 3; c++) out[c] += s[c]
  }
  return out.map((c) => c / taps)
}

// A deterministic low-discrepancy sweep. R2 for the position, and the footprint
// swept over the range the frame actually uses: the near tablet sits around 3-5
// levels down and the far one near the top, so 2 to 64 texels of minor axis and
// 1x to 8x of anisotropy covers both with room either side.
const G = 1.324717957244746
const A1 = 1 / G
const A2 = 1 / (G * G)

// Binned two ways, because one number hides the whole story. A ripmap is
// indexed by the texture's own axes, so how well it does depends on how far the
// ellipse's major axis is from one of them — and the answer at 45 degrees is
// worth printing rather than averaging away.
const RATIO_BINS = [1.5, 3, 8]
const ANGLE_BINS = [15, 30, 45]
const bins = new Map()

function add(ri, ti, er, ei, ec) {
  const k = ri * 10 + ti
  if (!bins.has(k)) bins.set(k, { n: 0, r: 0, i: 0, c: 0 })
  const b = bins.get(k)
  b.n++
  b.r += er * er
  b.i += ei * ei
  b.c += ec * ec
}

let sumRip = 0
let sumIso = 0
let sumCon = 0

for (let i = 0; i < NS; i++) {
  const u = (0.5 + A1 * i) % 1
  const v = (0.5 + A2 * i) % 1
  const B = 2 * 2 ** (5 * ((i * 0.6180339887) % 1)) // 2 .. 64 texels, minor axis
  const ratio = 2 ** (3 * ((i * 0.4142135624) % 1)) // 1x .. 8x
  const A = B * ratio
  const t = Math.PI * ((i * 0.7320508076) % 1) // the ellipse's own orientation

  const ref = reference([u, v], A, B, t)

  // the three rules
  const fu = Math.hypot(A * Math.cos(t), B * Math.sin(t))
  const fv = Math.hypot(A * Math.sin(t), B * Math.cos(t))
  const rip = ripFetch([u, v], Math.log2(Math.max(fu, 1)), Math.log2(Math.max(fv, 1)))
  const li = Math.log2(Math.max(Math.sqrt(A * B), 1))
  const iso = ripFetch([u, v], li, li)
  const lc = Math.log2(Math.max(A, 1))
  const con = ripFetch([u, v], lc, lc)

  const err = (x) =>
    Math.sqrt([0, 1, 2].reduce((s, c) => s + ((x[c] - ref[c]) / Math.max(ref[c], 1e-4)) ** 2, 0) / 3)

  const er = err(rip)
  const ei = err(iso)
  const ec = err(con)
  sumRip += er * er
  sumIso += ei * ei
  sumCon += ec * ec

  // the major axis's angle to the *nearer* texture axis: 0 aligned, 45 diagonal
  const a = ((t * 180) / Math.PI) % 90
  const dev = Math.min(a, 90 - a)
  const bin = (bs, x) => {
    const k = bs.findIndex((e) => x < e)
    return k < 0 ? bs.length - 1 : k
  }
  add(bin(RATIO_BINS, ratio), bin(ANGLE_BINS, dev), er, ei, ec)
}

const pct = (x, n) => (100 * Math.sqrt(x / n)).toFixed(2)
console.log(`n = ${NS} footprints; ground truth = 4096 taps of level 0 over the ellipse`)
console.log('relative RMS error, per cent\n')
console.log('  anisotropy   major axis    ripmap   Day 041   circumscribed    n')
const label = (i, e) => (i === 0 ? `<${e[0]}` : i === e.length - 1 ? `>${e[i - 1]}` : `${e[i - 1]}-${e[i]}`)
for (let ri = 0; ri < RATIO_BINS.length; ri++) {
  for (let ti = 0; ti < ANGLE_BINS.length; ti++) {
    const b = bins.get(ri * 10 + ti)
    if (!b) continue
    const rl = `${label(ri, RATIO_BINS)}x`.padStart(8)
    const tl = `${label(ti, ANGLE_BINS)} deg`.padStart(11)
    console.log(
      `  ${rl}   ${tl}   ${pct(b.r, b.n).padStart(7)}   ${pct(b.i, b.n).padStart(7)}   ` +
        `${pct(b.c, b.n).padStart(13)}   ${String(b.n).padStart(4)}`
    )
  }
}
console.log(
  `\n  all              ${pct(sumRip, NS).padStart(7)}   ${pct(sumIso, NS).padStart(7)}   ` +
    `${pct(sumCon, NS).padStart(13)}   ${NS}`
)
