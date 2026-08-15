// The other factor of the split-sum, measured for the first time with a blocker
// in front of the window.
//
//   node scripts/vis-error.mjs [configs] [grid]
//
// `lobe-error.mjs` brute-forces the integral the fetch stands in for and has
// done since Day 044. It has one thing missing from it, and it has been missing
// since the harness was written: **there is nothing in the way.** Every rule from
// Day 041 to Day 046 was scored on an unoccluded window, and the factorisation
// the renderer actually ships is
//
//     ∫ L V k  =  (∫ V k) · (∫ L V k / ∫ V k)      exactly, always
//              ≈  (∫ V k) · (∫ L k   / ∫ k)        Day 046
//
// so the whole of what the harness could see was the second factor of the second
// line. The difference between the two lines is the covariance of radiance and
// visibility over the lobe's own footprint, and it is invisible to a harness with
// no occluder in it — which is why six mornings of filtering never charged for it.
//
// ---------------------------------------------------------------------------
// The blocker
//
// A half-plane in the source's own uv, and that is not a simplification of a
// lath: the silhouette of *any* straight edge, seen from a point, is a straight
// line on the light's plane, because the projection of a line through a point
// onto a plane is a line. Visibility from a single shading point is binary — the
// penumbra is what happens after the integral, not inside it — so a hard
// half-plane is the exact visibility function of the exact thing in the frame.
//
// One per configuration, with its angle and its offset from the same low
// discrepancy sequence as the geometry, and the offset restricted to the band
// that actually cuts the window. A blocker that misses is a configuration where
// today is the identity, and the table would then be reporting how often the
// sequence throws a miss rather than how well the rule works.
//
// ---------------------------------------------------------------------------
// What is scored
//
//     reference   ∫ L V D / ∫ V D  over the six panes — the D-weighted mean of
//                 the window over **the part of it this point can see**.
//     Day 046     the fetch, unweighted. What ships until this morning.
//     panes       each slab weighted by the visibility of the pane it lands in —
//                 the mask the renderer already has, spent a second way.
//     the fit     each slab weighted by the plane least-squared through the taps
//                 (src/visfit.js). Today.
//     exact V     each slab weighted by the true visibility at its own centre.
//                 Not available to a shader; it is the ceiling of the mechanism,
//                 and the gap between it and the fit is the model's error rather
//                 than the estimator's.
//
// The first factor is held at the reference's own ∫ V D throughout, because what
// is being compared is the *colour of the visible window* and not the LTC sum,
// which no line of today touches.
import { WINDOW, LIGHT, lightPosition, buildWindow } from '../src/palette.js'
import { GLASS_K, cartoonMeans } from '../src/glass.js'
import { TAP_MAX, tapCount, MASS_KAPPA, massArea, erf } from '../src/footprint.js'
import { fitVis, evalVis, edgeFrom as edgeOf, clipFrac } from '../src/visfit.js'
import { cells, ripFetch, glassMean, box, eigenEllipse, rescale, N } from './rip.mjs'
import { slabWeights } from '../src/footprint.js'

const NC = Number(process.argv[2] || 256)
const NG = Number(process.argv[3] || 384)

const PANES_UV = (() => {
  const W = buildWindow()
  const bx = Math.tan(W.bound[0])
  const by = Math.tan(W.bound[1])
  return W.panes.map(([cx, cy, hx, hy]) => ({
    u0: 0.5 + Math.tan(cx - hx) / (2 * bx),
    u1: 0.5 + Math.tan(cx + hx) / (2 * bx),
    v0: 0.5 + Math.tan(cy - hy) / (2 * by),
    v1: 0.5 + Math.tan(cy + hy) / (2 * by),
  }))
})()

/** Which pane (u, v) is in, or -1 for the stone. */
function paneAt(u, v) {
  for (let i = 0; i < PANES_UV.length; i++) {
    const p = PANES_UV[i]
    if (u >= p.u0 && u <= p.u1 && v >= p.v0 && v <= p.v1) return i
  }
  return -1
}

function ltcClip(f) {
  const l = Math.hypot(f[0], f[1], f[2])
  return Math.max((l * l + f[2]) / (l + 1), 0)
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s]
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const crs = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
const nrm = (a) => mul(a, 1 / Math.max(Math.hypot(a[0], a[1], a[2]), 1e-12))
const mat = (m, v) => [
  m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
  m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
  m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
]

const L0 = cells()[0][0]
function sample0(u, v, out) {
  const x = Math.min(Math.max(u, 0.5 / N), 1 - 0.5 / N) * N - 0.5
  const y = Math.min(Math.max(v, 0.5 / N), 1 - 0.5 / N) * N - 0.5
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const fx = x - x0
  const fy = y - y0
  const x1 = Math.min(x0 + 1, N - 1)
  const y1 = Math.min(y0 + 1, N - 1)
  const i00 = (y0 * N + x0) * 4
  const i10 = (y0 * N + x1) * 4
  const i01 = (y1 * N + x0) * 4
  const i11 = (y1 * N + x1) * 4
  const w00 = (1 - fx) * (1 - fy)
  const w10 = fx * (1 - fy)
  const w01 = (1 - fx) * fy
  const w11 = fx * fy
  for (let c = 0; c < 3; c++) {
    out[c] = L0[i00 + c] * w00 + L0[i10 + c] * w10 + L0[i01 + c] * w01 + L0[i11 + c] * w11
  }
}

