// Day 103 — bleibt gleich.
//
// The whole body is one support function on the sphere:
//
//   h(u) = 1/2 + ε·p(u)          p = a homogeneous cubic (odd: p(−u) = −p(u))
//
// so the distance between two parallel planes squeezing it from opposite
// sides, h(u) + h(−u), is exactly 1 for every direction u. Nothing in the
// renderer enforces that; it falls out of the cubic being odd.
//
// The surface point whose outward normal is u is the gradient of the
// 1-homogeneous extension H(v) = |v|·h(v/|v|):
//
//   x(u) = ∇H(u) = u/2 + ε·(∇p(u) − 2p(u)·u)            (|u| = 1)
//
// which is exact, so the mesh is a sphere grid with positions x(u) and
// normals u — no marching, no SDF.
//
// The "ungleich" twin adds an even quadratic δ·q(u) to h. Its width is
// 1 + 2δ·q(u): the same body language, but the top plate has to move.

// p(x,y,z): a lumpy, deliberately asymmetric cubic.
const P = [
  // [coef, ax, ay, az]   Y₃³ (x³ − 3xy²) gives the equator a Reuleaux triangle;
  // the z-terms tip the triangle so no view of it is symmetric.
  [1.0, 3, 0, 0],
  [-3.0, 1, 2, 0],
  [0.45, 0, 0, 3],
  [-0.675, 2, 0, 1],
  [-0.675, 0, 2, 1],
  [0.6, 1, 1, 1],
]
// q(x,y,z): even, traceless on the sphere (no change of mean width).
const Q = [
  [1.0, 2, 0, 0],
  [-0.4, 0, 2, 0],
  [-0.6, 0, 0, 2],
  [0.9, 1, 1, 0],
]

function poly(T, x, y, z) {
  let s = 0
  for (const [c, a, b, d] of T) s += c * x ** a * y ** b * z ** d
  return s
}
function grad(T, x, y, z) {
  let gx = 0, gy = 0, gz = 0
  for (const [c, a, b, d] of T) {
    if (a) gx += c * a * x ** (a - 1) * y ** b * z ** d
    if (b) gy += c * b * x ** a * y ** (b - 1) * z ** d
    if (d) gz += c * d * x ** a * y ** b * z ** (d - 1)
  }
  return [gx, gy, gz]
}

// Support function of a body, for any direction (normalised inside).
export function support(ux, uy, uz, eps, delta) {
  const r = Math.hypot(ux, uy, uz)
  const x = ux / r, y = uy / r, z = uz / r
  return 0.5 + eps * poly(P, x, y, z) + delta * poly(Q, x, y, z)
}

// Boundary point with outward normal u (|u| = 1).
// H(v) = |v|/2 + ε·p(v)/|v|² + δ·q(v)/|v|
// ∇H at |v|=1 = u/2 + ε(∇p − 2p u) + δ(∇q − q u)
export function point(x, y, z, eps, delta, out) {
  const p = poly(P, x, y, z), q = poly(Q, x, y, z)
  const [px, py, pz] = grad(P, x, y, z)
  const [qx, qy, qz] = grad(Q, x, y, z)
  out[0] = 0.5 * x + eps * (px - 2 * p * x) + delta * (qx - q * x)
  out[1] = 0.5 * y + eps * (py - 2 * p * y) + delta * (qy - q * y)
  out[2] = 0.5 * z + eps * (pz - 2 * p * z) + delta * (qz - q * z)
  return out
}

// Smallest principal radius of curvature at u: eigenvalues of the tangential
// Hessian of H. Convex ⇔ all > 0. Done by finite differences of point().
function minRadius(x, y, z, eps, delta) {
  // tangent basis
  let ax = Math.abs(x) < 0.9 ? 1 : 0, ay = ax ? 0 : 1, az = 0
  let t1 = [ay * z - az * y, az * x - ax * z, ax * y - ay * x]
  let n1 = Math.hypot(...t1); t1 = t1.map((v) => v / n1)
  const t2 = [y * t1[2] - z * t1[1], z * t1[0] - x * t1[2], x * t1[1] - y * t1[0]]
  const e = 1e-5, a = [0, 0, 0], b = [0, 0, 0]
  const dir = (t, s) => {
    const v = [x + s * t[0], y + s * t[1], z + s * t[2]]
    const n = Math.hypot(...v)
    return v.map((c) => c / n)
  }
  const M = [[0, 0], [0, 0]]
  const T = [t1, t2]
  for (let i = 0; i < 2; i++) {
    point(...dir(T[i], e), eps, delta, a)
    point(...dir(T[i], -e), eps, delta, b)
    for (let j = 0; j < 2; j++) {
      M[i][j] = ((a[0] - b[0]) * T[j][0] + (a[1] - b[1]) * T[j][1] + (a[2] - b[2]) * T[j][2]) / (2 * e)
    }
  }
  const tr = M[0][0] + M[1][1]
  const m = (M[0][1] + M[1][0]) / 2
  const det = M[0][0] * M[1][1] - m * m
  return tr / 2 - Math.sqrt(Math.max(0, (tr * tr) / 4 - det))
}

