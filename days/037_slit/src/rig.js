import * as THREE from 'three'
import { LIGHT, MOTES } from './palette.js'
import { makeMoteMaterial } from './passes.js'

/**
 * "Slit" — a row of blades turning through a right angle, and a bead.
 *
 * Every scene in this series is arranged around one claim, and today's needs a
 * shape of demonstration yesterday's did not. Day 036 said *a shadow is sharp
 * where it touches and soft where it does not*, and a rake of identical rods was
 * enough, because the only variable was the gap. Today's claim has a second
 * variable in it:
 *
 *   **the softness of an edge depends on which way the thing casting it is
 *   turned.**
 *
 * You cannot show that with identical objects. You show it with *one* object,
 * repeated, rotated — everything else held still — so that the only thing the
 * eye can attribute the difference to is the angle.
 *
 *   apron    a pale limewash platform, wide and shallow. The page. Also, since
 *            Day 035, the brightest surface in the room and therefore a light
 *            source: the composite writes what it reflects into a buffer the
 *            froxel injection reads next frame.
 *   blades   seven thin strokes standing on it, same thickness (11.5cm), heights
 *            on a shallow arc, **yaw sweeping from -56 to +46 degrees across the
 *            frame.** The lamp's short axis runs one way and its long axis the
 *            other, so the blade at the left of the row is broadside to a
 *            seventeen-degree source and the one at the right is broadside to a
 *            three-degree one. Left: a smear with no dark core anywhere, because
 *            the penumbra is five times the blade's own thickness. Right: a
 *            line. Same object, same height, same gap, same lamp.
 *   bowl     one matte vessel in the direct light. It is the diffuse reference —
 *            its far side is where the soft terminator is easiest to read, a
 *            band rolling out of the light rather than a crease.
 *   bead     one glazed sphere, roughness 0.13, near the front. This is the
 *            *specular* reference and the most direct statement the frame makes:
 *            a smooth sphere reflects a scaled image of whatever is lighting it,
 *            so what sits on it is a bar with the opening's own aspect ratio.
 *            Press 9 and it becomes a circle; press 0 and it becomes a dot.
 *   lintel   a beam on two piers across the back. Its underside faces the floor
 *            and the lamp is above and behind, so it receives exactly zero
 *            direct light — Day 034's and Day 035's test, kept in frame so that
 *            today's work cannot quietly cost yesterday's. It is also the
 *            tallest blocker, and it lies across the frame, which makes it the
 *            one object here whose long soft edge comes from the source's long
 *            axis at room scale.
 *   plate    the aperture, upstream, never once rendered into the frame. Three
 *            slots. It slides very slowly, so the shafts wander.
 *   motes    4,500 specks. One draw, no CPU (Day 033).
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
 * The row. `x, z, h, yaw` — and the only one of those four that is doing any
 * arguing is `yaw`.
 *
 * A blade's shadow is a stripe, and the width of that stripe is set by the
 * blade's *thickness*; so the direction across the stripe — the direction whose
 * penumbra you can actually see — is the blade's own face normal. Sweeping the
 * yaw sweeps that normal through the source's ellipse, from its long axis to its
 * short one.
 *
 * The light arrives from (0.395, 0.845, -0.362), so the light frame's x axis
 * lies along roughly (-0.68, 0, -0.74) in the world and its y axis along
 * (-0.74, 0, +0.68). With the slot's long axis on light-y (palette.js), a blade
 * is maximally smeared near yaw = -0.83 rad and maximally crisp near +0.74. The
 * sweep below runs -0.98 to +0.80: both ends are in frame, and the transition
 * between them happens *across the picture* rather than at its edges.
 *
 * The heights are an arc rather than a ramp — a monotonic staircase reads as a
 * diagram — and the tallest blade sits a little right of centre so the row is
 * not symmetric about anything.
 */
const BLADES = [
  // x,     z,     h,     yaw
  [1.05, -2.34, 1.06, -0.98],
  [1.92, -2.10, 1.52, -0.68],
  [2.78, -1.94, 1.92, -0.39],
  [3.62, -1.88, 2.14, -0.09],
  [4.44, -1.94, 1.80, 0.21],
  [5.22, -2.10, 1.40, 0.51],
  [5.94, -2.36, 1.02, 0.80],
]

