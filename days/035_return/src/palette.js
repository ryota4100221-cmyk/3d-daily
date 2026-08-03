/**
 * The court, as numbers.
 *
 * Day 034 taught the air to light the stone, and then wrote down, in its own
 * NOTES, the two things it still could not do:
 *
 *   > **wash の可視性項。** ボリュームは面を知らないので、板は裏の空気からも光を受け取る。
 *   > **面 → 空気の注入。** 今日は空気→面の一方通行。明るい床が上の空気を照らし返せば、
 *   > ようやく閉じる。
 *
 * Both are the same missing sentence, said twice. In Day 034 the light went one
 * way — lamp, air, surface, eye — and a one-way path is not a light transport
 * solution, it is a chain of effects that happens to end at a camera. A room is
 * lit the way it is because the light goes *round*: down the shaft, off the pale
 * floor, back up into the air above it, and onto the underside of a slab that no
 * ray from the lamp will ever touch.
 *
 * Today that circuit closes, and it closes in the only place it could: the
 * injection pass, which has spent three days being told what the lamp is doing
 * and never once being told what the room is doing back.
 *
 * Everything here is linear radiance. Nothing is graded until the last pass.
 */

// --- the froxel grid --------------------------------------------------------
//
// Unchanged in shape since Day 032: one 2D atlas of 64 tiles, 256 x 144 cells
// across the screen, because a 3D render target in WebGL2 can only be written
// one layer per draw.
//
// The list of readers keeps growing, and today the grid gains something better
// than a reader — a *writer that is not the lamp*. Day 032 wrote it from the
// light. Day 033 let it write itself. Day 034 let surfaces read it. Today
// surfaces write into it too, which is the point at which the grid stops being a
// picture of the beam and becomes a picture of the room.
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

// --- multiple scattering (air -> air) ---------------------------------------
//
// Day 033's Jacobi iteration, kept whole: each froxel gathers what its
// neighbours held last frame, keeps `albedo` of it, and adds it back with no
// phase function, because a photon on its second bounce has forgotten which way
// it came from. One iteration per frame; the frames compose into the series.
//
// It is worth naming what happens to this today. Until now the iteration was
// closed over the air alone: the only energy in the loop was energy the lamp put
// into the air. With the return term below, surfaces are inside the same
// iteration — air feeds the stone, the stone feeds the air, and the air feeds
// itself — so the fixed point the frames converge to is a *room*, not a fog
// bank. That is a strictly larger operator solved by exactly the same machinery,
// which is the whole argument for having built the machinery this way.
export const MULTI = {
  albedo: [0.550, 0.505, 0.420],
  radius: 1.15, // metres between a cell and the neighbours it gathers from
  sigmaFloor: 0.014,
  clamp: 9.0,
}

// --- the air lighting the stone (air -> surface) ----------------------------
//
// Day 034's gather, with one thing added and one thing taken away.
//
// Added: a visibility term. A froxel is filled from the lamp and the medium and
// has never heard of a surface, so the air on the far side of a slab is exactly
// as bright in the grid as the air in front of it, and yesterday's only defence
// was to step `bias` along the normal and hope. That was written down as a
// mitigation. The fix is in VIS below — and it is not in the volume at all,
// because the volume is the wrong place to keep it.
//
// Taken away: most of `bias`. Once the occlusion is real, the bias no longer has
// to be large enough to clear a slab; it only has to clear the surface's own
// depth quantisation. 0.40 -> 0.22, which lets the gather sample the air that is
// actually touching the stone rather than the air forty centimetres off it.
export const BOUNCE = {
  gain: 0.235,
  radius: 1.35,
  bias: 0.22,
  spread: 0.88,
  jitter: 0.70,
  sigmaFloor: 0.014,
  clamp: 6.0,
}

