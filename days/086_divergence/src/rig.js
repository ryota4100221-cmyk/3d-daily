// rig.js — the whole field is one number.
//
// Point i of N sits at height z_i = 1 − (2i+1)/N and turns by i·f whole turns.
// Nothing else is placed. Whether the sphere reads as an even skin of dots or as
// q straight spokes is decided by f alone, and specifically by how well f can be
// approximated by fractions p/q with small q. The golden fraction 1/φ² is the
// number that is worst approximated of all (its continued fraction is all 1s),
// so at f = 1/φ² no small q ever lines up. That is the device.
//
// No three.js in this file: the shader receives the same f and redoes the same
// two lines, and the numbers in the HUD come from here.

export const PHI = (1 + Math.sqrt(5)) / 2
export const GOLDEN = 2 - PHI // 0.3819660112501051… = 1/φ²
export const GOLDEN_DEG = 360 * GOLDEN // 137.50776405003785…

export function point(i, n, f, out = [0, 0, 0]) {
  const z = 1 - (2 * i + 1) / n
  const r = Math.sqrt(Math.max(0, 1 - z * z))
  const a = 2 * Math.PI * ((i * f) % 1)
  out[0] = r * Math.cos(a)
  out[1] = z // "up" — the camera looks straight down this axis
  out[2] = r * Math.sin(a)
  return out
}

// Continued-fraction convergents p/q of x, up to denominator qMax.
export function convergents(x, qMax = 1e6, maxTerms = 24) {
  const out = []
  let p0 = 0, q0 = 1, p1 = 1, q1 = 0
  let y = x
  for (let k = 0; k < maxTerms; k++) {
    const a = Math.floor(y)
    const p = a * p1 + p0
    const q = a * q1 + q0
    if (q > qMax) break
    if (q > 0) out.push({ p, q, a })
    p0 = p1; q0 = q1; p1 = p; q1 = q
    const r = y - a
    if (r < 1e-12) break
    y = 1 / r
  }
  return out
}

// Hexagonal spacing for N points on the unit sphere: the NN distance a perfect
// packing would have. Everything below is reported as a ratio to it.
export const dHex = (n) => Math.sqrt((8 * Math.PI) / (Math.sqrt(3) * n))

// Nearest-neighbour statistics. Points are sorted by height, and a neighbour
// closer than c must be within Δz < c, i.e. within c·N/2 indices — so a window
// of that width is exact, not an approximation.
export function packing(n, f) {
  const P = new Float64Array(n * 3)
  const t = [0, 0, 0]
  for (let i = 0; i < n; i++) {
    point(i, n, f, t)
    P[3 * i] = t[0]; P[3 * i + 1] = t[1]; P[3 * i + 2] = t[2]
  }
  const d0 = dHex(n)
  const cut = 3 * d0
  const W = Math.ceil((cut * n) / 2)
  let sum = 0, min = Infinity, counted = 0
  for (let i = 0; i < n; i++) {
    let best = Infinity
    const lo = Math.max(0, i - W), hi = Math.min(n - 1, i + W)
    for (let j = lo; j <= hi; j++) {
      if (j === i) continue
      const dx = P[3 * i] - P[3 * j], dy = P[3 * i + 1] - P[3 * j + 1], dz = P[3 * i + 2] - P[3 * j + 2]
      const d = dx * dx + dy * dy + dz * dz
      if (d < best) best = d
    }
    best = Math.min(Math.sqrt(best), cut) // "no neighbour within 3·d_hex" is capped, not dropped
    sum += best; counted++
    if (best < min) min = best
  }
  return { mean: sum / counted / d0, min: min / d0 }
}

// Straight spokes: the smallest q with p/q so close to f that, walking the whole
// sequence, a spoke twists by less than one spoke gap (N·|f − p/q|·q < 1).
// Only q up to √N can be seen as spokes at all; beyond that they are the dots.
export function spokes(n, f) {
  const qMax = Math.floor(Math.sqrt(n))
  for (const c of convergents(f, qMax)) {
    if (c.q < 2) continue
    if (n * Math.abs(f - c.p / c.q) * c.q < 1) return c
  }
  return null
}

// The family of spirals worth tracing: the largest convergent denominator below
// 0.7·√N. Point i is lit when i mod q == 0.
export function family(n, f) {
  const cs = convergents(f, Math.floor(0.7 * Math.sqrt(n))).filter((c) => c.q >= 2)
  return cs.length ? cs[cs.length - 1].q : 1
}

// The five small spheres: Fibonacci ratios F_k/F_{k+2} walking in on 1/φ².
export const LADDER = [
  { label: '2/5', f: 2 / 5 },
  { label: '3/8', f: 3 / 8 },
  { label: '5/13', f: 5 / 13 },
  { label: '8/21', f: 8 / 21 },
  { label: '1/φ²', f: GOLDEN },
]

// Idle path for the knob: leaves the golden fraction, passes through 3/8 and
// 5/13 where the field collapses into spokes, and comes back to rest.
// Period 24 s, dwelling on 1/φ² for the first third.
export function idleF(t) {
  const T = 24
  const u = ((t % T) + T) % T / T
  if (u < 0.34) return GOLDEN
  const s = (u - 0.34) / 0.66 // 0..1
  const e = 0.5 - 0.5 * Math.cos(2 * Math.PI * s) // 0→1→0
  const w = Math.sin(2 * Math.PI * s) // sweeps both sides
  return GOLDEN + 0.0105 * e * Math.sign(w) * Math.abs(w) ** 0.5
}

// Pointer x ∈ [0,1] → f. The window straddles 3/8, 8/21, 1/φ², 5/13.
export const KNOB = [0.372, 0.392]
export const knobF = (x) => KNOB[0] + (KNOB[1] - KNOB[0]) * Math.min(1, Math.max(0, x))
