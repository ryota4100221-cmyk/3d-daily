import * as THREE from 'three'

/**
 * "Cadence" — the kinetic rig.
 *
 * Day 029's Scene.jsx opens with a confession: *everything here is deliberately
 * static*, because its motion vectors assumed a fixed world and a moving camera,
 * and the moment a form drifted its history would smear. Twenty-nine days of
 * still life were a renderer limitation dressed up as an aesthetic.
 *
 * Today the limitation is gone, so the subject is motion itself: one spindle,
 * standing still, and four things turning around it at four different rates.
 * Every one of them carries its own previous transform (see Pipeline.jsx), which
 * is the only reason they are allowed to move at all.
 *
 * The rates are chosen so a single frame contains two orders of magnitude:
 *
 *   group sway   0.045 rad/s   invisible to the eye, visible to the buffers
 *   blade ring   0.16  rad/s   ~1 px/frame — below the blur threshold
 *   bud arm      0.26  rad/s   counter-rotating
 *   orb arm      0.33  rad/s
 *   baton        4.0   rad/s   ~25 px of smear at the tips, ~0 at the hub
 *
 * The baton is the argument. Because velocity is a per-pixel quantity, its
 * smear grows from nothing at the hub to its full length at the beads on either
 * end. One number per object could never draw that gradient.
 */

// An exact revolved polyline — the control points ARE the silhouette. Day 028
// and 029 ran their profiles through a SplineCurve, which is right for organic
// forms and wrong for architectural ones: a smoothed foot on a slim shaft comes
// out looking like a candle that has been left in the sun.
function lathePoly(profile, segments = 128) {
  const g = new THREE.LatheGeometry(
    profile.map(([x, y]) => new THREE.Vector2(x, y)),
    segments
  )
  g.computeVertexNormals()
  return g
}

// ...and the smoothed version, for the two forms that should look thrown.
function latheSpline(profile, segments = 128) {
  const curve = new THREE.SplineCurve(profile.map(([x, y]) => new THREE.Vector2(x, y)))
  const g = new THREE.LatheGeometry(curve.getPoints(96), segments)
  g.computeVertexNormals()
  return g
}

// a slim shaft: disc foot, straight rise, a collar near the top
const SPINDLE = [
  [0.002, 0.000], [0.230, 0.000], [0.230, 0.020], [0.170, 0.030], [0.052, 0.038],
  [0.046, 0.30], [0.042, 1.40], [0.042, 2.60], [0.047, 2.82], [0.064, 2.91],
  [0.064, 2.96], [0.040, 3.03], [0.002, 3.05],
]

const PEBBLE = [
  [0.0, 0.0], [0.30, 0.004], [0.44, 0.055], [0.495, 0.165], [0.47, 0.28],
  [0.37, 0.365], [0.22, 0.405], [0.0, 0.412],
]

const BUD = [
  [0.0, 0.0], [0.135, 0.030], [0.225, 0.115], [0.250, 0.245], [0.222, 0.375],
  [0.150, 0.470], [0.068, 0.520], [0.0, 0.530],
]

const BLADES = 14
const BLADE_R = 1.18
const BLADE_Y = 2.40