// --- the geometry, verbatim from lobe-error.mjs -------------------------------
const HX = Math.tan(WINDOW.half[0]) * LIGHT.dist
const HY = Math.tan(WINDOW.half[1]) * LIGHT.dist
const C = lightPosition()
const DIR = nrm(LIGHT.dir)
const AX = nrm(crs(Math.abs(DIR[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], DIR))
const AY = crs(DIR, AX)

const G = 1.324717957244746
const R2A = 1 / G
const R2B = 1 / (G * G)
function halton(i, b) {
  let f = 1
  let r = 0
  while (i > 0) {
    f /= b
    r += f * (i % b)
    i = Math.floor(i / b)
  }
  return r
}

function config(i) {
  const t1 = (0.5 + R2A * i) % 1
  const t2 = (0.5 + R2B * i) % 1
  const t3 = halton(i + 1, 2)
  const rad = 7 * Math.cbrt(t3)
  const ct = 2 * t1 - 1
  const st = Math.sqrt(Math.max(1 - ct * ct, 0))
  const ph = 2 * Math.PI * t2
  const P = [
    LIGHT.target[0] + rad * st * Math.cos(ph),
    LIGHT.target[1] + rad * st * Math.sin(ph),
    LIGHT.target[2] + rad * ct,
  ]
  const toC = nrm(sub(C, P))
  const h1 = halton(i + 1, 3)
  const h2 = halton(i + 1, 5)
  const cz = 0.02 + 0.98 * h1
  const sz = Math.sqrt(Math.max(1 - cz * cz, 0))
  const pa = 2 * Math.PI * h2
  const B1 = nrm(Math.abs(toC[1]) < 0.9 ? crs([0, 1, 0], toC) : crs([1, 0, 0], toC))
  const B2 = crs(toC, B1)
  const nS = nrm([
    toC[0] * cz + (B1[0] * Math.cos(pa) + B2[0] * Math.sin(pa)) * sz,
    toC[1] * cz + (B1[1] * Math.cos(pa) + B2[1] * Math.sin(pa)) * sz,
    toC[2] * cz + (B1[2] * Math.cos(pa) + B2[2] * Math.sin(pa)) * sz,
  ])
  const T1 = nrm(Math.abs(nS[1]) < 0.9 ? crs([0, 1, 0], nS) : crs([1, 0, 0], nS))
  const T2 = crs(nS, T1)
  const g1 = 2 ** (8 * halton(i + 1, 7))
  const g2 = 2 ** (8 * halton(i + 1, 11))
  const ps = Math.PI * halton(i + 1, 13)
  const cs = Math.cos(ps)
  const ss = Math.sin(ps)
  const M = [
    g1 * (cs * T1[0] + ss * T2[0]), g1 * (cs * T1[1] + ss * T2[1]), g1 * (cs * T1[2] + ss * T2[2]),
    g2 * (-ss * T1[0] + cs * T2[0]), g2 * (-ss * T1[1] + cs * T2[1]), g2 * (-ss * T1[2] + cs * T2[2]),
    nS[0], nS[1], nS[2],
  ]
  const o = sub(C, P)
  const ax = mul(AX, HX)
  const ay = mul(AY, HY)

  // The blocker: a half-plane in the source's own uv. Angle and offset from two
  // more primes of the same sequence, the offset kept inside the band that cuts
  // the square so that every configuration is one the day is actually about.
  const th = 2 * Math.PI * halton(i + 1, 17)
  const nx = Math.cos(th)
  const ny = Math.sin(th)
  const half = 0.5 * (Math.abs(nx) + Math.abs(ny)) // the support of n.(uv - ½)
  const c0 = (2 * halton(i + 1, 19) - 1) * 0.85 * half
  return { p1: mat(M, sub(sub(o, ax), ay)), V1: mat(M, mul(ax, 2)), V2: mat(M, mul(ay, 2)), nx, ny, c0 }
}

/** The blocker's visibility at a point of the picture. Binary, from a point. */
function visOf(cf, u, v) {
  return cf.nx * (u - 0.5) + cf.ny * (v - 0.5) < cf.c0 ? 1 : 0
}

/**
 * The exact answer, with the blocker in it.
 *
 * Same weights as lobe-error.mjs — the lobe's density times dw/dA — restricted to
 * the panes, and now split three ways: the unoccluded mean (Day 046's reference,
 * kept so the two harnesses can be checked against each other), the visible mean
 * (today's), and the per-pane visibilities the renderer's mask estimates.
 */
function exact(cf, grid) {
  const { p1, V1, V2 } = cf
  const nq = crs(V1, V2)
  const c = [0, 0, 0]
  let W = 0
  let WV = 0
  const num = [0, 0, 0]
  const numV = [0, 0, 0]
  const fv = [0, 0, 0]
  const fvV = [0, 0, 0]
  const visN = new Array(PANES_UV.length).fill(0)
  const visD = new Array(PANES_UV.length).fill(0)
  let mu = 0
  let mv = 0
  let suu = 0
  let suv = 0
  let svv = 0
  // The z of each pane's own edge vector — what `ltcVector` calls e.z, before
  // the horizon fit and before the visibility weight. The shader has it per pane
  // already: it is the weight it uses for the chromaticity sum.
  const ez = new Array(PANES_UV.length).fill(0)
  const step = 1 / grid
  for (let j = 0; j < grid; j++) {
    const v = (j + 0.5) * step
    for (let i = 0; i < grid; i++) {
      const u = (i + 0.5) * step
      const pi = paneAt(u, v)
      if (pi < 0) continue
      const vis = visOf(cf, u, v)
      // The mask's own question — what fraction of pane i is clear — is an area
      // fraction and not a weighted one, because that is what its taps estimate.
      visD[pi]++
      visN[pi] += vis
      const X = [
        p1[0] + u * V1[0] + v * V2[0],
        p1[1] + u * V1[1] + v * V2[1],
        p1[2] + u * V1[2] + v * V2[2],
      ]
      const r2 = dot(X, X)
      if (r2 < 1e-12) continue
      const r = Math.sqrt(r2)
      const wz = X[2] / r
      const dw = (Math.abs(dot(nq, X) / r) / r2) * step * step
      ez[pi] += (X[2] / r) * dw / Math.PI
      fv[0] += (X[0] / r) * dw
      fv[1] += (X[1] / r) * dw
      fv[2] += wz * dw
      if (vis > 0) {
        fvV[0] += (X[0] / r) * dw
        fvV[1] += (X[1] / r) * dw
        fvV[2] += wz * dw
      }
      if (wz <= 0) continue
      const w = wz * dw
      sample0(u, v, c)
      for (let k = 0; k < 3; k++) num[k] += w * c[k]
      W += w
      if (vis > 0) {
        for (let k = 0; k < 3; k++) numV[k] += w * c[k]
        WV += w
        mu += w * u
        mv += w * v
        suu += w * u * u
        suv += w * u * v
        svv += w * v * v
      }
    }
  }
  if (W < 1e-12 || WV < 1e-9 * W) return null
  mu /= WV
  mv /= WV
  return {
    tint: num.map((x) => x / W),
    tintV: numV.map((x) => x / WV),
    // The visible kernel's own first and second moments in uv. Not available to
    // a shader; they are what a rule would produce if it were exactly right, and
    // the only way to say whether a residual is in the *region* the fetch reads
    // or in the filter that reads it.
    meanV: [mu, mv],
    covV: [suu / WV - mu * mu, suv / WV - mu * mv, svv / WV - mv * mv],
    f: mul(fv, 1 / Math.PI),
    fV: mul(fvV, 1 / Math.PI),
    visP: visN.map((x, k) => (visD[k] ? x / visD[k] : 1)),
    ez,
    // How much of the lobe survives the blocker. The bins at the bottom are cut
    // on it, because a configuration in full light and one in full shadow are
    // both configurations today cannot change.
    open: WV / W,
  }
}

/** `glassFetch`, up to the fetch: the same lines as lobe-error.mjs. */
function footprint(p1, V1, V2, lobe, delta, ff, support = true) {
  const no = crs(V1, V2)
  const A2 = dot(no, no)
  if (A2 < 1e-12) return null
  const dA = dot(no, p1)
  const den = dot(no, lobe)
  const t = dA / den
  const X = Math.abs(den) > 1e-6 && t > 0 ? mul(lobe, t) : mul(no, dA / A2)
  const hit = sub(X, p1)
  const d12 = dot(V1, V2)
  const i11 = 1 / dot(V1, V1)
  const V2p = sub(V2, mul(V1, d12 * i11))
  const v = dot(V2p, hit) / dot(V2p, V2p)
  const u = dot(V1, hit) * i11 - d12 * i11 * v
  const uv = [Math.min(Math.max(u, 0), 1), Math.min(Math.max(v, 0), 1)]
  const r = Math.max(Math.hypot(X[0], X[1], X[2]), 1e-6)
  const w = mul(X, 1 / r)
  const T1 = nrm(Math.abs(w[2]) < 0.99 ? crs([0, 0, 1], w) : crs([1, 0, 0], w))
  const T2 = crs(w, T1)
  const c0 = [dot(T1, V1) / r, dot(T2, V1) / r]
  const c1 = [dot(T1, V2) / r, dot(T2, V2) / r]
  let e = eigenEllipse(c0, c1, delta * N, support ? N / Math.sqrt(3) : 0)
  e = rescale(e, massArea(ff, w[2], e.det, N, MASS_KAPPA))
  return { uv, A: e.A, B: e.B, t: e.t }
}

/**
 * The tap rule with a weight per slab — the day, in five lines.
 *
 * `vis` is a function of the slab's own centre in uv. Passing null is Day 046
 * exactly: the weight is 1, the multiply stays, and the sum is the one
 * `rip.mjs` has been making since yesterday.
 *
 * The divide is still at the end and still one. That is the whole argument:
 * premultiplying by visibility is the same arithmetic as premultiplying by the
 * aperture, so a mean of L over "the glass" becomes a mean of L over "the glass
 * this point can see" without a second fetch or a second accumulator.
 */
function tapVis(uv, A, B, t, vis, opt = {}) {
  const n = tapCount(A, B, opt.max ?? TAP_MAX)
  const ap = A / n
  const ct = Math.cos(t)
  const st = Math.sin(t)
  const [fu, fv] = box(ap, B, t)
  const lu = Math.log2(Math.max(fu, 1))
  const lv = Math.log2(Math.max(fv, 1))
  const span = (A - ap) / N
  const w = slabWeights(n, 'area')
  const out = [0, 0, 0, 0]
  let wsum = 0
  for (let k = 0; k < n; k++) {
    const s = n > 1 ? (2 * k - (n - 1)) / (n - 1) : 0
    const tu = Math.min(Math.max(uv[0] + ct * span * s, 0), 1)
    const tv = Math.min(Math.max(uv[1] + st * span * s, 0), 1)
    const g = vis ? vis(tu, tv) : 1
    const c = ripFetch([tu, tv], lu, lv, true)
    for (let j = 0; j < 4; j++) out[j] += w[k] * g * c[j]
    wsum += w[k]
  }
  for (let j = 0; j < 4; j++) out[j] /= Math.max(wsum, 1e-6)
  return glassMean(out)
}


// --- the kernel, truncated by the blocker's own edge ---------------------------
//
// The tap weights above turned out to be nearly a no-op, and the reason is one
// line of arithmetic rather than a bug: the mean tap count is 1.3, and at one
// tap a scalar multiplies the colour and the coverage alike, so the divide
// cancels it exactly. Weighting slabs can only ever express the *difference*
// between slabs.
//
// What has to move is the region the fetch reads. Day 044 already did this once,
// for the window's own edges: two kernels multiplying is two covariances
// combining, and the answer there was the reciprocal sum because both factors
// were Gaussians. A blocker is not a Gaussian; it is a **half-plane**, and a
// Gaussian truncated by a half-plane also has closed-form moments — the Mills
// ratio, which is one exp and one erf:
//
//     alpha = (c - n.m) / s,      s^2 = n^T S n,     lambda = phi(a) / (1 - Phi(a))
//     m'    = m + S n lambda / s
//     S'    = S - (S n)(S n)^T (lambda^2 - alpha lambda) / s^2
//
// The mean slides *away* from the blocker and the variance shrinks *across* its
// edge and nowhere else, which is exactly what the picture says should happen: a
// surface that can only see the left half of the window should read the left half
// of the window, sharply, and not a blurred average of both halves shifted a
// little. And it works at one tap, because it is the ellipse that moved.
//
// The fit is a plane rather than a step, so the edge is taken where it crosses a
// half: n along the gradient, c where the plane reads 0.5. A plane with no
// gradient has no edge and the whole thing is the identity.
const SQ2PI = Math.sqrt(2 * Math.PI)
const phi = (x) => Math.exp(-0.5 * x * x) / SQ2PI
const PhiC = (x) => 0.5 * (1 - erf(x / Math.SQRT2))   // 1 - Phi(x), the visible tail

/**
 * (A, B, t, uv) truncated to the half-plane { n.(x - 1/2) >= c } in uv.
 *
 * Covariance convention as everywhere else in this series: a uniform ellipse of
 * semi-axes (a, b) has variance (a^2/4, b^2/4) along its own axes, so the ellipse
 * is 2 sqrt(eigenvalue) and the round trip is exact.
 */
function truncate(uv, A, B, t, n, c) {
  const ct = Math.cos(t)
  const st = Math.sin(t)
  const va = (A * A) / 4
  const vb = (B * B) / 4
  // S in texels^2, from the eigenframe.
  const sxx = va * ct * ct + vb * st * st
  const sxy = (va - vb) * ct * st
  const syy = va * st * st + vb * ct * ct
  // The line, in texels: n.(x/N) = c.
  const cx = N * c
  const mx = uv[0] * N
  const my = uv[1] * N
  const sn = [sxx * n[0] + sxy * n[1], sxy * n[0] + syy * n[1]]
  const s2 = n[0] * sn[0] + n[1] * sn[1]
  if (!(s2 > 1e-12)) return { uv, A, B, t }
  const sd = Math.sqrt(s2)
  const alpha = (cx - (n[0] * mx + n[1] * my)) / sd
  // Everything visible, or nothing: the first is the identity, and the second is
  // a shading point the mass factor has already taken to zero.
  if (alpha < -8) return { uv, A, B, t }
  const tail = PhiC(alpha)
  if (!(tail > 1e-6)) return { uv, A, B, t }
  const lam = phi(alpha) / tail
  const k = Math.min(Math.max(lam * lam - alpha * lam, 0), 0.999)
  const nx = mx + (sn[0] / sd) * lam
  const ny = my + (sn[1] / sd) * lam
  const f = k / s2
  const txx = sxx - f * sn[0] * sn[0]
  const txy = sxy - f * sn[0] * sn[1]
  const tyy = syy - f * sn[1] * sn[1]
  // Back to (A, B, t). Half a texel is the floor a box pyramid can express at
  // all; below it the ellipse is a point and the fetch is level 0 either way.
  const tr = 0.5 * (txx + tyy)
  const dsc = Math.sqrt(Math.max(tr * tr - (txx * tyy - txy * txy), 0))
  const l1 = Math.max(tr + dsc, 1e-8)
  const l2 = Math.max(tr - dsc, 1e-8)
  const r0 = [txy, l1 - txx]
  const r1 = [l1 - tyy, txy]
  let ax = r0[0] * r0[0] + r0[1] * r0[1] > r1[0] * r1[0] + r1[1] * r1[1] ? r0 : r1
  const len = Math.hypot(ax[0], ax[1])
  ax = len > 1e-12 ? [ax[0] / len, ax[1] / len] : [1, 0]
  return {
    uv: [Math.min(Math.max(nx / N, 0), 1), Math.min(Math.max(ny / N, 0), 1)],
    A: Math.max(2 * Math.sqrt(l1), 0.5),
    B: Math.max(2 * Math.sqrt(l2), 0.5),
    t: Math.atan2(ax[1], ax[0]),
  }
}

/**
 * The blocker's edge, from the taps' own moments — and the level set of the
 * fitted plane is *not* it.
 *
 * Least squares through a step is a biased way to find the step. For samples
 * with covariance C and a true edge at n.x = c, the regression slope is
 *
 *     k = C^-1 n sigma phi(beta),     beta = (c - n.mu)/sigma,  sigma^2 = n^T C n
 *
 * so two things follow that a level set gets wrong. The plane's gradient is not
 * the edge's normal unless the samples are isotropic — the normal is along
 * **C k**, not k. And the plane crosses one half at
 *
 *     h + beta phi(beta)  =  1/2
 *
 * which is the edge only when beta is 0. At beta = 1 — a point seeing a sixth of
 * the window — the crossing sits 41% further into the dark than the edge does,
 * which is exactly the bin where the level-set rule scored worst.
 *
 * So take the edge from the two statistics the taps estimate best. The direction
 * is C k. The offset comes from the *mean* visibility, which is the mask's own
 * scalar and stands on all forty-eight taps: model the tap positions as a
 * Gaussian of their measured covariance, and the visible fraction is 1 - Phi(beta),
 * so beta is fixed by h alone. No inverse normal is needed — |C k| = sigma phi(beta)
 * gives phi, and h gives the sign.
 */
function edgeFrom(mu, C, k, h) {
  const g = [C[0] * k[0] + C[1] * k[1], C[1] * k[0] + C[2] * k[1]]
  const gl = Math.hypot(g[0], g[1])
  if (!(gl > 1e-9)) return null
  const n = [g[0] / gl, g[1] / gl]
  const s2 = n[0] * (C[0] * n[0] + C[1] * n[1]) + n[1] * (C[1] * n[0] + C[2] * n[1])
  if (!(s2 > 1e-12)) return null
  const sd = Math.sqrt(s2)
  // phi(beta) = |C k| / sigma, capped at the density's own maximum.
  const ph = Math.min(gl / sd, 1 / SQ2PI)
  const beta = Math.sign(0.5 - h) * Math.sqrt(Math.max(-2 * Math.log(SQ2PI * ph), 0))
  return { n, c: n[0] * mu[0] + n[1] * mu[1] + sd * beta }
}

const MEANS = cartoonMeans()
const UNITS = [0, 1, 2].map((c) => MEANS.rect[c] / MEANS.pane[c])
const ref = (tint) => [0, 1, 2].map((c) => tint[c] * UNITS[c])

function err(x, r) {
  let s = 0
  for (let c = 0; c < 3; c++) {
    const d = (x[c] - r[c]) / Math.max(r[c], 1e-4)
    s += d * d
  }
  return Math.sqrt(s / 3)
}

const DELTA = GLASS_K / N
const pct = (x, n) => (100 * Math.sqrt(x / n)).toFixed(2)

process.stdout.write(`integrating ${NC} occluded configurations on a ${NG}x${NG} grid ... `)
const T0 = Date.now()
const SET = []
for (let i = 0; i < NC; i++) {
  const cf = config(i)
  const ex = exact(cf, NG)
  if (!ex) continue
  // The fetch direction is the *visibility-weighted* edge sum, because that is
  // what the shader points it with — Day 041's one unplanned consequence, and it
  // means the fetch already moves toward what is still visible. Everything below
  // is scored on top of that, not instead of it.
  const l = Math.hypot(ex.fV[0], ex.fV[1], ex.fV[2])
  if (l < 1e-9) continue
  const la = Math.hypot(ex.f[0], ex.f[1], ex.f[2])
  SET.push({
    ...cf,
    ...ex,
    lobe: mul(ex.fV, 1 / l),
    ff: ltcClip(ex.fV),
    // The same two numbers from the *unoccluded* edge sum. The shader does not
    // form them — since Day 039 the sum is visibility-weighted — but the
    // question of whether the truncation is double-counting a shrink the mass
    // already applied cannot be asked without them.
    lobeA: la > 1e-9 ? mul(ex.f, 1 / la) : mul(ex.fV, 1 / l),
    ffA: ltcClip(ex.f),
  })
}
console.log(`${((Date.now() - T0) / 1000).toFixed(1)} s, ${SET.length} usable`)

// --- 0. what the taps see -----------------------------------------------------
//
// The estimators below are handed the visibility the *renderer* would have: the
// mask's six area fractions, and a plane fitted to the same forty-eight taps the
// mask is made of. Both are computed here from the exact visibility rather than
// by re-running a shadow map, so what is scored is the description's resolution
// and not the estimator's noise. The noise is real and it is in the frame; it is
// not what this table is about.
const TAPS_PER_PANE = 8
function fitFor(cf) {
  const samples = []
  for (const p of PANES_UV) {
    for (let j = 0; j < TAPS_PER_PANE; j++) {
      // The shader's own stratification: one axis the stratum index, the other
      // the golden-ratio sequence, uniform inside the pane's rectangle.
      const a = (j + 0.5) / TAPS_PER_PANE
      const b = (j * 0.6180339887) % 1
      const u = p.u0 + a * (p.u1 - p.u0)
      const v = p.v0 + b * (p.v1 - p.v0)
      samples.push([u, v, visOf(cf, u, v)])
    }
  }
  return { fit: fitVis(samples), samples }
}

/** The taps' own centroid and covariance — the design the fit was made on. */
function designOf(samples) {
  let n = 0
  let mu = 0
  let mv = 0
  for (const [u, v] of samples) {
    n++
    mu += u
    mv += v
  }
  mu /= n
  mv /= n
  let cuu = 0
  let cuv = 0
  let cvv = 0
  let h = 0
  for (const [u, v, k] of samples) {
    cuu += (u - mu) ** 2
    cuv += (u - mu) * (v - mv)
    cvv += (v - mv) ** 2
    h += k
  }
  return { mu: [mu, mv], C: [cuu / n, cuv / n, cvv / n], h: h / n }
}

// --- 1. the estimators --------------------------------------------------------
console.log(`\n--- the second factor, with a blocker in front of the window ---`)
console.log(`relative RMS error against the visibility-weighted mean over the panes, per cent\n`)

const RULES = [
  ['Day 046  no visibility', null],
  ['  slabs, the mask', { w: (s) => (u, v) => {
    const i = paneAt(u, v)
    return i < 0 ? s.visMean : s.visP[i]
  } }],
  ['  slabs, the fit', { w: (s) => (u, v) => evalVis(s.fit, u, v) }],
  ['  slabs, exact V', { w: (s) => (u, v) => visOf(s, u, v) }],
  ['  truncated, level set', { cut: (s) => {
    const g = Math.hypot(s.fit[1], s.fit[2])
    return g > 1e-6
      ? { n: [s.fit[1] / g, s.fit[2] / g], c: (0.5 - s.fit[0]) / g + 0.5 * (s.fit[1] + s.fit[2]) / g }
      : null
  } }],
  ['Day 047  truncated, moments', { cut: (s) => s.edge }],
  ['  truncated, exact edge', { cut: (s) => ({ n: [-s.nx, -s.ny], c: -s.c0 + 0.5 * (-s.nx - s.ny) }) }],
  ['  the measured kernel', { moments: true }],
  ['  open ellipse, cut exact', { open: true, cut: (s) => ({ n: [-s.nx, -s.ny], c: -s.c0 + 0.5 * (-s.nx - s.ny) }) }],
  ['  open ellipse, cut moments', { open: true, cut: (s) => s.edge }],
  ['  open ellipse, no cut', { open: true }],
]

/** One rule, scored on one configuration. */
function score(s, fp, rule, max = TAP_MAX) {
  if (!rule) return tapVis(fp.uv, fp.A, fp.B, fp.t, null, { max })
  if (rule.open) {
    // The footprint the fetch would have if nothing were in the way: the
    // unoccluded lobe's own direction and its own mass. Every rule above starts
    // from the occluded one, because that is what the renderer has — and the
    // mass it divides by has had the visibility in it since Day 039, so a
    // truncation applied on top of it shrinks the ellipse twice.
    const g = footprint(s.p1, s.V1, s.V2, s.lobeA, DELTA, s.ffA)
    if (!g) return [1, 1, 1]
    const e = rule.cut ? rule.cut(s) : null
    if (!e) return tapVis(g.uv, g.A, g.B, g.t, null, { max })
    const q = truncate(g.uv, g.A, g.B, g.t, e.n, e.c)
    return tapVis(q.uv, q.A, q.B, q.t, null, { max })
  }
  if (rule.w) return tapVis(fp.uv, fp.A, fp.B, fp.t, rule.w(s), { max })
  if (rule.moments) {
    // The ceiling of any rule that describes the visible kernel by an ellipse:
    // the kernel's own first and second moments, measured by the reference and
    // handed straight to the fetch. Not available to a shader — it is the line
    // that says whether the residual is in the *description* or in the filter.
    const [cuu, cuv, cvv] = s.covV
    const tr = 0.5 * (cuu + cvv)
    const dsc = Math.sqrt(Math.max(tr * tr - (cuu * cvv - cuv * cuv), 0))
    const l1 = Math.max(tr + dsc, 1e-12)
    const l2 = Math.max(tr - dsc, 1e-12)
    const r0 = [cuv, l1 - cuu]
    const r1 = [l1 - cvv, cuv]
    let ax = r0[0] * r0[0] + r0[1] * r0[1] > r1[0] * r1[0] + r1[1] * r1[1] ? r0 : r1
    const len = Math.hypot(ax[0], ax[1])
    ax = len > 1e-12 ? [ax[0] / len, ax[1] / len] : [1, 0]
    return tapVis(s.meanV, 2 * Math.sqrt(l1) * N, 2 * Math.sqrt(l2) * N,
                  Math.atan2(ax[1], ax[0]), null, { max })
  }
  const e = rule.cut(s)
  if (!e) return tapVis(fp.uv, fp.A, fp.B, fp.t, null, { max })
  const g = truncate(fp.uv, fp.A, fp.B, fp.t, e.n, e.c)
  return tapVis(g.uv, g.A, g.B, g.t, null, { max })
}

const OPEN_BINS = [0.15, 0.45, 0.75, 0.95, 1.0001]
const openLabel = [
  'under 15% visible',
  '15 - 45%',
  '45 - 75%',
  '75 - 95%',
  'over 95% visible',
]
const rows = OPEN_BINS.map(() => ({ n: 0, s: RULES.map(() => 0) }))
let gap = 0
for (const s of SET) {
  const fp = footprint(s.p1, s.V1, s.V2, s.lobe, DELTA, s.ff)
  if (!fp) continue
  const ff = fitFor(s)
  s.fit = ff.fit
  const dz = designOf(ff.samples)
  s.edge = (() => {
    const e = edgeOf(dz.mu, dz.C, [s.fit[1], s.fit[2]], dz.h)
    return e ? { n: [e[0], e[1]], c: e[2] } : null
  })()
  s.visMean = s.visP.reduce((a, b) => a + b, 0) / s.visP.length
  const bi = Math.min(OPEN_BINS.findIndex((q) => s.open < q), OPEN_BINS.length - 1)
  const row = rows[bi < 0 ? OPEN_BINS.length - 1 : bi]
  row.n++
  const r = ref(s.tintV)
  RULES.forEach(([, rule], k) => {
    const e = err(score(s, fp, rule), r)
    row.s[k] += e * e
  })
  // How far the two references are apart at all — the size of the thing today is
  // trying to correct, before any rule is applied to it.
  const d = err(ref(s.tint), r)
  gap += d * d
}
console.log(`  visible fraction        ${RULES.map(([l]) => l.padStart(24)).join('')}      n`)
rows.forEach((r, i) => {
  if (!r.n) return
  console.log(
    `  ${openLabel[i].padEnd(18)}${r.s.map((x) => pct(x, r.n).padStart(24)).join('')}   ${String(r.n).padStart(4)}`
  )
})
{
  const all = rows.reduce((a, r) => ({ n: a.n + r.n, s: a.s.map((x, k) => x + r.s[k]) }), {
    n: 0,
    s: RULES.map(() => 0),
  })
  console.log(
    `  ${'all'.padEnd(18)}${all.s.map((x) => pct(x, all.n).padStart(24)).join('')}   ${String(all.n).padStart(4)}`
  )
  console.log(
    `\n  the two references differ by ${pct(gap, all.n)}% — the whole of what today is about`
  )
}

// --- 2. the tap budget, which is where the mechanism's own limit is -----------
//
// The slabs run along the major axis, so the fit is sampled n times across the
// footprint's long direction and once across its short one. If the day's error
// were dominated by that, more slabs would buy more; if it is dominated by the
// model, they would not. The renderer's budget is 4 and the mean count is under
// 1.4, so most of this table is about the few pixels where the lobe is long.
console.log(`\n--- the same rule, at other tap budgets ---\n`)
console.log(`     budget      Day 046   slabs, fit    truncated   mean taps`)
for (const max of [1, 2, 4, 8, 16]) {
  let a = 0
  let b = 0
  let c = 0
  let taps = 0
  let n = 0
  for (const s of SET) {
    const fp = footprint(s.p1, s.V1, s.V2, s.lobe, DELTA, s.ff)
    if (!fp) continue
    const r = ref(s.tintV)
    a += err(score(s, fp, null, max), r) ** 2
    b += err(score(s, fp, RULES[2][1], max), r) ** 2
    c += err(score(s, fp, RULES[5][1], max), r) ** 2
    taps += tapCount(fp.A, fp.B, max)
    n++
  }
  const mark = max === TAP_MAX ? '  <- today' : ''
  console.log(
    `  ${String(max).padStart(9)}${pct(a, n).padStart(13)}${pct(b, n).padStart(13)}` +
      `${pct(c, n).padStart(13)}   ${(taps / n).toFixed(2).padStart(9)}${mark}`
  )
}

// --- 3. the audit -------------------------------------------------------------
//
// With no blocker the day has to be the identity, exactly: the fit is the
// constant 1, every weight is 1, and the sum is yesterday's. Anything but a zero
// in the second column would mean the multiply is not where it is claimed to be.
console.log(`\n--- with the blocker removed, today must be yesterday ---\n`)
{
  let a = 0
  let b = 0
  let d = 0
  let n = 0
  for (const s of SET) {
    const fp = footprint(s.p1, s.V1, s.V2, s.lobe, DELTA, s.ff)
    if (!fp) continue
    const r = ref(s.tint)
    const y = tapVis(fp.uv, fp.A, fp.B, fp.t, null)
    // No blocker means a fit with no gradient, and a plane with no gradient has
    // no edge for the truncation to use — so this is the identity by the same
    // branch the shader takes, not by a second path.
    const t = score({ ...s, edge: null }, fp, RULES[5][1])
    a += err(y, r) ** 2
    b += err(t, r) ** 2
    d = Math.max(d, Math.max(...[0, 1, 2].map((c) => Math.abs(y[c] - t[c]))))
    n++
  }
  console.log(`  Day 046 ${pct(a, n)}%   today with V = 1 ${pct(b, n)}%   largest difference ${d.toExponential(1)}`)
}
console.log(`\n  MASS_KAPPA = ${MASS_KAPPA}, taps <= ${TAP_MAX}, delta = ${DELTA}`)

// --- 4. the mask itself, which is the other half of "granularity six" ---------
//
// Everything above scores the *tint*. The mask's six numbers are spent on the
// other factor — they weight the six polygons of the LTC sum — and there they are
// not a resolution limit but an *estimator*: eight Bernoulli trials per pane,
// decorrelated per pixel, standing behind a number the shader multiplies an edge
// sum by. Day 039 doubled the budget to 48 for exactly this reason and wrote
// down that a per-pane estimate has a sixth of the samples the average has.
//
// Once the taps have found the line, that estimator can be retired. A pane is a
// rectangle and a rectangle cut by a line has an exact area, so the same
// forty-eight taps decide *where the edge is* — three numbers, all forty-eight
// voting — and geometry decides how much of each pane is behind it.
//
// Scored the way an estimator has to be, over the decorrelation offset rather
// than over the geometry: the same configuration, sampled at many per-pixel
// shifts, against the exact per-pane visibility. That is the noise a surface
// actually shows.
console.log(`\n--- the per-pane mask: eight trials, or one line and a clip ---\n`)
{
  const SHIFTS = 24
  let mc = 0
  let an = 0
  let mcB = 0
  let anB = 0
  let ex = 0
  let cn = 0
  let n = 0
  for (const s of SET) {
    for (let q = 0; q < SHIFTS; q++) {
      const off = [halton(q + 1, 2), halton(q + 1, 3)]
      // The shader's own stratification, shifted per pixel and per pane.
      const samples = []
      const est = []
      PANES_UV.forEach((p, i) => {
        let acc = 0
        for (let j = 0; j < TAPS_PER_PANE; j++) {
          const ph = [(i * 0.3819660) % 1, (i * 0.1701102) % 1]
          const a = ((j + 0.5) / TAPS_PER_PANE + off[0] + ph[0]) % 1
          const b = ((j * 0.6180339887) % 1 + off[1] + ph[1]) % 1
          const u = p.u0 + a * (p.u1 - p.u0)
          const v = p.v0 + b * (p.v1 - p.v0)
          const h = visOf(s, u, v)
          acc += h
          samples.push([u, v, h])
        }
        est.push(acc / TAPS_PER_PANE)
      })
      const fit = fitVis(samples)
      const dz = (() => {
        let mu = 0
        let mv = 0
        for (const [u, v] of samples) {
          mu += u
          mv += v
        }
        mu /= samples.length
        mv /= samples.length
        let cuu = 0
        let cuv = 0
        let cvv = 0
        let h = 0
        for (const [u, v, k] of samples) {
          cuu += (u - mu) ** 2
          cuv += (u - mu) * (v - mv)
          cvv += (v - mv) ** 2
          h += k
        }
        const m = samples.length
        return { mu: [mu, mv], C: [cuu / m, cuv / m, cvv / m], h: h / m }
      })()
      const e = edgeOf(dz.mu, dz.C, [fit[1], fit[2]], dz.h)
      // And the same clip given the *exact* normal, with the offset placed by
      // bisection so that the visible area over the six panes matches the
      // measured mean h. That is the best any line-and-clip rule can do short of
      // being told the answer, and it says whether the loss below is the
      // direction, the offset, or the idea.
      // The direction, the other obvious way: the clear taps' centroid minus the
      // blocked taps'. For a half-plane through any design that difference points
      // along the normal, and it is a *difference of two means* rather than a
      // regression slope — no matrix, no conditioning, every tap voting once.
      const cd = (() => {
        let au = 0, av = 0, aw = 0, bu = 0, bv = 0, bw = 0
        for (const [u, v, h] of samples) {
          if (h > 0.5) { au += u; av += v; aw++ } else { bu += u; bv += v; bw++ }
        }
        if (aw < 1 || bw < 1) return null
        const dx = au / aw - bu / bw
        const dy = av / aw - bv / bw
        const l = Math.hypot(dx, dy)
        return l > 1e-9 ? [dx / l, dy / l] : null
      })()
      /** The offset that makes the clipped area over the panes match h. */
      const offsetFor = (nn) => {
        let lo = -2, hi = 3
        for (let k = 0; k < 24; k++) {
          const m = 0.5 * (lo + hi)
          let a = 0, w = 0
          PANES_UV.forEach((p) => {
            const ar = (p.u1 - p.u0) * (p.v1 - p.v0)
            a += clipFrac(p, nn, m) * ar
            w += ar
          })
          if (a / w > dz.h) lo = m
          else hi = m
        }
        return 0.5 * (lo + hi)
      }
      const nx = [-s.nx, -s.ny]
      const cx = offsetFor(nx)
      const cc = cd ? offsetFor(cd) : 0
      PANES_UV.forEach((p, i) => {
        const truth = s.visP[i]
        const a = e ? clipFrac(p, [e[0], e[1]], e[2]) : dz.h > 0.5 ? 1 : 0
        mc += (est[i] - truth) ** 2
        an += (a - truth) ** 2
        ex += (clipFrac(p, nx, cx) - truth) ** 2
        cn += (cd ? clipFrac(p, cd, cc) - truth : est[i] - truth) ** 2
        mcB += est[i] - truth
        anB += a - truth
        n++
      })
    }
  }
  const rms = (x) => (100 * Math.sqrt(x / n)).toFixed(2)
  const bias = (x) => (100 * (x / n)).toFixed(2)
  console.log(`     ${SHIFTS} decorrelation shifts x ${SET.length} configurations x 6 panes`)
  console.log(`                          RMS %     bias %`)
  console.log(`  eight trials a pane  ${rms(mc).padStart(8)}${bias(mcB).padStart(11)}`)
  console.log(`  the line, clipped    ${rms(an).padStart(8)}${bias(anB).padStart(11)}`)
  console.log(`  centroid normal      ${rms(cn).padStart(8)}`)
  console.log(`  exact normal         ${rms(ex).padStart(8)}    (both with the offset fitted from h)`)
}

// --- 5. so where *is* the error? ---------------------------------------------
//
// The oracle above — the visible kernel's own first and second moments, handed
// straight to the fetch — is half the error of what ships. That is the largest
// number on the page and it is not about visibility at all: the same oracle
// would win by the same margin with nothing in the way. So the ablation below
// takes the rule's ellipse and replaces one part of it at a time with the
// measured one, which is the only way to know whether tomorrow's morning belongs
// to the centre, the shape or the size.
console.log(`\n--- the rule's ellipse, one part at a time replaced by the measured one ---\n`)
{
  const moments = (s) => {
    const [cuu, cuv, cvv] = s.covV
    const tr = 0.5 * (cuu + cvv)
    const dsc = Math.sqrt(Math.max(tr * tr - (cuu * cvv - cuv * cuv), 0))
    const l1 = Math.max(tr + dsc, 1e-12)
    const l2 = Math.max(tr - dsc, 1e-12)
    const r0 = [cuv, l1 - cuu]
    const r1 = [l1 - cvv, cuv]
    let ax = r0[0] * r0[0] + r0[1] * r0[1] > r1[0] * r1[0] + r1[1] * r1[1] ? r0 : r1
    const len = Math.hypot(ax[0], ax[1])
    ax = len > 1e-12 ? [ax[0] / len, ax[1] / len] : [1, 0]
    return { A: 2 * Math.sqrt(l1) * N, B: 2 * Math.sqrt(l2) * N, t: Math.atan2(ax[1], ax[0]) }
  }
  // The centre the shader could form for nothing: each pane's own rectangle
  // centre, weighted by the mass the lobe puts on that pane — vis_i . max(e_i.z, 0),
  // the exact pair of numbers `ltcVector` already multiplies together for the
  // chromaticity sum. Six centres and six weights; no fetch, no ray, no plane
  // intersection.
  const massCentre = (s) => {
    let wu = 0
    let wv = 0
    let w = 0
    PANES_UV.forEach((p, i) => {
      const q = s.visP[i] * Math.max(s.ez[i], 0)
      wu += q * 0.5 * (p.u0 + p.u1)
      wv += q * 0.5 * (p.v0 + p.v1)
      w += q
    })
    return w > 1e-12 ? [wu / w, wv / w] : null
  }
  // The window's own four edges, applied with today's truncation instead of
  // Day 044's reciprocal variances. A box is the intersection of four
  // half-planes; a Gaussian truncated by a half-plane has closed-form moments;
  // so the opening's effect on the kernel is four applications of the same two
  // lines the blocker gets. Day 044 modelled the opening as a *Gaussian factor*,
  // which shrinks correctly and shifts far too much — its own NOTES recorded the
  // shift losing 2.7 points and shipped the shrink alone.
  const cutSquare = (f) => {
    let g = f
    g = truncate(g.uv, g.A, g.B, g.t, [1, 0], 0)
    g = truncate(g.uv, g.A, g.B, g.t, [-1, 0], -1)
    g = truncate(g.uv, g.A, g.B, g.t, [0, 1], 0)
    g = truncate(g.uv, g.A, g.B, g.t, [0, -1], -1)
    return g
  }
  const VARIANTS = [
    ['open mass + cut, exact', (s, f) => {
      const g = footprint(s.p1, s.V1, s.V2, s.lobe, DELTA, s.ffA)
      if (!g) return f
      return truncate(g.uv, g.A, g.B, g.t, [-s.nx, -s.ny], -s.c0 + 0.5 * (-s.nx - s.ny))
    }],
    ['open mass + cut, moments', (s, f) => {
      const g = footprint(s.p1, s.V1, s.V2, s.lobe, DELTA, s.ffA)
      if (!g || !s.edge) return f
      return truncate(g.uv, g.A, g.B, g.t, s.edge.n, s.edge.c)
    }],
    ['no support, cut: shape', (s, f) => {
      const g = footprint(s.p1, s.V1, s.V2, s.lobe, DELTA, s.ff, false)
      if (!g) return f
      const q = cutSquare(g)
      return { uv: g.uv, A: q.A, B: q.B, t: q.t }
    }],
    ['no support, cut: both', (s, f) => {
      const g = footprint(s.p1, s.V1, s.V2, s.lobe, DELTA, s.ff, false)
      return g ? cutSquare(g) : f
    }],
    ['no support at all', (s, f) => footprint(s.p1, s.V1, s.V2, s.lobe, DELTA, s.ff, false) || f],
    ['+ the opening, truncated', (s, f) => cutSquare(f)],
    ['  that, centre only', (s, f) => ({ ...f, uv: cutSquare(f).uv })],
    ['  that, shape only', (s, f) => {
      const g = cutSquare(f)
      return { uv: f.uv, A: g.A, B: g.B, t: g.t }
    }],
    ['the pane-mass centre', (s, f) => {
      const c = massCentre(s)
      return c ? { ...f, uv: c } : f
    }],
    ['half way to it', (s, f) => {
      const c = massCentre(s)
      return c ? { ...f, uv: [0.5 * (c[0] + f.uv[0]), 0.5 * (c[1] + f.uv[1])] } : f
    }],
    ['what ships (Day 046)', (s, f, m) => f],
    ['+ the measured centre', (s, f, m) => ({ ...f, uv: s.meanV })],
    ['+ the measured area', (s, f, m) => {
      const g = Math.sqrt((m.A * m.B) / Math.max(f.A * f.B, 1e-12))
      return { ...f, A: f.A * g, B: f.B * g }
    }],
    ['+ the measured shape', (s, f, m) => {
      const g = Math.sqrt((f.A * f.B) / Math.max(m.A * m.B, 1e-12))
      return { uv: f.uv, A: m.A * g, B: m.B * g, t: m.t }
    }],
    ['all three (the oracle)', (s, f, m) => ({ uv: s.meanV, ...m })],
  ]
  for (const [label, make] of VARIANTS) {
    let e = 0
    let n = 0
    for (const s of SET) {
      const fp = footprint(s.p1, s.V1, s.V2, s.lobe, DELTA, s.ff)
      if (!fp) continue
      const g = make(s, fp, moments(s))
      e += err(tapVis(g.uv, g.A, g.B, g.t, null), ref(s.tintV)) ** 2
      n++
    }
    console.log(`  ${label.padEnd(24)}${pct(e, n).padStart(8)}`)
  }
}
