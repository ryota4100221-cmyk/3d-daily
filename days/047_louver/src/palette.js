/**
 * The court, as numbers.
 *
 * Day 040 adds six colours, and they are the first numbers this file has learned
 * in four days.
 *
 * Every day since Day 037 has been about the source having a *shape*: two angles,
 * then six rectangles, then six rectangles with a mask over them. Through all of
 * it the opening has been one colour — `LIGHT.color`, a single warm white, the
 * same value multiplying every term in the renderer. That is a claim about
 * glass, and it is false about every window that has ever been worth looking at.
 * A leaded window is not an opening; it is *six different lamps held in one
 * frame*, and the room can tell.
 *
 * So `WINDOW.glass` is the day: a tint per pane, and the source stops being
 * uniform. What follows from it is that the integral, the shadow test and the
 * air all have to start carrying **three numbers where they carried one** —
 * see `ltc.js` for the integral and `shadow.js` for the other two.
 *
 * The tints are normalised (below) so their area-weighted mean is exactly white.
 * That is the series' rule about comparisons, applied to colour: `?pass=8`
 * greys the glass, and because the mean did not move, the two frames deliver the
 * same total light and differ by *chromaticity alone*.
 *
 * ---------------------------------------------------------------------------
 * Day 039's header follows.
 *
 * The lamp has been described exactly once since Day 038 — `WINDOW.panes`, six
 * rectangles — and every consumer derives what it needs from that list. Day 039
 * added a fourth consumer: a *visibility mask*, one weight per pane, measured
 * by the shadow sampler and spent inside the LTC integral. It needed no new
 * number here, because the panes it is a mask over were already the only
 * description of the source there is. A day that adds a term to the rendering
 * equation and does not touch the scene's constants is a day the previous
 * refactor paid for itself.
 *
 * (The one addition was in `rig.js`: a lath, upstream, which is geometry and not
 * light.)
 *
 * Day 037 gave the lamp two numbers instead of one — an ellipse rather than a
 * disc — and then wrote, at the top of its own list of what was still missing:
 *
 *   > **本物の LTC**。今日の representative point + ローブ拡張は 15% の近似で、
 *   > グレージング角では形が崩れる。
 *
 * That is today. And doing it properly forces a bigger admission than the
 * approximation error: **two numbers is still not a shape.** An ellipse is what
 * you write down when you have decided in advance that the opening is convex,
 * smooth and solid. Real openings are none of those. A traceried window is a
 * *set* of quadrilaterals with stone between them, and no pair of half-angles
 * can say that.
 *
 * So the source stops being parameters and becomes **geometry**:
 *
 *   `WINDOW.panes`   six rectangles in the light's own angular frame, with a
 *                    mullion down the middle and two transoms across. This list
 *                    is the entire description of the lamp. Everything else in
 *                    the renderer is derived from it, on the CPU, once.
 *
 * and the three consumers change accordingly:
 *
 *   the highlight   Heitz's **linearly transformed cosines** — the exact
 *                   analytic integral of a polygon against a GGX lobe. A
 *                   representative point can put a *bar* on a glaze; only an
 *                   integral can put a *window* on one, with its mullion in it,
 *                   and keep it right at grazing angles where the MRP's clamp
 *                   folds the lobe into a crease.
 *   the terminator  the same machinery with the identity matrix, which is the
 *                   analytic irradiance of the polygon set, horizon-clipped. It
 *                   is not a widened Lambert; it is the answer.
 *   the shadow      the PCF kernel stops being an ellipse and becomes **the
 *                   window itself**, sampled. A penumbra is the source's own
 *                   silhouette convolved with the blocker's, so the soft edge
 *                   of a shadow from a leaded window carries faint bands where
 *                   the mullions are. That is not a trick; it is what PCSS was
 *                   always approximating with a disc.
 *
 * One lamp, one list of rectangles, three consequences — and, for the first
 * time in the series, a highlight the eye can read the source *off*.
 *
 * Everything here is linear radiance. Nothing is graded until the last pass.
 */

