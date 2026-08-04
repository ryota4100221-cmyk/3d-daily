/**
 * The court, as numbers.
 *
 * Day 035 closed the light's circuit — lamp to air to stone to air to stone —
 * and then wrote down, in its own NOTES, the thing that had been true for
 * thirty-five days and had never been said out loud:
 *
 *   > **ライティング全体を遅延へ。** アルベドと radiosity が揃った今、three の
 *   > マテリアルを捨てて直接光も自前で解けば、直接光・wash・戻り光が同じ単位で
 *   > 語れるようになる。
 *
 * Everything interesting in this renderer has been ours for a week — the volume,
 * the diffusion, the wash, the return path, the temporal filter — and the one
 * term at the bottom of all of them, the light actually landing on a surface,
 * has been computed by somebody else. Two shadow maps for one lamp: three's,
 * packed in projection space and handed to a material, and ours, linear and in
 * metres, read by the air and the motes. They agreed to within a bias and never
 * exactly.
 *
 * Today the beauty pass is deleted, `DirectionalLight` is deleted, the procedural
 * environment map is deleted, and the composite computes the direct term itself
 * out of the G-buffer. One scene draw fewer, one shadow map fewer, and every
 * term in the frame finally in the same units.
 *
 * And that is what buys the day its picture. Once you own the shadow test you
 * can stop asking it a yes/no question. The lamp becomes what a lamp actually is
 * — a source with a *size* — and the answer becomes the fraction of that source
 * a point can see. Contact stays razor sharp; four metres of gap dissolves the
 * same edge into a gradient the width of a hand. That is the whole subject of
 * the frame.
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
// Still one, and today it is finally described the way a light has to be
// described if you intend to answer "how much of it can this point see".
//
// `angle` is the half-angle the source subtends — the single number that turns a
// shadow map from a boolean into a soft one. A blocker `g` metres above a
// surface throws a penumbra of roughly `angle · g` metres, so at 0.085 rad a
// stave standing on the ground is razor sharp where it touches and hands-wide by
// the time its shadow has run four metres. Nothing else in this file changes the
// picture as much for as little.
//
// For scale: the sun is 0.0047 rad, and a metre-wide window seen from three
// metres is about 0.16. This is an interior with one large bright opening —
// which is what the aperture upstream has been pretending to be since Day 031,
// and until today it was pretending it with a point.
export const LIGHT = {
  target: [1.90, 1.10, -0.40],
  dir: [0.395, 0.845, -0.362], // from the target *toward* the light
  dist: 24.0,
  halfSize: 17.0, // must cover everywhere FOG.radius allows medium to exist
  far: 52.0,
  size: 2048,
  bias: 0.070, // world units, compared against a linear depth
  color: [1.0, 0.955, 0.885],
  intensity: 3.05, // irradiance, in the same convention three's DirectionalLight used

  // --- the source's size, and what it costs to ask about it ---
  angle: 0.085, // half-angle of the disc, radians
  // Cap on the penumbra, in world units. Past this the taps are too far apart to
  // describe the gradient, and the cap is an honest statement of the budget
  // rather than a pretence that 20 samples can cover a two-metre disc.
  maxPen: 1.15,
  // Floor on it, also world units — about a texel and a half of the map. A
  // perfectly hard edge is not more correct here, it is only aliased.
  minPen: 0.028,
  // How far to look for a blocker. Equal to maxPen on purpose: search wider and
  // the estimate averages in occluders that cannot darken this point; narrower
  // and a real penumbra is truncated to a hard edge at the rim of its own search.
  search: 1.15,
  // The surface's own offset along its normal before the test. With a real
  // penumbra this no longer has to be large enough to clear anything — only the
  // map's own quantisation.
  normalBias: 0.035,
}

export function lightPosition() {
  return [
    LIGHT.target[0] + LIGHT.dir[0] * LIGHT.dist,
    LIGHT.target[1] + LIGHT.dir[1] * LIGHT.dist,
    LIGHT.target[2] + LIGHT.dir[2] * LIGHT.dist,
  ]
}

// --- surfaces, now that we are the ones shading them -------------------------
//
// The direct term is Lambert plus a single GGX lobe, evaluated once per pixel in
// the composite out of the G-buffer's albedo and roughness. `spec` is a gain on
// the specular lobe alone: this room is limewash, plaster and unpolished stone,
// so the highlight belongs on a rim as a sheen, and at 1.0 the bowl's lip pulls
// the eye off the shadows the day is about.
export const SURF = {
  spec: 0.55,
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
// Day 034's gather with Day 035's visibility march. One number moved: `gain` is
// up, because the environment map that sat under every surface as a quiet floor
// of light is gone today. Nothing in this frame is lit by anything that was not
// lit by the lamp, so the wash has to carry what used to be the ambient term —
// which is the right outcome, since it is the only term that knows *where in the
// room the light actually is*.
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
// Day 035's return path, unchanged in shape. Seven screen-space taps per froxel
// read the G-buffer and the composite's radiosity attachment; the result is a
// point-to-patch form factor with the area term folded into `gain`.
//
// What changed is what the radiosity buffer *contains*. Yesterday it was three's
// shading plus our wash — two renderers' opinions added together. Today both
// halves are ours, so the number a froxel reads back is the same number the
// surface computed.
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
// A touch thinner than yesterday. Today's subject is an edge lying on the
// ground, and an edge on the ground is read *through* whatever mist stands in
// front of it; the softness in the picture has to be the shadow's, not the air's.
export const FOG = {
  density: 0.034, // extinction per world unit at floor level
  height: 3.90, // e-folding height of the bank
  y0: -0.35,
  g: 0.62, // Henyey-Greenstein anisotropy for the direct term
  scatter: 1.35,
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
// Twenty metres behind the room, and today not a material at all: the G-buffer
// has a variant that evaluates this gradient and writes it into the albedo
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
