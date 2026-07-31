import * as THREE from 'three'
import { LIGHT, LAMP } from './palette.js'
import { makeGlassMaterial } from './passes.js'

/**
 * "Lantern" — a glass cylinder standing in a bank of mist, with a small warm
 * light inside it and a cold one raking across the hall from behind.
 *
 * Day 031 was a machine for cutting light into blades, and it was built for a
 * ray march that could resolve a blade. Today’s volume is a 256 x 144 grid — a
 * cell is six screen pixels wide — so a razor edge would only be a lie about
 * the sampling rate. The screen upstream is therefore coarse on purpose: ten
 * slats at a 3.4-unit pitch instead of twenty-four at 1.55, which gives shafts
 * a metre wide with soft shoulders. You design for the grid you have.
 *
 * Everything else follows from the two lights:
 *
 *   glass tube   the day's argument, and the only transparent surface this
 *                project has drawn. It is drawn twice — back faces, then front —
 *                which is all the sorting a convex shell needs.
 *   core         a 23cm sphere of emissive nothing, standing exactly where the
 *                lamp is. The glow around it in the air is not a sprite and not
 *                a bloom; it is the froxel grid integrating a point light.
 *   reeds        nine slender rods on a slow carousel inside the glass. They are
 *                lit warm from within and cold from behind, and their job is to
 *                give the interior a moving grain.
 *   bowl         one still form outside, out on the open floor where a shaft
 *                crosses it. The thing the beams are measured against.
 *   motes        130 specks. The only evidence in the frame that the air has
 *                anything in it at a scale smaller than a froxel.
 *
 * Built imperatively, because "where was this last frame" has to be a property
 * of the object graph rather than of a React render.
 */

function latheSpline(profile, segments = 128) {
  const curve = new THREE.SplineCurve(profile.map(([x, y]) => new THREE.Vector2(x, y)))
  const g = new THREE.LatheGeometry(curve.getPoints(96), segments)
  g.computeVertexNormals()
  return g
}

// a wide, shallow bowl: it reads as a disc of shadow with a lit rim
const BOWL = [
  [0.0, 0.0], [0.42, 0.006], [0.66, 0.05], [0.78, 0.16], [0.80, 0.30],
  [0.76, 0.34], [0.70, 0.22], [0.58, 0.12], [0.30, 0.075], [0.0, 0.068],
]

export const GLASS = { radius: 1.16, height: 3.30, base: 0.14 }

const REEDS = 9
const REED_R = 0.60
const MOTES = 130

// The screen: ten slats standing across the beam, twelve units upstream and
// entirely outside the frame. Wide pitch, wide slats — 40% closed — so what
// arrives is a set of broad shafts with dark lanes between them.
const SLATS = 10
const SLAT_PITCH = 3.40
const SLAT_W = 1.36
const SCREEN_DIST = 12.0

