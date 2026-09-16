// rig.js — Day 077 · The Waterline That Tells You Nothing
//
// after: uki by non Editions (https://ukibynoneditions.com/)
// The brand's name is read two ways at once — ウキウキ (buoyant spirits) and
// 浮き (buoyancy). This file takes the second reading literally.
//
// Every hull in this file is the same height and the same density. That fixes
// one thing absolutely: they all float at the same draft. The waterline is one
// straight line drawn across twenty-seven different objects, and it is the same
// line whether the hull is narrow or wide, short or long. It carries no
// information about which of them can stand up.
//
// The information is in a dimension that runs ALONG that line, not across it.
//
//   GM = b²/(12T) − (H − T)/2
//
// with T = ρH. Set it to zero and the beam that separates standing from lolling
// falls out with nothing else left in it:
//
//   b_c = √(6·T·(H − T)) = √(6 · 0.6 · 0.4) = 1.200   exactly
//
// No material, no mass, no length, no water depth, no wave height. Only the
// beam — and it enters squared, while the term it has to beat does not contain
// the beam at all.
//
// None of that formula is used to decide anything below. It is written here
// only so the number on screen can be checked. What actually runs is one
// operation repeated: clip a rectangle with a horizontal line.

export const G = 9.81
export const H = 1.0 // every hull, without exception
export const RHO = 0.6 // every hull, without exception
export const DRAFT = RHO * H // 0.600 — therefore every hull, without exception
export const B_CRIT = Math.sqrt(6 * DRAFT * (H - DRAFT)) // 1.200

export const DAMP = 1.55
export const FRONT_SPEED = 4.2 // how fast the swell may travel when chased

// ── the swell ───────────────────────────────────────────────────────────────
// One function. It is the only thing written for the water. The bobbing and the
// tipping are both read out of it — the height places each hull, the slope of
// the same height tilts it — so there is no second law anywhere that says what
// a wave does to a floating body.
//
// The GLSL below is the same expression, kept as one string so the water
// surface and the wet part of every hull cannot drift apart from the physics.
export const SWELL_GLSL = /* glsl */ `
const float SW_W = 2.0;
const float SW_A = 0.10;
const float SW_K = 0.55;
float swell(float x, float front) {
  float u = (x - front) / SW_W;
  if (abs(u) >= 1.0) return 0.0;
  return SW_A * 0.5 * (1.0 + cos(3.141592653589793 * u)) * (1.0 - SW_K * u);
}
`
const SW_W = 2.0
const SW_A = 0.1
const SW_K = 0.55

export function swell(x, front) {
  const u = (x - front) / SW_W
  if (Math.abs(u) >= 1) return 0
  return SW_A * 0.5 * (1 + Math.cos(Math.PI * u)) * (1 - SW_K * u)
}

// The slope is not a second formula. It is a difference of the first one.
export function swellSlope(x, front) {
  const e = 0.02
  return (swell(x + e, front) - swell(x - e, front)) / (2 * e)
}

// ── the one operation ───────────────────────────────────────────────────────
// Sutherland–Hodgman against a horizontal line, then the polygon's own area and
// centroid. Everything this piece does is downstream of these twenty lines.

function clipBelow(poly, level) {
  const out = []
  for (let i = 0; i < poly.length; i += 2) {
    const ax = poly[i], ay = poly[i + 1]
    const j = (i + 2) % poly.length
    const bx = poly[j], by = poly[j + 1]
    const ain = ay <= level
    const bin = by <= level
    if (ain) out.push(ax, ay)
    if (ain !== bin) {
      const t = (level - ay) / (by - ay)
      out.push(ax + t * (bx - ax), level)
    }
  }
  return out
}

function areaCentroid(poly) {
  let A = 0, cx = 0, cy = 0
  for (let i = 0; i < poly.length; i += 2) {
    const j = (i + 2) % poly.length
    const x0 = poly[i], y0 = poly[i + 1], x1 = poly[j], y1 = poly[j + 1]
    const cr = x0 * y1 - x1 * y0
    A += cr
    cx += (x0 + x1) * cr
    cy += (y0 + y1) * cr
  }
  A *= 0.5
  if (Math.abs(A) < 1e-12) return { A: 0, cx: 0, cy: 0 }
  return { A, cx: cx / (6 * A), cy: cy / (6 * A) }
}

