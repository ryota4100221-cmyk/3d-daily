// What is the fetch a stand-in *for*? Measured against that, rather than
// against the last three days' idea of it.
//
//   node scripts/lobe-error.mjs [configs] [grid]
//
// Days 041 through 043 all scored themselves against the same reference: the
// unweighted mean of the window's image over an ellipse. That reference has a
// constant in it. The ellipse is the preimage of a disc of angular radius
// delta = GLASS_K / GLASS_SIZE = 0.5 rad, and 0.5 was picked by eye on Day 041,
// against the sharpest surface in the frame, and never examined again. Every
// improvement since has been an improvement in how *that* ellipse is sampled.
//
// Day 043's NOTES put this at the top of its own list, and put it correctly:
// **the ground truth may itself have been an approximation.** It was. Here is
// the thing it approximates.
//
// The shading integral, once the LTC transform has been applied, is over a
// polygon with a clamped cosine on it:
//
//     I = integral over P of L(w) D(w) dw,     D(w) = max(w_z, 0) / pi
//
// and the whole method is to factor it as (a scalar) x (a colour), where the
// scalar is the LTC edge integral — exact, already computed, not in question —
// and the colour is
//
//     tint = integral of L D dw / integral of D dw
//
// the **D-weighted mean of the window's image over the whole window**. That is
// computable by brute force, and it is what this file computes. Three things
// about it are not true of the old reference:
//
//   1. It is weighted. The lobe is heavy in the middle and reaches zero at the
//      horizon; the old reference weighed every point of an ellipse the same.
//   2. It has no delta in it. Its extent is set by the polygon and by the lobe,
//      both of which are geometry, and the answer to "what should delta be" is
//      therefore a measurement rather than a choice.
//   3. It is clipped by the opening. Outside [0,1]^2 there is nothing to
//      average, and a kernel wider than the window is the whole window — not a
//      clamped fetch of part of it.
//
// Everything below is done in the transformed space, where the lobe is a clamped
// cosine about +z by construction and the source is a general parallelogram.
// That is the space `glassFetch` already works in, so **one harness covers both
// lobes**: the diffuse call is the identity transform and the two glazes are the
// same code with the polygon stretched by the LTC matrix.
//
// ---------------------------------------------------------------------------
// Day 045 added two things to this file, and the second is the day.
//
//   **The reference now runs over the panes.** Yesterday it integrated the
//   bounding rectangle — stone and all — because that is the rectangle the fetch
//   reads. But the integral being factored is over the *source*, and the source
//   is six openings in three tiers: that is the domain `ltcVector` sums over,
//   and it is what the scalar it hands back is the mass of. `--domain=square`
//   restores yesterday's reference exactly, and both are printed, because a day
//   that moves its own ground truth has to show the move.
//
//   **The footprint's area is measured rather than chosen.** The kernel's mass
//   is pi.ltcClip(f) and its peak is w_z.|det J|, both already on the shader's
//   stack, and mass over peak is an area. See `massArea` in src/footprint.js.
//   delta and the support constant both leave the size; one dimensionless
//   profile constant arrives, and this file measures it.
//
// ---------------------------------------------------------------------------
// Day 046 adds one rule and one conversion, and the conversion is the part that
// would have been a silent error.
//
//   **The masked atlas is in different units.** The pyramid is normalised so
//   that what the fetch *returns* is white for a lobe covering the whole window,
//   and from today the fetch returns rgb/a — so the constant divided out moves
//   from the rectangle's mean to the coverage-weighted one. The reference below
//   is integrated in the old build's units, and scoring the new fetch against it
//   unconverted would charge the day for a change of exposure. The ratio comes
//   from `cartoonMeans`, which measures both from the same raw cartoon.
import { WINDOW, LIGHT, lightPosition, buildWindow } from '../src/palette.js'
import { GLASS_K, cartoonMeans } from '../src/glass.js'
import {
  TAP_MAX,
  tapCount,
  slabWeights,
  SUPPORT_VAR,
  MASS_KAPPA,
  massArea,
  tiltCentre,
  TILT_GAIN,
} from '../src/footprint.js'
import { cells, ripFetch, box, eigenEllipse, rescale, tapRule, N } from './rip.mjs'

const NC = Number(process.argv[2] || 256) // configurations
const NG = Number(process.argv[3] || 384) // grid, per axis, for the exact answer
// 'panes' is today's reference; 'square' is Day 044's, kept so the two can be
// printed side by side rather than argued about.
const DOMAIN =
  (process.argv.find((a) => a.startsWith('--domain=')) || '').split('=')[1] || 'panes'

/**
 * The six openings, as rectangles in the bounding quad's own uv.
 *
 * The quad spans [-tan(bx), tan(bx)] x [-tan(by), tan(by)] on the window's
 * plane, and a pane spans [tan(cx - hx), tan(cx + hx)] — the same tan() the
 * shader builds its pane corners with, not the small-angle version, because the
 * head tier sits ten degrees off the axis and the difference is visible as a
 * modelling error rather than as an approximation.
 */
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