// --- the froxel grid --------------------------------------------------------
//
// Unchanged in shape since Day 032: one 2D atlas of 64 tiles, 256 x 144 cells
// across the screen, because a 3D render target in WebGL2 can only be written
// one layer per draw.
export const FROXEL = {
  x: 256,
  y: 144,
  z: 64,
  tx: 8, // tiles across the atlas
  ty: 8, // tiles down — tx * ty must equal z
  near: 3.2,
  far: 38.0,
}

export const ATLAS = {
  w: FROXEL.x * FROXEL.tx,
  h: FROXEL.y * FROXEL.ty,
}

// log2(FROXEL.z) prefix-scan passes: offsets 1, 2, 4, 8, 16, 32
export const SCAN_STEPS = Math.round(Math.log2(FROXEL.z))

// --- the light --------------------------------------------------------------
//
// A traceried window. Not a point, not a disc, not an ellipse: a frame of stone
// with six openings in it, high in a wall, twenty-four metres from the court.
//
// The old `angles` pair is gone. What replaces it is `WINDOW`, and the shape of
// that object is the day's whole argument — the source is described *once*, as
// geometry, and the shadow test, the diffuse integral and the specular integral
// all derive what they need from the same six rectangles rather than from three
// tuned numbers that happen to agree.
//
// For scale: the sun is 0.0047 rad and isotropic. This opening is 13 degrees by
// 21 — nearly four thousand times the sun's solid angle — which is what makes
// every one of today's effects large enough to see.
export const LIGHT = {
  target: [1.90, 1.10, -0.40],
  dir: [0.395, 0.845, -0.362], // from the target *toward* the light
  dist: 24.0,
  halfSize: 17.0, // must cover everywhere FOG.radius allows medium to exist
  far: 52.0,
  size: 2048,
  bias: 0.070, // world units, compared against a linear depth
  color: [1.0, 0.955, 0.885],
  intensity: 3.15, // irradiance from the whole opening, at normal incidence

  // Cap on the penumbra, per axis, in world units. Past this the taps are
  // further apart than the gradient is wide, and the cap is an honest statement
  // of the budget rather than a pretence that 20 samples cover a 4m opening.
  maxPen: [0.92, 1.34],
  // Floor on it, also per axis — about a texel and a half of the map. A
  // perfectly hard edge is not more correct here, it is only aliased.
  minPen: [0.028, 0.028],
  // How far to look for a blocker. Equal to maxPen on purpose: search wider and
  // the estimate averages in occluders that cannot darken this point; narrower
  // and a real penumbra is truncated to a hard edge at the rim of its own search.
  search: [0.92, 1.34],
  // The surface's own offset along its normal before the test.
  normalBias: 0.035,
}

/**
 * The opening, in the light's own angular frame. `[cx, cy, hx, hy]` in radians:
 * x runs across the window, y runs up it.
 *
 * Two lights of stone and three tiers — a mullion at x = 0 of half-width
 * `mullion`, transoms at y = ±0.060 of half-height `transom`. The middle tier is
 * shorter than the outer two, because a window divided into equal thirds reads
 * as a diagram and one that is not reads as a window.
 *
 * These numbers are small and they do a lot:
 *
 *   penumbra    the kernel is *this shape*, scaled by the gap. A blade 1.5m up
 *               throws an edge 17cm wide across and 27cm along, with two pale
 *               seams in it where the stone is.
 *   terminator  a curved surface rolls out of the light over the angular height
 *               of the opening — 21 degrees — as a band, not a crease.
 *   highlight   a glaze at roughness 0.06 reflects the *window*: two lights,
 *               three tiers, a dark cross of stone. Roughen it and the tracery
 *               closes up into a lozenge; that transition is the piece.
 */
