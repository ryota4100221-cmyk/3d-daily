// rig.js — Day 085 · The Depth the Page Is Sewn To
//
// A horizontal-scroll section turns the wheel's vertical distance into sideways
// travel. In a DOM page everything on the strip moves exactly 1 px per 1 px of
// scroll. Put the strip into a perspective camera and move the *camera* instead,
// and that is no longer true: a truck of Δx metres moves a point at distance d
// by Δx·K/d pixels. Exactly one distance moves 1:1 with the page. Everything
// nearer overtakes the page, everything further lags it.
//
// This file says nothing about "parallax" or "speed". It only fixes three
// distances and one conversion (scroll px → camera metres at the word plane).
// The 2.00× / 1.00× / 0.333× in the readout are measured from projected points.

// ── the lens ────────────────────────────────────────────────────────────────
// Camera is kept level (verticals stay vertical, as an architectural
// photographer would) and the frame is shifted down with setViewOffset so the
// horizon sits at 72% of the screen height instead of 50%. That is a shift lens.
export const EYE = 1.6 // m, eye height
export const HORIZON = 0.72 // horizon position, fraction of screen height from top
export const K_PER_H = 0.714 // screen px per (metre / metre) at unit distance, per px of viewport height
// Full (unshifted) image is 2·HORIZON·H tall; its fov follows from K.
export const FOV = (2 * Math.atan(HORIZON / K_PER_H) * 180) / Math.PI

// ── the three depths ────────────────────────────────────────────────────────
export const D_NEAR = 8 // timber frames
export const D_WORD = 16 // the wordmark — the plane the page is sewn to
export const D_FAR = 48 // roofs on the ridge line
export const LAYERS = [
  { key: 'near', d: D_NEAR, label: 'Frames' },
  { key: 'word', d: D_WORD, label: 'Wordmark' },
  { key: 'far', d: D_FAR, label: 'Ridge' },
]

// px per metre at distance d for a viewport of height H
export const pxPerM = (d, H) => (K_PER_H * H) / d

// Layout is authored at a 1000 px tall design viewport and in *page px on the
// word plane*, exactly as one would author a horizontal-scroll strip in CSS.
export const DESIGN_H = 1000
export const S_WORD = pxPerM(D_WORD, DESIGN_H) // 44.625 px/m
export const pagePxToWorld = (px) => px / S_WORD

// scroll px (at design height) → camera x (m). At other heights the page
// strip is scaled with the viewport, so the conversion stays 1:1.
export const camXFromScroll = (scroll, H) => scroll / pxPerM(D_WORD, H)

// ── the strip (page px, word plane) ─────────────────────────────────────────
// After the site: 注文住宅・リフォーム・不動産仲介・カフェ運営.
export const TRACK = 6400 // total horizontal travel in page px
export const CHAPTERS = [
  { px: 380, no: '00', en: 'Since 1959', ja: '兵庫・西脇', kind: 'gable2' },
  { px: 1600, no: '01', en: 'Order Housing', ja: '注文住宅', kind: 'gable1' },
  { px: 2850, no: '02', en: 'Renovation', ja: 'リフォーム', kind: 'renov' },
  { px: 4100, no: '03', en: 'Real Estate', ja: '不動産仲介', kind: 'flat' },
  { px: 5350, no: '04', en: 'Café', ja: 'カフェ運営', kind: 'cafe' },
]
export const WORDMARK = { text: 'Shichifuku', px: -752, sizePx: 345.6, tracking: -0.05 }

// ── timber frames ───────────────────────────────────────────────────────────
// 910 mm module (三尺), 105 mm posts (三寸五分). Each member is a box between two
// points; the frame generator only lists joints.
export const MOD = 0.91
export const POST = 0.105

function member(a, b, t = POST, accent = false) {
  return { a, b, t, accent }
}

