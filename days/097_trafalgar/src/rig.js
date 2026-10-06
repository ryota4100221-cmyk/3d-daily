// rig.js — a school of fish in a tank, seen from directly above, and the one
// thing that makes a startle cross it faster than any fish in it can swim.
//
// Units: 1 = one body length (BL). Time in seconds.
//
// Two rules, nothing else:
//   1. Schooling (Couzin zones): repel inside RR, align inside RO, attract inside RA.
//   2. Contagion: an idle fish that has an *escaping* fish within SEE body
//      lengths is triggered; LATENCY seconds later it escapes too — turns away
//      from the fish it saw and bursts at ESCAPE BL/s for BURST seconds.
//
// There is no "wave" in this file. The ring that runs across the school is
// only the order in which fish happened to see each other. Its speed is
// (distance a glance reaches) / (time to react), and it is fitted from the
// trigger times afterwards, not set.

export const N = 1500
export const TANK = { x0: -64, x1: 64, y0: -30, y1: 32 }

export const CRUISE = 2.2 // BL/s
export const ESCAPE = 7.0 // BL/s — the fastest any fish here ever moves
export const LATENCY = 0.075 // s, glance → C-start
export const BURST = 0.45 // s of escape
export const REFRACT = 4.0 // s before a fish can be startled again
export const SEE = 2.4 // BL — how far an escaping neighbour is noticed

const RR = 1.0
const RO = 3.2
const RA = 7.0
const TURN = 3.2 // rad/s while cruising
const CELL = RA

// seeded rng so the preview is the same frame every time
let seed = 97
export function rnd() {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed / 4294967296
}

export function createSchool() {
  const s = {
    t: 0,
    px: new Float32Array(N),
    py: new Float32Array(N),
    hx: new Float32Array(N),
    hy: new Float32Array(N),
    v: new Float32Array(N),
    phase: new Float32Array(N),
    trig: new Float32Array(N).fill(-1e9), // time of being triggered
    fromx: new Float32Array(N),
    fromy: new Float32Array(N),
    grid: new Map(),
    cascade: null,
    history: [],
  }
  // three loose shoals
  const blobs = [
    [-34, 6, 0.9],
    [6, -6, 1.3],
    [40, 12, 0.8],
  ]
  for (let i = 0; i < N; i++) {
    const b = blobs[i % 3]
    const r = Math.sqrt(rnd()) * 13 * b[2]
    const a = rnd() * Math.PI * 2
    s.px[i] = b[0] + Math.cos(a) * r * 1.4
    s.py[i] = b[1] + Math.sin(a) * r
    const h = (i % 3) * 2.1 + rnd() * 0.6
    s.hx[i] = Math.cos(h)
    s.hy[i] = Math.sin(h)
    s.v[i] = CRUISE
    s.phase[i] = rnd() * 6.28
  }
  return s
}

// 0 idle, 1 triggered (latent), 2 escaping, 3 refractory
export function stateOf(s, i) {
  const dt = s.t - s.trig[i]
  if (dt < 0) return 0
  if (dt < LATENCY) return 1
  if (dt < LATENCY + BURST) return 2
  if (dt < REFRACT) return 3
  return 0
}

function buildGrid(s) {
  const g = s.grid
  g.clear()
  for (let i = 0; i < N; i++) {
    const k = Math.floor(s.px[i] / CELL) * 4096 + Math.floor(s.py[i] / CELL)
    let a = g.get(k)
    if (!a) g.set(k, (a = []))
    a.push(i)
  }
}

// startle every fish within r of (x,y) — a knock on the glass
export function knock(s, x, y, r = 3.5) {
  const c = { t0: s.t, x, y, pts: [], c: null, b: null, reached: 0 }
  for (let i = 0; i < N; i++) {
    const dx = s.px[i] - x
    const dy = s.py[i] - y
    if (dx * dx + dy * dy < r * r && stateOf(s, i) === 0) {
      s.trig[i] = s.t
      const d = Math.hypot(dx, dy) || 1
      s.fromx[i] = -dx / d
      s.fromy[i] = -dy / d
      c.reached++
    }
  }
  if (c.reached === 0) return null
  s.cascade = c
  s.history.push(c)
  return c
}

// least squares d = c·t + b over the contagion-triggered fish
function fit(c) {
  const p = c.pts
  if (p.length < 12) return
  let st = 0, sd = 0, stt = 0, std = 0
  for (const [t, d] of p) {
    st += t; sd += d; stt += t * t; std += t * d
  }
  const n = p.length
  const den = n * stt - st * st
  if (den <= 1e-9) return
  c.c = (n * std - st * sd) / den
  c.b = (sd - c.c * st) / n
}

