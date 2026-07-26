// plates.js — procedural artwork plates drawn on a 2D <canvas>.
//
// Day 027 is the first day in this project that puts an actual *texture* on a
// mesh. Every previous day painted surfaces from GLSL alone. An Awwwards
// gallery is nothing without its images, and fetching images would break the
// offline-safe rule that has held for 26 days — so the "photographs" are
// generated: ten editorial posters composed here in Canvas2D, then uploaded as
// CanvasTextures. Bonus: Canvas2D gives us crisp real typography inside WebGL
// without troika/<Text> (the component that has historically white-screened
// this project when a font fails to load).

const PAPER = '#ede7da'
const SAND = '#d9cfba'
const INK = '#23252c'
const TERRA = '#c8603a'
const SLATE = '#4a5157'

// deterministic RNG so a given plate looks identical on every reload
// (headless previews stay reproducible)
function mulberry32(a) {
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const PLATES = [
  { title: 'MERIDIAN', caption: 'ARC · HORIZON', year: 'MMXXVI' },
  { title: 'VITRINE', caption: 'GLASS · DISPLAY', year: 'MMXXVI' },
  { title: 'PENUMBRA', caption: 'SOFT · SHADOW', year: 'MMXXVI' },
  { title: 'SILICA', caption: 'GRAIN · FIELD', year: 'MMXXVI' },
  { title: 'AZIMUTH', caption: 'ANGLE · OF · LIGHT', year: 'MMXXVI' },
  { title: 'RESONANCE', caption: 'SPECTRUM · FORM', year: 'MMXXVI' },
  { title: 'LACUNA', caption: 'VOID · AS · SUBJECT', year: 'MMXXVI' },
  { title: 'TERRA', caption: 'EARTH · PIGMENT', year: 'MMXXVI' },
  { title: 'STILLWATER', caption: 'FLAT · PLANE', year: 'MMXXVI' },
  { title: 'AURELIA', caption: 'SLOW · DRIFT', year: 'MMXXVI' },
]

// each plate gets its own ground / mark / accent so the strip reads as a
// curated set rather than ten variations of one swatch
const SCHEMES = [
  { bg: PAPER, fg: INK, ac: TERRA },
  { bg: INK, fg: PAPER, ac: TERRA },
  { bg: SAND, fg: INK, ac: SLATE },
  { bg: PAPER, fg: SLATE, ac: TERRA },
  { bg: TERRA, fg: PAPER, ac: INK },
  { bg: PAPER, fg: INK, ac: SLATE },
  { bg: SAND, fg: INK, ac: TERRA },
  { bg: INK, fg: SAND, ac: TERRA },
  { bg: PAPER, fg: INK, ac: TERRA },
  { bg: SLATE, fg: PAPER, ac: TERRA },
]

const W = 900
const H = 1200

// ---------------------------------------------------------------- motifs ----
// Ten compositional systems. Each one draws inside the margin box only; the
// typography block below is drawn on top afterwards, so motifs are told to
// keep out of the bottom sixth.

function mArcs(ctx, r, c) {
  const cx = W * 0.5
  const cy = H * 0.46
  ctx.lineWidth = 2
  ctx.strokeStyle = c.fg
  for (let i = 0; i < 9; i++) {
    const rad = 70 + i * 38
    ctx.globalAlpha = 0.28 + i * 0.06
    ctx.beginPath()
    ctx.arc(cx, cy, rad, Math.PI * 0.08, Math.PI * 1.12)
    ctx.stroke()
  }
  ctx.globalAlpha = 1
  ctx.fillStyle = c.ac
  ctx.beginPath()
  ctx.arc(cx, cy, 46, 0, Math.PI * 2)
  ctx.fill()
}

function mGrid(ctx, r, c) {
  const cols = 13
  const rows = 15
  const x0 = W * 0.14
  const y0 = H * 0.12
  const gw = W * 0.72
  const gh = H * 0.66
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const u = i / (cols - 1)
      const v = j / (rows - 1)
      const d = Math.hypot(u - 0.62, v - 0.38)
      const s = Math.max(0, 1 - d * 1.65) * 15 + 1.2
      ctx.fillStyle = d < 0.22 ? c.ac : c.fg
      ctx.globalAlpha = 0.25 + Math.max(0, 1 - d * 1.5) * 0.75
      ctx.beginPath()
      ctx.arc(x0 + u * gw, y0 + v * gh, s, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  ctx.globalAlpha = 1
}

function mBars(ctx, r, c) {
  const y0 = H * 0.1
  const hgt = H * 0.7
  let x = W * 0.13
  const right = W * 0.87
  let k = 0
  while (x < right) {
    const w = 8 + r() * 54
    if (x + w > right) break
    ctx.fillStyle = k === 3 ? c.ac : c.fg
    ctx.globalAlpha = k === 3 ? 1 : 0.14 + r() * 0.5
    ctx.fillRect(x, y0 + r() * 60, w, hgt - r() * 120)
    x += w + 10 + r() * 18
    k++
  }
  ctx.globalAlpha = 1
}

function mSplit(ctx, r, c) {
  const cx = W * 0.5
  const cy = H * 0.42
  const rad = W * 0.32
  ctx.fillStyle = c.fg
  ctx.beginPath()
  ctx.arc(cx, cy, rad, Math.PI * 0.5, Math.PI * 1.5)
  ctx.fill()
  ctx.strokeStyle = c.fg
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(cx, cy, rad, -Math.PI * 0.5, Math.PI * 0.5)
  ctx.stroke()
  ctx.fillStyle = c.ac
  ctx.fillRect(cx - 3, cy - rad - 90, 6, rad * 2 + 180)
}

function mWave(ctx, r, c) {
  ctx.lineWidth = 2.2
  for (let j = 0; j < 26; j++) {
    const y = H * 0.12 + j * (H * 0.026)
    const amp = 10 + Math.sin(j * 0.42) * 46
    ctx.strokeStyle = j === 14 ? c.ac : c.fg
    ctx.globalAlpha = j === 14 ? 1 : 0.2 + Math.sin(j * 0.3) * 0.2 + 0.25
    ctx.beginPath()
    for (let i = 0; i <= 90; i++) {
      const t = i / 90
      const x = W * 0.12 + t * W * 0.76
      const yy = y + Math.sin(t * 6.0 + j * 0.34) * amp * (0.3 + t * 0.9)
      i ? ctx.lineTo(x, yy) : ctx.moveTo(x, yy)
    }
    ctx.stroke()
  }
  ctx.globalAlpha = 1
}

function mHalftone(ctx, r, c) {
  const n = 17
  const x0 = W * 0.13
  const gw = W * 0.74
  const cell = gw / n
  for (let j = 0; j < 20; j++) {
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1)
      const v = j / 19
      const t = Math.min(1, Math.max(0, (u + v) * 0.62))
      const s = cell * 0.9 * t
      if (s < 0.6) continue
      ctx.fillStyle = t > 0.86 ? c.ac : c.fg
      ctx.globalAlpha = 0.9
      ctx.fillRect(
        x0 + i * cell + (cell - s) * 0.5,
        H * 0.1 + j * cell + (cell - s) * 0.5,
        s,
        s,
      )
    }
  }
  ctx.globalAlpha = 1
}

