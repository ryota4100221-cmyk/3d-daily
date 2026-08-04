import * as THREE from 'three'
import { LIGHT, MOTES } from './palette.js'
import { makeMoteMaterial } from './passes.js'

/**
 * "Penumbra" — a rake of staves standing in the light, and the ground they
 * write on.
 *
 * Every scene in this series has been arranged around one claim, and today's is
 * the simplest it has been: **a shadow is sharp where it touches and soft where
 * it does not.** So the frame needs objects whose shadows have a *run* — long
 * enough that the same edge can be seen doing both things at once, within a few
 * centimetres of each other, in the same shot.
 *
 *   apron    a pale limewash platform, wide and shallow, where the shafts land.
 *            It is the page. It is also — Day 035, still running — the brightest
 *            thing in the room and therefore a light source, because the
 *            composite writes what it reflects into a buffer the froxel
 *            injection reads next frame.
 *   staves   seven slender rods standing on it in a shallow arc, 0.85m to 3.30m.
 *            The beam comes from behind and to the right, so their shadows all
 *            run toward the camera and to the left, parallel, like the teeth of
 *            a rake. Each one is a hairline where it meets the stone and a
 *            gradient a hand wide at its tip — the same edge, one object, two
 *            answers. The tallest one's tip has no umbra left at all: at 3.3m of
 *            gap the penumbra is wider than the rod, which is exactly what
 *            happens to the shadow of a thin thing thrown far.
 *   bowl     one vessel in the direct light, so the frame has something honestly
 *            lit to be measured against, and a contact shadow with a real
 *            hardening under its foot.
 *   lintel   a beam on two piers across the back of the court. Its underside
 *            faces the floor and the lamp is above and behind, so it receives
 *            exactly zero direct light — Day 034's and Day 035's test, kept in
 *            frame so today's work does not quietly cost yesterday's. It is also
 *            the tallest blocker here, and throws the widest soft edge in the
 *            picture: a band across the back of the page with a
 *            quarter-metre gradient on it.
 *   plate    the aperture, seven units upstream, never once rendered into the
 *            frame. Three slots. It slides, very slowly, so the shafts wander
 *            and everything the shafts light wanders with them.
 *   motes    7,000 specks. One draw, no CPU (Day 033).
 *
 * The composition is the argument. Press 9 and the lamp collapses back to a
 * point: every one of those gradients snaps to a line, the shafts get ruled
 * edges, and the room turns into a diagram of itself.
 *
 * Built imperatively, because "where was this last frame" has to be a property
 * of the object graph rather than of a React render.
 */

function latheSpline(profile, segments = 128) {
  const curve = new THREE.SplineCurve(profile.map(([x, y]) => new THREE.Vector2(x, y)))
  const g = new THREE.LatheGeometry(curve.getPoints(112), segments)
  g.computeVertexNormals()
  return g
}

// a wide, shallow vessel: a disc of shadow with one lit rim
const BOWL = [
  [0.0, 0.0], [0.42, 0.006], [0.66, 0.05], [0.78, 0.16], [0.80, 0.30],
  [0.76, 0.34], [0.70, 0.22], [0.58, 0.12], [0.30, 0.075], [0.0, 0.068],
]

/**
 * The rake. x along the apron, z curving gently toward the camera at the ends,
 * height an arc rather than a ramp — a monotonic staircase would read as a
 * diagram, and the tallest rod belongs a little off centre.
 *
 * `r` is the radius at the base; every stave tapers to 70% of it at the top. The
 * numbers matter for the day: at 0.085 rad the penumbra equals the rod's own
 * width once the gap reaches about ten times the radius, and past that point the
 * shadow has no fully dark core anywhere. The tallest stave crosses that line
 * two thirds of the way along its own shadow, in frame, on purpose.
 */
const STAVES = [
  [0.55, -1.35, 0.90, 0.062],
  [1.42, -1.02, 1.58, 0.070],
  [2.28, -0.82, 2.42, 0.078],
  [3.12, -0.76, 3.30, 0.086],
  [3.96, -0.86, 2.62, 0.076],
  [4.76, -1.10, 1.74, 0.068],
  [5.52, -1.48, 1.02, 0.060],
]