// --- the visibility term ----------------------------------------------------
//
// The obvious place to put "is there something between these two points" is the
// volume: give every froxel an opacity channel and let the gather read it. That
// is wrong twice over. It spends a channel across 2.36 million cells to store
// something at 25cm resolution, and it answers the question in the *volume's*
// coordinates when both endpoints of the question live on the screen.
//
// The pass that needs the answer already holds both endpoints and a depth buffer
// of every surface between them. So the segment from the shaded point to the tap
// is marched in screen space — five steps, project, compare against the
// G-buffer's linear depth — and a tap whose segment passes behind a surface is
// not counted. Day 028 compared a reconstructed view position against a depth
// buffer to make ambient occlusion; Day 029 marched a ray across the screen to
// find a reflection. This is those two tools pointed at a third question.
//
// `thick` is the standard admission that a depth buffer is not a solid: a sample
// four metres behind the nearest surface is probably behind a *different*
// object, not inside this one, and rejecting it would carve holes in the light
// wherever a near silhouette crosses a far one.
export const VIS = {
  bias: 0.055, // world units, scaled slightly with distance
  thick: 3.2, // beyond this the occluder is treated as something else entirely
}

// --- the stone lighting the air (surface -> air) ----------------------------
//
// Today's technique, and the direction that was missing.
//
// The injection pass asks, for every cell, "what is the lamp putting here". It
// now also asks "what is the *room* putting here", and answers it the way the
// rest of this renderer answers everything: in screen space, out of buffers that
// already exist. The cell projects to a pixel; five taps around that pixel read
// the G-buffer's normal and depth and the composite's new radiosity attachment.
// Each tap is a small patch of surface at a known world position with a known
// outgoing radiance, and the form factor between a patch and a point is
// elementary:
//
//   E(cell) = Σ  B(patch) · cos(n_patch, patch->cell) · 1/(1 + d²/r0²) · p(θ)
//
// The phase function is kept, unlike in the air-to-air diffusion, and with a
// much weaker anisotropy. Light arriving from a patch of floor has a direction —
// unlike light that has bounced twice and forgotten — but a floor is an area
// source subtending a wide angle, so a sharp forward lobe would be a lie about
// how sharp the arrival is. 0.24 rather than the beam's 0.62.
//
// `range` is where this stops being physics and starts being a screen-space
// gather: a patch six metres away contributes almost nothing to a cell anyway,
// and cutting the search short keeps the cost at five taps regardless of scene.
export const RETURN = {
  gain: 6.00,
  // How far a surface can be from a cell and still count. Faded smoothly over
  // the last third, so the boundary is not a shell in the air.
  range: 5.2,
  // Softening radius of the inverse-square term. Without it a cell sitting on
  // the floor divides by nothing and the bottom slice of the volume detonates.
  //
  // It is also doing a second, less obvious job. A point-to-patch form factor
  // falls off as 1/d², but a *plane* does not fall off at all — irradiance from
  // an infinite lit floor is the same at one metre and at four. Seven taps
  // sampling an area source recover far too little of it at distance, and
  // widening r0 is the cheapest honest correction: it flattens the near field's
  // falloff toward what an area actually does.
  r0: 1.80,
  // Radius, in metres at the cell's own depth, of the outer of two screen-space
  // rings. Seven taps: the pixel the cell projects to, three at a third of this
  // radius, three at all of it. One ring is not enough, and the reason is the
  // scene — the ceiling that proves the day is four metres above the floor that
  // lights it, so a disc sized for the air near a wall never sees the floor, and
  // a disc sized to reach the floor steps over everything close by.
  spread: 2.60,
  g: 0.24,
  clamp: 5.5, // ceiling on one patch's radiosity; a specular pinprick is not a room
}

// --- the light --------------------------------------------------------------
//
// Still one. High, behind, and steep — the beam travels down, to the left and
// toward the camera. Nearly white and barely warm: every warm thing in this
// frame is supposed to have become warm by bouncing.
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
//
// A little thinner and a little taller than yesterday. The surface that proves
// the day is three metres off the ground, so the mist has to still be there at
// three metres, and it has to be thin enough that the slab is read *through* it
// rather than behind it.
export const FOG = {
  density: 0.062, // extinction per world unit at floor level
  height: 4.10, // e-folding height of the bank
  y0: -0.35,
  g: 0.62, // Henyey-Greenstein anisotropy for the direct term
  scatter: 2.15,
  center: [1.60, -1.20],
  radius: [6.8, 10.8], // fade the medium out well inside the light-space map
}

// --- the motes --------------------------------------------------------------
export const MOTES = {
  count: 7000,
  size: 0.0125, // world radius of one speck
  minPx: 1.25, // ...but never smaller than this on screen, or they scintillate
  span: [12.0, 8.4, 9.0], // the box they wrap inside, centred on `origin`
  origin: [1.60, 3.60, -0.40],
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
