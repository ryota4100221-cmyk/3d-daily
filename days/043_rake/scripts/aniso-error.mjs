// How wrong is each footprint rule? Measured against the thing all of them are
// approximating, on the CPU, where there is no TAA and no grain.
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
// So the measurement lives off the GPU. Everything below is the same arithmetic
// the shader does, run against a ground truth the shader cannot afford:
//
//   ground truth  the mean of level 0 over the *actual* elliptical footprint,
//                 4096 stratified samples. This is what an ideal anisotropic
//                 filter returns, by definition.
//   taps          Day 043. The ellipse cut into n slabs along its major axis;
//                 each slab read as its own sub-ellipse through the ripmap, and
//                 the n answers combined with the exact area of the slab. n = 1
//                 is Day 042, algebraically — see the reduction check below.
//   ripmap        Day 042. Two levels from the whole ellipse's axis-aligned
//                 bounding box, bilinear across the four neighbouring cells.
//   Day 041       one level, log2 of sqrt(AB) — and that identity is not a
//                 guess. Day 041 used d = dist/sqrt(area), and working that
//                 through the same Jacobian gives 1/sqrt(det J), which is
//                 exactly the geometric mean of the ellipse's two semi-axes.
//   conservative  one level, log2 of A, the major semi-axis: the circle that
//                 circumscribes the ellipse, which is what a GPU picks for a mip
//                 chain because it is the choice that cannot alias.
//
// The three isotropic-ish rules bracket the anisotropic ones, and the
// interesting result is where each of them errs — printed binned by anisotropy
// and by the major axis's angle to the nearer texture axis, because that angle
// is the whole of what a ripmap alone cannot see.
import { buildGlass, GLASS_SIZE, GLASS_LEVELS } from '../src/glass.js'
import { TAP_MAX, tapCount, slabF } from '../src/footprint.js'

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

/** The AABB half-extents of the ellipse (A, B, t), in texels. Day 042's answer. */
function box(A, B, t) {
  const ct = Math.cos(t)
  const st = Math.sin(t)
  return [Math.hypot(A * ct, B * st), Math.hypot(A * st, B * ct)]
}

/**
 * Today's rule.
 *
 * Cut the ellipse into n slabs perpendicular to its major axis. Slab k is read
 * as a *sub-ellipse* of semi-axes (A/n, B) centred on the slab — congruent for
 * every k, so all n taps share one level pair and the ripmap is still doing the
 * axis-aligned part of the work. What the taps add is the part a ripmap has no
 * index for: where along a diagonal major axis the ellipse actually is.
 *
 * The weights are the exact area fractions of the slabs, which are constants of
 * n alone: F(x) = (x sqrt(1-x^2) + asin x)/pi is the area of the unit disc left
 * of x, over pi, so slab k weighs F(2(k+1)/n - 1) - F(2k/n - 1).
 */
function tapRule(uv, A, B, t, opt = {}) {
  const max = opt.max ?? TAP_MAX
  const weights = opt.weights ?? 'area'
  const count = opt.count ?? 'round'
  const n = tapCount(A, B, max, count)
  const ap = A / n
  const ct = Math.cos(t)
  const st = Math.sin(t)
  const [fu, fv] = box(ap, B, t)
  const lu = Math.log2(Math.max(fu, 1))
  const lv = Math.log2(Math.max(fv, 1))
  // The outermost tap centre, in uv. The n sub-ellipses then tile [-A, A]
  // exactly: centre (A - A/n) plus half-length A/n reaches A.
  const span = (A - ap) / N
  const out = [0, 0, 0]
  let wsum = 0
  let prev = -0.5 // F(-1)
  for (let k = 0; k < n; k++) {
    const F = slabF(2 * (k + 1) / n - 1)
    const w = weights === 'area' ? F - prev : 1 / n
    prev = F
    const s = n > 1 ? (2 * k - (n - 1)) / (n - 1) : 0
    const c = ripFetch([uv[0] + ct * span * s, uv[1] + st * span * s], lu, lv)
    for (let j = 0; j < 3; j++) out[j] += w * c[j]
    wsum += w
  }
  return out.map((c) => c / wsum)
}

