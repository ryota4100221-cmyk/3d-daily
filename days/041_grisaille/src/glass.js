import * as THREE from 'three'
import { WINDOW } from './palette.js'

/**
 * Day 041 — the lamp's radiance, as an image.
 *
 * Yesterday gave the window six colours, one per pane, and yesterday's NOTES put
 * the objection at the top of its own list: *piecewise constant on the panes* is
 * the same resolution limit Day 039's shadow mask has, moved onto the radiance
 * side of the integral. Six numbers cannot hold a painted window, and a real one
 * is painted — grisaille on the glass, a lattice of quarries, a border, the pot
 * metal never quite even across a light.
 *
 * The fix is not more panes. Panes cost four edges each in the LTC sum and they
 * cost a whole shadow estimate each in the mask; subdividing to the point where
 * you could paint with them is unaffordable twice over. The fix is Heitz's
 * §5 (*Real-Time Polygonal-Light Shading with LTCs*, 2016): keep the polygon set
 * exactly as it is, and let the radiance be **a texture with a filtered pyramid**,
 * read once, at a level chosen from how much of the source the lobe covers.
 *
 *     result  =  F(shape, lobe)  ×  L̄(texture, lobe footprint)
 *                 ^ unchanged        ^ this file
 *
 * The whole of the day's new resolution lives in the second factor, and its cost
 * is one texture fetch per term. Not one per pane — **one**, and it would still
 * be one if the window had four hundred quarries in it.
 *
 * ---------------------------------------------------------------------------
 * What is in the image, and what is deliberately not
 *
 * This field is the radiance of *the glass*, defined over the window's whole
 * bounding rectangle — including the strips where the stone is. That looks wrong
 * for about a second and is the only arrangement that does not double-count:
 * **the tracery is carried by the polygons** (the six panes are the domain of the
 * form factor, and the stone is simply not in it), so if the texture also went
 * black over the mullion the stone would darken the answer twice. So the field is
 * continuous across the stone — what a glazier would call the cartoon, drawn
 * through the leads — and the mips of a continuous field do not bleed a black bar
 * outward into the glass as they coarsen.
 *
 * Which means the two limits of Day 039 and Day 040 are answered by one mechanism
 * and stay answered separately: the *shape* has pane resolution (still), the
 * *colour* has texel resolution (now 256×256, and free).
 *
 * ---------------------------------------------------------------------------
 * The normalisation, and which mean is pinned
 *
 * Yesterday `palette.js` divided the six tints by their area-weighted mean so
 * that a surface seeing the whole window saw white, and `?pass=8` could grey the
 * glass without changing the exposure. The same rule holds today and it is
 * *easier*: a 2×2 box downsample preserves the mean exactly, so pinning the mean
 * of level 0 pins the mean of every level of the pyramid, including the 1×1 top
 * that a rough surface reads. Wide lobes get exactly white, by construction, at
 * whatever depth they land in the pyramid.
 *
 * (The pane-area-weighted mean — the one yesterday pinned — then comes out at
 * 1 ± the small amount the field drifts across the stone strips. It is measured
 * below and reported; it is not the mean that matters for this integral, because
 * what a wide lobe actually reads is a filtered texel and not a sum over panes.)
 */

// A square pyramid. The window is taller than it is wide, so a square image
// spends more texels per radian across it than up it; that is the axis the
// quarries are finer on, so the asymmetry is on the right side of the picture.
export const GLASS_SIZE = 256
export const GLASS_LEVELS = Math.round(Math.log2(GLASS_SIZE)) + 1 // 256 -> 1

/**
 * Texels of footprint per unit of apparent source size — the one tuned number in
 * the day, and the whole of the mapping from "how big does the source look" to
 * "which level of the pyramid".
 *
 * Heitz writes lod = log(2048*d)/log(3) for a base-3 pyramid over a 2048-wide
 * image, which in a base-2 pyramid is log2(2048*d): the same formula, with this
 * constant at 2048 for an image of 2048. So the paper's own choice is K = N, and
 * mine is half of it.
 *
 * It was picked the way theirs was — by eye, against the sharpest surface in the
 * frame — and the comparison is in the URL, so anyone can redo it. At ?k=700 the
 * near tablet's reflection is a plain cross of stone: the picture is gone, and a
 * lacquer at roughness 0.05 is very nearly a mirror, so that is plainly too much
 * averaging. At ?k=96 it resolves both roses, their rings and the leads between
 * the quarries, and the far tablet at 0.125 still closes the whole window up into
 * one colour — which is the claim the pair of tablets exists to make. 128 sits
 * just inside that, sharp enough to read the paint and blunt enough that the
 * lattice never crawls on the curved surfaces as they turn.
 *
 * The honest statement is that this is a heuristic with a constant in it, in both
 * the paper and here. What makes it defensible rather than fudged is that it is
 * one number, it is monotone, and both of its failure modes are visible in a
 * single render.
 */
