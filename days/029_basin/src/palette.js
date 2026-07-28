/**
 * The sky lives in two places at once: the backdrop mesh paints it, and the
 * reflection pass has to be able to *evaluate* it for rays that leave the
 * screen without hitting anything. Keeping the numbers here means the water can
 * never mirror a sky that differs from the one above it.
 *
 * All values are linear — the whole frame stays linear until the composite.
 */
export const SKY = {
  wallZ: -26, // the backdrop plane
  low: [0.300, 0.212, 0.148], // at the waterline
  high: [0.068, 0.082, 0.110], // at the top
  band: [0.560, 0.320, 0.148], // the warm bar sitting on the horizon
  bandWidth: 1.02,
  yLow: -1.0,
  yHigh: 12.0,
}

// the gradient, as GLSL — compiled into the backdrop and into the ray march
export const SKY_GLSL = /* glsl */ `
  uniform vec3 uSkyLow;
  uniform vec3 uSkyHigh;
  uniform vec3 uSkyBand;
  uniform float uBandWidth;
  uniform vec2 uSkyRange;

  vec3 skyAtHeight(float y) {
    vec3 c = mix(uSkyLow, uSkyHigh, smoothstep(uSkyRange.x, uSkyRange.y, y));
    return c + uSkyBand * exp(-pow(y / uBandWidth, 2.0));
  }
`

export function skyUniforms(THREE) {
  return {
    uSkyLow: { value: new THREE.Color(...SKY.low) },
    uSkyHigh: { value: new THREE.Color(...SKY.high) },
    uSkyBand: { value: new THREE.Color(...SKY.band) },
    uBandWidth: { value: SKY.bandWidth },
    uSkyRange: { value: new THREE.Vector2(SKY.yLow, SKY.yHigh) },
  }
}
