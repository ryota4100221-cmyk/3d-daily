// rig.js — Day 081
//
// THE HALF YOU STAND ON
//
// A GNSS receiver does not measure position. It measures four unknowns at once
// — x, y, z and its own clock bias t — out of a pile of range measurements,
// each one an equation of the form
//
//     rho_i  =  -u_i . dx  +  c*dt        u_i = unit vector receiver -> satellite
//
// so the whole solve is one matrix, G, whose i-th row is [ -u_ix, -u_iy, -u_iz, 1 ].
// Everything about how well the solve is conditioned lives in
//
//     Q = (G^T G)^-1        HDOP = sqrt(Q00+Q11)   VDOP = sqrt(Q22)   TDOP = sqrt(Q33)
//
// There is no "vertical accuracy" term anywhere in here. No clock model, no
// ionosphere, no orbit quality, no receiver. Just directions.
//
// And yet the vertical is always the bad axis. The reason is the only thing in
// the problem that is not symmetric: YOU ARE STANDING ON HALF OF THE SKY.
// Every visible satellite has u_z > 0. Nothing is ever underfoot.
//
// Take the large-N limit with satellites uniform over the cap z in [s, 1]:
//
//     E[u_z] = (1+s)/2        E[u_z^2] = (1+s+s^2)/3
//
// the azimuthal average kills every x-z, y-z, x-t, y-t cross term, and the
// whole vertical problem collapses to one 2x2 block in (z, t):
//
//     [ E[uz^2]   -E[uz] ]          while horizontal is just  m_xx = (1-E[uz^2])/2
//     [ -E[uz]       1   ]
//
// At a flat horizon (s = 0) that block is [[1/3, -1/2], [-1/2, 1]], det = 1/12,
// and the inverse is [[12, 6], [6, 4]] against Q_xx = 3. So:
//
//     sigma_z / sigma_x  =  sqrt(12/3)  =  2            EXACTLY
//     rho(z, clock)      =  6/sqrt(12*4) = sqrt(3)/2    EXACTLY  (= 0.8660)
//
// On the full sphere (s = -1) E[u_z] = 0, the block decouples, and both numbers
// go to 1 and 0. The entire vertical penalty — the factor of two, the near-total
// confusion between "I am one metre higher" and "my clock is one metre slow" —
// is the ground. Not the hardware. Remove the ground and it is gone.
//
// Verified numerically against 40,000 random 9-satellite geometries before any
// of this was drawn (see NOTES.md).

// ── 4x4 inverse (Gauss-Jordan, full pivot on column) ────────────────────────
export function inv4(M) {
  const n = 4
  const A = M.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))])
  for (let c = 0; c < n; c++) {
    let p = c
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r
    if (Math.abs(A[p][c]) < 1e-12) return null // degenerate geometry
    ;[A[c], A[p]] = [A[p], A[c]]
    const d = A[c][c]
    for (let j = 0; j < 2 * n; j++) A[c][j] /= d
    for (let r = 0; r < n; r++) {
      if (r === c) continue
      const f = A[r][c]
      if (f === 0) continue
      for (let j = 0; j < 2 * n; j++) A[r][j] -= f * A[c][j]
    }
  }
  return A.map((r) => r.slice(n))
}

// ── the whole solve: directions in, conditioning out ────────────────────────
// dirs: array of unit vectors [uE, uN, uU] (east, north, up)
export function dop(dirs) {
  if (dirs.length < 4) return null
  const N = [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ]
  for (const u of dirs) {
    const g = [-u[0], -u[1], -u[2], 1]
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) N[i][j] += g[i] * g[j]
  }
  const Q = inv4(N)
  if (!Q) return null
  const sx = Math.sqrt(Math.max(0, Q[0][0]))
  const sy = Math.sqrt(Math.max(0, Q[1][1]))
  const sz = Math.sqrt(Math.max(0, Q[2][2]))
  const st = Math.sqrt(Math.max(0, Q[3][3]))
  if (![sx, sy, sz, st].every(Number.isFinite)) return null
  return {
    Q,
    sx,
    sy,
    sz,
    H: Math.sqrt(Q[0][0] + Q[1][1]),
    V: sz,
    T: st,
    P: Math.sqrt(Q[0][0] + Q[1][1] + Q[2][2]),
    // the two numbers this piece is about
    perAxis: sz / Math.sqrt(0.5 * (Q[0][0] + Q[1][1])), // sigma_z / sigma_horizontal-per-axis
    rho: Q[2][3] / (sz * st), // how confused altitude and the clock are
    n: dirs.length,
  }
}

