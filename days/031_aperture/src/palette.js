/**
 * The hall, as numbers.
 *
 * Day 029 kept the room's gradient in one file so the backdrop mesh and the
 * reflection pass could never disagree about what the water was showing; Day 030
 * gave that function a second dimension. Today the single shared definition
 * matters for a different reason: the volumetric pass has to know what the air
 * is standing in front of, and the backdrop has to be dark enough that a beam
 * of light in front of it is the brightest thing in the frame.
 *
 * Everything here is linear radiance. Nothing is graded until the last pass.
 */

// --- the light --------------------------------------------------------------
//
// One direction, and every part of the pipeline derives its own matrices from
// it: three's shadow camera for surface shading, and our own orthographic
// camera for the light-space depth map the ray march reads.
//
// It comes from high on the right and *behind* the piece, so the beams travel
// toward the viewer. That is the whole reason for the scene: forward scattering
// only pays off when you are looking into the light.
export const LIGHT = {
  target: [1.85, 1.45, 0.0],
  dir: [0.812, 0.470, -0.345], // unit: from the target *toward* the light
  dist: 26.0, // how far back the light cameras stand
  // The light-space map has to cover every point the haze is allowed to exist
  // at, or its own border shows up in the air as a straight edge of "everything
  // past here is lit". 17 across is what FOG.radius below fits inside.
  halfSize: 17.0,
  far: 52.0,
  size: 2048,
  bias: 0.07, // world units, compared against a linear depth
  color: [1.0, 0.855, 0.66],
  intensity: 5.2,
}

// where the two light cameras — three's shadow camera and our own depth
// camera — both stand. One definition, because a beam that is lit in one and
// shadowed in the other is a beam that does not land on its own floor.
export function lightPosition() {
  return [
    LIGHT.target[0] + LIGHT.dir[0] * LIGHT.dist,
    LIGHT.target[1] + LIGHT.dir[1] * LIGHT.dist,
    LIGHT.target[2] + LIGHT.dir[2] * LIGHT.dist,
  ]
}

// --- the air ----------------------------------------------------------------
export const FOG = {
  // Thin. The first version of this scene ran at 0.058 and the whole right half
  // of the frame — the side with no occluder in it — integrated into a flat
  // bright wall. A beam is a *contrast* phenomenon: it only exists where the
  // unshadowed haze around it is dim enough to be read as darkness.
  density: 0.034, // extinction per world unit at floor level
  height: 3.0, // e-folding height of the haze
  y0: -0.4, // below this the density stops growing
  g: 0.70, // Henyey-Greenstein anisotropy — forward scattering
  // the light's radiance, the medium's albedo and the phase function's 1/4π,
  // all collapsed into one number that can actually be dialled
  scatter: 8.0,
  // the haze is not infinite: it thins out past the hall so the edge of the
  // light-space depth map never shows itself as a straight line in the air
  // and it is a *pocket* of haze, not a world of it: gathered around the piece
  // so the left third of the frame, where the type lives, stays black
  center: [1.85, -0.6],
  radius: [5.0, 11.0],
  maxDist: 32.0,
}

// --- the backdrop -----------------------------------------------------------
export const SKY = {
  wallZ: -20,
  low: [0.0085, 0.0092, 0.0115],
  high: [0.0030, 0.0034, 0.0046],
  // one narrow warm seam, far right, where the light would be coming through
  warm: [0.135, 0.070, 0.032],
  warmSlot: [11.4, 1.5],
  yLow: -1.5,
  yHigh: 13.0,
}

export const SKY_GLSL = /* glsl */ `
  uniform vec3 uSkyLow;
  uniform vec3 uSkyHigh;
  uniform vec3 uWarmCol;
  uniform vec2 uWarmSlot;
  uniform vec2 uSkyRange;

  vec3 skyAt(vec2 p) {
    vec3 c = mix(uSkyLow, uSkyHigh, smoothstep(uSkyRange.x, uSkyRange.y, p.y));
    float fall = mix(1.0, 0.20, smoothstep(uSkyRange.x, uSkyRange.y * 0.7, p.y));
    c += uWarmCol * exp(-pow((p.x - uWarmSlot.x) / uWarmSlot.y, 2.0)) * fall;
    return c;
  }
`

export function skyUniforms(THREE) {
  return {
    uSkyLow: { value: new THREE.Color(...SKY.low) },
    uSkyHigh: { value: new THREE.Color(...SKY.high) },
    uWarmCol: { value: new THREE.Color(...SKY.warm) },
    uWarmSlot: { value: new THREE.Vector2(...SKY.warmSlot) },
    uSkyRange: { value: new THREE.Vector2(SKY.yLow, SKY.yHigh) },
  }
}
