// The ripmap, and the rules that read it, on the CPU — in the one place every
// harness can import them.
//
// Day 043 had this arithmetic written out inside `aniso-error.mjs`, which was
// fine while there was one harness. Today there are two, and the second one is
// specifically an argument about whether the first one's *ground truth* was
// right; if the two disagreed about what `ripFetch` means, the argument would be
// unresolvable and would look exactly like a result. So the sampler moved here,
// the same way `readPng` moved into `png.mjs` on Day 043 and for the same
// reason.
//
// What is here: the bilinear sample of one ripmap cell, the bilinear blend
// across the four cells around a level pair, the ellipse an eigenproblem gives,
// and the tap rule that walks along its major axis. Nothing here knows what the
// footprint is *for*.
import { buildGlass, GLASS_SIZE, GLASS_LEVELS } from '../src/glass.js'
import { TAP_MAX, tapCount, slabWeights } from '../src/footprint.js'

export const N = GLASS_SIZE
export const LMAX = GLASS_LEVELS - 1

let CELLS = null
/** The ripmap, built once per process. buildGlass is a second of work. */
export function cells() {
  if (!CELLS) CELLS = buildGlass().cells
  return CELLS
}

/** Bilinear sample of ripmap cell (m, n), uv in [0,1], clamped like the shader. */
export function cell(uv, m, n) {
  const w = N >> m
  const h = N >> n
  const src = cells()[m][n]
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
export function ripFetch(uv, lodU, lodV) {
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
  return [0, 1, 2].map(
    (k) => (a[k] * (1 - fu) + b[k] * fu) * (1 - fv) + (c[k] * (1 - fu) + d[k] * fu) * fv
  )
}

/** The AABB half-extents of the ellipse (A, B, t), in texels. Day 042's answer. */
export function box(A, B, t) {
  const ct = Math.cos(t)
  const st = Math.sin(t)
  return [Math.hypot(A * ct, B * st), Math.hypot(A * st, B * ct)]
}

/**
 * The ellipse { x : |Jx| <= delta } from J's two columns, as (A >= B, angle).
 *
 * Q = J^T J; the semi-axes are delta over the square roots of Q's eigenvalues,
 * with the *smaller* eigenvalue giving the *major* axis, because the direction J
 * stretches least is the direction the preimage runs furthest. Both candidate
 * rows of Q - lambda I are formed and the longer taken: the first vanishes at a
 * circular footprint, the second wherever the major axis lies along u.
 *
 * `support` is Day 044 and is documented at `shrink` in src/footprint.js. At
 * support = 0 this returns Day 043's ellipse exactly.
 */
export function eigenEllipse(c0, c1, delta, support = 0) {
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
  return {
    A: shrink(delta / Math.sqrt(l2), support),
    B: shrink(delta / Math.sqrt(l1), support),
    t: Math.atan2(ax[1], ax[0]),
  }
}

/**
 * Day 044. `s` is the half-width of the source's own support, in the same units
 * as the semi-axis; the two variances add reciprocally. s = 0 disables it.
 * See src/footprint.js for the derivation — this is the same two lines.
 */
export function shrink(a, s) {
  return s > 0 ? 1 / Math.sqrt(1 / (a * a) + 1 / (s * s)) : a
}

/**
 * The tap rule: cut the ellipse into n slabs perpendicular to its major axis and
 * read slab k as its own sub-ellipse of semi-axes (A/n, B), centred on the slab.
 * The sub-ellipses are congruent, so all n taps share one level pair.
 *
 * `uv` is in [0,1], A and B in texels, t in radians. Options are the three knobs
 * the harnesses score: `max` (budget), `count` ('round' | 'ceil') and `weights`
 * ('area' | 'flat' | 'gauss'), all of which live in src/footprint.js.
 */
export function tapRule(uv, A, B, t, opt = {}) {
  const max = opt.max ?? TAP_MAX
  const n = tapCount(A, B, max, opt.count ?? 'round')
  const ap = A / n
  const ct = Math.cos(t)
  const st = Math.sin(t)
  const [fu, fv] = box(ap, B, t)
  const lu = Math.log2(Math.max(fu, 1))
  const lv = Math.log2(Math.max(fv, 1))
  // The outermost tap centre, in uv. The n sub-ellipses then tile [-A, A]
  // exactly: centre (A - A/n) plus half-length A/n reaches A.
  const span = (A - ap) / N
  const w = slabWeights(n, opt.weights ?? 'area')
  const out = [0, 0, 0]
  let wsum = 0
  for (let k = 0; k < n; k++) {
    const s = n > 1 ? (2 * k - (n - 1)) / (n - 1) : 0
    const c = ripFetch([uv[0] + ct * span * s, uv[1] + st * span * s], lu, lv)
    for (let j = 0; j < 3; j++) out[j] += w[k] * c[j]
    wsum += w[k]
  }
  return out.map((c) => c / wsum)
}
