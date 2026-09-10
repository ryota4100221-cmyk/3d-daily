// ── Day 071 — the stored turn ────────────────────────────────────────────────
//
// One shaft, 3000 m long. The top of it is turned at a rate that never varies —
// not by a controller that holds it steady, but because the top node's angle is
// literally written as Ω₀·t. There is no line anywhere below that says "stick",
// "slip", "stall" or "release". There is a wave equation for a twisting rod, and
// one friction curve at the far end whose only unusual property is that it gets
// *weaker* as the bit turns faster.
//
// Out of those two things the bit stops dead for two seconds at a time and then
// spins at three times the speed of the thing driving it. The difference is not
// lost while the bit is stopped. It is stored in the rod as twist, and it comes
// back all at once.

// ── the rod ──────────────────────────────────────────────────────────────────
// 5" drill pipe, 127.0 mm OD / 108.6 mm ID, steel.
const OD = 0.127
const ID = 0.1086
const G_STEEL = 79.3e9 // Pa
const RHO = 7850 // kg/m³

export const JPOL = (Math.PI / 32) * (OD ** 4 - ID ** 4) // 1.1884e-5 m⁴
export const GJ = G_STEEL * JPOL // 942 383 N·m²/rad
export const RHOJ = RHO * JPOL // 0.09329 kg·m²/m
export const C_TOR = Math.sqrt(G_STEEL / RHO) // 3178 m/s — torsional wave speed

export const MD = 3000 // measured depth, m
export const N = 241 // nodes; 0 = top drive, N-1 = bit
export const DZ = MD / (N - 1) // 12.5 m
export const K_EL = GJ / DZ // 75 391 N·m/rad between neighbours
export const I_EL = RHOJ * DZ // 1.166 kg·m² per node
export const I_BHA = 118 // drill collars + bit, kg·m²
export const C_MUD = 0.36 // viscous drag per node, N·m·s/rad

// Whole-string compliance, which is the number that makes this possible at all:
// 314 N·m per radian ⇒ ~1974 N·m per full turn. A 14 kN·m breakaway torque is
// therefore about seven turns of wind-up. Seven turns, in a steel rod.
export const K_STRING = GJ / MD

// ── the far end ──────────────────────────────────────────────────────────────
// Velocity-weakening Coulomb friction. μ falls from μs to μk·μs over a
// characteristic speed W_C. TANH_EPS regularises sign(ω) so the integrator has
// something differentiable at zero; it also means the "stuck" bit is really
// creeping at a few rpm, which is what downhole tools actually record.
export const T_STATIC = 14000 // N·m at breakaway
const F_KIN = 0.42 // μk/μs, bare bit
const W_C = 5.5 // rad/s — the Stribeck speed; still weakening at 120 rpm, which
//                        is the whole reason the steady state is unstable at all
const TANH_EPS = 0.06

// The product on the reference site is a friction-reduction tool: it puts a
// small axial oscillation into the string so the contact never fully sets. In
// this rig that is two numbers on the same curve — the breakaway torque comes
// down, and the gap between static and kinetic closes. Nothing else changes:
// same rod, same inertia, same drive, same integrator, same 3000 m.
const T_STATIC_FRS = 0.55 * T_STATIC
const F_KIN_FRS = 0.9
const W_C_FRS = 0.35

export function bitTorque(w, frs) {
  const ts = frs ? T_STATIC_FRS : T_STATIC
  const f = frs ? F_KIN_FRS : F_KIN
  const wc = frs ? W_C_FRS : W_C
  const mu = f + (1 - f) * Math.exp(-Math.abs(w) / wc)
  return ts * mu * Math.tanh(w / TANH_EPS)
}

// ── the well ─────────────────────────────────────────────────────────────────
// Vertical → build at 520 m radius → 983 m lateral. A horizontal well, because
// the case study on the reference site is one (Гор 90°, Западная Сибирь), and
// because a horizontal lateral is where the bit-side friction actually bites.
const VERT = 1200
const R_BUILD = 520
const ARC = (R_BUILD * Math.PI) / 2 // 816.8 m
const LAT = MD - VERT - ARC // 983.2 m

export const WELL = { VERT, R_BUILD, ARC, LAT }

// Position and the in-plane normal N = B × T with B = +z, so the visible offset
// of a painted stripe is r·cos θ along N and r·sin θ straight into the screen.
export function pathAt(s) {
  if (s <= VERT) return { x: 0, y: -s, nx: 1, ny: 0 }
  if (s <= VERT + ARC) {
    const phi = (s - VERT) / R_BUILD
    return {
      x: R_BUILD - R_BUILD * Math.cos(phi),
      y: -VERT - R_BUILD * Math.sin(phi),
      nx: Math.cos(phi),
      ny: Math.sin(phi),
    }
  }
  const u = s - VERT - ARC
  return { x: R_BUILD + u, y: -VERT - R_BUILD, nx: 0, ny: 1 }
}

// Drawn radius of the painted stripe. The pipe is 63.5 mm in radius over 3000 m
// of length; at true scale the stripe is a straight line one pixel wide and the
// whole point is invisible. 86 m is a ×1350 exaggeration and it is the only
// dishonest number in the file.
export const SPOKE_R = 86

export const RIBBON_S = new Float64Array(N)
export const RIBBON_P = new Array(N)
for (let i = 0; i < N; i++) {
  RIBBON_S[i] = (i / (N - 1)) * MD
  RIBBON_P[i] = pathAt(RIBBON_S[i])
}

