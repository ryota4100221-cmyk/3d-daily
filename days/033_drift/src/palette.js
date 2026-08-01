/**
 * The court, as numbers.
 *
 * Day 032 kept the light in one file because three consumers had to agree about
 * it: three's shadow camera, our own light-space depth camera, and the froxel
 * injection. Today there are four — the motes read the same depth map, at the
 * same bias, in the same world units — and there is only *one light in the room*
 * for all of them to agree about.
 *
 * That is the composition, not an economy. Yesterday needed two lights to prove
 * that a second one was free. Today everything in the frame that is not standing
 * directly in the shaft is lit by the air itself, which is only possible because
 * the air now scatters more than once.
 *
 * Everything here is linear radiance. Nothing is graded until the last pass.
 */

// --- the froxel grid --------------------------------------------------------
//
// Unchanged in shape from Day 032: one 2D atlas of 64 tiles, 256 x 144 cells
// across the screen, because a 3D render target in WebGL2 can only be written
// one layer per draw.
//
// What changed is what a cell *is*. Yesterday a cell was written once and read
// twice within the same frame. Today a cell is also read by the *next* frame's
// injection, four times over, from four different places — the grid became its
// own input, which is what turns one blur into a converged diffusion.
export const FROXEL = {
  x: 256,
  y: 144,
  z: 64,
  tx: 8, // tiles across the atlas
  ty: 8, // tiles down — tx * ty must equal z
  // Where the exponential slice distribution starts. The mist pocket ends at
  // about z = +9 and the camera stands at z = 13.6, so nothing scatters inside
  // the first three units and every slice spent there is a slice thrown away.
  near: 3.4,
  far: 38.0, // the backdrop sits at z = -20; past this there is nothing to fog
}

export const ATLAS = {
  w: FROXEL.x * FROXEL.tx,
  h: FROXEL.y * FROXEL.ty,
}

// log2(FROXEL.z) prefix-scan passes: offsets 1, 2, 4, 8, 16, 32
export const SCAN_STEPS = Math.round(Math.log2(FROXEL.z))

// --- multiple scattering ----------------------------------------------------
//
// The day's argument, in four numbers.
//
// Single scattering — every volumetric day so far — says light goes source ->
// medium -> eye, once. It is why a shaft has a hard shoulder, and why the air
// beside a shaft is exactly as dark as the air in an unlit room: nothing in the
// model carries energy sideways out of the beam.
//
// A real second bounce is a global solve. What is affordable is *one Jacobi
// iteration per frame*: each froxel gathers the radiance its neighbours held
// last frame, keeps `albedo` of it, and adds it back isotropically. That result
// is what next frame's neighbours read, so the iterations compose — after a
// second of standing still the grid holds the sum of a geometric series, which
// is the multi-bounce answer. The temporal filter Day 032 built to fight noise
// turns out, unchanged, to be a solver.
//
// `albedo` is the loop gain and the only number here that can make this diverge:
// the series converges to 1/(1 - albedo), so 0.50 means the lit air settles at
// roughly twice its first bounce and no brighter, ever.
export const MULTI = {
  albedo: 0.50,
  radius: 1.15, // metres between a cell and the neighbours it gathers from
  // Below this extinction a cell's stored radiance *rate* is too small to divide
  // by — rate/sigma is the radiance estimate, and forming it from two very small
  // numbers is how a diffusion becomes a firefly farm.
  sigmaFloor: 0.014,
  clamp: 9.0, // hard ceiling on that estimate, for the same reason
}

// --- the light --------------------------------------------------------------
//
// One. High, behind, and steep — the beam travels down, to the left and toward
// the camera, so the motes are backlit and forward scattering does the work.
// Nearly white and barely warm: any colour in this frame is supposed to arrive
// because the air is warm about it, not because the lamp is orange.
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
  // Thicker than Day 032, and it has to be: multiple scattering is a function of
  // optical depth, and thin air has no second bounce to show. This is the
  // densest medium the project has drawn.
  density: 0.082, // extinction per world unit at floor level
  height: 3.30, // e-folding height of the bank
  y0: -0.35,
  g: 0.62, // Henyey-Greenstein anisotropy for the direct term
  // Radiance, albedo and the phase function's 1/4pi, collapsed into one number.
  // Lower than Day 032's 5.0 even though the mist is twice as thick, because the
  // diffusion adds its own gain on top and the two have to be budgeted together.
  scatter: 3.30,
  center: [0.60, -1.50],
  radius: [6.0, 10.5], // fade the medium out well inside the light-space map
}

// --- the motes --------------------------------------------------------------
//
// 7,000 specks, animated entirely in the vertex shader from a per-instance seed,
// so the CPU never touches a position. Their previous position is the *same
// closed-form function* evaluated at t - dt, which is the cheapest exact
// velocity this project has ever had.
export const MOTES = {
  count: 7000,
  size: 0.0125, // world radius of one speck
  minPx: 1.25, // ...but never smaller than this on screen, or they scintillate
  span: [11.5, 7.4, 8.5], // the box they wrap inside, centred on `origin`
  origin: [0.70, 3.30, -1.20],
  fall: [0.22, 0.48], // metres per second, min..max over the seed
  wander: 0.62,
  g: 0.72, // motes scatter strongly forward: a backlit speck flares
  gain: 0.86, // against a phase peak capped at 8, so the hottest speck is ~7
  ambient: [0.011, 0.012, 0.016],
  soft: 0.62, // metres over which a mote fades out against a surface
  // Not a real camera's shutter. The exact velocity is available for free, and
  // dust at 0.3 m/s smeared over 1/30 s is a streak one twentieth of a pixel
  // long — true, and invisible. A long shutter turns the same exact number into
  // the thing it is actually for: reading a still frame as a field in motion.
  shutter: 0.42,
  stretch: 0.45, // elongation, in speck-diameters per metre of travel
}

// --- the backdrop -----------------------------------------------------------
export const SKY = {
  wallZ: -20,
  low: [0.0060, 0.0068, 0.0092],
  high: [0.0021, 0.0026, 0.0039],
  // one broad, very dim warm bloom high on the right, where the opening is
  seam: [0.052, 0.046, 0.038],
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