function inSource(u, v) {
  if (DOMAIN === 'square') return true
  for (const p of PANES_UV) {
    if (u >= p.u0 && u <= p.u1 && v >= p.v0 && v <= p.v1) return true
  }
  return false
}

/** ltcClip, as the shader has it: Heitz's horizon fit on the vector form factor. */
function ltcClip(f) {
  const l = Math.hypot(f[0], f[1], f[2])
  return Math.max((l * l + f[2]) / (l + 1), 0)
}

// --- vectors, three at a time -------------------------------------------------
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

// --- the source image, without an allocation per sample -----------------------
//
// The exact answer costs NG^2 texture reads per configuration, so the reference
// gets its own level-0 sampler that writes into a caller's array. `rip.mjs`'s
// `cell` is the same arithmetic and is used by every rule below; this one exists
// only because 38 million three-element arrays is a minute of garbage collection.
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

/**
 * The exact answer, and the two vectors the shader is handed on the way to its
 * approximation of it.
 *
 * Weight at (u, v): the lobe's density times the change of variables from the
 * plane to the sphere. Both are one line, because the Jacobian of X -> X/|X| on
 * a plane is the projected area over the squared distance:
 *
 *     dw/dA = |(V1 x V2) . w| / r^2
 *
 * so the integral over solid angle becomes an integral over the unit square with
 * no reparametrisation and no missing cosine.
 *
 * Returns:
 *   tint    the D-weighted mean of L — the thing glassFetch approximates
 *   f       the polygon's vector irradiance, integral of w dw / pi, which is what
 *           the LTC edge sum computes and what the shader normalises to get its
 *           fetch direction. Computed here without the cosine, exactly as the
 *           edge sum does, so the comparison is against the direction the shader
 *           will actually use and not against a better one.
 *   mean    the first moment of the *weighted* kernel, in uv, and
 *   cov     its second moment. Neither is available to the shader. They are what
 *           the ellipse would be if the ellipse were measured, and the whole
 *           point of the sweep at the bottom is how close a rule gets to them.
 */
function exact(p1, V1, V2, grid) {
  const nq = crs(V1, V2)
  const c = [0, 0, 0]
  let W = 0
  const num = [0, 0, 0]
  const fv = [0, 0, 0]
  // The same vector integral over the bounding rectangle, stone included. Day
  // 045's rule divides by the mass, and the whole claim about the aperture's
  // shape is that the *panes'* mass is the right one — so the solid rectangle's
  // has to be scored beside it, with kappa free, or the claim is untested.
  const fq = [0, 0, 0]
  let mu = 0
  let mv = 0
  let suu = 0
  let svv = 0
  let suv = 0
  const step = 1 / grid
  for (let j = 0; j < grid; j++) {
    const v = (j + 0.5) * step
    for (let i = 0; i < grid; i++) {
      const u = (i + 0.5) * step
      const X = [
        p1[0] + u * V1[0] + v * V2[0],
        p1[1] + u * V1[1] + v * V2[1],
        p1[2] + u * V1[2] + v * V2[2],
      ]
      const r2 = dot(X, X)
      if (r2 < 1e-12) continue
      const r = Math.sqrt(r2)
      const wz = X[2] / r
      // dw, the solid angle of this cell. The vector irradiance wants it without
      // the lobe; the tint wants it with.
      const dw = (Math.abs(dot(nq, X) / r) / r2) * step * step
      fq[0] += (X[0] / r) * dw
      fq[1] += (X[1] / r) * dw
      fq[2] += wz * dw
      if (!inSource(u, v)) continue
      fv[0] += (X[0] / r) * dw
      fv[1] += (X[1] / r) * dw
      fv[2] += wz * dw
      if (wz <= 0) continue
      const w = wz * dw
      sample0(u, v, c)
      num[0] += w * c[0]
      num[1] += w * c[1]
      num[2] += w * c[2]
      W += w
      mu += w * u
      mv += w * v
      suu += w * u * u
      svv += w * v * v
      suv += w * u * v
    }
  }
  if (W < 1e-12) return null
  mu /= W
  mv /= W
  return {
    tint: num.map((x) => x / W),
    f: mul(fv, 1 / Math.PI),
    fq: mul(fq, 1 / Math.PI),
    mean: [mu, mv],
    cov: [suu / W - mu * mu, suv / W - mu * mv, svv / W - mv * mv],
    // Day 045. The kernel's mass, exactly — integral of max(w_z,0) dw over the
    // source. The shader does not have this; it has pi.ltcClip(f), which is the
    // same number up to Heitz's horizon fit, and how far apart the two are is
    // printed below because today's rule divides by it.
    mass: W,
  }
}

/**
 * `glassFetch`, up to the fetch itself: where on the window the lobe looks, and
 * the ellipse it looks through. Line for line the GLSL in src/ltc.js, given the
 * same three vectors and the same direction, so that what is scored below is the
 * shader's arithmetic and not a tidier version of it.
 */