// ── framing ──────────────────────────────────────────────────────────────────
// Long lens. 14° of vertical field from 8.7 km away: the build curve and the
// lateral are compressed onto one plane, which is what lets 3000 m of rod read
// as a single wave instead of a receding line.
export const CAM = {
  fov: 14,
  target: [1460, -955, 0],
  pos: [2761, 15, 8623],
  near: 100,
  far: 20000,
}

// ── the integrator ───────────────────────────────────────────────────────────
const DT = 1.2e-3 // s — under the 3.93 ms CFL limit of dz / c
const SUB_MAX = 60

// How much of the limit cycle to burn before the first frame. It is exposed on
// the query string (?warm=…) because the phase of a 6.6 s cycle is the whole
// difference between a still that shows a rod at rest and a still that shows
// 3000 m of it letting go at once.
export const WARM_DEFAULT = 24.6

export function createRig(surfaceRpm = 120, warm = WARM_DEFAULT) {
  const omega0 = (surfaceRpm * 2 * Math.PI) / 60

  const theta = new Float64Array(N)
  const omega = new Float64Array(N)
  const inv = new Float64Array(N)
  for (let i = 1; i < N; i++) inv[i] = 1 / (i === N - 1 ? I_EL / 2 + I_BHA : I_EL)

  // Start already wound up, on the steady sliding branch, so the first frame on
  // screen is inside the limit cycle rather than 8 seconds short of it.
  const tSlide = T_STATIC * F_KIN
  const dragPerM = (C_MUD * omega0) / DZ
  for (let i = 0; i < N; i++) {
    const z = i * DZ
    // Torque carried at depth z = bit torque + all the mud drag below it.
    // θ(z) = −∫₀ᶻ T/GJ dz, so the rod starts already wound the right way.
    theta[i] = -(tSlide * z + dragPerM * (MD * z - (z * z) / 2)) / GJ
    omega[i] = omega0
  }

  let t = 0
  let frs = false
  let acc = 0

  // rolling window for the stick-slip index, 20 s at 120 Hz
  const HIST = 2400
  const hist = new Float64Array(HIST)
  let hi = 0
  let hn = 0
  let sinceSample = 0
  hist.fill(surfaceRpm)
  hn = HIST

  function integrate() {
    const top = omega0 * t
    theta[0] = top
    omega[0] = omega0

    for (let i = 1; i < N; i++) {
      const left = K_EL * (theta[i - 1] - theta[i])
      const right = i < N - 1 ? K_EL * (theta[i + 1] - theta[i]) : 0
      let tq = left + right - C_MUD * omega[i]

      if (i === N - 1) {
        const w = omega[i]
        const tb = bitTorque(w, frs)
        // Semi-implicit on the friction slope only. Where the curve falls
        // (velocity weakening) the slope is negative and clamped to zero, which
        // leaves that part explicit — it is the gentle part.
        const h = 1e-3
        const d = Math.max(0, (bitTorque(w + h, frs) - bitTorque(w - h, frs)) / (2 * h))
        const I = 1 / inv[i]
        omega[i] = (I * w + DT * (tq - tb + d * w)) / (I + DT * d)
      } else {
        omega[i] += DT * tq * inv[i]
      }
    }
    for (let i = 1; i < N; i++) theta[i] += DT * omega[i]
    t += DT

    sinceSample += DT
    if (sinceSample >= 1 / 120) {
      sinceSample = 0
      hist[hi] = (omega[N - 1] * 60) / (2 * Math.PI)
      hi = (hi + 1) % HIST
    }
  }

  function step(dtWall) {
    acc += Math.min(Math.max(dtWall, 0), 0.05)
    let n = 0
    while (acc >= DT && n < SUB_MAX) {
      integrate()
      acc -= DT
      n++
    }
    if (n === SUB_MAX) acc = 0
  }

  function readout() {
    let mn = Infinity
    let mx = -Infinity
    let sum = 0
    for (let i = 0; i < hn; i++) {
      const v = hist[i]
      if (v < mn) mn = v
      if (v > mx) mx = v
      sum += v
    }
    const avg = sum / hn
    return {
      t,
      frs,
      surfaceRpm,
      bitRpm: (omega[N - 1] * 60) / (2 * Math.PI),
      turns: (theta[0] - theta[N - 1]) / (2 * Math.PI),
      topTorque: K_EL * (theta[0] - theta[1]),
      bitTq: bitTorque(omega[N - 1], frs),
      dssi: (mx - mn) / (2 * Math.max(avg, 1e-6)),
      rpmMin: mn,
      rpmMax: mx,
      thetaTop: theta[0],
      thetaBit: theta[N - 1],
    }
  }

  // Sparkline sampling: last SPAN seconds of bit rpm, newest last.
  function trace(out, span = 20) {
    const m = out.length
    const nSamples = Math.min(HIST, Math.round(span * 120))
    for (let j = 0; j < m; j++) {
      const back = nSamples - 1 - Math.round((j / (m - 1)) * (nSamples - 1))
      out[j] = hist[(hi - 1 - back + HIST * 2) % HIST]
    }
    return out
  }

  // Settle into the limit cycle before the first frame is ever drawn. 22 s is
  // long enough to overwrite the whole rpm window, so the stick-slip index on
  // screen at t=0 is measured, not seeded.
  for (let k = 0; k < Math.round(warm / DT); k++) integrate()

  return {
    theta,
    omega,
    step,
    readout,
    trace,
    setFrs: (v) => {
      frs = v
    },
    isFrs: () => frs,
  }
}