// --- the reduction check ------------------------------------------------------
//
// The shader does not get (A, B, t). It gets a 2x2 Jacobian J from the window's
// own uv to the tangent plane at the lobe, and has to find the ellipse
// { x : |Jx| <= delta } itself — which is an eigenproblem on Q = J^T J, with the
// *smaller* eigenvalue giving the *major* semi-axis, because the direction J
// stretches least is the direction the preimage runs furthest.
//
// Day 042 never formed the ellipse: it went straight to the bounding box through
// the row norms of J inverse, which is two lines and no eigenvalues. So the first
// thing to check is that the two agree, or today's n = 1 is not yesterday's build
// and every comparison below is between two different things.
function eigenEllipse(c0, c1, delta) {
  const qa = c0[0] * c0[0] + c0[1] * c0[1]
  const qb = c0[0] * c1[0] + c0[1] * c1[1]
  const qc = c1[0] * c1[0] + c1[1] * c1[1]
  const tr = 0.5 * (qa + qc)
  const dsc = Math.sqrt(Math.max(tr * tr - (qa * qc - qb * qb), 0))
  const l1 = Math.max(tr + dsc, 1e-18)
  const l2 = Math.max(tr - dsc, 1e-18)
  const v1 = [qb, l2 - qa]
  const v2 = [l2 - qc, qb]
  let ax = v1[0] * v1[0] + v1[1] * v1[1] > v2[0] * v2[0] + v2[1] * v2[1] ? v1 : v2
  const len = Math.hypot(ax[0], ax[1])
  ax = len > 1e-12 ? [ax[0] / len, ax[1] / len] : [1, 0]
  return { A: delta / Math.sqrt(l2), B: delta / Math.sqrt(l1), t: Math.atan2(ax[1], ax[0]) }
}