function footprint(p1, V1, V2, lobe, delta, support, mass = null, tilt = 0) {
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

  // delta is an angle; the ellipse wants texels, so delta*N is the constant, and
  // delta*N is exactly GLASS_K. The support half-width is in the same units.
  let e = eigenEllipse(c0, c1, delta * N, support ? N / Math.sqrt(3) : 0)

  // --- Day 045: the area, off the radiometry -------------------------------
  //
  // `mass` is { ff, kappa }: the clipped form factor the shader already has, and
  // the profile constant swept at the bottom of this file. The peak of the
  // kernel is the lobe's density at the fetch point times the uv -> solid angle
  // stretch there, and mass over peak is an area. Aspect and orientation are
  // untouched — `rescale` multiplies both semi-axes by one number — so what is
  // scored below is a change of size and nothing else.
  //
  // w[2] is the fetch direction's z, which is the direction actually used: in
  // the fallback branch it is the plane's own normal and not the lobe, exactly
  // as it is for the Jacobian three lines above.
  if (mass) {
    const ab = massArea(mass.ff, w[2], e.det, N, mass.kappa ?? MASS_KAPPA)
    e = rescale(e, ab)
  }
  if (support === 'both') {
    // The other half of the same derivation. Multiplying two Gaussians moves the
    // mean as well as shrinking the variance, and the second one here is the
    // window's own support, centred at (0.5, 0.5). In the ellipse's eigenframe
    // the pull along each axis is that axis's share of the support's variance —
    // zero for a lobe far inside the opening, total for one that covers it — so
    // this is the hard clamp of uv into [0,1] replaced by the thing the clamp was
    // a crude stand-in for.
    const ca = Math.cos(e.t)
    const sa = Math.sin(e.t)
    const ex = (0.5 - uv[0]) * N
    const ey = (0.5 - uv[1]) * N
    const ea = ca * ex + sa * ey
    const eb = -sa * ex + ca * ey
    const fa = (3 * e.A * e.A) / (N * N)
    const fb = (3 * e.B * e.B) / (N * N)
    const sx = ca * (fa * ea) - sa * (fb * eb)
    const sy = sa * (fa * ea) + ca * (fb * eb)
    uv[0] = Math.min(Math.max(uv[0] + sx / N, 0), 1)
    uv[1] = Math.min(Math.max(uv[1] + sy / N, 0), 1)
  }
  // --- Day 048: the centre, tilted onto the kernel --------------------------
  //
  // Last, because the tilt is measured in units of the finished ellipse's own
  // half-lengths — the support and the mass have both had their say about how
  // wide the slab is before it is asked which way it leans.
  let step = 0
  if (tilt > 0) {
    const c = tiltCentre(uv, e.A, e.B, e.t, V1, V2, X, r, N, tilt)
    uv[0] = c[0]
    uv[1] = c[1]
    step = c[2]
  }
  // The isotropic circle Day 041 read, restored the way the shader restores it:
  // d = distance / sqrt(area), which is the geometric mean of the semi-axes.
  const iso = (Math.abs(dA) / Math.pow(A2, 0.75)) * delta * N
  return { uv, A: e.A, B: e.B, t: e.t, iso, step }
}

