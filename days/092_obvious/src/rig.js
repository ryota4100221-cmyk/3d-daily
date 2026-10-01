// rig.js — the obvious face, and what sits under it.
//
// The source (日暮里ゼミナール, nippori.lamm.tokyo) opens on one thing: "Under the
// Obvious" in Helvetica at 260px, leading 75%, tracking −5%, stacked flush left
// on white. At 75% the cap height (~0.72em) nearly fills the line, so the three
// lines lock into one slab of type. That slab is the only thing we take.
//
// Device — "the voice under the obvious" (声の奥行き):
//   the slab is cut into thin vertical strips. Seen head-on through an
//   orthographic lens every strip has the same front face, so the type reads
//   perfectly flat — the obvious. Each strip is extruded backwards by the
//   loudness of a spoken voice at the moment that strip represents (x = time).
//   The voice moves right-to-left like the site's marquee, so the back of the
//   type is always changing while the front never does. Turn the camera and
//   the word turns out to be a waveform.

// ── type spec (measured on the source, in em) ───────────────────────────
export const LINES = ['Under', 'the', 'Obvious']
export const LEADING = 0.75 // 195px / 260px
export const TRACKING = -0.05 // −13px / 260px
const PX = 220 // raster resolution: px per em
export const COLS = 900 // strips across the widest line

// ── voice (all in "seconds of audio") ──────────────────────────────────
export const SYLLABLE_HZ = 4.2 // mean syllable rate of conversational Japanese/English
export const SPAN = 9.0 // seconds of speech laid across the slab
export const SPEED = 0.55 // audio seconds per wall-clock second
export const DMAX = 1.35 // deepest extrusion, em

// Rasterise the slab and return one record per vertical run of ink in each
// strip: [xCenter, yCenter, width, height, u] in em, origin at slab centre.
export async function buildRuns(fontUrl) {
  const face = new FontFace('Slab', `url(${fontUrl})`)
  await face.load()
  document.fonts.add(face)

  const c = document.createElement('canvas')
  const g = c.getContext('2d', { willReadFrequently: true })
  const font = `400 ${PX}px Slab`
  g.font = font
  g.letterSpacing = `${TRACKING * PX}px`
  const widths = LINES.map((l) => g.measureText(l).width)
  const W = Math.ceil(Math.max(...widths)) + 8
  const lineH = LEADING * PX
  const H = Math.ceil(lineH * (LINES.length - 1) + PX * 1.0)
  c.width = W
  c.height = H
  g.font = font
  g.letterSpacing = `${TRACKING * PX}px`
  g.fillStyle = '#000'
  g.textBaseline = 'alphabetic'
  // first baseline sits one cap-height (≈0.73em) below the top edge
  LINES.forEach((l, i) => g.fillText(l, 2, PX * 0.76 + i * lineH))

  const img = g.getImageData(0, 0, W, H).data
  const colW = W / COLS
  const runs = []
  for (let ci = 0; ci < COLS; ci++) {
    const px = Math.min(W - 1, Math.floor((ci + 0.5) * colW))
    let start = -1
    for (let y = 0; y <= H; y++) {
      const ink = y < H && img[(y * W + px) * 4 + 3] > 127
      if (ink && start < 0) start = y
      if (!ink && start >= 0) {
        const y0 = start / PX
        const y1 = y / PX
        runs.push([
          ((ci + 0.5) * colW) / PX - W / PX / 2,
          -((y0 + y1) / 2 - H / PX / 2),
          colW / PX,
          y1 - y0,
          ci / (COLS - 1),
        ])
        start = -1
      }
    }
  }
  return { runs, width: W / PX, height: H / PX }
}

// Same envelope as the shader, for the HUD.
const hash = (n) => {
  const s = Math.sin(n * 127.1) * 43758.5453
  return s - Math.floor(s)
}
export function loudness(s) {
  const word = Math.floor(s * 0.85)
  if (hash(word + 11.3) < 0.2) return 0 // a breath between phrases
  const k = Math.floor(s * SYLLABLE_HZ)
  const f = s * SYLLABLE_HZ - k
  return (0.35 + 0.65 * hash(k)) * Math.pow(Math.sin(Math.PI * f), 0.7)
}

export const voiceGLSL = /* glsl */ `
  float h1(float n){ return fract(sin(n*127.1)*43758.5453); }
  float loudness(float s){
    float word = floor(s*0.85);
    float gate = step(0.2, h1(word+11.3));
    float k = floor(s*${SYLLABLE_HZ.toFixed(2)});
    float f = s*${SYLLABLE_HZ.toFixed(2)} - k;
    float env = (0.35 + 0.65*h1(k)) * pow(sin(3.14159265*f), 0.7);
    // fine grain: the waveform's own texture inside the envelope
    float grain = 0.82 + 0.18*h1(floor(s*90.0)+3.7);
    return gate * env * grain;
  }
`

// Camera keyframes along the scroll: azimuth, elevation (rad).
//   0.0 face   — straight on: the obvious
//   0.5 turn   — three-quarter: the strips have depth
//   1.0 above  — from overhead the slab is a plotted voice
export const KEYS = [
  { p: 0.0, az: 0.0, el: 0.0 },
  { p: 0.5, az: -0.95, el: 0.34 },
  { p: 1.0, az: -0.18, el: 1.32 },
]
export function pose(p) {
  const sm = (t) => t * t * (3 - 2 * t)
  for (let i = 0; i < KEYS.length - 1; i++) {
    const a = KEYS[i]
    const b = KEYS[i + 1]
    if (p <= b.p) {
      const t = sm(Math.min(1, Math.max(0, (p - a.p) / (b.p - a.p))))
      return { az: a.az + (b.az - a.az) * t, el: a.el + (b.el - a.el) * t }
    }
  }
  const k = KEYS[KEYS.length - 1]
  return { az: k.az, el: k.el }
}