function mRings(ctx, r, c) {
  const cx = W * 0.52
  const cy = H * 0.4
  ctx.strokeStyle = c.fg
  for (let i = 0; i < 22; i++) {
    ctx.lineWidth = 1.4
    ctx.globalAlpha = 0.12 + (i / 22) * 0.6
    ctx.beginPath()
    ctx.arc(cx - i * 3.2, cy, 24 + i * 13, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.globalAlpha = 1
  ctx.fillStyle = c.ac
  ctx.beginPath()
  ctx.arc(cx + 120, cy - 130, 30, 0, Math.PI * 2)
  ctx.fill()
}

function mBlock(ctx, r, c) {
  ctx.fillStyle = c.fg
  ctx.globalAlpha = 0.9
  ctx.fillRect(W * 0.13, H * 0.1, W * 0.74, H * 0.6)
  ctx.globalAlpha = 1
  ctx.fillStyle = c.bg
  ctx.fillRect(W * 0.3, H * 0.26, W * 0.4, H * 0.28)
  ctx.fillStyle = c.ac
  ctx.fillRect(W * 0.3, H * 0.26, W * 0.4, 14)
  ctx.fillRect(W * 0.13, H * 0.74, W * 0.28, 6)
}

function mTopo(ctx, r, c) {
  const cx = W * 0.5
  const cy = H * 0.4
  ctx.lineWidth = 2
  for (let i = 0; i < 14; i++) {
    const k = i / 13
    ctx.strokeStyle = i === 3 ? c.ac : c.fg
    ctx.globalAlpha = i === 3 ? 1 : 0.2 + k * 0.55
    ctx.beginPath()
    for (let a = 0; a <= 72; a++) {
      const th = (a / 72) * Math.PI * 2
      const wob =
        1 +
        Math.sin(th * 3 + i * 0.5) * 0.12 +
        Math.sin(th * 5 - i * 0.31) * 0.07
      const rad = (40 + i * 24) * wob
      const x = cx + Math.cos(th) * rad
      const y = cy + Math.sin(th) * rad * 0.82
      a ? ctx.lineTo(x, y) : ctx.moveTo(x, y)
    }
    ctx.closePath()
    ctx.stroke()
  }
  ctx.globalAlpha = 1
}

function mSlash(ctx, r, c) {
  ctx.save()
  ctx.beginPath()
  ctx.rect(W * 0.13, H * 0.1, W * 0.74, H * 0.62)
  ctx.clip()
  ctx.lineWidth = 3
  for (let i = -30; i < 60; i++) {
    const x = W * 0.13 + i * 22
    const inGap = i > 14 && i < 22
    ctx.strokeStyle = inGap ? c.ac : c.fg
    ctx.globalAlpha = inGap ? 1 : 0.35
    if (inGap && i % 2) continue
    ctx.beginPath()
    ctx.moveTo(x, H * 0.1)
    ctx.lineTo(x + H * 0.42, H * 0.72)
    ctx.stroke()
  }
  ctx.restore()
  ctx.globalAlpha = 1
}

const MOTIFS = [
  mArcs,
  mGrid,
  mBars,
  mSplit,
  mWave,
  mHalftone,
  mRings,
  mBlock,
  mTopo,
  mSlash,
]

// ------------------------------------------------------------- typography ---

function tracked(ctx, text, x, y, em) {
  // ctx.letterSpacing is Chromium-only; fall back to manual advance so the
  // plates still typeset in other engines.
  if ('letterSpacing' in ctx) {
    ctx.letterSpacing = `${em}px`
    ctx.fillText(text, x, y)
    ctx.letterSpacing = '0px'
    return
  }
  let cx = x
  for (const ch of text) {
    ctx.fillText(ch, cx, y)
    cx += ctx.measureText(ch).width + em
  }
}

const SANS =
  '"Helvetica Neue", Helvetica, Arial, "Liberation Sans", "DejaVu Sans", sans-serif'

export function drawPlate(index) {
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  const item = PLATES[index % PLATES.length]
  const c = SCHEMES[index % SCHEMES.length]
  const r = mulberry32(index * 9176 + 7)

  ctx.fillStyle = c.bg
  ctx.fillRect(0, 0, W, H)

  MOTIFS[index % MOTIFS.length](ctx, r, c)

  // hairline frame — the one element every plate shares
  ctx.globalAlpha = 0.35
  ctx.strokeStyle = c.fg
  ctx.lineWidth = 1.5
  ctx.strokeRect(W * 0.055, H * 0.042, W * 0.89, H * 0.916)
  ctx.globalAlpha = 1

  // running head
  ctx.fillStyle = c.fg
  ctx.textBaseline = 'alphabetic'
  ctx.font = `500 22px ${SANS}`
  ctx.globalAlpha = 0.75
  tracked(ctx, `N° ${String(index + 1).padStart(2, '0')}`, W * 0.1, H * 0.098, 5)
  const yr = item.year
  ctx.font = `500 22px ${SANS}`
  const yw = ctx.measureText(yr).width + yr.length * 5
  tracked(ctx, yr, W * 0.9 - yw, H * 0.098, 5)
  ctx.globalAlpha = 1

  // colophon block
  ctx.fillStyle = c.ac
  ctx.fillRect(W * 0.1, H * 0.792, W * 0.14, 5)

  ctx.fillStyle = c.fg
  ctx.font = `700 96px ${SANS}`
  ctx.fillText(item.title, W * 0.1, H * 0.885)

  ctx.globalAlpha = 0.62
  ctx.font = `500 21px ${SANS}`
  tracked(ctx, item.caption, W * 0.1, H * 0.925, 6)
  ctx.globalAlpha = 1

  // paper grain — keeps the flat fills from looking like vector art.
  // NOTE: putImageData bypasses globalCompositeOperation/alpha entirely, so the
  // noise is baked into a small offscreen tile and *drawn* back as a repeating
  // pattern (which does composite).
  ctx.globalCompositeOperation = 'overlay'
  ctx.globalAlpha = 0.5
  ctx.fillStyle = ctx.createPattern(grainTile(r), 'repeat')
  ctx.fillRect(0, 0, W, H)
  ctx.globalCompositeOperation = 'source-over'
  ctx.globalAlpha = 1

  return canvas
}

const GRAIN = 256
function grainTile(r) {
  const t = document.createElement('canvas')
  t.width = t.height = GRAIN
  const tc = t.getContext('2d')
  const img = tc.createImageData(GRAIN, GRAIN)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    const v = 108 + r() * 40
    d[i] = d[i + 1] = d[i + 2] = v
    d[i + 3] = 255
  }
  tc.putImageData(img, 0, 0)
  return t
}

export const PLATE_ASPECT = W / H
