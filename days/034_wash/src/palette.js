/**
 * The court, as numbers.
 *
 * Day 033 taught the air to scatter light more than once, and then admitted in
 * its own NOTES what it still could not do: a column of mist standing in a beam
 * knows exactly how bright it is, and the plaster panel standing beside it
 * cannot ask. Surfaces were lit by one directional light and a hemisphere fill
 * that was, in that file's own words, "a stand-in" — a borrowed bounce, put
 * there because the real one was not built.
 *
 * Today the real one is built and the hemisphere is gone. Every pale surface in
 * this frame that is not standing in the shaft is lit by the mist beside it,
 * read out of the same froxel grid the composite was already sampling.
 *
 * Everything here is linear radiance. Nothing is graded until the last pass.
 */

// --- the froxel grid --------------------------------------------------------
//
// Unchanged in shape since Day 032: one 2D atlas of 64 tiles, 256 x 144 cells
// across the screen, because a 3D render target in WebGL2 can only be written
// one layer per draw.
//
// What changed today is the number of readers. The grid started as something the
// composite read once per pixel. Day 033 made it read *itself*, one frame later,
// which is what turned a blur into a diffusion. Today the surfaces read it too —
// four taps each, at their own world position, offset along their own normal. A
// grid that three separate stages consult for three different reasons is the
// definition of a resource rather than an effect.
export const FROXEL = {
  x: 256,
  y: 144,
  z: 64,
  tx: 8, // tiles across the atlas
  ty: 8, // tiles down — tx * ty must equal z
  // Where the exponential slice distribution starts. The mist ends around z = +7
  // and the camera stands at z = 13.4, so nothing scatters inside the first three
  // units and every slice spent there is a slice thrown away.
  near: 3.4,
  far: 38.0,
}

export const ATLAS = {
  w: FROXEL.x * FROXEL.tx,
  h: FROXEL.y * FROXEL.ty,
}

// log2(FROXEL.z) prefix-scan passes: offsets 1, 2, 4, 8, 16, 32
export const SCAN_STEPS = Math.round(Math.log2(FROXEL.z))

// --- multiple scattering ----------------------------------------------------
//
// Day 033's Jacobi iteration, kept whole: each froxel gathers what its
// neighbours held last frame, keeps `albedo` of it, and adds it back with no
// phase function, because a photon on its second bounce has forgotten which way
// it came from. One iteration per frame; the frames compose into the series.
//
// The one change is that `albedo` is three numbers now instead of one.
//
// A scalar albedo cannot change the colour of anything: multiply a radiance by
// 0.5 n times and you have a dimmer version of the same colour. Real media do
// not work that way — the reason distant air is blue and deep wax is warm is
// that the survival probability per bounce depends on wavelength. Three numbers
// is the smallest honest version of that, and it costs one vec3 multiply in a
// line that was already a vec3 multiply.
//
// These are warm-biased, so light that has bounced twice arrives warmer than
// light that bounced once. That matters more today than it would have yesterday,
// because bounced light is now the *only* light on half the surfaces in the
// frame: the tint is not a property of the air any more, it is the colour of the
// plaster.
//
// The series still converges to 1/(1 - albedo) per channel — red settles at
// about 2.2x its first bounce, blue at about 1.7x — and neither can run away.
export const MULTI = {
  albedo: [0.550, 0.505, 0.420],
  radius: 1.15, // metres between a cell and the neighbours it gathers from
  // Below this extinction a cell's stored radiance *rate* is too small to divide
  // by — rate/sigma is the radiance estimate, and forming it out of two very
  // small numbers is how a diffusion becomes a firefly farm.
  sigmaFloor: 0.014,
  clamp: 9.0,
}

