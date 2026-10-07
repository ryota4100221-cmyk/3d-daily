// rig.js — the numbers behind "where the stripes stand still".
//
// A glass ring is a glass rod bent into a circle. Across its tube the rod is a
// cylinder lens of radius r, and a cylinder of index n focuses parallel light at
//     f = n r / (2 (n − 1))            (measured from the tube's axis)
// The striped wall sits a fixed distance D behind that axis. A ray entering at
// height h leaves converging at −h/f and lands on the wall at h (1 − D/f), so the
// stripes seen through the tube are scaled by
//     m = 1 − D / f.
// Choose D = 2r and m = 0 happens at n = 4/3 — water. At that index every ray
// through the tube's middle lands on one point of the wall: the running stripes
// stop. Below it they run forward and magnified; above it (glass, diamond) they
// run backward. Nothing in the shader is told any of this; it only refracts.

export const GEOM = {
  R: 1.3, // ring radius (axis of the tube)
  r: 0.55, // tube radius
}
GEOM.D = 2 * GEOM.r // wall distance behind the tube axis → standstill at n = 4/3

export const SPEED = 0.32 // stripe drift on the wall, units / s (rightward)

export const MATERIALS = [
  { name: 'Air', n: 1.0 },
  { name: 'Water', n: 1.333 },
  { name: 'Crown glass', n: 1.523 },
  { name: 'Sapphire', n: 1.77 },
  { name: 'Diamond', n: 2.417 },
]
export const N_MIN = 1.0
export const N_MAX = 2.417
export const ABBE = 42 // dispersion: n_F − n_C ≈ (n − 1) / V

export const nFromPointer = (x) => N_MIN + (N_MAX - N_MIN) * Math.min(1, Math.max(0, x))
export const pointerFromN = (n) => (n - N_MIN) / (N_MAX - N_MIN)

export function nearestMaterial(n) {
  let best = MATERIALS[0]
  for (const m of MATERIALS) if (Math.abs(m.n - n) < Math.abs(best.n - n)) best = m
  return best
}

// paraxial focal length of the tube, in units of r
export const focalOverR = (n) => (n <= 1.0001 ? Infinity : n / (2 * (n - 1)))
export const paraxialM = (n) => 1 - GEOM.D / (focalOverR(n) * GEOM.r)

// 2D exact trace across the tube: a ray travelling −z at height h meets a circle of
// radius r centred at the origin, refracts in, crosses, refracts out, and lands on
// the wall z = −D. Returns the landing height, or null if it never gets there.
function refract2(I, N, eta) {
  const c = -(I[0] * N[0] + I[1] * N[1])
  const k = 1 - eta * eta * (1 - c * c)
  if (k < 0) return null
  const s = eta * c - Math.sqrt(k)
  return [eta * I[0] + s * N[0], eta * I[1] + s * N[1]]
}

export function landing(n, h) {
  const { r, D } = GEOM
  if (Math.abs(h) >= r) return h
  // (y, z) components
  const P1 = [h, Math.sqrt(r * r - h * h)]
  const N1 = [P1[0] / r, P1[1] / r]
  const d1 = refract2([0, -1], N1, 1 / n)
  if (!d1) return null
  const t = -2 * (P1[0] * d1[0] + P1[1] * d1[1])
  const P2 = [P1[0] + t * d1[0], P1[1] + t * d1[1]]
  const N2 = [-P2[0] / r, -P2[1] / r] // faces back into the glass
  const d2 = refract2(d1, N2, n)
  if (!d2 || d2[1] >= 0) return null
  const s = (-D - P2[1]) / d2[1]
  return P2[0] + s * d2[0]
}

// What the tube does to the stripes, measured by tracing, not by formula.
export function measure(n) {
  const { r } = GEOM
  const eps = 1e-4 * r
  const m0 = (landing(n, eps) - landing(n, -eps)) / (2 * eps)
  const K = 400
  let reversed = 0
  let reach = 0
  let lo = Infinity
  let hi = -Infinity
  for (let i = 0; i < K; i++) {
    const h0 = -r + (2 * r * (i + 0.5)) / K
    const a = landing(n, h0 - eps)
    const b = landing(n, h0 + eps)
    if (a === null || b === null) continue
    reach++
    if (b - a < 0) reversed++
    const y = landing(n, h0)
    lo = Math.min(lo, y)
    hi = Math.max(hi, y)
  }
  return {
    n,
    material: nearestMaterial(n).name,
    fOverR: focalOverR(n),
    m0, // traced magnification at the tube's middle
    mPar: paraxialM(n),
    reversedFrac: reach ? reversed / K : 0,
    wallSpan: (hi - lo) / (2 * r), // how much wall the whole tube shows, in tube widths
    seenSpeed: m0 * SPEED, // drift as seen through the tube's middle
  }
}

// the index at which the middle of the tube freezes the stripes (bisection on traced m0)
export function standstillIndex() {
  let a = 1.05
  let b = 2.4
  const m = (n) => measure(n).m0
  for (let i = 0; i < 40; i++) {
    const c = 0.5 * (a + b)
    if (m(c) > 0) a = c
    else b = c
  }
  return 0.5 * (a + b)
}
