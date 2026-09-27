// A curtain, and nothing that knows it is a curtain.
//
// The whole cloth is NX × NY points joined by three kinds of thread:
//   warp/weft  — neighbours, rest length H (these are the threads the print is on)
//   shear      — diagonals, rest length H·√2, softer
//   bend       — every other point, rest length 2H, softest
// Ten rings sit on a rod. They are closer together than the cloth between them
// (GATHER < 1), and alternate slightly front/back. That is all a pleat is.
//
// The print is not in here. It is in the fragment shader, indexed by uv — and
// uv never changes. So wherever this file moves a point, the pattern at that
// point moves with it. Nothing in the shader follows the folds; it doesn't need to.

export const NX = 46
export const NY = 58
export const H = 0.085
export const RING_EVERY = 5
export const GATHER = 0.52
export const RINGS = Math.floor((NX - 1) / RING_EVERY) + 1

const GRAVITY = -9.8
const DT = 1 / 60
const SUBSTEPS = 2
const ITER = 16
const DAMP = 0.992
const WALL_Z = -0.06 // the cloth may not pass the back of the wall

export function createCloth({ rodX0, rodY, rodZ }) {
  const n = NX * NY
  const pos = new Float32Array(n * 3)
  const prev = new Float32Array(n * 3)
  const pinned = new Uint8Array(n)
  const pin = new Float32Array(n * 3)

  const ringGap = RING_EVERY * H * GATHER
  for (let j = 0; j < NY; j++) {
    for (let i = 0; i < NX; i++) {
      const k = j * NX + i
      // start hanging straight, already gathered, so the first frames are calm
      const x = rodX0 + (i / RING_EVERY) * ringGap
      const y = rodY - j * H
      const z = rodZ
      pos[k * 3] = prev[k * 3] = x
      pos[k * 3 + 1] = prev[k * 3 + 1] = y
      pos[k * 3 + 2] = prev[k * 3 + 2] = z
    }
  }
  for (let r = 0; r < RINGS; r++) {
    const i = Math.min(NX - 1, r * RING_EVERY)
    pinned[i] = 1
    pin[i * 3] = rodX0 + r * ringGap
    pin[i * 3 + 1] = rodY
    pin[i * 3 + 2] = rodZ + (r % 2 ? 0.2 : -0.2)
  }

  // constraints: [a, b, rest, stiffness]
  const cons = []
  const add = (a, b, rest, s) => cons.push(a, b, rest, s)
  for (let j = 0; j < NY; j++) {
    for (let i = 0; i < NX; i++) {
      const k = j * NX + i
      if (i < NX - 1) add(k, k + 1, H, 1)
      if (j < NY - 1) add(k, k + NX, H, 1)
      if (i < NX - 1 && j < NY - 1) {
        add(k, k + NX + 1, H * Math.SQRT2, 0.5)
        add(k + 1, k + NX, H * Math.SQRT2, 0.5)
      }
      if (i < NX - 2) add(k, k + 2, 2 * H, 0.12)
      if (j < NY - 2) add(k, k + 2 * NX, 2 * H, 0.12)
    }
  }
  const C = new Float32Array(cons)
  const nThread = (NX - 1) * NY + NX * (NY - 1)

  const state = {
    pos,
    t: 0,
    strainMax: 0,
    strainMean: 0,
    wind: 0,
    pointer: { x: 0, y: 0, active: false, vx: 0, vy: 0 },
  }

  function windAt(t) {
    // a slow breath with gusts riding on it — never a steady push
    const breath = 0.5 + 0.5 * Math.sin(t * 0.42)
    const gust = Math.max(0, Math.sin(t * 1.3 + Math.sin(t * 0.37) * 2.0))
    return 0.35 + 1.25 * breath * (0.55 + 0.45 * gust)
  }

  function substep(h) {
    const t = state.t
    const w = windAt(t)
    state.wind = w
    const p = state.pointer
    const h2 = h * h
    for (let k = 0; k < n; k++) {
      if (pinned[k]) continue
      const o = k * 3
      const x = pos[o], y = pos[o + 1], z = pos[o + 2]
      const i = k % NX
      const j = (k / NX) | 0
      // wind comes in through the opening (−z → +z is toward the wall, so it
      // pushes the cloth back out toward the sky, and sideways along the rod)
      const s = Math.sin(t * 1.7 + j * 0.21 + i * 0.13) * 0.5 + Math.sin(t * 0.9 - i * 0.31) * 0.5
      const depth = j / (NY - 1)
      let fx = w * 0.55 * (0.4 + 0.6 * s) * depth
      let fy = GRAVITY
      let fz = -w * (0.9 + 0.8 * s) * (0.25 + depth)
      if (p.active) {
        const dx = x - p.x, dy = y - p.y
        const d2 = dx * dx + dy * dy
        const R = 0.7
        if (d2 < R * R) {
          const f = 1 - Math.sqrt(d2) / R
          fz -= 38 * f * f
          fx += p.vx * 14 * f
          fy += p.vy * 14 * f
        }
      }
      const vx = (x - prev[o]) * DAMP
      const vy = (y - prev[o + 1]) * DAMP
      const vz = (z - prev[o + 2]) * DAMP
      prev[o] = x; prev[o + 1] = y; prev[o + 2] = z
      pos[o] = x + vx + fx * h2
      pos[o + 1] = y + vy + fy * h2
      pos[o + 2] = z + vz + fz * h2
    }
    for (let it = 0; it < ITER; it++) {
      for (let c = 0; c < C.length; c += 4) {
        const a = C[c] * 3, b = C[c + 1] * 3
        const rest = C[c + 2], s = C[c + 3]
        const dx = pos[b] - pos[a], dy = pos[b + 1] - pos[a + 1], dz = pos[b + 2] - pos[a + 2]
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-9
        const diff = ((d - rest) / d) * 0.5 * s
        const wa = pinned[C[c]] ? 0 : 1
        const wb = pinned[C[c + 1]] ? 0 : 1
        const sum = wa + wb
        if (!sum) continue
        const ka = (2 * wa) / sum, kb = (2 * wb) / sum
        pos[a] += dx * diff * ka; pos[a + 1] += dy * diff * ka; pos[a + 2] += dz * diff * ka
        pos[b] -= dx * diff * kb; pos[b + 1] -= dy * diff * kb; pos[b + 2] -= dz * diff * kb
      }
      for (let k = 0; k < n; k++) {
        const o = k * 3
        if (pinned[k]) {
          pos[o] = pin[o]; pos[o + 1] = pin[o + 1]; pos[o + 2] = pin[o + 2]
        } else if (pos[o + 2] > WALL_Z) {
          pos[o + 2] = WALL_Z
        }
      }
    }
    state.t += h
  }

  function measure() {
    // strain on the threads the print is on (warp + weft only)
    let max = 0, sum = 0, m = 0
    for (let c = 0; c < C.length; c += 4) {
      if (C[c + 3] !== 1) continue
      const a = C[c] * 3, b = C[c + 1] * 3
      const dx = pos[b] - pos[a], dy = pos[b + 1] - pos[a + 1], dz = pos[b + 2] - pos[a + 2]
      const e = Math.abs(Math.sqrt(dx * dx + dy * dy + dz * dz) / C[c + 2] - 1)
      if (e > max) max = e
      sum += e
      m++
    }
    state.strainMax = max
    state.strainMean = sum / m
  }

  let acc = 0
  function step(dt) {
    acc += Math.min(dt, 0.1)
    let steps = 0
    while (acc >= DT && steps < 4) {
      for (let s = 0; s < SUBSTEPS; s++) substep(DT / SUBSTEPS)
      acc -= DT
      steps++
    }
    if (steps === 4) acc = 0
    measure()
  }

  // settle before the first frame is ever drawn, so a screenshot taken at
  // any moment sees a curtain that has already fallen into its pleats
  function settle(seconds) {
    const steps = Math.round(seconds / DT)
    for (let i = 0; i < steps; i++) for (let s = 0; s < SUBSTEPS; s++) substep(DT / SUBSTEPS)
    measure()
  }

  return { state, step, settle, nThread }
}