export function buildRig() {
  const geo = {
    plinth: new THREE.CylinderGeometry(1.30, 1.37, 0.14, 128),
    tube: new THREE.CylinderGeometry(GLASS.radius, GLASS.radius, GLASS.height, 128, 1, true),
    core: new THREE.SphereGeometry(0.115, 48, 32),
    reed: new THREE.CylinderGeometry(0.017, 0.040, 2.46, 14),
    hoop: new THREE.TorusGeometry(REED_R, 0.012, 8, 160),
    bowl: latheSpline(BOWL),
    mote: new THREE.OctahedronGeometry(0.011, 0),
    slat: new THREE.BoxGeometry(SLAT_W, 34.0, 0.28),
  }

  const mat = {
    // pale limewash: matte, nearly a silhouette when the key is behind it
    lime: new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#cdc7bc'),
      roughness: 0.74,
      metalness: 0.0,
      envMapIntensity: 0.60,
    }),
    stone: new THREE.MeshStandardMaterial({
      color: new THREE.Color('#2b2a29'),
      roughness: 0.88,
      metalness: 0.0,
      envMapIntensity: 0.30,
    }),
    // the screen is only ever seen from its dark side; it is not asked to be
    // anything but an edge
    slate: new THREE.MeshStandardMaterial({
      color: new THREE.Color('#17191c'),
      roughness: 0.92,
      metalness: 0.0,
      envMapIntensity: 0.22,
    }),
    // the filament. Its colour comes out of the same constant as the point light
    // and the froxel injection, so the glow in the air and the thing making it
    // can never disagree about what colour they are.
    core: new THREE.MeshStandardMaterial({
      color: new THREE.Color('#000000'),
      emissive: new THREE.Color(...LAMP.color),
      emissiveIntensity: 9.0,
      roughness: 1.0,
      metalness: 0.0,
    }),
    dust: new THREE.MeshStandardMaterial({
      color: new THREE.Color('#fff1de'),
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

  const root = new THREE.Group()

  const group = new THREE.Group()
  // right of centre — the left third of the frame belongs to the type
  group.position.set(1.85, 0, -0.2)
  root.add(group)

  // --- the screen ----------------------------------------------------------
  // Positioned and oriented from LIGHT, not by hand: lookAt(target) points the
  // group's local +z straight down the beam, so the slats stand square across it
  // and the shafts they cut are parallel by construction.
  const screen = new THREE.Group()
  screen.position.set(
    LIGHT.target[0] + LIGHT.dir[0] * SCREEN_DIST,
    LIGHT.target[1] + LIGHT.dir[1] * SCREEN_DIST,
    LIGHT.target[2] + LIGHT.dir[2] * SCREEN_DIST
  )
  screen.lookAt(new THREE.Vector3(...LIGHT.target))

  const screenSlide = new THREE.Group()
  for (let i = 0; i < SLATS; i++) {
    const s = solid(geo.slat, mat.slate)
    s.receiveShadow = false // never lit; asking costs a shadow lookup
    s.position.x = (i - (SLATS - 1) * 0.5) * SLAT_PITCH
    screenSlide.add(s)
  }
  screen.add(screenSlide)
  root.add(screen)

  // --- the lantern ---------------------------------------------------------
  const plinth = solid(geo.plinth, mat.stone)
  plinth.position.y = 0.07

  const core = solid(geo.core, mat.core, false)
  core.position.set(LAMP.pos[0] - 1.85, LAMP.pos[1], LAMP.pos[2] + 0.2)

  const carousel = new THREE.Group()
  for (let i = 0; i < REEDS; i++) {
    const a = (i / REEDS) * Math.PI * 2
    const r = solid(geo.reed, mat.lime)
    r.position.set(Math.cos(a) * REED_R, 1.38, Math.sin(a) * REED_R)
    // a slight outward lean, so the ring reads as a basket rather than a fence
    r.rotation.z = -Math.cos(a) * 0.075
    r.rotation.x = Math.sin(a) * 0.075
    carousel.add(r)
  }
  const hoop = solid(geo.hoop, mat.lime)
  hoop.rotation.x = -Math.PI * 0.5
  hoop.position.y = 2.58
  carousel.add(hoop)

  group.add(plinth, core, carousel)

  // --- one still form outside, out on the open floor ------------------------
  const bowl = solid(geo.bowl, mat.lime)
  bowl.position.set(-3.40, 0, 2.05)
  bowl.rotation.y = -0.5
  bowl.scale.setScalar(1.05)
  group.add(bowl)

  // --- dust ----------------------------------------------------------------
  // castShadow off: 130 specks in the light-space depth map would be noise, and
  // a speck that shadows the air behind it is not a thing anyone has seen.
  const motes = new THREE.InstancedMesh(geo.mote, mat.dust, MOTES)
  motes.castShadow = false
  motes.receiveShadow = true
  motes.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  motes.frustumCulled = false
  group.add(motes)

  const seeds = new Float32Array(MOTES * 4)
  for (let i = 0; i < MOTES; i++) {
    const a = Math.random() * Math.PI * 2
    const r = 0.5 + Math.sqrt(Math.random()) * 3.6
    seeds[i * 4 + 0] = Math.cos(a) * r
    seeds[i * 4 + 1] = Math.random() * 3.6
    seeds[i * 4 + 2] = Math.sin(a) * r * 0.9
    seeds[i * 4 + 3] = Math.random() * 6.283
  }

  // --- the glass -----------------------------------------------------------
  // It lives in a scene of its own, and that is the whole trick for keeping a
  // forward pass out of a deferred renderer's way: the light-depth pass, the
  // G-buffer and the beauty pass all traverse `root` and simply never meet it.
  // No visible flags to toggle, no per-pass filtering, nothing to forget.
  const glassScene = new THREE.Scene()
  const glassMats = [
    makeGlassMaterial({ side: THREE.BackSide }),
    makeGlassMaterial({ side: THREE.FrontSide }),
  ]
  const glassMeshes = glassMats.map((m, i) => {
    const mesh = new THREE.Mesh(geo.tube, m)
    mesh.position.set(1.85, GLASS.base + GLASS.height * 0.5, -0.2)
    mesh.renderOrder = i // back faces first: two layers, correctly ordered
    mesh.frustumCulled = false
    glassScene.add(mesh)
    return mesh
  })

  // --- per-instance previous transforms ------------------------------------
  const M = new THREE.Matrix4()
  const Q = new THREE.Quaternion()
  const E = new THREE.Euler(0, 0, 0, 'YXZ')
  const P = new THREE.Vector3()
  const S = new THREE.Vector3(1, 1, 1)

  function layoutMotes(t) {
    for (let i = 0; i < MOTES; i++) {
      const sx = seeds[i * 4 + 0]
      const sy = seeds[i * 4 + 1]
      const sz = seeds[i * 4 + 2]
      const ph = seeds[i * 4 + 3]
      // a slow rise, wrapped, with a lateral wander — dust in still air, not
      // snow. The wrap is in the position only, so a mote that wraps reports one
      // frame of enormous velocity; TAA's variance clip eats it.
      const y = ((sy + t * 0.048) % 3.6) + 0.12
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

  layoutMotes(0)

  const arr = new Float32Array(MOTES * 16)
  arr.set(motes.instanceMatrix.array)
  const prevAttr = new THREE.InstancedBufferAttribute(arr, 16)
  prevAttr.setUsage(THREE.DynamicDrawUsage)
  geo.mote.setAttribute('aPrevInstance', prevAttr)

  function step(t) {
    carousel.rotation.y = t * 0.085
    // one pitch every twenty-two seconds. The slats are more than twice as wide
    // as Day 031's, so the same visual speed needs a much slower slide; wrapped,
    // so the previous-matrix machinery never sees a jump larger than one pitch.
    screenSlide.position.x = ((t * 0.155) % SLAT_PITCH) - SLAT_PITCH * 0.5
    layoutMotes(t)
    root.updateMatrixWorld(true)
    glassScene.updateMatrixWorld(true)
  }

  function dispose() {
    Object.values(geo).forEach((g) => g.dispose())
    Object.values(mat).forEach((m) => m.dispose())
    glassMats.forEach((m) => m.dispose())
    motes.dispose()
  }

  // `screen` is handed back so the pipeline can switch it off after the two
  // light-space passes. It is a shadow caster and nothing else: at this camera
  // it clips the top right corner of the frame, and a ten-metre slab of matte
  // slate leaning into a minimal composition is not what anyone came for. The
  // rule from Day 031 stands — the object the piece is built around is never
  // once seen.
  return { group: root, screen, glassScene, glassMats, glassMeshes, step, dispose }
}