export const GLASS_K = GLASS_SIZE / 2

// --- the cartoon -------------------------------------------------------------
//
// Everything below is drawn in the window's own angular frame, normalised to
// [-1, 1] across the bounding rectangle, so the drawing does not have to know
// the opening's half-angles and the panes do not have to know the drawing.

function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** A soft band around v = c of half-width h, feathered over f. 1 inside. */
function band(v, c, h, f) {
  return 1 - smoothstep(h - f, h + f, Math.abs(v - c))
}

/** Cheap value noise on a lattice — the glass's own unevenness, not detail. */
function hash2(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453
  return s - Math.floor(s)
}

function vnoise(x, y) {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const xf = x - xi
  const yf = y - yi
  const u = xf * xf * (3 - 2 * xf)
  const v = yf * yf * (3 - 2 * yf)
  const a = hash2(xi, yi)
  const b = hash2(xi + 1, yi)
  const c = hash2(xi, yi + 1)
  const d = hash2(xi + 1, yi + 1)
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}

/**
 * The window's radiance at (u, v) ∈ [-1, 1]², before normalisation.
 *
 * Three layers, and they are deliberately at three different scales, because the
 * point of a filtered pyramid is that a surface should be able to resolve some of
 * them and not others:
 *
 *   the ground   the hue field yesterday approximated with six constants — warm
 *                and old on the left, cool and green on the right, deepening
 *                toward the sill. Now it is continuous, so it no longer steps at
 *                the mullion; the mullion is a *shape*, and it was never the
 *                reason the colour changed.
 *   the quarries a diamond lattice of leaded panes, about a degree across, each
 *                one its own draw from the pot. This is the layer the near
 *                lacquer at roughness 0.05 can read and the far one at 0.125
 *                cannot — the same picture, filtered by the lobe that looks at it.
 *   the grisaille a painted roundel in the middle tier and a border inside the
 *                frame, in brown-black enamel. Bigger than the quarries and
 *                darker, so it survives two more levels of the pyramid and is
 *                the last thing to go.
 *
 * Luminance is held near constant per layer wherever possible — the green channel
 * of the hue field is fixed at one, as yesterday — so that the window changes
 * *hue* across its width without changing brightness. The grisaille is the one
 * layer that is allowed to change brightness, because paint is paint.
 */