export function step(s, dt) {
  buildGrid(s)
  const { px, py, hx, hy, v, trig } = s
  const casc = s.cascade
  const nhx = new Float32Array(N)
  const nhy = new Float32Array(N)
  for (let i = 0; i < N; i++) {
    const st = stateOf(s, i)
    const cx = Math.floor(px[i] / CELL)
    const cy = Math.floor(py[i] / CELL)
    let rx = 0, ry = 0, ox = 0, oy = 0, ax = 0, ay = 0
    let nr = 0, no = 0, na = 0
    let seen = -1, seenD = 1e9
    for (let gx = cx - 1; gx <= cx + 1; gx++)
      for (let gy = cy - 1; gy <= cy + 1; gy++) {
        const a = s.grid.get(gx * 4096 + gy)
        if (!a) continue
        for (const j of a) {
          if (j === i) continue
          const dx = px[j] - px[i]
          const dy = py[j] - py[i]
          const d2 = dx * dx + dy * dy
          if (d2 > RA * RA) continue
          const d = Math.sqrt(d2) || 1e-4
          if (d < RR) { rx -= dx / d; ry -= dy / d; nr++ }
          else if (d < RO) { ox += hx[j]; oy += hy[j]; no++ }
          else { ax += dx / d; ay += dy / d; na++ }
          if (st === 0 && d < SEE && d < seenD && stateOf(s, j) === 2) {
            seen = j
            seenD = d
          }
        }
      }

    // contagion
    if (seen >= 0) {
      trig[i] = s.t
      const dx = px[i] - px[seen]
      const dy = py[i] - py[seen]
      const d = Math.hypot(dx, dy) || 1
      s.fromx[i] = dx / d
      s.fromy[i] = dy / d
      if (casc) {
        casc.pts.push([s.t - casc.t0, Math.hypot(px[i] - casc.x, py[i] - casc.y)])
        casc.reached++
      }
    }

    let dx = hx[i], dy = hy[i]
    const st2 = stateOf(s, i)
    if (st2 === 2) {
      // C-start: away from whatever was seen, no turn limit
      dx = s.fromx[i] * 0.85 + hx[i] * 0.15
      dy = s.fromy[i] * 0.85 + hy[i] * 0.15
      v[i] += (ESCAPE - v[i]) * Math.min(1, dt * 30)
    } else {
      if (nr > 0) { dx = rx; dy = ry }
      else {
        dx = hx[i] * 0.6
        dy = hy[i] * 0.6
        if (no > 0) { dx += ox / no; dy += oy / no }
        if (na > 0) { dx += (ax / na) * 0.55; dy += (ay / na) * 0.55 }
      }
      // glass: steer off the walls
      const m = 7
      const T = TANK
      if (px[i] < T.x0 + m) dx += ((T.x0 + m - px[i]) / m) * 2.2
      if (px[i] > T.x1 - m) dx -= ((px[i] - (T.x1 - m)) / m) * 2.2
      if (py[i] < T.y0 + m) dy += ((T.y0 + m - py[i]) / m) * 2.2
      if (py[i] > T.y1 - m) dy -= ((py[i] - (T.y1 - m)) / m) * 2.2
      // a slow current so shoals keep wheeling
      dx += -py[i] * 0.004
      dy += px[i] * 0.004
      v[i] += (CRUISE - v[i]) * Math.min(1, dt * 1.6)
    }
    const L = Math.hypot(dx, dy) || 1
    dx /= L; dy /= L
    // turn-rate limit
    const cur = Math.atan2(hy[i], hx[i])
    let want = Math.atan2(dy, dx) - cur
    want = Math.atan2(Math.sin(want), Math.cos(want))
    const lim = st2 === 2 ? 40 * dt : TURN * dt
    const a = cur + Math.max(-lim, Math.min(lim, want))
    nhx[i] = Math.cos(a)
    nhy[i] = Math.sin(a)
  }
  for (let i = 0; i < N; i++) {
    hx[i] = nhx[i]
    hy[i] = nhy[i]
    px[i] += hx[i] * v[i] * dt
    py[i] += hy[i] * v[i] * dt
    const T = TANK
    px[i] = Math.min(T.x1 - 0.5, Math.max(T.x0 + 0.5, px[i]))
    py[i] = Math.min(T.y1 - 0.5, Math.max(T.y0 + 0.5, py[i]))
    s.phase[i] += dt * (6 + v[i] * 5)
  }
  s.t += dt
  if (casc) fit(casc)
}

// is anything still escaping?
export function quiet(s) {
  for (let i = 0; i < N; i++) {
    const st = stateOf(s, i)
    if (st === 1 || st === 2) return false
  }
  return true
}

// pick the densest place to knock: the fish with the most neighbours
export function densest(s) {
  buildGrid(s)
  let best = 0, bn = -1
  for (let k = 0; k < 60; k++) {
    const i = Math.floor(rnd() * N)
    let n = 0
    for (let j = 0; j < N; j++) {
      const dx = s.px[j] - s.px[i]
      const dy = s.py[j] - s.py[i]
      if (dx * dx + dy * dy < 25) n++
    }
    if (n > bn) { bn = n; best = i }
  }
  return [s.px[best], s.py[best]]
}