// --- the configurations -------------------------------------------------------
//
// Not random: the frame's own geometry, swept. The opening is 13 by 21 degrees
// at 24 units, so its half-extents are tan(half) * dist, and everything that
// receives light in this piece is within about seven units of the light's
// target. Normals cover the hemisphere that can see the opening at all,
// including grazing, because grazing is where the footprint is longest.
//
// The transform is the other half, and it is the half that sets the scale. For
// the diffuse lobe it is the shading frame's rotation and nothing else; for a
// glaze the LTC matrix stretches the polygon by roughly 1/alpha across the
// reflection, and alpha is roughness squared, so the near tablet at 0.050 pulls
// the window out by a factor in the hundreds and its footprint closes to a few
// texels. Sweeping the two scales log-uniformly over [1, 256] independently
// covers the stone, both tablets and everything between, and it covers them at
// every eccentricity rather than only the two the frame happens to contain.
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
  // the shading point: near the light's target, spread over the room
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

  // the normal: anywhere on the hemisphere that can see the opening
  const toC = nrm(sub(C, P))
  const h1 = halton(i + 1, 3)
  const h2 = halton(i + 1, 5)
  const cz = 0.02 + 0.98 * h1 // 0 would be a surface edge-on to the window
  const sz = Math.sqrt(Math.max(1 - cz * cz, 0))
  const pa = 2 * Math.PI * h2
  const B1 = nrm(Math.abs(toC[1]) < 0.9 ? crs([0, 1, 0], toC) : crs([1, 0, 0], toC))
  const B2 = crs(toC, B1)
  const nS = nrm([
    toC[0] * cz + (B1[0] * Math.cos(pa) + B2[0] * Math.sin(pa)) * sz,
    toC[1] * cz + (B1[1] * Math.cos(pa) + B2[1] * Math.sin(pa)) * sz,
    toC[2] * cz + (B1[2] * Math.cos(pa) + B2[2] * Math.sin(pa)) * sz,
  ])

  // the shading frame, then the LTC stretch inside it
  const T1 = nrm(Math.abs(nS[1]) < 0.9 ? crs([0, 1, 0], nS) : crs([1, 0, 0], nS))
  const T2 = crs(nS, T1)
  const g1 = 2 ** (8 * halton(i + 1, 7)) // 1 .. 256
  const g2 = 2 ** (8 * halton(i + 1, 11))
  const ps = Math.PI * halton(i + 1, 13)
  const cs = Math.cos(ps)
  const ss = Math.sin(ps)
  // M = shading frame, then a rotation by ps in the tangent plane, then diag.
  const M = [
    g1 * (cs * T1[0] + ss * T2[0]), g1 * (cs * T1[1] + ss * T2[1]), g1 * (cs * T1[2] + ss * T2[2]),
    g2 * (-ss * T1[0] + cs * T2[0]), g2 * (-ss * T1[1] + cs * T2[1]), g2 * (-ss * T1[2] + cs * T2[2]),
    nS[0], nS[1], nS[2],
  ]

  const o = sub(C, P)
  const ax = mul(AX, HX)
  const ay = mul(AY, HY)
  const p1 = mat(M, sub(sub(o, ax), ay))
  const V1 = mat(M, mul(ax, 2))
  const V2 = mat(M, mul(ay, 2))
  return { p1, V1, V2 }
}

// --- the rules ----------------------------------------------------------------
//
// Every one of them is handed the same fetch direction, from the same vector
// irradiance, so what is being compared is the footprint and only the footprint.
const RULES = [
  ['Day 041  one circle', (fp) => ripFetch(fp.uv, lg(fp.iso), lg(fp.iso)).slice(0, 3)],
  ['Day 042  a level pair', (fp) => {
    const [bu, bv] = box(fp.A, fp.B, fp.t)
    return ripFetch(fp.uv, lg(bu), lg(bv)).slice(0, 3)
  }],
  ['Day 043  4 taps, area', (fp) => tapRule(fp.uv, fp.A, fp.B, fp.t, { weights: 'area' })],
  ['Day 044  + the support', null], // scored from its own footprint, below
  ['Day 045  area measured', null],
  ['Day 046  masked pyramid', null], // the same footprint, on the other atlas
  ['Day 048  centre tilted', null],
]

// Which footprint each of the three later rules asks for, and which atlas it
// reads. Day 046 differs from Day 045 in the last column and in nothing else:
// same ellipse, same taps, same cells, one more channel.
const LATE = [
  { supp: 'size', mass: false, masked: false },
  { supp: 'size', mass: true, masked: false },
  { supp: 'size', mass: true, masked: true },
  { supp: 'size', mass: true, masked: true, tilt: Number(process.env.TILT ?? TILT_GAIN) },
]
const lg = (x) => Math.log2(Math.max(x, 1))

// Day 046. The masked pyramid divides out the coverage-weighted mean where the
// unmasked one divides out the rectangle's, so a fetch of the first is the same
// radiance in different units. Per channel, and it is about a per cent — small,
// systematic, and exactly the size of thing that turns into "the day improved
// nothing" or "the day improved everything" depending on its sign.
const MEANS = cartoonMeans()
// NOUNITS=1 removes the conversion, which is not a mode anyone should render in
// — it is the control that says how much of today is the conversion. Measured:
// 4.37 with it, 5.71 without, so leaving it out would have reported the mask as
// worth 0.06 points and the morning would have been spent looking for a bug in
// the mask. See NOTES.
const UNITS = process.env.NOUNITS ? [1, 1, 1] : [0, 1, 2].map((c) => MEANS.rect[c] / MEANS.pane[c])

/** The reference, in the units of the atlas the rule reads. See UNITS above. */
function ref(tint, masked) {
  return masked ? [0, 1, 2].map((c) => tint[c] * UNITS[c]) : tint
}

/** Relative RMS error of a colour against the exact one, over the three channels. */
function err(x, ref) {
  let s = 0
  for (let c = 0; c < 3; c++) {
    const d = (x[c] - ref[c]) / Math.max(ref[c], 1e-4)
    s += d * d
  }
  return Math.sqrt(s / 3)
}

