// rig.js — the shore in the sky.
//
// One world unit = 100 m. The island is a height field; the cloud sea is one
// flat lid at height H (the top of the inversion). Nothing in this file or in
// Scene.jsx draws a coastline: the "island" you see is just the set
// { h(x,z) > H }, and its shadow on the cloud is just the sun ray that hits h.
//
// Mikura-jima, for scale: ~20.6 km² (radius ≈ 2.56 km), sea cliffs to ~480 m,
// summit Oyama 851 m, sitting west of centre.

export const UNIT_M = 100
export const PEAK = 8.51 // 851 m
export const R_ISLAND = 25.6 // 2.56 km
export const N = 256 // height-field samples per side
export const SPAN = 64 // the field covers [-32, 32]² world units
export const SEA = -2 // below every cloud lid we allow

// ── deterministic value noise (JS only; the shader samples the baked field) ──
function hash(ix, iz) {
  let h = (ix * 374761393 + iz * 668265263) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295
}
function vnoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z)
  const fx = x - ix, fz = z - iz
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz)
  const a = hash(ix, iz), b = hash(ix + 1, iz)
  const c = hash(ix, iz + 1), d = hash(ix + 1, iz + 1)
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz
}
function ridged(x, z) {
  let s = 0, amp = 0.5, f = 1, norm = 0
  for (let o = 0; o < 5; o++) {
    const n = 1 - Math.abs(vnoise(x * f + o * 17.3, z * f - o * 9.1) * 2 - 1)
    s += n * n * amp
    norm += amp
    amp *= 0.5
    f *= 2.03
  }
  return s / norm
}

function rawHeight(x, z) {
  const ang = Math.atan2(z, x)
  // the outline is a slightly lumpy circle
  const wob = 1 + 0.07 * (vnoise(Math.cos(ang) * 2.2 + 5, Math.sin(ang) * 2.2 + 5) * 2 - 1)
  const r = Math.hypot(x, z) / (R_ISLAND * wob)
  if (r > 1) return SEA
  const s = 1 - r
  const cliff = 3.9 * smooth(0, 0.05, s) // the sea wall
  const d = Math.hypot(x + 4.5, z - 2.5) / R_ISLAND // summit sits west
  const dome = 4.4 * Math.pow(Math.max(0, 1 - d), 1.5)
  const rid = 2.2 * ridged(x * 0.13, z * 0.13) * smooth(0.02, 0.35, s)
  return cliff + dome + rid
}
function smooth(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

// ── bake ───────────────────────────────────────────────────────────────────
export const field = new Float32Array(N * N)
{
  let max = 0
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const x = -SPAN / 2 + (i / (N - 1)) * SPAN
      const z = -SPAN / 2 + (j / (N - 1)) * SPAN
      const h = rawHeight(x, z)
      field[j * N + i] = h
      if (h > max) max = h
    }
  // scale land so the summit is exactly Oyama
  for (let k = 0; k < field.length; k++) if (field[k] > 0) field[k] *= PEAK / max
}

export const CELL_KM2 = Math.pow((SPAN / (N - 1)) * UNIT_M / 1000, 2)
const land = Array.from(field).filter((h) => h > 0).sort((a, b) => a - b)
export const ISLAND_KM2 = land.length * CELL_KM2

// area of the island that stands above a cloud lid at H (binary search on the
// sorted heights — this is the whole "shoreline" computation)
export function areaAbove(H) {
  let lo = 0, hi = land.length
  while (lo < hi) {
    const m = (lo + hi) >> 1
    if (land[m] > H) hi = m
    else lo = m + 1
  }
  return (land.length - lo) * CELL_KM2
}

export function heightAt(x, z) {
  const fi = ((x + SPAN / 2) / SPAN) * (N - 1)
  const fj = ((z + SPAN / 2) / SPAN) * (N - 1)
  if (fi < 0 || fj < 0 || fi > N - 1 || fj > N - 1) return SEA
  const i = Math.min(N - 2, Math.floor(fi)), j = Math.min(N - 2, Math.floor(fj))
  const u = fi - i, v = fj - j
  const a = field[j * N + i], b = field[j * N + i + 1]
  const c = field[(j + 1) * N + i], d = field[(j + 1) * N + i + 1]
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v
}

export const summit = (() => {
  let k = 0
  for (let n = 1; n < field.length; n++) if (field[n] > field[k]) k = n
  const i = k % N, j = (k / N) | 0
  return { x: -SPAN / 2 + (i / (N - 1)) * SPAN, z: -SPAN / 2 + (j / (N - 1)) * SPAN, h: field[k] }
})()

// a west–east section through the summit, for the DOM diagram
export function section(samples = 160) {
  const out = []
  for (let s = 0; s < samples; s++) {
    const x = -30 + (s / (samples - 1)) * 60
    out.push(heightAt(x, summit.z))
  }
  return out
}

// ── time ───────────────────────────────────────────────────────────────────
// Dawn breathes: the sun climbs from 0.6° to 11° and settles back, once a
// minute. Its azimuth is fixed, low and just off the right edge of the frame.
export const DAWN_S = 60
export function sunElevationDeg(t) {
  const p = 0.5 - 0.5 * Math.cos((2 * Math.PI * t) / DAWN_S)
  return 0.6 + 10.4 * p
}
const AZ = Math.atan2(-0.78, 0.62) // direction toward the sun, in xz (far right on screen)
export function sunDir(t, out = [0, 0, 0]) {
  const e = (sunElevationDeg(t) * Math.PI) / 180
  out[0] = Math.cos(e) * Math.cos(AZ)
  out[1] = Math.sin(e)
  out[2] = Math.cos(e) * Math.sin(AZ)
  return out
}

// the inversion lid also breathes, slower and on its own clock
export function lidHeight(t) {
  return 4.7 + 0.55 * Math.sin((2 * Math.PI * t) / 37 + 1.1)
}

// how far the summit's shadow reaches across the lid: (h − H) / tan e
export function peakShadowKm(H, t) {
  const e = (sunElevationDeg(t) * Math.PI) / 180
  const rise = Math.max(0, summit.h - H)
  return (rise / Math.tan(e)) * UNIT_M / 1000
}