function fib(n) {
  const out = []
  const g = Math.PI * (3 - Math.sqrt(5))
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n
    const r = Math.sqrt(1 - y * y)
    out.push([Math.cos(g * i) * r, y, Math.sin(g * i) * r])
  }
  return out
}

function minRadiusOver(dirs, eps, delta) {
  let m = Infinity
  for (const d of dirs) m = Math.min(m, minRadius(d[0], d[1], d[2], eps, delta))
  return m
}

// ε as large as convexity allows, then back off to 96 % so the sharpest
// rim keeps a small positive radius (at ε_max the body grows a crease).
// derive() re-measures these; the numbers are baked in so the page does not
// spend two seconds bisecting on load. node scripts/derive.mjs prints them.
const DIRS = fib(6000)
function bisect(f, lo, hi) {
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2
    if (f(mid) > 0) lo = mid; else hi = mid
  }
  return lo
}
export function derive() {
  const epsMax = bisect((e) => minRadiusOver(DIRS, e, 0), 0, 0.5)
  const eps = 0.96 * epsMax
  // the twin trades 40 % of the odd lumps for an even one, so it can be
  // visibly ungleich and still convex
  const deltaMax = bisect((d) => minRadiusOver(DIRS, TWIN_EPS * eps, d), 0, 0.5)
  return { epsMax, eps, deltaMax, delta: 0.7 * deltaMax, rmin: minRadiusOver(DIRS, eps, 0) }
}
export const EPS_MAX = 0.062082414239284844
export const EPS = 0.96 * EPS_MAX
export const TWIN_EPS = 0.6
export const DELTA = 0.07738695805810493
export { minRadiusOver, fib }

// Mesh: lat-long grid over the sphere of normals.
export function buildMesh(nu = 220, nv = 110) {
  const verts = (nu + 1) * (nv + 1)
  const pos = new Float32Array(verts * 3)
  const pos2 = new Float32Array(verts * 3)
  const nrm = new Float32Array(verts * 3)
  const o = [0, 0, 0]
  let k = 0
  for (let j = 0; j <= nv; j++) {
    const th = (j / nv) * Math.PI
    for (let i = 0; i <= nu; i++) {
      const ph = (i / nu) * Math.PI * 2
      const x = Math.sin(th) * Math.cos(ph), y = Math.cos(th), z = Math.sin(th) * Math.sin(ph)
      point(x, y, z, EPS, 0, o)
      pos.set(o, k * 3)
      point(x, y, z, TWIN_EPS * EPS, DELTA, o)
      pos2.set(o, k * 3)
      nrm.set([x, y, z], k * 3)
      k++
    }
  }
  const idx = []
  for (let j = 0; j < nv; j++)
    for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i, b = a + nu + 1
      idx.push(a, b, a + 1, b, b + 1, a + 1)
    }
  return { pos, pos2, nrm, idx: new Uint32Array(idx) }
}

// Width in direction d (world) of the body rotated by quaternion R, at mix m.
// Plates touch at H(R⁻¹ŷ) on top and −H(−R⁻¹ŷ) underneath.
export function plates(dx, dy, dz, m) {
  const d = m * DELTA, e = EPS * (1 - (1 - TWIN_EPS) * m)
  const top = support(dx, dy, dz, e, d)
  const bot = support(-dx, -dy, -dz, e, d)
  return { top, bot, width: top + bot }
}

// Volume by the divergence theorem over the sphere of normals:
// V = (1/3)∮ h dA, dA = det(curvature radii) dΩ. Done on the mesh instead.
export function volume(mesh, which = 'pos') {
  const p = mesh[which], I = mesh.idx
  let v = 0
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3
    v += (p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) -
      p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) +
      p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])) / 6
  }
  return Math.abs(v)
}

// Census: width over many directions, measured on the mesh vertices (not on h),
// so a wrong point() would show up here.
export function census(mesh, which = 'pos', n = 4000) {
  const p = mesh[which]
  const N = p.length / 3
  let lo = Infinity, hi = -Infinity
  for (const [x, y, z] of fib(n)) {
    let mx = -Infinity, mn = Infinity
    for (let i = 0; i < N; i++) {
      const s = p[i * 3] * x + p[i * 3 + 1] * y + p[i * 3 + 2] * z
      if (s > mx) mx = s
      if (s < mn) mn = s
    }
    const w = mx - mn
    if (w < lo) lo = w
    if (w > hi) hi = w
  }
  return { lo, hi }
}