// Build the configurations once; every sweep below re-scores the same ones.
process.stdout.write(`integrating ${NC} configurations on a ${NG}x${NG} grid ... `)
const T0 = Date.now()
const SET = []
for (let i = 0; i < NC; i++) {
  const cf = config(i)
  const ex = exact(cf.p1, cf.V1, cf.V2, NG)
  if (!ex) continue
  const l = Math.hypot(ex.f[0], ex.f[1], ex.f[2])
  if (l < 1e-9) continue
  // ff is the number the shader actually divides by — the fit, not the truth —
  // so every rule below is scored on the approximation it will really be handed.
  SET.push({
    ...cf,
    ...ex,
    lobe: mul(ex.f, 1 / l),
    fl: l,
    ff: ltcClip(ex.f),
    ffq: ltcClip(ex.fq),
  })
}
console.log(`${((Date.now() - T0) / 1000).toFixed(1)} s, ${SET.length} usable`)
console.log(`reference domain: ${DOMAIN === 'square' ? 'the bounding rectangle (Day 044)' : 'the six panes (Day 045)'}`)

// How good is pi.ltcClip(f) as the kernel's mass? Today's area is proportional
// to it, so the horizon fit's error passes straight into the footprint, and it
// is worth knowing before reading any of the tables below.
{
  let s = 0
  let n = 0
  let bias = 0
  for (const c of SET) {
    const r = (Math.PI * c.ff) / Math.max(c.mass, 1e-12)
    s += (r - 1) * (r - 1)
    bias += r
    n++
  }
  console.log(
    `pi.ltcClip(f) against the exact mass: mean ${(bias / n).toFixed(4)}x, RMS ${(100 * Math.sqrt(s / n)).toFixed(2)}%`
  )
}

// Day 046's two normalisations, and the ratio between them. The fill fraction is
// the share of the bounding rectangle that is glass, which is the number the
// whole day is about: 29% of every wide fetch was stone.
console.log(
  `the panes cover ${(100 * MEANS.fill).toFixed(2)}% of the rectangle; ` +
    `masked / unmasked exposure ${UNITS.map((u) => u.toFixed(4)).join(' / ')}`
)

const DELTA = GLASS_K / N
const pct = (x, n) => (100 * Math.sqrt(x / n)).toFixed(2)

// --- 1. the four rules, against the exact lobe --------------------------------
//
// Binned by how large the footprint is against the window itself, because that
// ratio is the whole of today's argument: a kernel far inside the opening is a
// kernel the old reference described well, and a kernel that runs off the edge
// of it is one the old reference could not describe at all.
console.log(`\n--- the rules, scored against the D-weighted mean of the window ---`)
console.log(`relative RMS error, per cent.  delta = GLASS_K / N = ${DELTA}\n`)
const SIZE_BINS = [0.1, 0.4, 1.5, 6, 1e9]
const sizeLabel = [
  'a tenth of the window',
  'a tenth to half of it',
  'about the window itself',
  'a few times wider',
  'an order wider',
]
const rows = SIZE_BINS.map(() => ({ n: 0, s: RULES.map(() => 0), t: 0 }))

for (const s of SET) {
  const fp = footprint(s.p1, s.V1, s.V2, s.lobe, DELTA, false)
  if (!fp) continue
  const frac = Math.sqrt(fp.A * fp.B) / N
  const bi = SIZE_BINS.findIndex((q) => frac < q)
  const row = rows[bi]
  row.n++
  row.t += Math.sqrt((s.cov[0] + s.cov[2]) / 2)
  const alt = LATE.map((l) =>
    footprint(s.p1, s.V1, s.V2, s.lobe, DELTA, l.supp, l.mass ? { ff: s.ff } : null, l.tilt || 0)
  )
  let ai = 0
  RULES.forEach(([, f], k) => {
    if (f) {
      const e = err(f(fp), s.tint)
      row.s[k] += e * e
      return
    }
    const l = LATE[ai]
    const g = alt[ai++]
    const c = tapRule(g.uv, g.A, g.B, g.t, { weights: 'area', masked: l.masked })
    const e = err(c, ref(s.tint, l.masked))
    row.s[k] += e * e
  })
}
if (process.env.DIST) {
  const fr = SET.map((s) => {
    const fp = footprint(s.p1, s.V1, s.V2, s.lobe, DELTA, false)
    return fp ? Math.sqrt(fp.A * fp.B) / N : 0
  }).sort((a, b) => a - b)
  console.log('  size percentiles:', [0.05, 0.25, 0.5, 0.75, 0.95].map((q) => fr[Math.floor(q * fr.length)].toFixed(3)).join(' '))
}
console.log(`  footprint                    ${RULES.map(([l]) => l.padStart(22)).join('')}      n`)
rows.forEach((r, i) => {
  if (!r.n) return
  console.log(
    `  ${sizeLabel[i].padEnd(28)}${r.s.map((x) => pct(x, r.n).padStart(22)).join('')}   ${String(r.n).padStart(4)}`
  )
})
{
  const all = rows.reduce((a, r) => ({ n: a.n + r.n, s: a.s.map((x, k) => x + r.s[k]) }), {
    n: 0,
    s: RULES.map(() => 0),
  })
  console.log(
    `  ${'all'.padEnd(28)}${all.s.map((x) => pct(x, all.n).padStart(22)).join('')}   ${String(all.n).padStart(4)}`
  )
}