function cartoon(u, v) {
  // --- 1. the hue field ------------------------------------------------------
  // Yesterday's six tints, read as samples of the field they were sampling.
  // ±0.21 across, another 0.06 of deepening toward the sill; green pinned at 1.
  const across = u
  const deep = 1 - 0.28 * v // more saturated at the sill, paler at the head
  const warm = 0.21 * deep
  let r = 1 + warm * -across
  let g = 1.0
  let b = 1 - warm * -across
  // A slow wander so neither light is flat: the old glass is not a gradient.
  const w = vnoise(u * 1.7 + 3.1, v * 2.3 - 1.4) - 0.5
  r += 0.05 * w
  b -= 0.04 * w

  // --- 2. the quarries -------------------------------------------------------
  // A diamond lattice on the rotated grid. `q` is the cell index, `e` the
  // distance to the nearest lead in cell units.
  const QX = 7.0 // quarries across the bounding rectangle
  const QY = 11.0
  const a1 = (u * QX + v * QY) * 0.5
  const a2 = (u * QX - v * QY) * 0.5
  const c1 = Math.floor(a1)
  const c2 = Math.floor(a2)
  const f1 = Math.abs(a1 - c1 - 0.5)
  const f2 = Math.abs(a2 - c2 - 0.5)
  // The lead itself: a thin dark line, and note which way round the smoothstep
  // goes. `max(f1, f2)` is 0 at a quarry's centre and 0.5 at its boundary, so
  // the came is the *high* end — the first version had these reversed and drew a
  // window of bright grid and dark glass, which is a fishing net.
  const lead = smoothstep(0.44, 0.5, Math.max(f1, f2))
  // Each quarry its own draw from the pot: a few per cent, in hue and in level.
  const qh = hash2(c1 * 1.7, c2 * 2.3) - 0.5
  const ql = hash2(c1 * 3.9 + 7.0, c2 * 1.1 - 2.0) - 0.5
  const qm = 1 + 0.115 * ql
  r = (r + 0.085 * qh) * qm
  g = g * qm
  b = (b - 0.075 * qh) * qm
  const leadK = 1 - 0.62 * lead
  r *= leadK
  g *= leadK
  b *= leadK

  // --- 3. the grisaille ------------------------------------------------------
  // Brown-black enamel, fired onto the glass: it takes more blue than red, which
  // is why the painted parts of a window go warm as they go dark.
  //
  // Where the paint goes is a lesson from the first render. The rose started
  // centred on the window and was invisible, because the centre of this window is
  // the crossing of the mullion and the middle transom — stone, and stone is not
  // in the integral. Paint belongs *inside panes*. So there is one rose per light
  // in the middle tier, a painted band across the head and the sill, and a border
  // just inside the frame.
  //
  // AR converts a v-offset into u-units at equal angle: the bounding rectangle is
  // 0.115 by 0.180 radians, so a circle on the glass is an ellipse in this frame
  // and drawing it as a circle would make an oval rose.
  const AR = 1.565
  let paint = 0
  for (let k = 0; k < 2; k++) {
    const du = u - (k === 0 ? -0.571 : 0.571)
    const dv = v * AR
    const rr = Math.sqrt(du * du + dv * dv)
    const th = Math.atan2(dv, du)
    paint = Math.max(paint, band(rr, 0.0, 0.052, 0.040) * 0.88)
    paint = Math.max(paint, band(rr, 0.140, 0.022, 0.018) * 0.86)
    paint = Math.max(paint, band(rr, 0.310, 0.015, 0.016) * 0.76)
    // Eight petals, drawn by an angular cosine rather than by eight tests.
    const ray = Math.max(0, Math.cos(th * 8)) ** 5
    paint = Math.max(paint, ray * band(rr, 0.222, 0.078, 0.058) * 0.74)
  }
  // A painted band across the head and the sill tiers — the layer that is coarse
  // enough to survive two more levels of the pyramid than the quarries do.
  paint = Math.max(paint, band(Math.abs(v), 0.720, 0.042, 0.030) * 0.62)
  // The border, just inside the bounding rectangle, on both axes.
  const edge = Math.max(Math.abs(u), Math.abs(v))
  paint = Math.max(paint, band(edge, 0.945, 0.030, 0.020) * 0.66)
  const k = 1 - 0.72 * paint
  r *= k * (1 + 0.10 * paint) // enamel warms what it darkens
  g *= k
  b *= k * (1 - 0.14 * paint)

  return [r, g, b]
}

/**
 * Level 0: the cartoon, supersampled and normalised so the image's mean is
 * exactly white.
 *
 * Exported because `scripts/glass-preview.mjs` writes it out as a PNG. Judging a
 * source texture from its reflection in a lacquer plate is judging two
 * approximations at once, and the first version of the rose was invisible for a
 * reason (it was painted on the mullion) that one look at the image would have
 * caught in a second.
 */
export function renderCartoon(N) {
  const px = new Float32Array(N * N * 4)

  // A 2x2 supersample. The quarries are near the Nyquist limit of this grid, and
  // an aliased level 0 stays aliased all the way up the pyramid — a box filter
  // cannot remove what was folded in before it ran.
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      let r = 0
      let g = 0
      let b = 0
      for (let sy = 0; sy < 2; sy++) {
        for (let sx = 0; sx < 2; sx++) {
          const u = ((x + 0.25 + sx * 0.5) / N) * 2 - 1
          const v = ((y + 0.25 + sy * 0.5) / N) * 2 - 1
          const c = cartoon(u, v)
          r += c[0]
          g += c[1]
          b += c[2]
        }
      }
      const i = (y * N + x) * 4
      px[i] = r * 0.25
      px[i + 1] = g * 0.25
      px[i + 2] = b * 0.25
      px[i + 3] = 1
    }
  }

  // Pin the mean to white. A 2x2 box downsample preserves the mean exactly, so
  // pinning it here pins it at every level of the pyramid, including the 1x1 top
  // that a rough surface reads.
  const mean = [0, 0, 0]
  for (let i = 0; i < N * N; i++) {
    for (let c = 0; c < 3; c++) mean[c] += px[i * 4 + c]
  }
  for (let c = 0; c < 3; c++) mean[c] /= N * N
  for (let i = 0; i < N * N; i++) {
    for (let c = 0; c < 3; c++) px[i * 4 + c] /= mean[c] || 1
  }
  return px
}