const MULLION = 0.0165 // half-width of the vertical stone bar, radians
const TRANSOM = 0.0150 // half-height of the horizontal ones
export const WINDOW = {
  half: [0.115, 0.180], // the opening's full extent, half-angles, radians
  // Rotation of the window's own frame inside the light's uv frame. The tall
  // axis lies along light-space y at pi/2, which puts it across the picture and
  // up — the same convention Day 037's `axis` used, kept so the aperture plate
  // downstream still crosses the *short* axis and the shafts stay crisp.
  axis: Math.PI / 2,
  // The stone. Everything else is derived.
  mullion: MULLION,
  transom: TRANSOM,
  rows: [
    [-0.1275, 0.0525], // sill tier   : y in [-0.180, -0.075]
    [0.0, 0.0450], // middle tier : y in [-0.045, +0.045]
    [0.1275, 0.0525], // head tier   : y in [+0.075, +0.180]
  ],
  cols: [
    [-0.0657, 0.0492], // left light  : x in [-0.115, -0.0165]
    [0.0657, 0.0492], // right light : x in [+0.0165, +0.115]
  ],
  /**
   * The glass. One tint per pane, in the order `buildWindow` emits them — rows
   * outermost, so: sill L/R, middle L/R, head L/R.
   *
   * These are *relative* radiances, normalised below so the area-weighted mean
   * is white. What they encode is a split down the mullion — the left light
   * older and warmer, the right cooler and greener — deepening toward the sill,
   * because the head of a window is where the pale glass goes and everybody who
   * has ever glazed one knows it.
   *
   * The amplitude was chosen by measuring the render, not by picking swatches,
   * and the first attempt was wrong by a factor of 1.6. At ±13% — which looks
   * like plenty in a colour picker — the two halves of the reflection came back
   * at R/B 0.95 and 1.09 against a grey-glass baseline of 1.04. Real, provable
   * with a script, and not visible. Two things eat it: the mean is white *by
   * construction*, so anything that sees the whole window sees none of this, and
   * the tone map is compressing hard exactly where the window is brightest.
   *
   * At ±21% the same measurement reads 0.92 against 1.16 and the mullion becomes
   * a colour boundary rather than a shadow. The green channel is held at one
   * throughout, so the tints trade red against blue and every pane keeps almost
   * exactly the same luminance — the window changes hue across its width and
   * never changes brightness, which is what keeps it a window and not a chapel.
   */
  glass: [
    [1.160, 1.008, 0.784], // sill   L — the deepest amber
    [0.832, 0.992, 1.168], // sill   R
    [1.208, 1.000, 0.720], // middle L
    [0.784, 1.000, 1.240], // middle R — the coolest, and the one the lath takes
    [1.096, 1.000, 0.864], // head   L
    [0.904, 0.992, 1.096], // head   R
  ],
}

/**
 * The window as a flat list of rectangles, plus everything derived from it that
 * anyone downstream asks for. Called once; the result is uploaded as uniforms
 * and never touched again.
 *
 *   panes   [cx, cy, hx, hy] per opening, radians, in the *window's* own frame.
 *           They stay there: a rotated rectangle is not a rectangle, so the
 *           `axis` turn is applied to the finished sample instead — one complex
 *           multiply, exactly where Day 037 applied it.
 *   cdf     cumulative area fraction, for picking a pane in one pass
 *   omega   the total solid angle, used to turn the scene's irradiance into the
 *           window's radiance. This is the number that makes the comparison
 *           renders honest: taking the tracery away enlarges the opening, so
 *           the solid render is handed a *lower* radiance and delivers the same
 *           irradiance. The pictures then differ by the source's shape and by
 *           nothing else — Day 037's rule, which is why `shRound` existed.
 */