// --- 2. delta, which was never measured ---------------------------------------
//
// GLASS_K is 128 on a 256-wide image, so delta is half a radian, and the note in
// glass.js is honest about where the number came from: it was chosen by eye
// against the near tablet, the way the paper chose theirs. This is the first
// morning there has been anything to choose it against.
console.log(`\n--- delta, swept, against the same exact answers ---`)
console.log(`  the two Day 043 columns differ only in the ellipse's size\n`)
// Day 045 adds its own column, and the column is the point: with the area taken
// off the radiometry, delta survives only in the *aspect* of the ellipse, so the
// sweep should go flat. A constant that has been carried for four mornings
// either matters or it does not, and this is the line that says which.
console.log(`     GLASS_K     delta        Day 043      + support     Day 045     Day 046   mean taps`)
for (const K of [48, 64, 96, 128, 160, 192, 256, 320, 448]) {
  const d = K / N
  let a = 0
  let b = 0
  let c = 0
  let m = 0
  let taps = 0
  let n = 0
  for (const s of SET) {
    const f0 = footprint(s.p1, s.V1, s.V2, s.lobe, d, false)
    const f1 = footprint(s.p1, s.V1, s.V2, s.lobe, d, 'size')
    const f2 = footprint(s.p1, s.V1, s.V2, s.lobe, d, 'size', { ff: s.ff })
    if (!f0 || !f1 || !f2) continue
    const e0 = err(tapRule(f0.uv, f0.A, f0.B, f0.t), s.tint)
    const e1 = err(tapRule(f1.uv, f1.A, f1.B, f1.t), s.tint)
    const e2 = err(tapRule(f2.uv, f2.A, f2.B, f2.t), s.tint)
    const e3 = err(tapRule(f2.uv, f2.A, f2.B, f2.t, { masked: true }), ref(s.tint, true))
    a += e0 * e0
    b += e1 * e1
    c += e2 * e2
    m += e3 * e3
    taps += tapCount(f2.A, f2.B)
    n++
  }
  const mark = K === GLASS_K ? '  <- today' : ''
  console.log(
    `  ${String(K).padStart(8)}   ${d.toFixed(3).padStart(7)}   ${pct(a, n).padStart(11)}   ` +
      `${pct(b, n).padStart(10)}${pct(c, n).padStart(12)}${pct(m, n).padStart(12)}   ` +
      `${(taps / n).toFixed(2).padStart(9)}${mark}`
  )
}

// --- 2b. kappa, the one constant today introduces -----------------------------
//
// It is a *profile*, not a size: 1 if the kernel were uniform on its ellipse, 2
// if it were a Gaussian of the same covariance. Anything outside that interval
// would mean the mass-over-peak identity is being asked to absorb an error that
// is not a profile, so where the minimum lands is itself a check on the day.
console.log(`\n--- kappa, the profile constant, swept ---`)
console.log(`  1 = uniform on the ellipse, 2 = a Gaussian of the same covariance\n`)
// The second column swaps pi.ltcClip(f) for the mass the reference measured.
// It is not available to a shader and it is not a proposal; it is the only way
// to say whether what limits today's rule is the *idea* — mass over peak as an
// area — or the horizon fit that supplies the mass. The two columns differing is
// a statement about Heitz's fit, not about the footprint.
// Day 046 adds the third column, and it is a question the day has to ask about
// itself: kappa was measured on a pyramid that averaged stone. If the mask moved
// its minimum, then 1.2 was partly absorbing the mullions — a size standing in
// for a domain — and the constant would have to be re-measured rather than
// inherited.
console.log(`     kappa       RMS %    exact mass      masked   mean taps    A / measured`)
for (const k of [0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.2, 1.5, 2.0, 3.0]) {
  let s = 0
  let sx = 0
  let sm = 0
  let taps = 0
  let ra = 0
  let n = 0
  for (const c of SET) {
    const fp = footprint(c.p1, c.V1, c.V2, c.lobe, DELTA, 'size', { ff: c.ff, kappa: k })
    const fx = footprint(c.p1, c.V1, c.V2, c.lobe, DELTA, 'size', {
      ff: c.mass / Math.PI,
      kappa: k,
    })
    if (!fp || !fx) continue
    const e = err(tapRule(fp.uv, fp.A, fp.B, fp.t), c.tint)
    const ex = err(tapRule(fx.uv, fx.A, fx.B, fx.t), c.tint)
    const em = err(tapRule(fp.uv, fp.A, fp.B, fp.t, { masked: true }), ref(c.tint, true))
    s += e * e
    sx += ex * ex
    sm += em * em
    taps += tapCount(fp.A, fp.B)
    const [cuu, cuv, cvv] = c.cov
    const tr = 0.5 * (cuu + cvv)
    const dsc = Math.sqrt(Math.max(tr * tr - (cuu * cvv - cuv * cuv), 0))
    ra += fp.A / Math.max(2 * Math.sqrt(Math.max(tr + dsc, 0)) * N, 1e-6)
    n++
  }
  const mark = k === MASS_KAPPA ? '  <- today' : ''
  console.log(
    `  ${k.toFixed(2).padStart(8)}${pct(s, n).padStart(12)}${pct(sx, n).padStart(14)}` +
      `${pct(sm, n).padStart(12)}   ` +
      `${(taps / n).toFixed(2).padStart(9)}${(ra / n).toFixed(3).padStart(16)}${mark}`
  )
}

