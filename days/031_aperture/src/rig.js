import * as THREE from 'three'
import { LIGHT } from './palette.js'

/**
 * "Aperture" — a zoetrope for light.
 *
 * Day 030 put the sculpture in motion and made the motion the subject. Today the
 * sculpture is mostly an *occluder*: twenty vertical fins standing in a ring,
 * turning very slowly, with a single hard light coming through them from behind
 * and to the right. What you are meant to look at is not the fins. It is the air
 * between them — the blades of light the ring cuts out of the haze, sweeping
 * through the hall as it turns.
 *
 * Which means every form here has two jobs, and the second one is invisible in
 * the beauty pass:
 *
 *   fins      chop the beam into twenty blades (0.062 rad/s — one blade every
 *             ~5s, slow enough to be a tide rather than a strobe)
 *   vessel    stands still in the middle and carves one wide dark wedge
 *   arm+bead  0.85 rad/s, the one fast thing: it passes through the blades, so
 *             it is alternately lit and extinguished — and it is what the motion
 *             blur has to work with
 *   motes     130 specks of dust. They are not lit by anything special. They are
 *             lit by the key light, so the ones inside a blade of light are the
 *             only ones you can see, and they sample the beam in three dimensions
 *             the way the fog cannot.
 *
 * All of it is built imperatively, because "where was this last frame" has to be
 * a property of the object graph rather than of a React render.
 */

function lathePoly(profile, segments = 128) {
  const g = new THREE.LatheGeometry(
    profile.map(([x, y]) => new THREE.Vector2(x, y)),
    segments
  )
  g.computeVertexNormals()
  return g
}

function latheSpline(profile, segments = 128) {
  const curve = new THREE.SplineCurve(profile.map(([x, y]) => new THREE.Vector2(x, y)))
  const g = new THREE.LatheGeometry(curve.getPoints(96), segments)
  g.computeVertexNormals()
  return g
}

// a tall vessel: a narrow foot, a long shoulder, a closed lip. Architectural at
// the bottom (plain polyline), thrown at the top (spline) — Day 030's lesson
// about not smoothing a plinth into a candle stub.
const VESSEL_FOOT = [
  [0.002, 0.0], [0.300, 0.0], [0.300, 0.028], [0.238, 0.046], [0.196, 0.062],
]
const VESSEL_BODY = [
  [0.196, 0.062], [0.226, 0.20], [0.320, 0.48], [0.395, 0.80], [0.410, 1.06],
  [0.372, 1.28], [0.286, 1.44], [0.190, 1.52], [0.108, 1.555], [0.0, 1.562],
]

const PEBBLE = [
  [0.0, 0.0], [0.30, 0.004], [0.44, 0.055], [0.495, 0.165], [0.47, 0.28],
  [0.37, 0.365], [0.22, 0.405], [0.0, 0.412],
]

export const FINS = 20
export const FIN_R = 1.95
export const FIN_H = 2.90

// The screen — twenty-four slats standing across the beam, twelve units upstream
// and entirely outside the frame.
//
// The first version of this scene did not have it, and the render said why it
// needed one: a ring of fins in an open hall casts *one* shadow, so the picture
// was a large wash of lit haze with a dark wedge under the sculpture. Blades of
// light are the complement of that. They need most of the hall to be in shadow,
// with narrow gaps — which is a thing you build upstream, not around the subject.
//
// It is also the object the piece is named after, and you never quite see it.
const SLATS = 24
const SLAT_PITCH = 1.55
const SLAT_W = 0.66
const SCREEN_DIST = 12.0
// 220 at 20mm read as grit on the lens rather than dust in the air. Fewer and
// much smaller: a mote should be a point of light you are not sure you saw.
const MOTES = 130

