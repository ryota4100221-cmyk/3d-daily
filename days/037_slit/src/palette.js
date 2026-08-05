/**
 * The court, as numbers.
 *
 * Day 036 gave the lamp a size, and then wrote down, in its own NOTES, exactly
 * how far that had got:
 *
 *   > **面積光源の直接項も面積にする。** 影だけが大きさを知っていて、拡散反射と
 *   > ハイライトはまだ点光源のもの。
 *
 * That is the whole of today. Yesterday one number — a half-angle — reached the
 * shadow test and nothing else. The BRDF six lines above it still evaluated
 * `max(dot(n, L), 0)` and a single GGX lobe around a direction, which is the
 * shading of a source with no size at all. A frame where the *shadows* know the
 * lamp is a metre wide and the *terminator* does not is internally inconsistent
 * in a way that is easy to miss and impossible to unsee.
 *
 * So today the size arrives everywhere. And once it does, there is no longer any
 * reason for it to be one number: a source's angular extent is an ellipse, and
 * an ellipse has two of them.
 *
 *   the shadow      the blocker search and the PCF disc become an *ellipse*,
 *                   oriented in the source's own frame. The same rod, at the
 *                   same height, throws a hairline or a smear depending on which
 *                   way it is turned.
 *   the terminator  Lambert's cosine is replaced by the analytic irradiance of a
 *                   disc straddling the horizon, at the angular radius the
 *                   ellipse has *in the direction the surface is tilting*.
 *   the highlight   the GGX lobe is widened anisotropically by the source's two
 *                   angles and evaluated in a tangent frame aligned to them, so
 *                   a polished thing reflects the shape of the opening: a bar,
 *                   not a dot.
 *
 * One lamp, three consequences, and a picture whose subject is that all three
 * come from the same two numbers.
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
// A slot. Not a disc, not a point: an opening much longer than it is wide, which
// is the commonest bright thing in a room built out of masonry and the one shape
// yesterday's single `angle` could not describe.
//
// `angles` are the half-angles the source subtends along its own two axes, and
// `axis` is where the long one points *in the light's own uv frame* — pi/2 puts
// it along light-space y, which is to say across the frame and up. Every visible
// consequence in the piece is a consequence of these three numbers:
//
//   penumbra    theta * gap, per axis. A blade 1.5m up throws an edge 57cm wide
//               one way and 6cm the other — five times its own thickness, or
//               half of it. Turn the blade, and it swaps which one it gets: the
//               shadow goes from a line to a smear with no dark core anywhere.
//   terminator  a curved surface rolls out of the light over roughly the angular
//               diameter of the source in the direction it is rolling — 44
//               degrees the long way, 5 the short way.
//   highlight   the specular lobe is widened by theta/2 per axis, so a glaze
//               reflects a bar with the source's own 9:1 aspect.
//
// For scale: the sun is 0.0047 rad and isotropic. This is an interior lit
// through a long slot high in a wall — which is what the aperture upstream has
// been pretending to be since Day 031, first with a point and then, yesterday,
// with a circle.
//
// The short axis is deliberately the one that crosses the aperture's own slots:
// the shafts keep their edges (Day 036 learned the hard way what happens when
// they do not) while everything standing on the ground softens along the other.
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

  // --- the source's shape ---
  angles: [0.380, 0.042], // half-angles: along the slot, across it. Radians.
  axis: Math.PI / 2, // where the long axis points, in the light's uv frame

  // Cap on the penumbra, per axis, in world units. Past this the taps are
  // further apart than the gradient is wide, and the cap is an honest statement
  // of the budget rather than a pretence that 20 samples cover a 4m disc.
  maxPen: [2.20, 0.34],
  // Floor on it, also per axis — about a texel and a half of the map. A
  // perfectly hard edge is not more correct here, it is only aliased.
  minPen: [0.030, 0.022],
  // How far to look for a blocker. Equal to maxPen on purpose: search wider and
  // the estimate averages in occluders that cannot darken this point; narrower
  // and a real penumbra is truncated to a hard edge at the rim of its own search.
  search: [2.20, 0.34],
  // The surface's own offset along its normal before the test.
  normalBias: 0.035,
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
  spec: 0.95,
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
