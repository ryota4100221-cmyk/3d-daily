// rig.js — Day 082
//
// The whole piece is one theorem, and the theorem is about what a photograph
// of a Lambertian object does NOT contain.
//
// Write a surface as a height field z = f(x,y) seen straight down the z axis
// with an orthographic camera. Collect albedo and shape into one field, the
// albedo-scaled unit normal
//
//     b(x,y) = ρ(x,y) · n̂(x,y),      n̂ = (−f_x, −f_y, 1) / √(1 + f_x² + f_y²)
//
// and collect the light direction and its intensity into one vector s. Then a
// Lambertian image is just a dot product:
//
//     I(x,y) = max(0, b(x,y) · s)
//
// Now take any invertible G and replace b by G⁻ᵀb and s by Gs. The dot product
// is unchanged — (G⁻ᵀb)·(Gs) = bᵀG⁻¹Gs = b·s — for EVERY pixel and EVERY light.
// The family of G that keeps b a legal height field is three-dimensional
// (Belhumeur, Kriegman & Yuille 1999). Here only the depth-scaling member is
// used:
//
//     G = diag(1, 1, λ)   ⇒   f̄ = λ f        (the surface is flattened by λ)
//                             ρ̄ = N̄ / (λ N)  (and repainted by this much)
//                             s̄ = (s_x, s_y, λ s_z)
//
// So: flatten the object, repaint it, move the lamp, and no photograph — under
// any illumination, from this camera — can tell the difference. The number λ
// never reaches the image.
//
// Everything below is that one identity plus the arithmetic needed to say how
// big the repaint has to be. There is no "flatten" instruction anywhere: the
// flattening is what G⁻ᵀ does to b, and the matching lamp is what G does to s.

// ── the six columns ────────────────────────────────────────────────────────
// Six, because the source puts exactly six bottles in a row and gives each one
// a colour. Each column is the same object flattened by a different λ.
export const LAMBDAS = [1.0, 0.68, 0.4624, 0.314432, 0.21381, 0.145393]

// The only colour in the frame. Diffar's six scent colours, each bottle split
// cap / body into two tones — so each bar is split the same way.
export const HUES = [
  ['#7FB2C4', '#4E7E90'], // 水色  Japanese Citrus
  ['#5B7A4A', '#3C5531'], // 緑    Woody Earthy
  ['#D7B23C', '#A8842A'], // 黄
  ['#D98E96', '#A85F69'], // 桃
  ['#8E3A46', '#5E2530'], // 臙脂
  ['#7A5A3C', '#513A26'], // 茶
]

export const GROUND = 0.3765 // #606060 — the source's bodyBg, used raw as sRGB
export const INK = '#DCDCDC'
export const SUB = '#8E8E8E'

// ── the surface ────────────────────────────────────────────────────────────
// A bottle in relief: body, shoulder, neck, cap, an inset label panel and a
// knurl on the cap. Six of them in a row, because that is what the source
// puts on its one grey field. Nothing is drawn outside the bottle, so f = 0
// at the edge of the quad and the quad has no edge — it dissolves into the
// ground, which is the thing the source actually does (0.32% designed colour).
const H = 0.42
const T = 0.32

function sdBox(px, py, bx, by, r) {
  const dx = Math.abs(px) - bx + r
  const dy = Math.abs(py) - by + r
  return Math.min(Math.max(dx, dy), 0) + Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) - r
}

function smin(a, b, k) {
  const h = Math.min(1, Math.max(0, 0.5 + (0.5 * (b - a)) / k))
  return b + (a - b) * h - k * h * (1 - h)
}

export function heightAt(x, y) {
  const db = sdBox(x, y + 0.16, 0.3, 0.5, 0.13)
  const dn = sdBox(x, y - 0.42, 0.115, 0.155, 0.055)
  const dc = sdBox(x, y - 0.655, 0.155, 0.125, 0.045)
  const d = Math.min(smin(db, dn, 0.1), dc)
  const t = Math.min(1, Math.max(0, 1 + d / T))
  let f = Math.sqrt(Math.max(0, 1 - t * t))
  const band =
    (1 - smoothstep(0.14, 0.2, Math.abs(y + 0.12))) * (1 - smoothstep(0.2, 0.27, Math.abs(x)))
  f -= 0.085 * band * f
  f += 0.035 * (1 - smoothstep(0.0, 0.03, dc)) * Math.sin(58 * x)
  return H * f
}

