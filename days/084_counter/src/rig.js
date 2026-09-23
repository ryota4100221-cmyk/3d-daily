// rig.js — "weight is a radius".
//
// A specimen ramp (Hairline → Black) is usually drawn by hand, weight by weight.
// Here every weight is the same single-line skeleton, dilated by a disk of radius r:
//     ink(r) = { p : dist(p, skeleton) ≤ r }
// Nothing else changes between rows. The consequences are then not design choices
// but geometry, and this file is where they are measured.
//
// Units: x-height = 1. The bowl of b / o / d is one circle, radius R = 0.5.

export const R = 0.5
export const ASC = 1.62 // ascender top of b, l, d

// Ten named weights of a neo-grotesk ramp, and one row past Black.
// r is the half stroke. The spacing is geometric: a ramp reads as even when each
// step multiplies the stroke, not when it adds to it.
export const WEIGHTS = (() => {
  const names = ['Hairline', 'Thin', 'Extralight', 'Light', 'Book', 'Regular', 'Medium', 'Bold', 'Extrabold', 'Black', 'Past Black']
  const r0 = 0.012
  const r9 = 0.5 * R // Black = half the bowl radius
  return names.map((name, i) => {
    const r = i < 10 ? r0 * Math.pow(r9 / r0, i / 9) : R * 1.08
    return { name, r }
  })
})()

// Sidebearings grow with the stroke: the gap between two skeletons must stay
// wider than two strokes, or neighbouring letters fuse before any counter closes.
export const gapFor = (r) => 0.46 + 2 * r

// Skeleton of "bold" as segments and circles, laid out for weight r.
// Returns { segs:[[x0,y0,x1,y1]], circles:[[cx,cy]], width, counters:[[cx,cy]] }
export function layout(r) {
  const segs = []
  const circles = []
  let x = 0
  const g = gapFor(r)
  // b — stem tangent to the bowl on its left
  segs.push([x, 0, x, ASC])
  circles.push([x + R, R])
  x += 2 * R + g
  // o
  circles.push([x + R, R])
  x += 2 * R + g
  // l
  segs.push([x, 0, x, ASC])
  x += g
  // d — stem tangent to the bowl on its right
  circles.push([x + R, R])
  segs.push([x + 2 * R, 0, x + 2 * R, ASC])
  x += 2 * R
  return { segs, circles, width: x, counters: circles.map((c) => c.slice()) }
}

// ── exact ink of the bare letters ────────────────────────────────────────
// o: annulus while the counter is open, full disk after it closes.
export const inkO = (r) => (r < R ? 4 * Math.PI * R * r : Math.PI * (R + r) * (R + r))
// l: stadium — 2r·h plus two half-disk caps.
export const inkL = (r) => 2 * r * ASC + Math.PI * r * r
// o: the counter left over, radius R − r.
export const counterO = (r) => (r < R ? Math.PI * (R - r) * (R - r) : 0)

// ── distance to the skeleton (CPU twin of the shader) ────────────────────
function dSeg(px, py, s) {
  const ax = s[0], ay = s[1], bx = s[2], by = s[3]
  const vx = bx - ax, vy = by - ay
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy)))
  return Math.hypot(px - ax - t * vx, py - ay - t * vy)
}
const dCirc = (px, py, c) => Math.abs(Math.hypot(px - c[0], py - c[1]) - R)

export function distSkeleton(px, py, L) {
  let d = 1e9
  for (const s of L.segs) d = Math.min(d, dSeg(px, py, s))
  for (const c of L.circles) d = Math.min(d, dCirc(px, py, c))
  return d
}

// Rasterise a word at weight r and measure ink and enclosed counters.
// Counter = non-ink pixels not 4-connected to the border (flood fill).
export function measureWord(r, h = 0.004) {
  const L = layout(r)
  const pad = r + 0.1
  const x0 = -pad, y0 = -pad
  const W = Math.ceil((L.width + 2 * pad) / h)
  const H = Math.ceil((ASC + 2 * pad) / h)
  const ink = new Uint8Array(W * H)
  let inkN = 0
  for (let j = 0; j < H; j++) {
    const py = y0 + (j + 0.5) * h
    for (let i = 0; i < W; i++) {
      const px = x0 + (i + 0.5) * h
      if (distSkeleton(px, py, L) <= r) { ink[j * W + i] = 1; inkN++ }
    }
  }
  // flood the outside
  const seen = new Uint8Array(W * H)
  const stack = []
  const push = (i, j) => {
    if (i < 0 || j < 0 || i >= W || j >= H) return
    const k = j * W + i
    if (seen[k] || ink[k]) return
    seen[k] = 1
    stack.push(k)
  }
  for (let i = 0; i < W; i++) { push(i, 0); push(i, H - 1) }
  for (let j = 0; j < H; j++) { push(0, j); push(W - 1, j) }
  while (stack.length) {
    const k = stack.pop()
    const i = k % W, j = (k / W) | 0
    push(i + 1, j); push(i - 1, j); push(i, j + 1); push(i, j - 1)
  }
  // count enclosed components
  let counters = 0
  let counterN = 0
  for (let k = 0; k < W * H; k++) {
    if (ink[k] || seen[k]) continue
    counters++
    seen[k] = 1
    stack.push(k)
    while (stack.length) {
      const q = stack.pop()
      counterN++
      const i = q % W, j = (q / W) | 0
      for (const [a, b] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]]) {
        if (a < 0 || b < 0 || a >= W || b >= H) continue
        const t = b * W + a
        if (seen[t] || ink[t]) continue
        seen[t] = 1
        stack.push(t)
      }
    }
  }
  return { ink: inkN * h * h, counters, counterArea: counterN * h * h, width: L.width }
}

// Ink of the lone "o" by raster — to check the closed forms above.
export function measureO(r, h = 0.002) {
  const c = [0, 0]
  const e = R + r + 0.02
  let n = 0
  const N = Math.ceil((2 * e) / h)
  for (let j = 0; j < N; j++) {
    const py = -e + (j + 0.5) * h
    for (let i = 0; i < N; i++) {
      const px = -e + (i + 0.5) * h
      if (Math.abs(Math.hypot(px - c[0], py - c[1]) - R) <= r) n++
    }
  }
  return n * h * h
}

// Stroke weight of the breathing row: Hairline → past Black → Hairline.
// Eases so that the moment the counters close is lingered on, not skipped.
// Starts at t0 so the first frame already sits between Black and the close.
// A `?t=` query overrides the start (used for the preview captures).
const T0 = (() => {
  try {
    const q = new URLSearchParams(window.location.search).get('t')
    return q != null ? Number(q) : 3.3
  } catch {
    return 3.3
  }
})()
export function breath(t) {
  const u = 0.5 - 0.5 * Math.cos(((t + T0) / 9) * Math.PI * 2) // 0..1, period 9 s
  const lo = WEIGHTS[0].r, hi = R * 1.12
  return lo * Math.pow(hi / lo, Math.pow(u, 0.8))
}
