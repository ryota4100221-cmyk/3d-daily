/**
 * The room, as numbers.
 *
 * Day 029 kept the sky in one place so the backdrop mesh and the reflection
 * pass could never disagree about what the water was mirroring. That still
 * holds — but the function has grown a dimension. Last time it was
 * `skyAtHeight(y)`: a horizontal band, which a mirror lays out as another
 * horizontal band. Today it is `skyAt(x, y)`, so the room can have **vertical**
 * light slots, and a vertical slot is the one thing a horizontal mirror turns
 * into a long streak running toward the viewer. The plate needs that streak:
 * it is the only reason a black lacquer floor reads as polished rather than
 * matte.
 *
 * All values are linear radiance — the frame stays linear until the very last
 * pass.
 */
export const SKY = {
  wallZ: -26, // the backdrop plane

  low: [0.019, 0.022, 0.030], // at the floor line
  high: [0.005, 0.006, 0.009], // up in the roof

  // a narrow warm slot, off to the right of the sculpture. Bright, because it
  // is a light source; narrow, because the plate has to read it as a line.
  warm: [0.62, 0.30, 0.13],
  warmSlot: [10.2, 0.45], // centre x, gaussian half-width

  // a broad cold wash behind the type, on the left. Barely there — its whole
  // job is to keep the left third from being a flat black rectangle.
  cool: [0.026, 0.036, 0.058],
  coolSlot: [-6.0, 4.2],

  yLow: -1.5,
  yHigh: 13.0,
}

// The gradient as GLSL. Compiled into the backdrop mesh AND into the
// reflection pass, so a ray that walks off the screen can be told exactly what
// it would have hit.
export const SKY_GLSL = /* glsl */ `
  uniform vec3 uSkyLow;
  uniform vec3 uSkyHigh;
  uniform vec3 uWarmCol;
  uniform vec2 uWarmSlot;
  uniform vec3 uCoolCol;
  uniform vec2 uCoolSlot;
  uniform vec2 uSkyRange;

  float slotAt(float x, vec2 s) {
    return exp(-pow((x - s.x) / s.y, 2.0));
  }

  vec3 skyAt(vec2 p) {
    vec3 c = mix(uSkyLow, uSkyHigh, smoothstep(uSkyRange.x, uSkyRange.y, p.y));
    // the slots are brightest down where the plate can see them, and fade out
    // toward the roof — a light panel standing on the floor, not a stripe
    float fall = mix(1.0, 0.16, smoothstep(uSkyRange.x, uSkyRange.y * 0.7, p.y));
    c += uWarmCol * slotAt(p.x, uWarmSlot) * fall;
    c += uCoolCol * slotAt(p.x, uCoolSlot) * fall;
    return c;
  }
`

export function skyUniforms(THREE) {
  return {
    uSkyLow: { value: new THREE.Color(...SKY.low) },
    uSkyHigh: { value: new THREE.Color(...SKY.high) },
    uWarmCol: { value: new THREE.Color(...SKY.warm) },
    uWarmSlot: { value: new THREE.Vector2(...SKY.warmSlot) },
    uCoolCol: { value: new THREE.Color(...SKY.cool) },
    uCoolSlot: { value: new THREE.Vector2(...SKY.coolSlot) },
    uSkyRange: { value: new THREE.Vector2(SKY.yLow, SKY.yHigh) },
  }
}