export function buildWindow() {
  const { rows, cols, half, glass } = WINDOW
  const panes = []
  let area = 0
  for (const [cy, hy] of rows) {
    for (const [cx, hx] of cols) {
      panes.push([cx, cy, hx, hy])
      area += 4 * hx * hy
    }
  }
  const cdf = []
  let acc = 0
  for (const p of panes) {
    acc += (4 * p[2] * p[3]) / area
    cdf.push(acc)
  }
  cdf[cdf.length - 1] = 1.0

  // --- the glass, normalised to white ---------------------------------------
  //
  // The mean that has to be held is the *area-weighted* one, per channel, and
  // not the plain average of six triples: the middle tier is shorter than the
  // other two, so the plain average would quietly hand its colours more of the
  // window than they own. Dividing by that mean makes
  //
  //     sum_i  (area_i / area) * glass_i  ==  (1, 1, 1)
  //
  // exactly, which is what lets `?pass=8` grey the glass and change nothing but
  // the colour. Every other quantity in the renderer — irradiance, exposure,
  // the radiance uSrcRad is derived from — is untouched by the tint, by
  // construction rather than by tuning.
  const mean = [0, 0, 0]
  panes.forEach((p, i) => {
    const w = (4 * p[2] * p[3]) / area
    for (let c = 0; c < 3; c++) mean[c] += w * (glass[i] ? glass[i][c] : 1)
  })
  const paneCol = panes.map((_, i) =>
    [0, 1, 2].map((c) => ((glass[i] ? glass[i][c] : 1) / (mean[c] || 1)))
  )

  return {
    panes,
    cdf,
    paneCol,
    // The solid comparison: one rectangle covering the whole opening, stone and
    // all. Same list format, so every consumer takes it without a branch.
    solid: [[0, 0, half[0], half[1]]],
    solidCdf: [1.0],
    // Day 040's fallback tints, kept for ?pass=8, where they are what the six
    // panes are handed instead of the image. Day 041 does not reach this list in
    // its own mode: the picture is a texture over the bounding rectangle, so a
    // solid source keeps every quarry and every rose it had — one pane cannot
    // carry six colours, but it can carry a 256x256 image of them.
    solidCol: [[1, 1, 1]],
    bound: [half[0], half[1]],
    omega: area,
    solidOmega: 4 * half[0] * half[1],
  }
}

export function lightPosition() {
  return [
    LIGHT.target[0] + LIGHT.dir[0] * LIGHT.dist,
    LIGHT.target[1] + LIGHT.dir[1] * LIGHT.dist,
    LIGHT.target[2] + LIGHT.dir[2] * LIGHT.dist,
  ]
}

// --- surfaces, now that the source has a shape -------------------------------
//
// `spec` was 0.55 yesterday, held down because a point-source highlight is a
// pinprick and a pinprick on a rim pulls the eye off the shadows. An area source
// does not make pinpricks. The energy that used to sit in one dot is spread
// along a bar the source's own shape, so the lobe can be paid for in full and
// still be the quietest thing in the frame.
export const SURF = {
  spec: 0.72,
  f0: 0.04, // dielectric normal reflectance; nothing here is metal
}

// --- multiple scattering (air -> air) ---------------------------------------
//
// Day 033's Jacobi iteration, kept whole: each froxel gathers what its
// neighbours held last frame, keeps `albedo` of it, and adds it back with no
// phase function, because a photon on its second bounce has forgotten which way
// it came from. One iteration per frame; the frames compose into the series.
export const MULTI = {
  albedo: [0.550, 0.505, 0.420],
  radius: 1.15, // metres between a cell and the neighbours it gathers from
  sigmaFloor: 0.014,
  clamp: 9.0,
}

// --- the air lighting the stone (air -> surface) ----------------------------
//
// Day 034's gather with Day 035's visibility march, unchanged. It is the only
// thing lighting the underside of the lintel, and it is worth restating why that
// matters today: the soft terminator arriving this morning makes surfaces near
// the light's horizon *brighter* than Lambert did, and the easiest way to fake
// that has always been to lift the ambient. There is no ambient here to lift.
export const BOUNCE = {
  gain: 0.290,
  radius: 1.35,
  bias: 0.22,
  spread: 0.88,
  jitter: 0.70,
  sigmaFloor: 0.014,
  clamp: 6.0,
}