{
  let worst = 0
  for (let i = 0; i < 4000; i++) {
    const r = (k) => Math.sin(i * 12.9898 + k * 78.233) * 43758.5453
    const f = (k) => r(k) - Math.floor(r(k)) - 0.5
    const c0 = [f(1) * 3, f(2) * 3]
    const c1 = [f(3) * 3, f(4) * 3]
    const det = Math.abs(c0[0] * c1[1] - c0[1] * c1[0])
    if (det < 1e-3) continue
    const delta = 0.5
    // Day 042: half-extents are the row norms of J inverse, times delta.
    const a = [(delta * Math.hypot(c1[0], c1[1])) / det, (delta * Math.hypot(c0[0], c0[1])) / det]
    const e = eigenEllipse(c0, c1, delta)
    const b = box(e.A, e.B, e.t)
    worst = Math.max(worst, Math.abs(a[0] - b[0]) / a[0], Math.abs(a[1] - b[1]) / a[1])
  }
  console.log(`reduction check: eigen ellipse vs Day 042's row norms — worst relative`)
  console.log(`  disagreement over 4000 random Jacobians: ${(worst * 100).toExponential(2)} %\n`)
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

function add(ri, ti, e) {
  const k = ri * 10 + ti
  if (!bins.has(k)) bins.set(k, { n: 0, s: [0, 0, 0, 0] })
  const b = bins.get(k)
  b.n++
  for (let i = 0; i < 4; i++) b.s[i] += e[i] * e[i]
}

// The variants, scored on the same samples. Today's rule has three knobs and all
// three were guesses when it was written; the point of having the harness is
// that they do not have to stay guesses.
const VARIANTS = [
  ['n<=4 area round', { max: 4, weights: 'area', count: 'round' }],
  ['n<=4 flat round', { max: 4, weights: 'flat', count: 'round' }],
  ['n<=4 area ceil', { max: 4, weights: 'area', count: 'ceil' }],
  ['n<=2 area round', { max: 2, weights: 'area', count: 'round' }],
  ['n<=8 area round', { max: 8, weights: 'area', count: 'round' }],
  ['n<=16 area round', { max: 16, weights: 'area', count: 'round' }],
]
const vsum = VARIANTS.map(() => 0)
const vtap = VARIANTS.map(() => 0)

const total = [0, 0, 0, 0]
let taken = 0

for (let i = 0; i < NS; i++) {
  const u = (0.5 + A1 * i) % 1
  const v = (0.5 + A2 * i) % 1
  const B = 2 * 2 ** (5 * ((i * 0.6180339887) % 1)) // 2 .. 64 texels, minor axis
  const ratio = 2 ** (3 * ((i * 0.4142135624) % 1)) // 1x .. 8x
  const A = B * ratio
  const t = Math.PI * ((i * 0.7320508076) % 1) // the ellipse's own orientation

  const ref = reference([u, v], A, B, t)
  const err = (x) =>
    Math.sqrt([0, 1, 2].reduce((s, c) => s + ((x[c] - ref[c]) / Math.max(ref[c], 1e-4)) ** 2, 0) / 3)

  const [fu, fv] = box(A, B, t)
  const li = Math.log2(Math.max(Math.sqrt(A * B), 1))
  const lc = Math.log2(Math.max(A, 1))
  const e = [
    err(tapRule([u, v], A, B, t)),
    err(ripFetch([u, v], Math.log2(Math.max(fu, 1)), Math.log2(Math.max(fv, 1)))),
    err(ripFetch([u, v], li, li)),
    err(ripFetch([u, v], lc, lc)),
  ]
  for (let k = 0; k < 4; k++) total[k] += e[k] * e[k]
  for (let k = 0; k < VARIANTS.length; k++) {
    const o = VARIANTS[k][1]
    const x = err(tapRule([u, v], A, B, t, o))
    vsum[k] += x * x
    vtap[k] += tapCount(A, B, o.max, o.count)
  }
  taken++

  // the major axis's angle to the *nearer* texture axis: 0 aligned, 45 diagonal
  const a = ((t * 180) / Math.PI) % 90
  const dev = Math.min(a, 90 - a)
  const bin = (bs, x) => {
    const k = bs.findIndex((q) => x < q)
    return k < 0 ? bs.length - 1 : k
  }
  add(bin(RATIO_BINS, ratio), bin(ANGLE_BINS, dev), e)
}

const pct = (x, n) => (100 * Math.sqrt(x / n)).toFixed(2)
console.log(`n = ${taken} footprints; ground truth = 4096 taps of level 0 over the ellipse`)
console.log(`relative RMS error, per cent  (taps: n <= ${TAP_MAX}, area weights)\n`)
console.log('  anisotropy   major axis      taps    ripmap   Day 041   circumscribed    n')
const label = (i, e) => (i === 0 ? `<${e[0]}` : i === e.length - 1 ? `>${e[i - 1]}` : `${e[i - 1]}-${e[i]}`)
for (let ri = 0; ri < RATIO_BINS.length; ri++) {
  for (let ti = 0; ti < ANGLE_BINS.length; ti++) {
    const b = bins.get(ri * 10 + ti)
    if (!b) continue
    const rl = `${label(ri, RATIO_BINS)}x`.padStart(8)
    const tl = `${label(ti, ANGLE_BINS)} deg`.padStart(11)
    console.log(
      `  ${rl}   ${tl}   ${pct(b.s[0], b.n).padStart(7)}   ${pct(b.s[1], b.n).padStart(7)}   ` +
        `${pct(b.s[2], b.n).padStart(7)}   ${pct(b.s[3], b.n).padStart(13)}   ${String(b.n).padStart(4)}`
    )
  }
}
console.log(
  `\n  all                  ${pct(total[0], taken).padStart(7)}   ${pct(total[1], taken).padStart(7)}   ` +
    `${pct(total[2], taken).padStart(7)}   ${pct(total[3], taken).padStart(13)}   ${taken}`
)

// The knobs, with what each of them costs. Error alone would pick the most
// expensive rule every time; the mean tap count is the other half of the choice,
// and it is the number that gets multiplied by four bilinear fetches and by two
// lobes before it reaches a frame.
console.log('\nthe knobs, scored on the same footprints\n')
console.log('                       RMS %   mean taps')
for (let k = 0; k < VARIANTS.length; k++) {
  console.log(
    `  ${VARIANTS[k][0].padEnd(18)}${pct(vsum[k], taken).padStart(7)}   ` +
      `${(vtap[k] / taken).toFixed(2).padStart(9)}`
  )
}