// The aperture. Closed spans in the plate's local x; what is left between them
// is the light. One wide slot slightly left of the beam's axis and two narrow
// ones, because a single shaft is a diagram and three is a composition.
const SPANS = [
  [-19.0, -5.35],
  [-4.25, -2.05],
  [0.55, 1.95],
  [3.35, 19.0],
]

// Four and a half units, not eleven. This number did nothing at all until today:
// the light is directional, so sliding the plate along the beam does not move a
// single shaft by a millimetre. What it moves is the *gap*, and the gap is now
// the softness — at 0.085 rad every metre upstream costs another 8.5cm of
// gradient on the ground. At yesterday's eleven the three slots arrived as one
// featureless pool, 90cm of penumbra on each side of a 1.2m shaft, which is
// physically right and pictorially nothing. Pressing 9 is what showed it: the
// hard render has three crisp bands where the soft one has a wash.
//
// So the plate came down to where its edges are still edges. A parameter that
// was arbitrary for five days acquired a meaning the moment the lamp got a size.
const PLATE_DIST = 4.6

export function buildRig() {
  const geo = {
    apron: new THREE.BoxGeometry(8.6, 0.20, 6.0),
    lintel: new THREE.BoxGeometry(7.4, 0.44, 0.72),
    pier: new THREE.BoxGeometry(0.42, 3.02, 0.62),
    bowl: latheSpline(BOWL),
    mote: new THREE.PlaneGeometry(1, 1),
  }

  const mat = {
    // pale limewash: matte, and worth exactly its albedo times whatever the room
    // next to it happens to be doing, in both directions at once
    lime: new THREE.MeshStandardMaterial({
      color: new THREE.Color('#d4cec3'),
      roughness: 0.80,
      metalness: 0.0,
    }),
    // a shade cooler and a shade darker, so the rake reads against its own page
    chalk: new THREE.MeshStandardMaterial({
      color: new THREE.Color('#b9b5ad'),
      roughness: 0.72,
      metalness: 0.0,
    }),
    stone: new THREE.MeshStandardMaterial({
      color: new THREE.Color('#24242a'),
      roughness: 0.90,
      metalness: 0.0,
    }),
    // the plate is only ever seen from its dark side, and in fact is never seen
    // at all; it is not asked to be anything but an occluder
    slate: new THREE.MeshStandardMaterial({
      color: new THREE.Color('#15161a'),
      roughness: 0.94,
      metalness: 0.0,
    }),
  }

  const solid = (g, m, shadow = true) => {
    const mesh = new THREE.Mesh(g, m)
    mesh.castShadow = shadow // the light-depth pass reads this and nothing else
    return mesh
  }

  const root = new THREE.Group()
  const staveGeos = []

  // --- the aperture --------------------------------------------------------
  // Positioned and oriented from LIGHT, not by hand: lookAt(target) points the
  // group's local +z straight down the beam, so the slots stand square across it
  // and the shafts they cut are parallel by construction.
  const screen = new THREE.Group()
  screen.position.set(
    LIGHT.target[0] + LIGHT.dir[0] * PLATE_DIST,
    LIGHT.target[1] + LIGHT.dir[1] * PLATE_DIST,
    LIGHT.target[2] + LIGHT.dir[2] * PLATE_DIST
  )
  screen.lookAt(new THREE.Vector3(...LIGHT.target))

  const plateGeos = []
  const plateSlide = new THREE.Group()
  for (const [a, b] of SPANS) {
    const g = new THREE.BoxGeometry(b - a, 46.0, 0.28)
    plateGeos.push(g)
    const s = solid(g, mat.slate)
    s.position.x = (a + b) * 0.5
    plateSlide.add(s)
  }
  screen.add(plateSlide)
  root.add(screen)

  // --- the page -------------------------------------------------------------
  // Wide enough that its near edge leaves the bottom of the frame: the eye
  // should read a ground, not a floating tile.
  const apron = solid(geo.apron, mat.lime)
  apron.position.set(2.70, 0.10, -0.35)

  // --- the rake -------------------------------------------------------------
  const staves = STAVES.map(([x, z, h, r]) => {
    const g = new THREE.CylinderGeometry(r * 0.70, r, h, 22, 1)
    staveGeos.push(g)
    const s = solid(g, mat.chalk)
    s.position.set(x, 0.22 + h * 0.5, z)
    return s
  })

  // --- the reference --------------------------------------------------------
  const bowl = solid(geo.bowl, mat.lime)
  bowl.position.set(5.35, 0.20, 1.05)
  bowl.rotation.y = -0.52
  bowl.scale.setScalar(1.14)

  // --- the threshold --------------------------------------------------------
  // A beam on two piers, standing across the back of the court. It earns its
  // place twice.
  //
  // Its underside faces the floor and the lamp is above and behind, so
  // dot(n, L) there is negative — not small, negative. That face receives
  // exactly zero direct light, forever, and with the environment map deleted
  // this morning it has nothing at all except the wash coming off the bright
  // apron below it. Day 034's and Day 035's test, kept in frame, so today's work
  // cannot quietly cost yesterday's.
  //
  // And it is the tallest blocker in the picture: three metres above the ground
  // it throws the widest soft edge in the frame, a band across the back of the
  // page whose gradient is a quarter of a metre. The staves say "sharp here,
  // soft there" at the scale of a hand; the beam says it at the scale of a room.
  const lintel = solid(geo.lintel, mat.lime)
  lintel.position.set(4.70, 3.24, -4.35)

  const piers = [1.30, 8.10].map((x) => {
    const m = solid(geo.pier, mat.lime)
    m.position.set(x, 1.510, -4.35)
    return m
  })

  root.add(apron, bowl, lintel, ...piers, ...staves)

  // --- the motes ------------------------------------------------------------
  // A scene of their own, which is the whole trick for keeping a forward pass
  // out of a deferred renderer's way: the light-depth pass and the G-buffer both
  // traverse `root` and simply never meet them.
  const moteScene = new THREE.Scene()
  const moteMat = makeMoteMaterial()
  const motes = new THREE.InstancedMesh(geo.mote, moteMat, MOTES.count)
  motes.frustumCulled = false
  motes.castShadow = false

  // Four floats per speck and nothing else — the position is a function, not a
  // buffer, so this is the entire per-particle state the GPU is ever given.
  const seeds = new Float32Array(MOTES.count * 4)
  const rand = mulberry32(0x0d3f71)
  for (let i = 0; i < MOTES.count; i++) {
    seeds[i * 4 + 0] = rand()
    seeds[i * 4 + 1] = rand()
    seeds[i * 4 + 2] = rand()
    seeds[i * 4 + 3] = rand()
  }
  geo.mote.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4))
  moteScene.add(motes)

  function step_(t) {
    // one slow lateral wander of the aperture: the shafts are never quite where
    // they were a minute ago, and nothing else in the frame moves at all
    plateSlide.position.x = Math.sin(t * 0.0365) * 1.55
    moteMat.uniforms.uTime.value = t
    root.updateMatrixWorld(true)
    moteScene.updateMatrixWorld(true)
  }

  function dispose() {
    Object.values(geo).forEach((g) => g.dispose())
    plateGeos.forEach((g) => g.dispose())
    staveGeos.forEach((g) => g.dispose())
    Object.values(mat).forEach((m) => m.dispose())
    moteMat.dispose()
    motes.dispose()
  }

  // `screen` is handed back so the pipeline can switch it off after the
  // light-space pass. It is a shadow caster and nothing else. The rule from
  // Day 031 stands: the object the piece is built around is never once seen.
  return { group: root, screen, moteScene, moteMat, motes, step: step_, dispose }
}

// deterministic, so the field is the same on every machine and in every capture
function mulberry32(a) {
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