// --- the visibility term ----------------------------------------------------
//
// Day 035's screen-space march from the shaded point to each wash tap. Five
// steps, projected through the jittered view-projection, compared against the
// G-buffer's linear depth. `thick` is the standard admission that a depth buffer
// is not a solid.
export const VIS = {
  bias: 0.055, // world units, scaled slightly with distance
  thick: 3.2, // beyond this the occluder is treated as something else entirely
}

// --- the stone lighting the air (surface -> air) ----------------------------
//
// Day 035's return path, unchanged. Seven screen-space taps per froxel read the
// G-buffer and the composite's radiosity attachment; the result is a
// point-to-patch form factor with the area term folded into `gain`.
export const RETURN = {
  gain: 6.00,
  range: 5.2,
  r0: 1.80,
  spread: 2.60,
  g: 0.24,
  clamp: 5.5,
}

// --- the air ----------------------------------------------------------------
//
// Thinner again by a hair. The subject today is a set of edges lying on a pale
// floor and a bar of light on a glaze; both are read *through* whatever mist
// stands in front of them, and the softness in the picture has to belong to the
// source rather than to the air.
export const FOG = {
  density: 0.031, // extinction per world unit at floor level
  height: 3.90, // e-folding height of the bank
  y0: -0.35,
  g: 0.62, // Henyey-Greenstein anisotropy for the direct term
  scatter: 1.32,
  center: [2.10, -1.00],
  radius: [7.2, 11.0], // fade the medium out well inside the light-space map
}

// --- the motes --------------------------------------------------------------
export const MOTES = {
  count: 4500,
  size: 0.0125, // world radius of one speck
  minPx: 1.25, // ...but never smaller than this on screen, or they scintillate
  span: [12.4, 8.4, 9.4], // the box they wrap inside, centred on `origin`
  origin: [2.00, 3.50, -0.40],
  fall: [0.22, 0.48], // metres per second, min..max over the seed
  wander: 0.62,
  g: 0.72, // motes scatter strongly forward: a backlit speck flares
  gain: 0.28,
  ambient: [0.010, 0.011, 0.015],
  soft: 0.62, // metres over which a mote fades out against a surface
  shutter: 0.42, // a long exposure on purpose; see Day 033
  stretch: 0.45,
}

// --- the backdrop -----------------------------------------------------------
//
// Twenty metres behind the room, and not a material at all: the G-buffer has a
// variant that evaluates this gradient and writes it into the albedo
// attachment, and the composite hands it through as emission. It is the one
// surface in the frame lit by nothing, which is exactly what a painted distance
// is.
export const SKY = {
  wallZ: -21,
  low: [0.0052, 0.0059, 0.0080],
  high: [0.0018, 0.0022, 0.0034],
  seam: [0.048, 0.042, 0.035],
  seamSlot: [9.5, 3.4],
  yLow: -1.5,
  yHigh: 13.0,
}

export const SKY_GLSL = /* glsl */ `
  uniform vec3 uSkyLow;
  uniform vec3 uSkyHigh;
  uniform vec3 uSeamCol;
  uniform vec2 uSeamSlot;
  uniform vec2 uSkyRange;

  vec3 skyAt(vec2 p) {
    vec3 c = mix(uSkyLow, uSkyHigh, smoothstep(uSkyRange.x, uSkyRange.y, p.y));
    float fall = smoothstep(uSkyRange.x, uSkyRange.y * 0.85, p.y);
    c += uSeamCol * exp(-pow((p.x - uSeamSlot.x) / uSeamSlot.y, 2.0)) * fall;
    return c;
  }
`

export function skyUniforms(THREE) {
  return {
    uSkyLow: { value: new THREE.Color(...SKY.low) },
    uSkyHigh: { value: new THREE.Color(...SKY.high) },
    uSeamCol: { value: new THREE.Color(...SKY.seam) },
    uSeamSlot: { value: new THREE.Vector2(...SKY.seamSlot) },
    uSkyRange: { value: new THREE.Vector2(SKY.yLow, SKY.yHigh) },
  }
}