function smoothstep(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

// Central differences, with the same ε the shader uses. This matters: the
// identity below has to survive the discretisation, and it does, because
// f̄ = λf is linear — FD(λf) = λ·FD(f) exactly, in floating point too.
const EPS = 0.0035

export function slopeAt(x, y) {
  return [
    (heightAt(x + EPS, y) - heightAt(x - EPS, y)) / (2 * EPS),
    (heightAt(x, y + EPS) - heightAt(x, y - EPS)) / (2 * EPS),
  ]
}

// ── the two ways to look at the row ────────────────────────────────────────
// A: each object gets the lamp that its own G asks for.   b̄·s̄
// B: every object gets the same lamp, and the same paint. ρ·max(0, n̂̄·s)
export function shadeMatched(fx, fy, lambda, s) {
  const N = Math.hypot(fx, fy, 1)
  const b = [-fx / N, -fy / N, 1 / N] // ρ = 1 on the original
  const bBar = [b[0], b[1], b[2] / lambda] // G⁻ᵀ b
  const sBar = [s[0], s[1], lambda * s[2]] // G  s
  return Math.max(0, bBar[0] * sBar[0] + bBar[1] * sBar[1] + bBar[2] * sBar[2])
}

export function shadeShared(fx, fy, lambda, s) {
  const gx = lambda * fx
  const gy = lambda * fy
  const N = Math.hypot(gx, gy, 1)
  return Math.max(0, (-gx * s[0] - gy * s[1] + s[2]) / N)
}

// How much repainting the flattening costs. ρ̄ = N̄/(λN), and its largest value
// is at the flat rim (1/λ), so the normalised paint is N̄/N ∈ (0, 1].
export function albedoFloor(lambda, grid = 160) {
  let lo = 1
  for (let j = 0; j < grid; j++) {
    for (let i = 0; i < grid; i++) {
      const x = -0.55 + (1.1 * (i + 0.5)) / grid
      const y = -0.92 + (1.84 * (j + 0.5)) / grid
      const [fx, fy] = slopeAt(x, y)
      const N = Math.hypot(fx, fy, 1)
      const NB = Math.hypot(lambda * fx, lambda * fy, 1)
      lo = Math.min(lo, NB / N)
    }
  }
  return lo
}

export function lightFrom(az, el) {
  const ce = Math.cos(el)
  return [ce * Math.cos(az), ce * Math.sin(az), Math.sin(el)]
}

// ── the measurement ────────────────────────────────────────────────────────
// Run the two rows on a grid and report, per column, how far its pixels sit
// from column 1. Row A should be at floating-point zero for every λ; row B is
// the same six objects with the naive assumption (same paint, same lamp) and
// separates immediately. Both numbers go on screen — the claim is only worth
// as much as the number next to it.
export function measure(az = 2.36, el = 0.56, grid = 190) {
  const s = lightFrom(az, el)
  const pts = []
  for (let j = 0; j < grid; j++) {
    for (let i = 0; i < grid; i++) {
      const x = -0.55 + (1.1 * (i + 0.5)) / grid
      const y = -0.92 + (1.84 * (j + 0.5)) / grid
      pts.push(slopeAt(x, y))
    }
  }
  const ref = pts.map(([fx, fy]) => shadeMatched(fx, fy, 1, s))
  return LAMBDAS.map((lam, k) => {
    let dA = 0
    let dB = 0
    for (let i = 0; i < pts.length; i++) {
      const [fx, fy] = pts[i]
      dA = Math.max(dA, Math.abs(shadeMatched(fx, fy, lam, s) - ref[i]))
      dB = Math.max(dB, Math.abs(shadeShared(fx, fy, lam, s) - ref[i]))
    }
    return { k, lambda: lam, dA, dB, rho: albedoFloor(lam), px: pts.length }
  })
}

// ── layout ─────────────────────────────────────────────────────────────────
// One function, used by both the scene and the HTML, so the captions cannot
// drift off the columns they name.
export const WORLD_H = 5.2
export const ROW_A_Y = 0.96
export const ROW_B_Y = -0.94
export const BAR_Y = 0.03

export function layout(px, py) {
  const aspect = px / py
  const worldW = WORLD_H * aspect
  const gutter = Math.min(1.35, worldW * 0.17)
  const left = -worldW / 2 + gutter
  const right = worldW / 2 - Math.min(0.34, worldW * 0.04)
  const n = LAMBDAS.length
  const pitch = (right - left) / n
  const tile = pitch * 0.94
  const tileH = tile * 1.34
  const cx = LAMBDAS.map((_, i) => left + pitch * (i + 0.5))
  const toPx = (x, y) => [
    ((x / (worldW / 2)) * 0.5 + 0.5) * px,
    (0.5 - (y / (WORLD_H / 2)) * 0.5) * py,
  ]
  return { aspect, worldW, worldH: WORLD_H, left, right, pitch, tile, tileH, cx, toPx }
}