/**
 * Build the pyramid, normalise it, and hand back a texture plus the numbers the
 * shader needs to turn a lobe footprint into a level.
 *
 * Half float, not float: RGBA16F is linearly filterable in core WebGL2, where
 * full float needs an extension that SwiftShader has been known to withhold, and
 * this texture is nothing but linear filtering. Eight bits was the other option
 * and it is not enough — the whole subject is a ±20% modulation that has to
 * survive being averaged eight levels deep.
 */
export function buildGlass() {
  const level0 = renderCartoon(GLASS_SIZE)
  const N = GLASS_SIZE

  // The other mean — over the panes only, which is the one Day 040 pinned. It is
  // reported rather than enforced; see the header for why this integral reads the
  // filtered one instead.
  const paneMean = measurePaneMean(level0, N)

  // --- the pyramid -----------------------------------------------------------
  // A plain 2×2 box. Every level is therefore the exact mean of the 2^m × 2^m
  // block under it, which is what makes "read level m" mean "average the source
  // over a footprint 2^m texels wide" and makes the pyramid mean-preserving.
  const levels = [level0]
  for (let m = 1; m < GLASS_LEVELS; m++) {
    const prev = levels[m - 1]
    const pn = N >> (m - 1)
    const n = N >> m
    const cur = new Float32Array(n * n * 4)
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        for (let c = 0; c < 4; c++) {
          cur[(y * n + x) * 4 + c] =
            0.25 *
            (prev[((2 * y) * pn + 2 * x) * 4 + c] +
              prev[((2 * y) * pn + 2 * x + 1) * 4 + c] +
              prev[((2 * y + 1) * pn + 2 * x) * 4 + c] +
              prev[((2 * y + 1) * pn + 2 * x + 1) * 4 + c])
        }
      }
    }
    levels.push(cur)
  }

  const mips = levels.map((data, m) => {
    const n = N >> m
    const half = new Uint16Array(n * n * 4)
    for (let i = 0; i < half.length; i++) half[i] = THREE.DataUtils.toHalfFloat(data[i])
    return { data: half, width: n, height: n }
  })

  const tex = new THREE.DataTexture(mips[0].data, N, N, THREE.RGBAFormat, THREE.HalfFloatType)
  // three uploads `mipmaps[i]` as level i for a DataTexture and skips its own
  // generation when the array is non-empty. Level 0 has to be in the list as
  // well as in `image`, or the base level is uploaded twice with the second
  // write coming from mipmaps[0] — which is the same data here, but only by
  // accident of how this is assembled.
  tex.mipmaps = mips
  tex.generateMipmaps = false
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.wrapS = THREE.ClampToEdgeWrapping
  tex.wrapT = THREE.ClampToEdgeWrapping
  tex.colorSpace = THREE.NoColorSpace
  tex.needsUpdate = true

  return { tex, size: N, levels: GLASS_LEVELS, paneMean }
}

/**
 * The area-weighted mean over the panes alone — Day 040's normalisation, kept as
 * a measurement so the difference between the two conventions is a number in the
 * NOTES rather than a shrug.
 */
function measurePaneMean(level0, N) {
  const { rows, cols, half } = WINDOW
  const acc = [0, 0, 0]
  let w = 0
  for (const [cy, hy] of rows) {
    for (const [cx, hx] of cols) {
      // the pane, in the [-1,1] frame of the image
      const u0 = (cx - hx) / half[0]
      const u1 = (cx + hx) / half[0]
      const v0 = (cy - hy) / half[1]
      const v1 = (cy + hy) / half[1]
      const x0 = Math.max(0, Math.floor(((u0 + 1) * 0.5) * N))
      const x1 = Math.min(N, Math.ceil(((u1 + 1) * 0.5) * N))
      const y0 = Math.max(0, Math.floor(((v0 + 1) * 0.5) * N))
      const y1 = Math.min(N, Math.ceil(((v1 + 1) * 0.5) * N))
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * N + x) * 4
          acc[0] += level0[i]
          acc[1] += level0[i + 1]
          acc[2] += level0[i + 2]
          w++
        }
      }
    }
  }
  return w > 0 ? acc.map((c) => c / w) : [1, 1, 1]
}