// Heel a rectangle of beam b by phi, then slide a horizontal line down it until
// the area underneath equals the area the hull has to displace. Where that line
// lands is the draft; how far the leftover shape's centre has slid sideways is
// the righting arm. There is no stability criterion in here, no capsize test,
// no angle of loll. Those are all names for what this returns.
const SCRATCH = new Float64Array(8)
export function floatState(b, phi) {
  const c = Math.cos(phi), s = Math.sin(phi)
  const hb = b / 2, hh = H / 2
  const cx = [-hb, hb, hb, -hb]
  const cy = [-hh, -hh, hh, hh]
  let lo = Infinity, hi = -Infinity
  for (let k = 0; k < 4; k++) {
    const X = cx[k] * c - cy[k] * s
    const Y = cx[k] * s + cy[k] * c
    SCRATCH[k * 2] = X
    SCRATCH[k * 2 + 1] = Y
    if (Y < lo) lo = Y
    if (Y > hi) hi = Y
  }
  const corners = Array.from(SCRATCH)
  const need = RHO * b * H
  for (let k = 0; k < 30; k++) {
    const mid = (lo + hi) * 0.5
    if (areaCentroid(clipBelow(corners, mid)).A < need) lo = mid
    else hi = mid
  }
  const w = (lo + hi) * 0.5
  const sub = areaCentroid(clipBelow(corners, w))
  // sub.cx is the horizontal offset of the centre of buoyancy from the centre
  // of gravity. That offset IS the righting arm; nothing converts it.
  return { w, gz: sub.cx }
}

// The closed form, kept only for the readout — never used to move anything.
export function gmOf(b) {
  return (b * b) / (12 * DRAFT) - (H - DRAFT) / 2
}

// ── the fleet ───────────────────────────────────────────────────────────────
// Beam steps by a constant 0.05. Length is drawn at random and deliberately
// varies by a factor of three, because length appears nowhere in b_c and the
// only way to show that is to let it vary and watch it not matter.
export function makeFleet() {
  let seed = 20260917 >>> 0
  const rnd = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 4294967296
  }
  const fleet = []
  let cursor = 0
  for (let i = 0; i < 27; i++) {
    const b = 0.72 + 0.05 * i
    const len = 0.9 + 2.0 * rnd()
    const half = Math.max(b, H) / 2
    cursor += half
    fleet.push({
      i,
      b,
      len,
      x: cursor,
      phi: 0,
      omega: 0,
      y: -DRAFT + H / 2,
      gz: 0,
      gm: gmOf(b),
    })
    cursor += half + 0.66
  }
  return fleet
}

export function stripLength(fleet) {
  return fleet[fleet.length - 1].x + 1
}

// ── time ────────────────────────────────────────────────────────────────────
export function step(fleet, front, dt) {
  const sub = 3
  const h = dt / sub
  for (let s = 0; s < sub; s++) {
    for (let k = 0; k < fleet.length; k++) {
      const bl = fleet[k]
      // The water surface is tilted here by this much; read straight off swell().
      const alpha = Math.atan(swellSlope(bl.x, front))
      const st = floatState(bl.b, bl.phi - alpha)
      const k2 = (bl.b * bl.b + H * H) / 12
      bl.omega += (G * st.gz / k2 - DAMP * bl.omega) * h
      bl.phi += bl.omega * h
      if (bl.phi > 2.6) { bl.phi = 2.6; bl.omega = 0 }
      if (bl.phi < -2.6) { bl.phi = -2.6; bl.omega = 0 }
      bl.gz = st.gz
      bl.y = swell(bl.x, front) - st.w
    }
  }
}

// Deterministic pre-roll: walk the swell in from off the left end at a fixed
// step so the page looks the same every time it is opened, and so a still frame
// is a statement about the physics rather than about when the shutter fired.
export function preroll(fleet, front, settle = 40) {
  const dt = 1 / 70
  let f = -SW_W - 1
  const v = 2.6
  let guard = 0
  while (f < front && guard++ < 6000) {
    f = Math.min(front, f + v * dt)
    step(fleet, f, dt)
  }
  // Then hold the water still and let them finish. Near the threshold the fall
  // takes its time — the closer GM is to zero the longer it takes, without
  // limit — so a page that opened on the swell alone would open on a lie.
  for (let i = 0; i < Math.round(settle / dt); i++) step(fleet, front, dt)
  return f
}
