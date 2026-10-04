// rig.js — a water drop on a superhydrophobic floor, and nothing else.
//
// The one fact this file is built around (Richard, Clanet & Quéré, Nature 2002):
// a drop that bounces off a surface it cannot wet behaves like a spring whose
// stiffness is surface tension. A spring's half-period does not depend on how
// hard you hit it, so the time the drop spends on the floor is
//
//     τ ≈ 2.6 · √(ρR³/σ)
//
// for every impact speed. Nothing below says "make the contacts equal". Each
// drop is integrated on its own, with its own release height, and the HUD only
// reads back the times at which it touched and left.
//
// Units: SI inside the integrator. The scene draws 1 unit = 1 mm.

export const RHO = 1000 // kg/m³  water
export const SIGMA = 0.072 // N/m    water / air
export const G = 9.81 // m/s²
export const PREFACTOR = 2.6 // measured; sets the spring

// Damping of the contact spring. ζ = 0.1 gives a restitution of ~0.73, in the
// range measured for millimetric water drops on lotus-like surfaces. Because
// the spring is linear, ζ shortens nothing differently for different speeds.
const ZETA = 0.1
// The free drop's lowest shape mode (Rayleigh, l = 2). Its decay is made
// faster than water's (~0.2 s for R = 1 mm) so the wobble reads on screen.
const ZETA2 = 0.035
// How much of the take-off speed the l = 2 mode receives. This is a visual
// coupling, not derived: a spheroid has one shape coordinate where a real drop
// has many, and pouring all of it into one mode makes a cigar.
const KAPPA = 0.32

export const IMPACT_SPEEDS = [0.12, 0.22, 0.32, 0.44, 0.58] // m/s
export const T_IMPACT = 0.06 // s — every drop is released so it first lands here
export const LOOP = 0.42 // s of physical time before everything is re-released
const DT = 2e-6 // s

export function scales(Rmm) {
  const R = Rmm * 1e-3
  const m = (4 / 3) * Math.PI * R ** 3 * RHO
  const t0 = Math.sqrt((RHO * R ** 3) / SIGMA)
  const tau = PREFACTOR * t0 // the undamped half period we aim the spring at
  const wd = Math.PI / tau // damped angular frequency → contact lasts exactly τ (g aside)
  const w = wd / Math.sqrt(1 - ZETA * ZETA)
  const w2 = Math.sqrt(8) / t0 // Rayleigh l = 2: ω² = l(l−1)(l+2) σ/ρR³
  return { R, m, t0, tau, w, w2, k: m * w * w }
}

// One drop. State in metres: z = height of the centre of mass in flight;
// during contact the integrator follows δ, the compression of the spring.
export function makeDrop(Rmm, V) {
  const s = scales(Rmm)
  const h = (V * V) / (2 * G) // release height of the bottom of the drop
  const tFall = V / G
  return {
    s,
    V,
    h,
    release: T_IMPACT - tFall,
    phase: 'wait',
    z: s.R + h,
    vz: 0,
    d: 0,
    vd: 0,
    q: 0, // l = 2 shape coordinate in flight (c/R − 1)
    vq: 0,
    t: 0,
    contacts: [], // [{ t0, t1, v }] — read by the HUD
  }
}

function step(dp, dt) {
  const { s } = dp
  dp.t += dt
  if (dp.phase === 'wait') {
    if (dp.t >= dp.release) dp.phase = 'air'
    return
  }
  if (dp.phase === 'air') {
    dp.vz -= G * dt
    dp.z += dp.vz * dt
    // free shape oscillation
    const aq = -s.w2 * s.w2 * dp.q - 2 * ZETA2 * s.w2 * dp.vq
    dp.vq += aq * dt
    dp.q += dp.vq * dt
    if (dp.z <= s.R && dp.vz < 0) {
      dp.phase = 'contact'
      dp.d = s.R - dp.z
      dp.vd = -dp.vz
      dp.q = 0
      dp.vq = 0
      dp.contacts.push({ t0: dp.t, t1: null, v: -dp.vz })
    }
    return
  }
  // contact: m δ'' = −k δ − c δ' + m g
  const ad = -s.w * s.w * dp.d - 2 * ZETA * s.w * dp.vd + G
  dp.vd += ad * dt
  dp.d += dp.vd * dt
  if (dp.d <= 0 && dp.vd < 0) {
    const c = dp.contacts[dp.contacts.length - 1]
    c.t1 = dp.t
    c.vout = -dp.vd
    dp.phase = 'air'
    dp.z = s.R
    dp.vz = -dp.vd
    // the drop leaves elongating upward: hand part of that to the l = 2 mode
    dp.q = 0
    dp.vq = (KAPPA * dp.vz) / s.R
    // too slow to leave: it stays and just sits (the last little bounces)
    if (dp.vz < 0.012) {
      dp.phase = 'rest'
      dp.z = s.R
      dp.vz = 0
    }
  }
}

export function advance(dp, tTarget) {
  while (dp.t < tTarget) step(dp, Math.min(DT, tTarget - dp.t + 1e-12))
}

// Shape for drawing: a spheroid with horizontal semi-axis a and vertical c,
// centred at height y, volume conserved (a²c = R³).
export function shape(dp) {
  const R = dp.s.R
  let c, y
  if (dp.phase === 'contact') {
    // The spring lives in δ; the drawn drop flattens as R·e^{−δ/R}, which keeps
    // its bottom on the floor, is continuous with free flight at δ = 0, and
    // never inverts however hard the impact.
    c = R * Math.exp(-dp.d / R)
    y = c
  } else if (dp.phase === 'wait' || dp.phase === 'rest') {
    c = R
    y = dp.z
  } else {
    c = R * (1 + dp.q)
    y = dp.z
  }
  const a = Math.sqrt((R * R * R) / c)
  return { a: a * 1e3, c: c * 1e3, y: y * 1e3 } // mm
}

export function makeSet(Rmm) {
  return IMPACT_SPEEDS.map((V) => makeDrop(Rmm, V))
}
