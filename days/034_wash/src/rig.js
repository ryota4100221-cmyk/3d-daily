import * as THREE from 'three'
import { LIGHT, MOTES } from './palette.js'
import { makeMoteMaterial } from './passes.js'

/**
 * "Wash" — two plaster panels standing in a court, and one beam that never
 * touches either of them.
 *
 * The scene is arranged around a single test. The key comes from high and
 * behind; both panels face the camera, which means both face *away* from the
 * light, which means three's own shading gives them a directional term of
 * exactly zero. Almost everything visible on those two fields arrived by
 * scattering in the air twice and then reflecting once.
 *
 * Almost, and not all: the scene still has an image-based environment, so with
 * the wash switched off (key 8) the plaster does not go to black — it goes to a
 * flat, directionless grey that describes nothing about where the light in this
 * room actually is. That difference is the whole point, and it is more honest
 * than a black frame would have been. Key 9 takes away the air's *own* second
 * bounce instead, and the fields dim again, because a single-scattering medium
 * cannot carry energy sideways out of a beam and there is no beam on them.
 *
 *   plate    an aperture wall standing across the beam, eleven units upstream
 *            and never once rendered into the frame. Three slots: one broad, two
 *            narrow. It slides, very slowly, so the shafts wander and the wash
 *            they throw wanders with them.
 *   panel    the wide field, near. The subject.
 *   pier     a second, slender one further back and turned the other way, so the
 *            picture states twice — at two distances from the lit air — that the
 *            wash falls off with distance the way real bounce does.
 *   plinth   a low dark slab, where the beam is allowed to land.
 *   bowl     one wide vessel standing in that light, so the frame has something
 *            directly lit to be measured against.
 *   vessel   one tall form at the panel's edge: half of its silhouette against
 *            the washed field, half against the dark.
 *   pebble   one small stone for a shaft to graze.
 *   motes    7,000 specks. One draw, no CPU (Day 033).
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

// A tapered shaft with a little entasis — it reads as thrown rather than cut,
// and the swell is what keeps a 3.6-metre cylinder from looking like a pipe.
const VESSEL = [
  [0.00, 0.000], [0.46, 0.000], [0.48, 0.080], [0.375, 0.140], [0.355, 0.270],
  [0.395, 0.830], [0.375, 1.700], [0.320, 2.700], [0.268, 3.540],
  [0.282, 3.690], [0.226, 3.810], [0.00, 3.850],
]

// a wide, shallow vessel: a disc of shadow with one lit rim
const BOWL = [
  [0.0, 0.0], [0.42, 0.006], [0.66, 0.05], [0.78, 0.16], [0.80, 0.30],
  [0.76, 0.34], [0.70, 0.22], [0.58, 0.12], [0.30, 0.075], [0.0, 0.068],
]

// The aperture. Closed spans in the plate's local x; what is left between them
// is the light. One wide slot slightly left of the beam's axis and two narrow
// ones, because a single shaft is a diagram and three is a composition.
const SPANS = [
  [-19.0, -4.20],
  [-3.70, -1.10],
  [0.50, 3.20],
  [3.80, 19.0],
]
const PLATE_DIST = 11.0

export function buildRig() {
  const geo = {
    plinth: new THREE.BoxGeometry(5.0, 0.22, 2.8),
    panel: new THREE.BoxGeometry(5.4, 6.1, 0.34),
    pier: new THREE.BoxGeometry(2.1, 5.2, 0.30),
    vessel: latheSpline(VESSEL),
    bowl: latheSpline(BOWL),
    pebble: new THREE.IcosahedronGeometry(0.29, 3),
    mote: new THREE.PlaneGeometry(1, 1),
  }

  const mat = {
    // pale limewash: matte, and — this is the point of the day — worth exactly
    // its albedo times whatever the air next to it happens to be doing
    lime: new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#d2ccc1'),
      roughness: 0.78,
      metalness: 0.0,
      envMapIntensity: 0.55,
    }),
    stone: new THREE.MeshStandardMaterial({
      color: new THREE.Color('#26262a'),
      roughness: 0.90,
      metalness: 0.0,
      envMapIntensity: 0.28,
    }),
    // the plate is only ever seen from its dark side, and in fact is never seen
    // at all; it is not asked to be anything but an occluder
    slate: new THREE.MeshStandardMaterial({
      color: new THREE.Color('#15161a'),
      roughness: 0.94,
      metalness: 0.0,
      envMapIntensity: 0.20,
    }),
  }

  const solid = (g, m, shadow = true) => {
    const mesh = new THREE.Mesh(g, m)
    mesh.castShadow = shadow
    mesh.receiveShadow = true
    return mesh
  }

  const root = new THREE.Group()

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
    s.receiveShadow = false // never lit; asking for it costs a shadow lookup
    s.position.x = (a + b) * 0.5
    plateSlide.add(s)
  }
  screen.add(plateSlide)
  root.add(screen)

  // --- the two fields -------------------------------------------------------
  // Both are turned a few degrees off square. A panel exactly perpendicular to
  // the camera reads as a backdrop; a panel at eight degrees reads as an object
  // standing in a room, and the wash across it gets a gradient to describe.
  const panel = solid(geo.panel, mat.lime)
  panel.position.set(1.90, 3.00, -4.20)
  panel.rotation.y = 0.15

  const pier = solid(geo.pier, mat.lime)
  pier.position.set(6.90, 2.60, -6.10)
  pier.rotation.y = -0.22

  // --- what the beam is allowed to reach ------------------------------------
  const plinth = solid(geo.plinth, mat.stone)
  plinth.position.set(3.00, 0.11, 0.30)

  const bowl = solid(geo.bowl, mat.lime)
  bowl.position.set(2.90, 0.22, 0.35)
  bowl.rotation.y = -0.52
  bowl.scale.setScalar(1.12)

  const pebble = solid(geo.pebble, mat.lime)
  pebble.position.set(4.96, 0.42, 0.88)
  pebble.scale.set(1.0, 0.74, 1.0)

  const vessel = solid(geo.vessel, mat.lime)
  vessel.position.set(0.60, 0.0, -2.20)

  root.add(panel, pier, plinth, bowl, pebble, vessel)

  // --- the motes ------------------------------------------------------------
  // A scene of their own, which is the whole trick for keeping a forward pass
  // out of a deferred renderer's way: the light-depth pass, the G-buffer and the
  // beauty pass all traverse `root` and simply never meet them. No visible flags
  // to toggle, no per-pass filtering, nothing to forget.
  const moteScene = new THREE.Scene()
  const moteMat = makeMoteMaterial()
  const motes = new THREE.InstancedMesh(geo.mote, moteMat, MOTES.count)
  motes.frustumCulled = false
  motes.castShadow = false
  motes.receiveShadow = false

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
    plateSlide.position.x = Math.sin(t * 0.0365) * 1.65
    moteMat.uniforms.uTime.value = t
    root.updateMatrixWorld(true)
    moteScene.updateMatrixWorld(true)
  }

  function dispose() {
    Object.values(geo).forEach((g) => g.dispose())
    plateGeos.forEach((g) => g.dispose())
    Object.values(mat).forEach((m) => m.dispose())
    moteMat.dispose()
    motes.dispose()
  }

  // `screen` is handed back so the pipeline can switch it off after the two
  // light-space passes. It is a shadow caster and nothing else. The rule from
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
