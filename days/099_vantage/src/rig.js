// rig.js — Day 099 · Make the Point
//
// A lattice of red dots that is only a lattice from one point.
//
// Every dot i is placed on the ray from the vantage point E (the origin)
// through lattice node (u_i, v_i) at its own random distance t_i, and its
// radius is r_i = A · t_i, so from E every dot subtends the same angle. From E
// the cloud therefore projects to a perfect, evenly sized grid, and depth is
// invisible. Nothing in this file says "grid" after construction: the grid is
// a property of where you stand.
//
// Two things move the eye, and they are not alike:
//   rotation about E    — every ray turns together, the grid survives exactly
//   translation from E  — a dot at depth t slides by d/t, near dots more than
//                         far ones, and the grid tears (parallax)
// The tear is measured, not drawn: latticeError() projects every dot and every
// lattice direction (a point at infinity, which translation cannot move) with
// the same camera and reports the RMS miss in lattice cells.

export const COLS = 16
export const ROWS = 14
export const STEP = 0.036 // lattice pitch in tan-space (≈ 2.06° per cell)
export const U0 = -0.09 // left edge of the lattice in tan-space
export const V0 = -((ROWS - 1) * STEP) / 2
export const ANG = 0.0085 // dot radius in tan-space (same for every dot from E)
export const T_NEAR = 4
export const T_FAR = 30

// deterministic hash so the cloud is the same on every load
function rand(i) {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

export function buildDots() {
  const dots = []
  let k = 0
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const u = U0 + c * STEP
      const v = V0 + r * STEP
      // ray direction from E, normalised
      const len = Math.hypot(u, v, 1)
      const dir = [u / len, v / len, -1 / len]
      // depth: uniform in 1/t so near and far are equally represented on screen
      const s = rand(k + 1)
      const t = 1 / (1 / T_NEAR + s * (1 / T_FAR - 1 / T_NEAR))
      // distance along the ray such that the camera-space depth (-z) is t
      const along = t * len
      dots.push({
        u,
        v,
        dir,
        t,
        pos: [dir[0] * along, dir[1] * along, dir[2] * along],
        radius: ANG * t, // tan-space radius × depth = world radius
      })
      k++
    }
  }
  return dots
}

// small 3×3 helpers — camera orientation is yaw (about y) then pitch (about x)
function rot(yaw, pitch) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw)
  const cp = Math.cos(pitch), sp = Math.sin(pitch)
  // R = Ry(yaw) · Rx(pitch), columns are the camera axes in world space
  return [
    [cy, sy * sp, sy * cp],
    [0, cp, -sp],
    [-sy, cy * sp, cy * cp],
  ]
}

// world → camera space: R^T (p - C)
function toCam(R, C, p) {
  const x = p[0] - C[0], y = p[1] - C[1], z = p[2] - C[2]
  return [
    R[0][0] * x + R[1][0] * y + R[2][0] * z,
    R[0][1] * x + R[1][1] * y + R[2][1] * z,
    R[0][2] * x + R[1][2] * y + R[2][2] * z,
  ]
}

// RMS distance (in lattice cells) between where each dot lands and where its
// lattice direction lands, for a camera at C with orientation (yaw, pitch).
// Also returns the worst dot, and how far the nearest and farthest dots moved.
export function latticeError(dots, C, yaw, pitch) {
  const R = rot(yaw, pitch)
  let sum = 0, worst = 0
  for (const d of dots) {
    const p = toCam(R, C, d.pos)
    const q = toCam(R, [0, 0, 0], d.dir) // direction: translation drops out
    const px = p[0] / -p[2], py = p[1] / -p[2]
    const qx = q[0] / -q[2], qy = q[1] / -q[2]
    const e = Math.hypot(px - qx, py - qy) / STEP
    sum += e * e
    if (e > worst) worst = e
  }
  return { rms: Math.sqrt(sum / dots.length), worst }
}

// The eye's path. Translation breathes out and back to E every PERIOD seconds
// while its direction turns; yaw sways on its own unrelated clock and never
// touches the grid.
export const PERIOD = 14
export const REACH = 0.45 // metres of translation at the far end of the breath
export const SWAY = (4 * Math.PI) / 180

export function eyeAt(time, pointer) {
  const breath = 0.5 - 0.5 * Math.cos((2 * Math.PI * time) / PERIOD)
  const a = 0.9 + time * 0.31
  const auto = [Math.cos(a) * REACH * breath, Math.sin(a) * REACH * breath * 0.55, 0]
  const w = pointer ? pointer.weight : 0
  const px = pointer ? pointer.x * 0.9 : 0
  const py = pointer ? pointer.y * 0.5 : 0
  const C = [auto[0] * (1 - w) + px * w, auto[1] * (1 - w) + py * w, 0]
  const yaw = SWAY * Math.sin((2 * Math.PI * time) / 17 + 0.4)
  const pitch = SWAY * 0.35 * Math.sin((2 * Math.PI * time) / 23)
  return { C, yaw, pitch, breath }
}

// Closed-form check of the tear for a pure sideways translation d:
// a dot at depth t moves d/t in tan-space, so the error is d·|1/t − ⟨…⟩| — but
// the lattice reference is at infinity, so the miss of each dot is simply d/t
// (in tan units). RMS in cells = d · sqrt(⟨1/t²⟩) / STEP.
export function predictedRms(dots, d) {
  let s = 0
  for (const p of dots) s += 1 / (p.t * p.t)
  return (d * Math.sqrt(s / dots.length)) / STEP
}