export function buildRig() {
  const geo = {
    spindle: lathePoly(SPINDLE),
    pebble: latheSpline(PEBBLE),
    bud: latheSpline(BUD),
    orb: new THREE.SphereGeometry(0.125, 64, 48),
    bead: new THREE.SphereGeometry(0.072, 40, 28),
    baton: new THREE.BoxGeometry(1.72, 0.026, 0.026),
    armA: new THREE.BoxGeometry(1.02, 0.013, 0.013),
    armB: new THREE.BoxGeometry(1.55, 0.012, 0.012),
    blade: new THREE.BoxGeometry(0.020, 0.44, 0.085),
    rim: new THREE.TorusGeometry(BLADE_R, 0.011, 8, 180),
  }

  const mat = {
    porcelain: new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#f0eae0'),
      roughness: 0.28,
      metalness: 0.0,
      clearcoat: 0.66,
      clearcoatRoughness: 0.18,
      envMapIntensity: 1.0,
    }),
    matte: new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#d8d0c2'),
      roughness: 0.64,
      metalness: 0.0,
      envMapIntensity: 0.78,
    }),
    // unglazed, not lacquered: with a clearcoat this reads as plastic fruit
    terra: new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#a85d3d'),
      roughness: 0.58,
      metalness: 0.0,
      clearcoat: 0.12,
      envMapIntensity: 0.92,
    }),
  }

  const solid = (g, m) => {
    const mesh = new THREE.Mesh(g, m)
    mesh.castShadow = true
    mesh.receiveShadow = true
    return mesh
  }

  const group = new THREE.Group()
  // right of centre: the left third of the frame belongs to the type
  group.position.set(1.9, 0, -0.4)

  // everything kinetic hangs off `sway`, so the slow rotation of the whole
  // piece stacks onto each element's own — and so the one still object can be
  // genuinely still
  const sway = new THREE.Group()
  group.add(sway)

  // --- the still centre ----------------------------------------------------
  sway.add(solid(geo.spindle, mat.porcelain))

  // Four heights, four rates, no two elements sharing a plane — otherwise
  // counter-rotating arms pass through each other, which no amount of rendering
  // will fix.

  // --- arm A: a small porcelain orb, low enough to own its own reflection ---
  const pivotA = new THREE.Group()
  const armA = solid(geo.armA, mat.matte)
  armA.position.set(0.51, 0.26, 0)
  const orb = solid(geo.orb, mat.porcelain)
  orb.position.set(1.02, 0.26, 0)
  pivotA.add(armA, orb)

  // --- arm B: the one warm form, wide and counter-turning ------------------
  const pivotB = new THREE.Group()
  pivotB.rotation.z = 0.06
  const armB = solid(geo.armB, mat.matte)
  armB.position.set(0.775, 1.40, 0)
  const bud = solid(geo.bud, mat.terra)
  bud.position.set(1.55, 1.40, 0)
  bud.scale.setScalar(0.72)
  pivotB.add(armB, bud)

  // --- the blade ring: 14 blades, ONE draw call, 14 different velocities ---
  // Day 005 put 2,304 pillars in a single draw. What it could not do was tell
  // the renderer where any one pillar had *been*: those transforms live in a
  // second instanced attribute, added at the bottom of this file.
  const blades = new THREE.InstancedMesh(geo.blade, mat.porcelain, BLADES)
  blades.castShadow = true
  blades.receiveShadow = true
  blades.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  blades.frustumCulled = false
  const pivotBlades = new THREE.Group()
  pivotBlades.rotation.set(0.26, 0, 0.09)
  // The rim is not decoration; it is what makes fourteen floating rectangles
  // legible as one object. Without it, a ring seen from near its own plane
  // renders as confetti at random heights — the eye has nothing to hang the
  // blades on. A hoop 11mm thick, seen at a shallow angle, draws the ellipse
  // that the blades then read as belonging to.
  const rim = solid(geo.rim, mat.matte)
  rim.rotation.x = -Math.PI * 0.5
  rim.position.y = BLADE_Y // the blades carry their height in their instance
  // matrices; a plain mesh does not, and a hoop left at y=0 lands on the plate
  pivotBlades.add(rim, blades)

  // --- the baton: fast enough that no still frame can hold it -------------
  const pivotBaton = new THREE.Group()
  const baton = solid(geo.baton, mat.porcelain)
  baton.position.y = 1.05
  const beadL = solid(geo.bead, mat.porcelain)
  beadL.position.set(-0.86, 1.05, 0)
  const beadR = solid(geo.bead, mat.terra)
  beadR.position.set(0.86, 1.05, 0)
  pivotBaton.add(baton, beadL, beadR)

  sway.add(pivotA, pivotB, pivotBlades, pivotBaton)

  // --- one thing that does not move --------------------------------------
  // Everything else turns; a single still pebble is what makes the turning
  // legible. It sits far left and small, where its reflection can hold the
  // bottom of the composition down without competing with the type.
  const still = solid(geo.pebble, mat.matte)
  still.position.set(-2.85, 0, 1.5)
  still.rotation.y = -0.6
  still.scale.setScalar(0.56)
  group.add(still)

  // --- per-instance previous transforms -----------------------------------
  // `instanceMatrix` is itself an InstancedBufferAttribute of itemSize 16 bound
  // to a `mat4` attribute, so a second one costs nothing conceptually: three
  // splits a 16-wide instanced attribute across four vec4 slots for us.
  const M = new THREE.Matrix4()
  const Q = new THREE.Quaternion()
  const E = new THREE.Euler(0, 0, 0, 'YXZ')
  const P = new THREE.Vector3()
  const S = new THREE.Vector3(1, 1, 1)

  function layoutBlades(t) {
    for (let i = 0; i < BLADES; i++) {
      const th = (i / BLADES) * Math.PI * 2 + t * 0.16
      // A small twist, not a large one: the ring has to read as a ring. Each
      // blade still runs on its own phase, so no two of the eighteen share a
      // velocity — which is the entire point of storing them per instance.
      const twist = Math.sin(th * 2.0 + t * 0.5) * 0.10
      P.set(Math.cos(th) * BLADE_R, BLADE_Y, Math.sin(th) * BLADE_R)
      // local +z points radially outward: rotating +z by (π/2 − θ) about y
      // lands on (cos θ, 0, sin θ)
      E.set(0, Math.PI * 0.5 - th, twist)
      Q.setFromEuler(E)
      M.compose(P, Q, S)
      blades.setMatrixAt(i, M)
    }
    blades.instanceMatrix.needsUpdate = true
  }

  layoutBlades(0)
  const prevInstance = new Float32Array(BLADES * 16)
  prevInstance.set(blades.instanceMatrix.array)
  const prevAttr = new THREE.InstancedBufferAttribute(prevInstance, 16)
  prevAttr.setUsage(THREE.DynamicDrawUsage)
  geo.blade.setAttribute('aPrevInstance', prevAttr)

  function step(t) {
    pivotA.rotation.y = t * 0.33
    pivotB.rotation.y = -t * 0.26
    pivotBaton.rotation.y = t * 4.0
    // the whole piece sways a few degrees: a slow term underneath the fast ones,
    // so any given blade's velocity is the sum of two rotations, not one
    sway.rotation.y = Math.sin(t * 0.045) * 0.10
    layoutBlades(t)
    group.updateMatrixWorld(true)
  }

  function dispose() {
    Object.values(geo).forEach((g) => g.dispose())
    Object.values(mat).forEach((m) => m.dispose())
    blades.dispose()
  }

  return { group, step, dispose, blades }
}
