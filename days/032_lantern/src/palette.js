/**
 * The hall, as numbers.
 *
 * Day 031 kept the light in one file so that three's shadow camera and the ray
 * march's own light camera could never disagree. Today a third consumer joins
 * them — the froxel grid — and it is the one with the strongest opinion, because
 * it decides *where in the room* the medium is sampled at all.
 *
 * Everything here is linear radiance. Nothing is graded until the last pass.
 */

// --- the froxel grid --------------------------------------------------------
//
// The volume is stored as one 2D atlas of Z slices rather than a 3D texture,
// because a 3D render target in WebGL2 can only be written one layer per draw:
// 64 layers is 64 binds for the injection and 384 for the integration. Laid out
// as tiles, the whole volume is one framebuffer and one draw.
//
// 256 x 144 across the screen is coarse — a froxel is six pixels wide at 1600px
// — and that is the honest cost of the technique. It is also why this piece is
// lit with wide, soft shafts instead of Day 031's razor blades: you design for
// the sampling rate you have. What makes six pixels survivable is that the cell
// is *jittered and integrated* rather than point-sampled (see froxel.js), so it
// carries the average over its own footprint instead of one sample from the
// middle of it, and a shaft edge crosses two cells as a ramp rather than a stair.
//
// 64 slices, distributed exponentially, so the near air (where the eye is) gets
// most of them.
export const FROXEL = {
  x: 256,
  y: 144,
  z: 64,
  tx: 8, // tiles across the atlas
  ty: 8, // tiles down — tx * ty must equal z
  // The near plane of the *grid*, which is not the near plane of the camera and
  // has no reason to be. Slices are spaced exponentially from here, so this
  // number decides where the resolution goes. At 0.35 the debug atlas came back
  // with six of its eight rows solid black: the camera stands outside the mist
  // pocket, nothing scatters until about five units out, and forty-seven slices
  // were being spent on empty air. Moving it to 6.0 more than halves the slab thickness
  // everywhere the medium actually is, for free.
  near: 6.0,
  far: 36.0, // the far wall sits at ~34 units; past this there is nothing to fog
}

export const ATLAS = {
  w: FROXEL.x * FROXEL.tx,
  h: FROXEL.y * FROXEL.ty,
}

// log2(FROXEL.z) prefix-scan passes: offsets 1, 2, 4, 8, 16, 32
export const SCAN_STEPS = Math.round(Math.log2(FROXEL.z))

// --- the key light ----------------------------------------------------------
//
// Cool, and from high on the right and *behind* the piece, so the shafts travel
// toward the viewer and forward scattering pays off. Day 031's key was amber;
// this one is north light, because today the warm thing in the frame is inside
// the glass and there must be only one of them.
export const LIGHT = {
  target: [1.85, 1.55, 0.0],
  dir: [0.795, 0.500, -0.343], // unit-ish: from the target *toward* the light
  dist: 26.0,
  halfSize: 17.0, // must cover everywhere FOG.radius allows medium to exist
  far: 52.0,
  size: 2048,
  bias: 0.07, // world units, compared against a linear depth
  color: [0.70, 0.80, 1.0],
  intensity: 4.6,
}

export function lightPosition() {
  return [
    LIGHT.target[0] + LIGHT.dir[0] * LIGHT.dist,
    LIGHT.target[1] + LIGHT.dir[1] * LIGHT.dist,
    LIGHT.target[2] + LIGHT.dir[2] * LIGHT.dist,
  ]
}

// --- the lamp ---------------------------------------------------------------
//
// The second light, and the argument for the whole technique. Adding it to
// Day 031's ray march would have meant a second shadow map lookup at every one
// of forty-eight steps per pixel. Here it is one more term evaluated once per
// froxel — 2.4 million times, no matter how large the window is.
//
// It is unshadowed. A point light inside a glass tube, glowing into mist that is
// mostly outside the tube, does not have an interesting shadow; it has a
// falloff, and the falloff is cut short deliberately so the warm glow stays a
// pocket around the lantern instead of tinting the whole hall.
export const LAMP = {
  pos: [1.85, 1.62, -0.20],
  color: [1.0, 0.575, 0.255],
  intensity: 3.4, // for the three.js point light that shades the surfaces
  distance: 8.5,
  power: 2.9, // for the froxel injection
  radius: [2.6, 7.6], // soft cut-off of the in-scatter contribution
  g: 0.15, // almost isotropic: a lamp is not a beam
  scatter: 1.35,
}

// --- the air ----------------------------------------------------------------
export const FOG = {
  // A little thicker than Day 031, and much lower: the subject today is a bank
  // of mist standing on the floor with a lit object in it, not a hall full of
  // haze. A shaft is still a contrast phenomenon — it exists only because the
  // unshadowed medium around it is dim.
  density: 0.044, // extinction per world unit at floor level
  height: 2.05, // e-folding height of the mist bank
  y0: -0.5,
  g: 0.66, // Henyey-Greenstein anisotropy of the key light in the medium
  // Radiance, albedo and the phase function's 1/4pi, collapsed. Deliberately
  // short of clipping: a shaft that saturates to white stops being cold light
  // and starts being paper, and the only warm thing in this room is the lamp.
  scatter: 5.0,
  center: [1.85, -0.4],
  radius: [5.5, 12.0], // fade the medium out well inside the light-space map
}

// --- the backdrop -----------------------------------------------------------
export const SKY = {
  wallZ: -20,
  low: [0.0072, 0.0084, 0.0114],
  high: [0.0026, 0.0032, 0.0048],
  // one narrow cool seam, far right, where the key would be coming through
  seam: [0.062, 0.080, 0.126],
  seamSlot: [11.0, 1.7],
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
    float fall = mix(1.0, 0.20, smoothstep(uSkyRange.x, uSkyRange.y * 0.7, p.y));
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