// --- 2c. does the aperture's *shape* pay, or only its area? -------------------
//
// The panes cover 71% of the bounding rectangle, so the panes' mass is smaller
// than the rectangle's by roughly that factor almost everywhere — and a constant
// factor is something kappa absorbs without noticing. If the two columns below
// reach the same minimum at different kappas, then "the aperture's real shape"
// is one number and today should say so; if the panes column reaches lower, then
// what pays is the part that *varies* — a lobe reading one pane where the solid
// rectangle would have read a mullion too.
console.log(`\n--- the panes' mass against the bounding rectangle's, each with kappa free ---\n`)
console.log(`     kappa    panes    rectangle`)
for (const k of [0.6, 0.8, 1.0, 1.1, 1.2, 1.3, 1.5, 1.8, 2.2]) {
  let a = 0
  let b = 0
  let n = 0
  for (const c of SET) {
    const fa = footprint(c.p1, c.V1, c.V2, c.lobe, DELTA, 'size', { ff: c.ff, kappa: k })
    const fb = footprint(c.p1, c.V1, c.V2, c.lobe, DELTA, 'size', { ff: c.ffq, kappa: k })
    if (!fa || !fb) continue
    const ea = err(tapRule(fa.uv, fa.A, fa.B, fa.t), c.tint)
    const eb = err(tapRule(fb.uv, fb.A, fb.B, fb.t), c.tint)
    a += ea * ea
    b += eb * eb
    n++
  }
  console.log(`  ${k.toFixed(2).padStart(8)}${pct(a, n).padStart(9)}${pct(b, n).padStart(13)}`)
}

// --- 3. the ellipse against the kernel's own second moment --------------------
//
// The exact integral gives the kernel's covariance in uv, which is the ellipse
// nobody has been able to compute: a uniform ellipse of semi-axes (a, b) has
// covariance (a^2/4, b^2/4) in its own frame, so 2 sqrt(eig) is the measured
// footprint. Comparing the rule's ellipse to it says whether the rule is wrong
// about the size, about the shape, or about neither.
console.log(`\n--- the rule's ellipse against the kernel's measured one ---`)
{
  const stat = { a: 0, b: 0, an: 0, n: 0, sa: 0, sb: 0, ma: 0, mb: 0 }
  for (const s of SET) {
    const fp = footprint(s.p1, s.V1, s.V2, s.lobe, DELTA, false)
    const fs = footprint(s.p1, s.V1, s.V2, s.lobe, DELTA, 'size')
    const fm = footprint(s.p1, s.V1, s.V2, s.lobe, DELTA, 'size', { ff: s.ff })
    if (!fp || !fs || !fm) continue
    const [cuu, cuv, cvv] = s.cov
    const tr = 0.5 * (cuu + cvv)
    const dsc = Math.sqrt(Math.max(tr * tr - (cuu * cvv - cuv * cuv), 0))
    const mA = 2 * Math.sqrt(Math.max(tr + dsc, 0)) * N // texels
    const mB = 2 * Math.sqrt(Math.max(tr - dsc, 0)) * N
    stat.a += fp.A / Math.max(mA, 1e-6)
    stat.b += fp.B / Math.max(mB, 1e-6)
    stat.sa += fs.A / Math.max(mA, 1e-6)
    stat.sb += fs.B / Math.max(mB, 1e-6)
    stat.ma += fm.A / Math.max(mA, 1e-6)
    stat.mb += fm.B / Math.max(mB, 1e-6)
    stat.an += mA / Math.max(mB, 1e-6)
    stat.n++
  }
  const n = stat.n
  console.log(`  mean ratio of the rule's semi-axis to the measured one, over ${n} configurations\n`)
  console.log(`                    major    minor`)
  console.log(
    `  Day 043       ${(stat.a / n).toFixed(3).padStart(9)}${(stat.b / n).toFixed(3).padStart(9)}`
  )
  console.log(
    `  + support     ${(stat.sa / n).toFixed(3).padStart(9)}${(stat.sb / n).toFixed(3).padStart(9)}`
  )
  console.log(
    `  Day 045       ${(stat.ma / n).toFixed(3).padStart(9)}${(stat.mb / n).toFixed(3).padStart(9)}`
  )
  console.log(`\n  the kernel's own anisotropy averages ${(stat.an / n).toFixed(2)}x`)
}

