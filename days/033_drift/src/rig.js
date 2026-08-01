import * as THREE from 'three'
import { LIGHT, MOTES } from './palette.js'
import { makeMoteMaterial } from './passes.js'

/**
 * "Drift" — a still court with one opening in it, a bank of mist standing on the
 * floor, and seven thousand specks falling through the light.
 *
 * The scene list is the shortest this project has had in a fortnight, and that
 * is the argument. Day 032 needed a glass tube, a filament, nine reeds and a
 * carousel because the volume had to be *shown* to be a resource — something had
 * to read it at a depth the composite could not. Today the volume is not being
 * demonstrated, it is being lit, and the frame is emptied out so that the only
 * thing left to look at is what the air does when light is allowed to bounce in
 * it twice.
 *
 *   plate    an aperture wall standing across the beam, eleven units upstream
 *            and never once rendered into the frame. Three slots: one broad, two
 *            narrow. It slides, very slowly, so the shafts wander.
 *   step     a low dark slab for the shaft to land on.
 *   stele    one tall turned form, standing in the edge of the broad shaft.
 *   basin    one wide shallow vessel out on the open floor, left of it.
 *   pebble   one small stone on the slab, so a shaft has something to graze.
 *   motes    the whole point. One draw, no CPU, no matrices.
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
// and the swell is what keeps a 4-metre cylinder from looking like a pipe.
const STELE = [
  [0.00, 0.000], [0.50, 0.000], [0.52, 0.085], [0.41, 0.150], [0.385, 0.290],
  [0.425, 0.900], [0.405, 1.850], [0.345, 2.950], [0.290, 3.860],
  [0.305, 4.020], [0.245, 4.150], [0.00, 4.190],
]

// a wide, shallow vessel: a disc of shadow with one lit rim
const BASIN = [
  [0.0, 0.0], [0.42, 0.006], [0.66, 0.05], [0.78, 0.16], [0.80, 0.30],
  [0.76, 0.34], [0.70, 0.22], [0.58, 0.12], [0.30, 0.075], [0.0, 0.068],
]

// The aperture. Closed spans in the plate's local x; what is left between them
// is the light. One wide slot slightly left of the beam's axis and two narrow
// ones, because a single shaft is a diagram and three is a composition.
const SPANS = [
  [-19.0, -4.20],
  [-3.70, -1.30],
  [1.30, 3.20],
  [3.80, 19.0],
]
const PLATE_DIST = 11.0

export function buildRig() {
  const geo = {
    step: new THREE.BoxGeometry(6.0, 0.22, 3.4),
    stele: latheSpline(STELE),
    basin: latheSpline(BASIN),
    pebble: new THREE.IcosahedronGeometry(0.29, 3),
    mote: new THREE.PlaneGeometry(1, 1),
  }

  const mat = {
    // pale limewash: matte, and nearly a silhouette when the key is behind it
    lime: new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#d2ccc1'),
      roughness: 0.76,
      metalness: 0.0,
      envMapIntensity: 0.62,
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

  // --- the still forms ------------------------------------------------------
  const step = solid(geo.step, mat.stone)
  step.position.set(1.62, 0.11, -0.60)

  const stele = solid(geo.stele, mat.lime)
  stele.position.set(2.30, 0.22, -0.55)

  const basin = solid(geo.basin, mat.lime)
  basin.position.set(-3.05, 0.0, 1.85)
  basin.rotation.y = -0.52
  basin.scale.setScalar(1.45)

  const pebble = solid(geo.pebble, mat.lime)
  pebble.position.set(3.86, 0.425, 0.52)
  pebble.scale.set(1.0, 0.74, 1.0)

  root.add(step, stele, basin, pebble)

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