// ── the closed form the picture is being checked against ────────────────────
// mask in radians; -PI/2 means the full sphere (the counterfactual).
export function limit(maskRad) {
  const s = Math.sin(maskRad)
  const Ez = (1 + s) / 2
  const Ez2 = (1 + s + s * s) / 3
  const det = Ez2 * 1 - Ez * Ez
  const Qzz = 1 / det
  const Qzt = Ez / det
  const Qtt = Ez2 / det
  const Qxx = 2 / (1 - Ez2)
  return {
    Ez,
    perAxis: Math.sqrt(Qzz / Qxx),
    rho: Qzt / Math.sqrt(Qzz * Qtt),
  }
}

export const HORIZON = limit(0) //  perAxis = 2      rho = sqrt(3)/2
export const FULLSKY = limit(-Math.PI / 2) //  perAxis = 1      rho = 0

// ── constellation ───────────────────────────────────────────────────────────
// GPS-like: 6 planes, 4 per plane, 55 deg inclination, r = 4.164 Earth radii.
// Real rise/set geometry matters here — a hand-waved ring of points would put
// satellites at elevations the sky never actually serves, and the whole claim
// is about which elevations you are allowed to have.
export const CONST = {
  planes: 6,
  perPlane: 4,
  inc: (55 * Math.PI) / 180,
  rs: 4.164, // GPS semi-major / Earth radius
  lat: (35.68 * Math.PI) / 180, // receiver latitude
  period: 11.967, // hours, sidereal
}

export const SATS = (() => {
  const out = []
  for (let p = 0; p < CONST.planes; p++) {
    for (let k = 0; k < CONST.perPlane; k++) {
      out.push({
        id: `${String.fromCharCode(65 + p)}${k + 1}`,
        raan: (2 * Math.PI * p) / CONST.planes,
        // stagger within the plane, plus a per-plane offset so the planes do
        // not all present the same phase at once
        u0: (2 * Math.PI * k) / CONST.perPlane + (p * Math.PI) / CONST.planes,
      })
    }
  }
  return out
})()

// hours -> every satellite's local direction and elevation
export function look(hours) {
  const { inc, rs, lat, period } = CONST
  const n = (2 * Math.PI) / period // orbital rate, rad/hour
  const we = (2 * Math.PI) / 23.934 // Earth rotation, rad/hour

  // receiver on the unit Earth, carried east by rotation
  const lon = we * hours
  const cl = Math.cos(lat)
  const rec = [cl * Math.cos(lon), cl * Math.sin(lon), Math.sin(lat)]
  // local ENU basis at the receiver
  const up = rec
  let east = [-Math.sin(lon), Math.cos(lon), 0]
  const north = [
    up[1] * east[2] - up[2] * east[1],
    up[2] * east[0] - up[0] * east[2],
    up[0] * east[1] - up[1] * east[0],
  ]

  const ci = Math.cos(inc)
  const si = Math.sin(inc)

  return SATS.map((s) => {
    const u = s.u0 + n * hours
    const cu = Math.cos(u)
    const su = Math.sin(u)
    // in-plane -> inclined -> rotated to its RAAN
    const x0 = cu
    const y0 = su * ci
    const z0 = su * si
    const cO = Math.cos(s.raan)
    const sO = Math.sin(s.raan)
    const pos = [rs * (x0 * cO - y0 * sO), rs * (x0 * sO + y0 * cO), rs * z0]

    const d = [pos[0] - rec[0], pos[1] - rec[1], pos[2] - rec[2]]
    const L = Math.hypot(d[0], d[1], d[2])
    d[0] /= L
    d[1] /= L
    d[2] /= L

    const uE = d[0] * east[0] + d[1] * east[1] + d[2] * east[2]
    const uN = d[0] * north[0] + d[1] * north[1] + d[2] * north[2]
    const uU = d[0] * up[0] + d[1] * up[1] + d[2] * up[2]

    return { id: s.id, dir: [uE, uN, uU], elev: Math.asin(Math.max(-1, Math.min(1, uU))) }
  })
}

// ── the frame: what the solve sees, and what it would see if the ground were
//    not there. Same instant, same satellites, one difference: the cut.
export function solveFrame(hours, maskDeg) {
  const all = look(hours)
  const mask = (maskDeg * Math.PI) / 180
  const visible = all.filter((s) => s.elev >= mask)

  const real = dop(visible.map((s) => s.dir))
  const full = dop(all.map((s) => s.dir)) // counterfactual: see through the Earth

  return { all, visible, mask, real, full }
}