// A house, centred on x = cx at distance D_NEAR from the camera track.
// Coordinates: x along the street, y up, z toward the camera (camera at z = 0,
// house front face at z = -D_NEAR, back face deeper).
export function house(cx, kind) {
  const m = []
  const nx = kind === 'cafe' ? 10 : kind === 'flat' ? 9 : 8
  const nz = 5
  const w = nx * MOD
  const dep = nz * MOD
  const x0 = cx - w / 2
  const zf = -D_NEAR
  const zb = zf - dep
  const storeys = kind === 'renov' || kind === 'cafe' || kind === 'gable1' ? 1 : 2
  const H1 = 2.9
  const eave = storeys === 2 ? 5.6 : 2.9
  const sill = 0.3
  const posts = []
  for (let i = 0; i <= nx; i++) {
    // cafe: leave out two posts on the front for the big opening
    const open = kind === 'cafe' && (i === 4 || i === 6)
    if (i % 2 === 0 || i === nx) posts.push({ x: x0 + i * MOD, front: !open })
  }
  for (const p of posts) {
    if (p.front) m.push(member([p.x, sill, zf], [p.x, eave, zf]))
    m.push(member([p.x, sill, zb], [p.x, eave, zb]))
  }
  for (const z of [zf, zb]) {
    m.push(member([x0, sill, z], [x0 + w, sill, z], 0.12)) // 土台 sill
    m.push(member([x0, eave, z], [x0 + w, eave, z], 0.15)) // 軒桁 eave beam
    if (storeys === 2) m.push(member([x0, H1, z], [x0 + w, H1, z], 0.15)) // 胴差
  }
  for (const x of [x0, x0 + w]) {
    for (let k = 1; k < nz; k += 2) {
      m.push(member([x, sill, zf - k * MOD], [x, eave, zf - k * MOD]))
    }
    m.push(member([x, eave, zf], [x, eave, zb], 0.15))
    m.push(member([x, sill, zf], [x, sill, zb], 0.12))
    if (storeys === 2) m.push(member([x, H1, zf], [x, H1, zb], 0.15))
  }
  // 筋交い braces in the end bays of the front
  const brace = (xa, xb, ya, yb, accent) => m.push(member([xa, ya, zf], [xb, yb, zf], 0.09, accent))
  brace(x0, x0 + 2 * MOD, sill, storeys === 2 ? H1 : eave)
  brace(x0 + w, x0 + w - 2 * MOD, sill, storeys === 2 ? H1 : eave)
  if (kind === 'renov') {
    // the renovation house: the new members are the accent
    brace(x0 + 2 * MOD, x0 + 4 * MOD, sill, eave, true)
    brace(x0 + 6 * MOD, x0 + 4 * MOD, sill, eave, true)
  }
  // roof
  if (kind === 'flat') {
    for (let i = 0; i <= nx; i += 3) m.push(member([x0 + i * MOD, eave, zf], [x0 + i * MOD, eave, zb], 0.12))
    m.push(member([x0 - 0.3, eave + 0.25, zf + 0.3], [x0 + w + 0.3, eave + 0.25, zf + 0.3], 0.2))
  } else {
    // gable runs along x (ridge parallel to the street), rafters in section
    const rise = kind === 'cafe' ? 1.4 : 1.9
    const zc = (zf + zb) / 2
    const ridge = eave + rise
    for (let i = 0; i <= nx; i += 2) {
      const x = x0 + i * MOD
      m.push(member([x, eave, zf + 0.35], [x, ridge, zc], 0.09))
      m.push(member([x, eave, zb - 0.35], [x, ridge, zc], 0.09))
      if (i === 0 || i === nx) m.push(member([x, eave, zc], [x, ridge, zc], 0.105)) // 束
    }
    m.push(member([x0 - 0.35, ridge, zc], [x0 + w + 0.35, ridge, zc], 0.15)) // 棟木
  }
  return m
}

export function allMembers() {
  const out = []
  for (const c of CHAPTERS) out.push(...house(pagePxToWorld(c.px), c.kind))
  return out
}

// ── ridge line (far) ────────────────────────────────────────────────────────
function rng(seed) {
  let s = seed >>> 0
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
}
export function ridgeRoofs() {
  const r = rng(85)
  const out = []
  let x = -60
  while (x < 220) {
    const w = 6 + r() * 9
    const h = 3 + r() * 5
    const pitch = 0.35 + r() * 0.35
    out.push({ x: x + w / 2, w, h, roof: w * 0.5 * pitch, z: -D_FAR - r() * 2 })
    x += w + 0.6 + r() * 5
  }
  return out
}