// --- the air lighting the stone ---------------------------------------------
//
// The day's technique, in six numbers.
//
// A froxel holds `sigma_s * L`: radiance scattered per unit of path length. A
// surface wants irradiance — what arrives on it over the hemisphere it faces.
// Dividing a cell's rate by its own extinction recovers L (the same move the
// diffusion makes to hand energy between cells), and a cosine-weighted average
// of L over a few directions is E, up to constants.
//
// `gain` is where those constants went. The missing pi, the fact that four taps
// a metre away is a coarse estimate of a hemisphere integral, and the unit
// mismatch between three's light intensities and this project's radiances, all
// collapse into one dial — which is exactly what `scatter` is for the air, and
// is honest for the same reason: none of the three could be measured separately
// in a renderer that grades everything at the end anyway.
export const BOUNCE = {
  gain: 0.200,
  // How far out the four taps sit. Under a metre they all land in the same
  // froxel and the wash goes flat; much past two and a panel starts collecting
  // the glow of mist that is nowhere near it.
  radius: 1.35,
  // Step this far along the normal before the gather starts at all. The volume
  // has no idea there is a panel here — froxels are filled from the light, not
  // from the G-buffer — so a tap placed too close can sit *inside* the panel and
  // read the air on the far side of it.
  bias: 0.40,
  // How far the taps lean away from the normal. 0 is a pencil along it; 1 is
  // nearly the full hemisphere and starts sampling grazing air that contributes
  // little but noise.
  spread: 0.88,
  // Peak-to-peak spread of the per-pixel, per-frame scatter applied to that
  // radius. Without it the froxel lattice prints itself on every flat surface as
  // squares; with it the same error becomes noise, and the temporal resolve —
  // which is already integrating the rotating kernel — absorbs it.
  jitter: 0.70,
  sigmaFloor: 0.014, // same reasoning as MULTI.sigmaFloor
  clamp: 6.0,
}

// --- the light --------------------------------------------------------------
//
// Still one. High, behind, and steep — the beam travels down, to the left and
// toward the camera, so the motes are backlit and forward scattering does the
// work. Nearly white and barely warm: every warm thing in this frame is supposed
// to have become warm by bouncing, not by being lit with an orange lamp.
export const LIGHT = {
  target: [1.40, 1.30, -0.30],
  dir: [0.420, 0.815, -0.400], // from the target *toward* the light
  dist: 24.0,
  halfSize: 17.0, // must cover everywhere FOG.radius allows medium to exist
  far: 52.0,
  size: 2048,
  bias: 0.075, // world units, compared against a linear depth
  color: [1.0, 0.955, 0.885],
  intensity: 4.6,
}

export function lightPosition() {
  return [
    LIGHT.target[0] + LIGHT.dir[0] * LIGHT.dist,
    LIGHT.target[1] + LIGHT.dir[1] * LIGHT.dist,
    LIGHT.target[2] + LIGHT.dir[2] * LIGHT.dist,
  ]
}

// --- the air ----------------------------------------------------------------
export const FOG = {
  density: 0.070, // extinction per world unit at floor level
  height: 3.40, // e-folding height of the bank
  y0: -0.35,
  g: 0.62, // Henyey-Greenstein anisotropy for the direct term
  // Radiance, albedo and the phase function's 1/4pi, collapsed into one number.
  scatter: 2.35,
  center: [1.00, -1.80],
  radius: [6.4, 10.4], // fade the medium out well inside the light-space map
}

// --- the motes --------------------------------------------------------------
//
// Day 033's, unchanged in kind: 7,000 specks animated entirely in the vertex
// shader from a four-float seed, their previous position obtained by evaluating
// the same closed-form function at t - shutter.
export const MOTES = {
  count: 7000,
  size: 0.0125, // world radius of one speck
  minPx: 1.25, // ...but never smaller than this on screen, or they scintillate
  span: [12.0, 7.6, 9.0], // the box they wrap inside, centred on `origin`
  origin: [1.20, 3.30, -0.60],
  fall: [0.22, 0.48], // metres per second, min..max over the seed
  wander: 0.62,
  g: 0.72, // motes scatter strongly forward: a backlit speck flares
  gain: 0.86,
  ambient: [0.010, 0.011, 0.015],
  soft: 0.62, // metres over which a mote fades out against a surface
  shutter: 0.42, // a long exposure on purpose; see Day 033
  stretch: 0.45,
}

// --- the backdrop -----------------------------------------------------------
export const SKY = {
  wallZ: -21,
  low: [0.0052, 0.0059, 0.0080],
  high: [0.0018, 0.0022, 0.0034],
  // one broad, very dim warm bloom high on the right, where the opening is
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