// Narrow, and the narrowness is not a style choice. A blade wide enough to read
// as an object is also wide enough to hide the page its shadow is written on,
// and the shadow is the subject. Seven strokes of 34cm across six metres leave
// the apron open; nine of 66cm — the first thing tried this morning — turned the
// row into a wall and the frame into a silhouette.
const BLADE_W = 0.34
const BLADE_T = 0.115 // the number the whole row is measured against

// The aperture. Closed spans in the plate's local x; what is left between them
// is the light. One wide slot slightly left of the beam's axis and two narrow
// ones, because a single shaft is a diagram and three is a composition.
const SPANS = [
  [-19.0, -5.35],
  [-4.25, -2.05],
  [0.55, 1.95],
  [3.35, 19.0],
]

// The plate's own gap, which Day 036 discovered was the difference between three
// shafts and one pool. It survives today for a reason that is new: the slots run
// across the source's *short* axis, so what governs the shafts' edges is the
// 3.2-degree number and not the 17-degree one. A slot window makes crisp shafts
// and soft ground shadows at the same time, and that is not a contradiction —
// it is two different directions through the same opening.
const PLATE_DIST = 4.6

export function buildRig() {
  const geo = {
    apron: new THREE.BoxGeometry(9.4, 0.20, 6.4),
    lintel: new THREE.BoxGeometry(7.4, 0.40, 0.72),
    pier: new THREE.BoxGeometry(0.42, 2.42, 0.62),
    bowl: latheSpline(BOWL),
    bead: new THREE.SphereGeometry(0.52, 64, 40),
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
    // a shade cooler and a shade darker, so the row reads against its own page
    chalk: new THREE.MeshStandardMaterial({
      color: new THREE.Color('#b9b5ad'),
      roughness: 0.72,
      metalness: 0.0,
    }),
    // The one glazed thing in the frame, and the reason the G-buffer carries a
    // roughness channel at all. At 0.13 the lobe's own width is 0.017 and the
    // source's two half-angles are 0.30 and 0.055, so the widened lobe comes out
    // at 0.17 by 0.045 — an aspect ratio of nearly four, which is the bar. Make
    // this 0.6 and the sphere goes back to reporting nothing about the lamp.
    glaze: new THREE.MeshStandardMaterial({
      color: new THREE.Color('#2b2f38'),
      roughness: 0.13,
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
  const bladeGeos = []

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

  // --- the row --------------------------------------------------------------
  const blades = BLADES.map(([x, z, h, yaw]) => {
    const g = new THREE.BoxGeometry(BLADE_W, h, BLADE_T)
    bladeGeos.push(g)
    const s = solid(g, mat.chalk)
    s.position.set(x, 0.20 + h * 0.5, z)
    s.rotation.y = yaw
    return s
  })

  // --- the diffuse reference ------------------------------------------------
  const bowl = solid(geo.bowl, mat.lime)
  bowl.position.set(6.05, 0.20, 0.80)
  bowl.rotation.y = -0.52
  bowl.scale.setScalar(1.14)

  // --- the specular reference -----------------------------------------------
  // Near the front and well clear of the row, because the thing it is saying is
  // small — a bar a few dozen pixels long — and it must not be read as a
  // highlight *on* something else.
  const bead = solid(geo.bead, mat.glaze)
  bead.position.set(0.86, 0.72, 1.86)

  // --- the threshold --------------------------------------------------------
  // A beam on two piers across the back of the court. It earns its place three
  // times now.
  //
  // Its underside faces the floor and the lamp is above and behind, so
  // dot(n, L) there is negative — not small, negative, and past the terminator
  // band as well. That face receives exactly zero direct light, forever, and has
  // nothing at all except the wash coming off the bright apron below it.
  //
  // It is the tallest blocker in the picture, so it throws the widest soft edge.
  // And it lies *across* the frame, which after this morning means something
  // specific: its edge is governed by the source's long axis where the blades'
  // are governed by whichever axis each of them happens to face. The blades say
  // "it depends on the angle" at the scale of a hand; the beam is the one that
  // says it at the scale of a room.
  const lintel = solid(geo.lintel, mat.lime)
  lintel.position.set(4.70, 2.64, -5.10)

  const piers = [1.30, 8.10].map((x) => {
    const m = solid(geo.pier, mat.lime)
    m.position.set(x, 1.210, -5.10)
    return m
  })

  root.add(apron, bowl, bead, lintel, ...piers, ...blades)

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
    bladeGeos.forEach((g) => g.dispose())
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
