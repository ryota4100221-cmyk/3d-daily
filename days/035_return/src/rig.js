import * as THREE from 'three'
import { LIGHT, MOTES } from './palette.js'
import { makeMoteMaterial } from './passes.js'

/**
 * "Return" — an alcove with a pale floor, and a ceiling no ray from the lamp
 * can ever touch.
 *
 * Day 034 arranged its scene around a single test: two plaster fields turned
 * away from the only light in the room, so that everything visible on them had
 * to have come out of the air. Today's test is the same shape, one link further
 * along the chain.
 *
 *   apron    a pale limewash platform lying in the open, where the shafts are
 *            allowed to land. This is the only bright thing in the frame, and —
 *            new today — it is a *light source*, because the composite writes
 *            what it reflects into a buffer the froxel injection reads.
 *   soffit   a canopy raked over it, five metres deep, descending away from the
 *            camera so that its whole underside is presented to the lens. That
 *            underside faces the floor and therefore faces away from a lamp that
 *            is above and behind. Not "nearly zero" — a downward-facing plane
 *            under a downward beam receives exactly nothing, forever, and no
 *            amount of moving the light will change that.
 *   jamb     the wall closing the alcove on the left. Its face looks straight at
 *            the apron and stands entirely inside the soffit's shadow, which
 *            makes it the vertical version of the same claim.
 *   pier     a slender field further back and out in the open, at a different
 *            distance from the lit air, so the picture states twice that the
 *            wash falls off the way real bounce does.
 *   bowl     one vessel standing in the direct light on the apron, so the frame
 *            has something honestly lit to be measured against.
 *   pebble   one small stone for a shaft to graze.
 *   vessel   one tall form beyond the far edge of the soffit, half silhouette.
 *   plate    the aperture, eleven units upstream, never once rendered into the
 *            frame. Three slots. It slides, very slowly, so the shafts wander
 *            across the apron and everything the apron lights wanders with them.
 *   motes    7,000 specks. One draw, no CPU (Day 033).
 *
 * The composition is the argument. Take the return path away (key 8) and the
 * underside of that slab has nothing left to be lit by.
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
  [-19.0, -4.875],
  [-3.775, -1.825],
  [0.775, 2.775],
  [3.975, 19.0],
]
const PLATE_DIST = 11.0

export function buildRig() {
  const geo = {
    apron: new THREE.BoxGeometry(5.2, 0.22, 4.4),
    soffit: new THREE.BoxGeometry(5.6, 0.30, 5.0),
    jamb: new THREE.BoxGeometry(0.50, 3.30, 4.6),
    pier: new THREE.BoxGeometry(1.9, 4.4, 0.30),
    vessel: latheSpline(VESSEL),
    bowl: latheSpline(BOWL),
    pebble: new THREE.IcosahedronGeometry(0.29, 3),
    mote: new THREE.PlaneGeometry(1, 1),
  }

  const mat = {
    // pale limewash: matte, and — this is the point of the day — worth exactly
    // its albedo times whatever the room next to it happens to be doing, in both
    // directions at once
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

  // --- the giver ------------------------------------------------------------
  // Pale, and standing on a floor that is not. The whole return term is
  // localised by that contrast: what lands on the ceiling is the shape of this
  // slab, thrown four metres upward and blurred by the air it travelled through.
  const apron = solid(geo.apron, mat.lime)
  apron.position.set(3.30, 0.11, -0.55)

  // --- the receivers --------------------------------------------------------
  // A canopy rather than a flat ceiling, raked fourteen degrees so that it descends
  // away from the camera. That is not decoration: a level slab seen from below
  // shows a two-degree band of underside and nothing else, and the surface this
  // day is about would have been a sliver. Raked, the same slab presents eight
  // degrees of its own underside to the lens — the whole plane, gradient and
  // all. The beam arrives 35 degrees off vertical, so the faces of it the lamp
  // can reach are the top and the right-hand edge. The one facing the camera is
  // unreachable by construction, forever, at any hour.
  const soffit = solid(geo.soffit, mat.lime)
  soffit.position.set(1.20, 3.15, 0.20)
  soffit.rotation.x = -0.24

  // The alcove's left wall. Its face looks straight across at the apron and
  // stands wholly inside the soffit's own shadow — a vertical statement of the
  // same thing the ceiling says horizontally.
  const jamb = solid(geo.jamb, mat.lime)
  jamb.position.set(-1.78, 1.65, 0.20)

  // Out in the open and much further away: the wash falls off with distance.
  const pier = solid(geo.pier, mat.lime)
  pier.position.set(8.10, 2.20, -7.60)
  pier.rotation.y = -0.46

  // --- what the beam is allowed to reach ------------------------------------
  const bowl = solid(geo.bowl, mat.lime)
  bowl.position.set(3.95, 0.22, 0.30)
  bowl.rotation.y = -0.52
  bowl.scale.setScalar(1.12)

  const pebble = solid(geo.pebble, mat.lime)
  pebble.position.set(5.15, 0.36, 1.10)
  pebble.scale.set(1.0, 0.74, 1.0)

  const vessel = solid(geo.vessel, mat.lime)
  vessel.position.set(0.05, 0.0, -3.90)

  root.add(apron, soffit, jamb, pier, bowl, pebble, vessel)

  // --- the motes ------------------------------------------------------------
  // A scene of their own, which is the whole trick for keeping a forward pass
  // out of a deferred renderer's way: the light-depth pass, the G-buffer and the
  // beauty pass all traverse `root` and simply never meet them.
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