// --- 4. the knobs, on the exact reference -------------------------------------
console.log(`\n--- the knobs, re-scored against the exact lobe ---\n`)
console.log(`                             RMS %   mean taps`)
const MASS = { ff: 0 } // filled per configuration; presence is the switch
const KNOBS = [
  ['Day 043 (n<=4 area)', { max: TAP_MAX, weights: 'area' }, false, false],
  ['Day 044 + support', { max: TAP_MAX, weights: 'area' }, 'size', false],
  ['Day 045 + measured area', { max: TAP_MAX, weights: 'area' }, 'size', true],
  ['Day 046 + the mask', { max: TAP_MAX, weights: 'area', masked: true }, 'size', true],
  ['  masked, no measure', { max: TAP_MAX, weights: 'area', masked: true }, 'size', false],
  ['  masked, no support', { max: TAP_MAX, weights: 'area', masked: true }, false, true],
  ['  masked, n<=1', { max: 1, weights: 'area', masked: true }, 'size', true],
  ['  masked, n<=8', { max: 8, weights: 'area', masked: true }, 'size', true],
  ['  measured, no support', { max: TAP_MAX, weights: 'area' }, false, true],
  ['  measured, gauss', { max: TAP_MAX, weights: 'gauss' }, 'size', true],
  ['  measured, flat', { max: TAP_MAX, weights: 'flat' }, 'size', true],
  ['  measured, n<=1', { max: 1, weights: 'area' }, 'size', true],
  ['  measured, n<=2', { max: 2, weights: 'area' }, 'size', true],
  ['  measured, n<=8', { max: 8, weights: 'area' }, 'size', true],
  ['  measured, ceil', { max: TAP_MAX, weights: 'area', count: 'ceil' }, 'size', true],
]
for (const [label, opt, supp, useMass] of KNOBS) {
  let s = 0
  let taps = 0
  let n = 0
  for (const cf of SET) {
    const fp = footprint(cf.p1, cf.V1, cf.V2, cf.lobe, DELTA, supp, useMass ? { ff: cf.ff } : null)
    if (!fp) continue
    const e = err(tapRule(fp.uv, fp.A, fp.B, fp.t, opt), ref(cf.tint, opt.masked))
    s += e * e
    taps += tapCount(fp.A, fp.B, opt.max)
    n++
  }
  console.log(`  ${label.padEnd(24)}${pct(s, n).padStart(7)}   ${(taps / n).toFixed(2).padStart(9)}`)
}

// --- 5. where the mask pays ---------------------------------------------------
//
// The day's claim is not "the filter is better" but "the fetch was averaging a
// set the integral is not over", so the honest way to read it is by *how much
// stone the fetch had in it* — the coverage the masked atlas reports in alpha.
// A footprint entirely inside a pane has coverage 1 and today is the identity
// there, to the bit. If the improvement did not concentrate where the coverage
// is low, the mechanism would not be the one claimed.
console.log(`\n--- the mask, binned by how much of the footprint was glass ---\n`)
// The bins are cut where the window is, not on round numbers: a footprint that
// covers the whole opening reports the fill fraction itself (0.715), because
// that is what "the glass, over the rectangle" means, and everything below it is
// a fetch sitting on more stone than the window average — a lobe on a mullion,
// or one clamped against the frame. Above it are the fetches small enough to sit
// inside a light.
console.log(`     coverage        Day 045    Day 046       n`)
const COV_BINS = [0.6, 0.705, 0.73, 0.9, 1.001]
const covLabel = ['under 0.60', '0.60 - 0.705', 'the window', '0.73 - 0.90', 'inside a pane']
const covRows = COV_BINS.map(() => ({ n: 0, a: 0, b: 0 }))
for (const c of SET) {
  const fp = footprint(c.p1, c.V1, c.V2, c.lobe, DELTA, 'size', { ff: c.ff })
  if (!fp) continue
  // The coverage of this footprint, read off the same fetch the rule makes.
  const raw = tapRule(fp.uv, fp.A, fp.B, fp.t, { weights: 'area', masked: 'raw' })
  const cov = raw[3]
  const bi = Math.min(COV_BINS.findIndex((q) => cov < q), COV_BINS.length - 1)
  const row = covRows[bi < 0 ? COV_BINS.length - 1 : bi]
  const ea = err(tapRule(fp.uv, fp.A, fp.B, fp.t, { weights: 'area' }), c.tint)
  const eb = err(
    tapRule(fp.uv, fp.A, fp.B, fp.t, { weights: 'area', masked: true }),
    ref(c.tint, true)
  )
  row.n++
  row.a += ea * ea
  row.b += eb * eb
}
covRows.forEach((r, i) => {
  if (!r.n) return
  console.log(
    `  ${covLabel[i].padEnd(14)}${pct(r.a, r.n).padStart(10)}${pct(r.b, r.n).padStart(11)}   ${String(r.n).padStart(5)}`
  )
})
console.log(`\n  SUPPORT_VAR = ${SUPPORT_VAR}, MASS_KAPPA = ${MASS_KAPPA}`)