export function buildRig() {
  const geo = {
    foot: lathePoly(VESSEL_FOOT),
    body: latheSpline(VESSEL_BODY),
    pebble: latheSpline(PEBBLE),
    fin: new THREE.BoxGeometry(0.075, FIN_H, 0.110),
    ringTop: new THREE.TorusGeometry(FIN_R, 0.024, 8, 220),
    ringMid: new THREE.TorusGeometry(FIN_R, 0.014, 8, 220),
    base: new THREE.CylinderGeometry(FIN_R + 0.16, FIN_R + 0.20, 0.10, 128),
    arm: new THREE.BoxGeometry(1.24, 0.014, 0.014),
    bead: new THREE.SphereGeometry(0.085, 40, 28),
    mote: new THREE.OctahedronGeometry(0.011, 0),
    slat: new THREE.BoxGeometry(SLAT_W, 34.0, 0.28),
  }

  const mat = {
    porcelain: new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#efe9df'),
      roughness: 0.30,
      metalness: 0.0,
      clearcoat: 0.58,
      clearcoatRoughness: 0.20,
      envMapIntensity: 1.0,
    }),
    // the fins are not the subject, so they are the least reflective thing here:
    // pale limewash, matte, almost a silhouette when the light is behind them
    lime: new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#cfc7b8'),
      roughness: 0.78,
      metalness: 0.0,
      envMapIntensity: 0.60,
    }),
    // the screen is only ever seen from its dark side, so it is not asked to be
    // anything but an edge
    slate: new THREE.MeshStandardMaterial({
      color: new THREE.Color('#191b1e'),
      roughness: 0.92,
      metalness: 0.0,
      envMapIntensity: 0.25,
    }),
    terra: new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#ab5f3c'),
      roughness: 0.56,
      metalness: 0.0,
      clearcoat: 0.10,
      envMapIntensity: 0.90,
    }),
    // dust does not have a material worth arguing about; it has to be bright
    // enough that one lit speck survives a single pixel
    dust: new THREE.MeshStandardMaterial({
      color: new THREE.Color('#fff2df'),
      roughness: 0.55,
      metalness: 0.0,
      envMapIntensity: 0.4,
    }),
  }

  const solid = (g, m, shadow = true) => {
    const mesh = new THREE.Mesh(g, m)
    mesh.castShadow = shadow
    mesh.receiveShadow = true
    return mesh
  }

  // root holds two things that must not share a transform: the sculpture, which
  // is nudged right of centre for the composition, and the screen, which is
  // placed in world space by the light's own numbers.
  const root = new THREE.Group()

  const group = new THREE.Group()
  // right of centre — the left third of the frame belongs to the type
  group.position.set(1.85, 0, -0.2)
  root.add(group)

  // --- the screen ----------------------------------------------------------
  // Positioned and oriented from LIGHT, not by hand: lookAt(target) points the
  // group's local +z straight down the beam, so the slats stand square across
  // it and the blades they cut are parallel by construction.
  const screen = new THREE.Group()
  screen.position.set(
    LIGHT.target[0] + LIGHT.dir[0] * SCREEN_DIST,
    LIGHT.target[1] + LIGHT.dir[1] * SCREEN_DIST,
    LIGHT.target[2] + LIGHT.dir[2] * SCREEN_DIST
  )
  screen.lookAt(new THREE.Vector3(...LIGHT.target))
  // and the slats slide inside it, one pitch every ten seconds. A static screen
  // draws static blades, which after ten seconds reads as a painted backdrop;
  // sliding them turns the hall into something that is happening. The wall is wider
  // than the light-space map, so the travel never uncovers an end.
  const screenSlide = new THREE.Group()
  for (let i = 0; i < SLATS; i++) {
    const s = solid(geo.slat, mat.slate)
    s.receiveShadow = false // it is never lit; asking costs a shadow lookup
    s.position.x = (i - (SLATS - 1) * 0.5) * SLAT_PITCH
    screenSlide.add(s)
  }
  screen.add(screenSlide)
  root.add(screen)

  // --- the ring of fins ----------------------------------------------------
  const louvre = new THREE.Group()

  const fins = new THREE.InstancedMesh(geo.fin, mat.lime, FINS)
  fins.castShadow = true
  fins.receiveShadow = true
  fins.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  fins.frustumCulled = false

  // Day 030: fourteen blades on a circle read as confetti until a hoop was put
  // through them. Same rule, and here it does a second job — the rings are what
  // stop the beam at the top and bottom, so the blades of light have ends.
  const ringTop = solid(geo.ringTop, mat.lime)
  ringTop.rotation.x = -Math.PI * 0.5
  ringTop.position.y = FIN_H

  const ringMid = solid(geo.ringMid, mat.lime)
  ringMid.rotation.x = -Math.PI * 0.5
  ringMid.position.y = FIN_H * 0.5

  const base = solid(geo.base, mat.lime)
  base.position.y = 0.05

  louvre.add(fins, ringTop, ringMid, base)

  // --- the still centre ----------------------------------------------------
  const vessel = new THREE.Group()
  vessel.add(solid(geo.foot, mat.porcelain), solid(geo.body, mat.porcelain))
  vessel.position.y = 0.10

  // --- the fast thing ------------------------------------------------------
  const spin = new THREE.Group()
  const arm = solid(geo.arm, mat.lime)
  arm.position.set(0.66, 0.62, 0)
  const bead = solid(geo.bead, mat.terra)
  bead.position.set(1.30, 0.62, 0)
  spin.add(arm, bead)

  group.add(louvre, vessel, spin)

  // --- one form outside the ring, and it never moves -----------------------
  // It sits left and low, out in the open floor where a blade of light crosses
  // it once per turn. Its only job is to be the thing the beams are measured
  // against.
  const still = solid(geo.pebble, mat.lime)
  still.position.set(-3.55, 0, 1.9)
  still.rotation.y = -0.55
  still.scale.setScalar(0.60)
  group.add(still)

  // --- dust ----------------------------------------------------------------
  // castShadow off: 130 specks in the light-space depth map would just be noise,
  // and a speck that shadows the air behind it is not a thing anyone has seen.
  const motes = new THREE.InstancedMesh(geo.mote, mat.dust, MOTES)
  motes.castShadow = false
  motes.receiveShadow = true
  motes.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  motes.frustumCulled = false
  group.add(motes)

  const seeds = new Float32Array(MOTES * 4)
  for (let i = 0; i < MOTES; i++) {
    const a = Math.random() * Math.PI * 2
    const r = 0.4 + Math.sqrt(Math.random()) * 3.4
    seeds[i * 4 + 0] = Math.cos(a) * r
    seeds[i * 4 + 1] = Math.random() * 3.6
    seeds[i * 4 + 2] = Math.sin(a) * r * 0.9
    seeds[i * 4 + 3] = Math.random() * 6.283
  }

  // --- per-instance previous transforms ------------------------------------
  const M = new THREE.Matrix4()
  const Q = new THREE.Quaternion()
  const E = new THREE.Euler(0, 0, 0, 'YXZ')
  const P = new THREE.Vector3()
  const S = new THREE.Vector3(1, 1, 1)

  function layoutFins() {
    for (let i = 0; i < FINS; i++) {
      const th = (i / FINS) * Math.PI * 2
      P.set(Math.cos(th) * FIN_R, FIN_H * 0.5, Math.sin(th) * FIN_R)
      // local +z points radially outward, so the 75mm dimension is tangential
      // (thin, to let light past) and the 185mm dimension is radial (deep, so
      // the ring only opens along one narrow angle at a time)
      E.set(0, Math.PI * 0.5 - th, 0)
      Q.setFromEuler(E)
      M.compose(P, Q, S)
      fins.setMatrixAt(i, M)
    }
    fins.instanceMatrix.needsUpdate = true
  }

  function layoutMotes(t) {
    for (let i = 0; i < MOTES; i++) {
      const sx = seeds[i * 4 + 0]
      const sy = seeds[i * 4 + 1]
      const sz = seeds[i * 4 + 2]
      const ph = seeds[i * 4 + 3]
      // a slow rise, wrapped, with a lateral wander — dust in still air, not
      // snow. The wrap is in the position only, so a mote that wraps reports one
      // frame of enormous velocity; at 4 units of rise and 0.05 u/s that is once
      // every 80 seconds per mote, and TAA's variance clip eats it.
      const y = ((sy + t * 0.052) % 3.6) + 0.15
      P.set(
        sx + Math.sin(t * 0.11 + ph) * 0.24,
        y,
        sz + Math.cos(t * 0.083 + ph * 1.7) * 0.24
      )
      E.set(ph + t * 0.13, ph * 2.0 + t * 0.09, 0)
      Q.setFromEuler(E)
      M.compose(P, Q, S)
      motes.setMatrixAt(i, M)
    }
    motes.instanceMatrix.needsUpdate = true
  }

  layoutFins()
  layoutMotes(0)

  const attachPrev = (g, mesh, count) => {
    const arr = new Float32Array(count * 16)
    arr.set(mesh.instanceMatrix.array)
    const a = new THREE.InstancedBufferAttribute(arr, 16)
    a.setUsage(THREE.DynamicDrawUsage)
    g.setAttribute('aPrevInstance', a)
  }
  attachPrev(geo.fin, fins, FINS)
  attachPrev(geo.mote, motes, MOTES)

  function step(t) {
    // one blade of light every ~3.9 seconds. Faster than this and the hall
    // strobes; slower and nothing appears to be happening at all.
    louvre.rotation.y = t * 0.062
    spin.rotation.y = -t * 0.85
    // wrapped, so the travel is bounded and the previous-matrix machinery never
    // sees a jump larger than one pitch
    screenSlide.position.x = ((t * 0.155) % SLAT_PITCH) - SLAT_PITCH * 0.5
    layoutMotes(t)
    root.updateMatrixWorld(true)
  }

  function dispose() {
    Object.values(geo).forEach((g) => g.dispose())
    Object.values(mat).forEach((m) => m.dispose())
    fins.dispose()
    motes.dispose()
  }

  return { group: root, step, dispose }
}
