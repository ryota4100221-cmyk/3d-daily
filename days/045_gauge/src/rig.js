import * as THREE from 'three'
import { LIGHT, MOTES } from './palette.js'
import { makeMoteMaterial } from './passes.js'

/**
 * "Eclipse" — the same court as yesterday, plus one lath nobody sees either.
 *
 * Day 038 arranged this frame around "a highlight is a picture of the source",
 * and to make that legible it took some trouble to keep the tablets *fully lit*:
 * the aperture's middle slot was widened on purpose, because — its own words —
 * "a window reflected in a panel that is half in shadow is a puzzle rather than
 * a picture".
 *
 * Today the puzzle is the picture. If a highlight is an image of the source,
 * then putting something between the source and the mirror has to *edit the
 * image*, and the whole scene now exists to ask whether it does. One bar across
 * the beam, four metres upstream of the near tablet, aligned so its penumbra is
 * swept along the window's width — see BAR below for why that particular axis —
 * and the reflection loses panes rather than losing brightness.
 *
 * The far tablet is untouched by the lath and keeps yesterday's whole window,
 * closed up by its own roughness. The pair is now a comparison in two variables
 * at once, which is a thing to be careful with and is worth it here: the near
 * one shows what the source *is* and what an occluder does to it, the far one
 * shows neither, and both are the same lamp.
 *
 * ---------------------------------------------------------------------------
 * Yesterday's inventory, still accurate:
 *
 * "Tracery" — two lacquer tablets, a row of blades, and a window nobody sees.
 *
 * Every scene in this series is arranged around one claim, and today's needed a
 * shape of demonstration the last two days could not give it.
 *
 *   **a highlight is a picture of the source.**
 *
 * Day 037 said that too, and then put a *sphere* in the frame to say it with.
 * That was a mistake I could not see until the source had a mullion in it. A
 * sphere compresses the whole hemisphere into its own silhouette: the image of a
 * 13-degree opening on a 42cm bead is about five centimetres across and, at this
 * camera, ten pixels. Ten pixels can show you that a highlight is a *bar* and
 * not a dot — which is all yesterday needed — and can never show you that it is
 * a window with two lights and three tiers.
 *
 * So the frame gets what it actually needs, which is **flat mirrors**:
 *
 *   tablets  two lacquered panels lying on the apron, tilted 28 degrees, the
 *            same tilt for both. The angle is not styling: it is
 *            `normalize(V + L)` for this camera and this lamp, so the mirror
 *            direction lands *in the opening* and the panel carries the window
 *            at something like life size. They differ in one property —
 *            roughness 0.055 and 0.165 — and that is the piece: on the near one
 *            the tracery is legible, six panes and a cross of stone; on the far
 *            one the mullion has closed up and what is left is Day 037's
 *            lozenge. Nothing about the light differs between them.
 *   blades   three thin strokes standing behind the tablets, 11.5cm thick.
 *            Their penumbrae are the *other* half of the claim, and they are
 *            turned to sample the window along different axes: the left one's
 *            face is broadside to the window's width, so its soft edge is
 *            crossed by a single pale seam where the mullion is; the right one
 *            is broadside to its height and gets two, from the transoms. Same
 *            object, same lamp, different seams — and the seams are not drawn,
 *            they are what a kernel shaped like a window does.
 *   bowl     one matte vessel in the direct light: the diffuse reference, where
 *            the terminator is a band rolling out of the light rather than a
 *            crease. Today that band is an integral rather than a fit.
 *   bead     one glazed sphere, roughness 0.10, kept from yesterday as an
 *            honest control. It shows a lozenge, because that is all a sphere
 *            can show, and standing next to a panel that shows a window it makes
 *            the point better than its own reflection does.
 *   lintel   a beam on two piers across the back. Its underside faces the floor
 *            and the lamp is above and behind, so it receives exactly zero
 *            direct light — Day 034's and Day 035's test, kept in frame so that
 *            today's work cannot quietly cost yesterday's.
 *   plate    the aperture, upstream, never once rendered. Its slots cut the
 *            shafts; one wide opening is aimed at the tablets, because a window
 *            reflected in a panel that is half in shadow is a puzzle rather than
 *            a picture.
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
 * penumbra you can actually read — is the blade's own face normal. Which axis of
 * the window that normal happens to point along decides which piece of stone
 * shows up in the soft edge.
 *
 * The light arrives from (0.395, 0.845, -0.362), so the light frame's x axis
 * lies along roughly (-0.68, 0, -0.74) in the world and its y along
 * (-0.74, 0, +0.68). The window's own frame is turned a further ninety degrees
 * (WINDOW.axis), which puts the window's *width* — the axis the mullion divides
 * — along world (-0.74, 0, +0.68), and its *height*, the axis the transoms
 * divide, along (+0.68, 0, +0.74).
 *
 * So:
 *
 *   yaw -0.83   face normal along the window's width. The kernel is swept
 *               across the mullion: **one pale seam** up the middle of the
 *               penumbra, 5cm per metre of gap.
 *   yaw  0.74   face normal along its height. Swept across both transoms:
 *               **two seams**, and the outer tiers slightly brighter than the
 *               middle because they are the taller panes.
 *   yaw  0.00   neither. A plain gradient, and it is in the row to prove the
 *               other two are not an artefact of the sampler.
 *
 * Taller than yesterday's, because a seam is the mullion's angular width times
 * the gap and the gap is the only term available: at 1m a seam is 3cm and
 * arguable, at 2.4m it is 8cm and it is simply there.
 */
const BLADES = [
  // x,     z,     h,    yaw
  [0.30, -0.80, 1.85, -0.83],
  [3.25, -0.90, 2.24, 0.00],
  [5.95, -0.80, 1.68, 0.74],
]

// Narrow, and the narrowness is not a style choice. A blade wide enough to read
// as an object is also wide enough to hide the page its shadow is written on,
// and the shadow is the subject.
const BLADE_W = 0.62
const BLADE_T = 0.16

// The camera's rest position, duplicated from Pipeline's damp target because the
// tablets' geometry is *solved against it*. If that moves, this moves.
const EYE = [1.50, 4.07, 11.50]

/**
 * A tablet's normal is not chosen, it is solved: `normalize(V + L)` at the
 * tablet's own centre — the half vector — which is the one orientation whose
 * mirror direction lands in the middle of the opening. About twenty-five degrees
 * off horizontal here: a lectern, or a slab leaned back to be read.
 *
 * This is the reason the day has a picture at all. Lying flat, these same panels
 * reflect a patch of empty ceiling 47 degrees away from the window and show
 * precisely nothing, which is what the first version of the frame did.
 *
 * It also has to be done **per tablet**. The two sit three metres apart, so their
 * view vectors differ by ten degrees, and a shared normal — the first fix, which
 * looked more principled — left the far one black. The comparison is between two
 * roughnesses; it is not allowed to also be a comparison of aim.
 */
function halfVector(x, y, z) {
  const V = new THREE.Vector3(...EYE).sub(new THREE.Vector3(x, y, z)).normalize()
  return V.add(new THREE.Vector3(...LIGHT.dir).normalize()).normalize()
}

// The aperture. Closed spans in the plate's local x; what is left between them
// is the light. Wider through the middle than Day 037's: the tablets sit under
// that opening and a window reflected in a panel that is half in shadow reads as
// a mistake. The two narrow slots on the flanks keep the shafts.
const SPANS = [
  [-19.0, -6.10],
  [-4.95, -3.30],
  [1.75, 3.05],
  [4.85, 19.0],
]

// The plate's own gap, which Day 036 discovered was the difference between three
// shafts and one pool. It survives today for a reason that is new: the slots run
// across the source's *short* axis, so what governs the shafts' edges is the
// 3.2-degree number and not the 17-degree one. A slot window makes crisp shafts
// and soft ground shadows at the same time, and that is not a contradiction —
// it is two different directions through the same opening.
const PLATE_DIST = 4.6

/**
 * The lath — today's one new object, and it is never seen either.
 *
 * Everything about it is decided by which axis it runs along, so it is worth
 * writing that chain down once.
 *
 * The plate is aimed down the beam, so its local x lies along the light frame's
 * x and its local y along the light frame's y. `WINDOW.axis` turns the window a
 * further ninety degrees inside that frame, which means:
 *
 *   light x   =  the window's *height*  — the axis the two transoms divide
 *   light y   =  the window's *width*   — the axis the mullion divides
 *
 * The existing slots have their edges in local x, so their penumbrae are swept
 * along the window's height: a receiver crossing one of those edges loses the
 * head tier, then the middle, then the sill. That is Day 038's picture and it
 * still runs.
 *
 * This bar's edges are in local **y**. Its penumbra is swept along the window's
 * *width*, so a receiver crossing it loses one whole light of the window —
 * three panes at once, cleanly, at the mullion — and what remains is not a
 * dimmer window but a *narrower* one. That is the day's whole picture, and the
 * mullion is what makes it legible: without a bar of stone at x = 0 the loss
 * would be a gradient, and a gradient is what a dimming looks like.
 *
 * `HEIGHT` is a band and not a half-plane on purpose. Six metres of bar would
 * put the whole near corner of the page in shadow and the frame would read as
 * night; 2.4m throws a stripe about a metre wide at the bottom of its own
 * penumbra, crosses the near tablet, and lets the court behind it go on being
 * lit.
 *
 * `OFFSET` is measured from the tablet's own centre, in metres of plate-local y,
 * and the placement is *solved* rather than typed: the bar is put where the near
 * tablet is, because the tablet is what has to be half eclipsed. Move the tablet
 * and the bar follows.
 */
const BAR = {
  offset: 0.45, // the lower edge, relative to tablet A's centre
  height: 2.40,
  thick: 0.26,
  span: 46.0, // across the beam; the same 46 the slots use
}

// `?bar=0.4` slides the lath along its own axis without a rebuild. It is here
// for the same reason `?pass` is: the placement of an eclipse is a matter of
// centimetres in a frame where the penumbra is 1.35m wide, and finding those
// centimetres by editing a constant costs a build per guess.
function barOffset() {
  if (typeof window === 'undefined') return BAR.offset
  const v = Number(new URLSearchParams(window.location.search).get('bar'))
  return Number.isFinite(v) && new URLSearchParams(window.location.search).has('bar')
    ? v
    : BAR.offset
}

export function buildRig() {
  const geo = {
    apron: new THREE.BoxGeometry(9.4, 0.20, 6.4),
    lintel: new THREE.BoxGeometry(7.4, 0.40, 0.72),
    pier: new THREE.BoxGeometry(0.42, 2.42, 0.62),
    bowl: latheSpline(BOWL),
    bead: new THREE.SphereGeometry(0.46, 64, 40),
    // The two mirrors. Thickness along local +z, which `lookAt` will point at
    // the half vector.
    slabA: new THREE.BoxGeometry(2.38, 1.72, 0.085),
    slabB: new THREE.BoxGeometry(1.92, 1.36, 0.075),
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
    // The sphere, kept from yesterday. At 0.10 it is smoother than Day 037's
    // bead and still shows a lozenge, because the limit on what a sphere can
    // report is its curvature and not its polish.
    glaze: new THREE.MeshStandardMaterial({
      color: new THREE.Color('#2b2f38'),
      roughness: 0.10,
      metalness: 0.0,
    }),
    // The two tablets. Near-black on purpose: a lacquer's albedo contributes a
    // diffuse term that competes with its own reflection, and the subject here
    // is the reflection. What is left is 4% Fresnel against a surface returning
    // about a fiftieth of what the apron does — which is why the window lands on
    // them at three and a half times the brightness of the page it sits on.
    //
    // The pair differ in exactly one number.
    lacquerA: new THREE.MeshStandardMaterial({
      color: new THREE.Color('#0e1014'),
      roughness: 0.050,
      metalness: 0.0,
    }),
    lacquerB: new THREE.MeshStandardMaterial({
      color: new THREE.Color('#0e1014'),
      roughness: 0.125,
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

  // --- the two mirrors ------------------------------------------------------
  // `lookAt` points a mesh's local +z at its argument, and the slabs' thickness
  // is on local z, so aiming at the half vector puts the face normal on the
  // half vector, one solved per tablet.
  const tablet = (g, m, x, y, z) => {
    const s = solid(g, m)
    s.position.set(x, y, z)
    s.lookAt(s.position.clone().add(halfVector(x, y, z)))
    return s
  }
  const tabletA = tablet(geo.slabA, mat.lacquerA, 1.42, 0.60, 1.42)
  const tabletB = tablet(geo.slabB, mat.lacquerB, 4.55, 0.56, 1.58)

  // --- the lath -------------------------------------------------------------
  // Put where the near tablet is, in the plate's own frame, which is the only
  // frame in which "across the mullion" is a direction. The light is
  // orthographic, so a feature at plate-local (x, y) shadows the point at
  // plate-local (x, y) however far downstream it lies — the placement is a
  // projection and not a search.
  //
  // It does not join `plateSlide`. The slots may wander; an eclipse aimed at a
  // particular tablet may not.
  screen.updateMatrixWorld(true)
  const barY = screen.worldToLocal(tabletA.position.clone()).y
  const barGeo = new THREE.BoxGeometry(BAR.span, BAR.height, BAR.thick)
  plateGeos.push(barGeo)
  const lath = solid(barGeo, mat.slate)
  lath.position.set(0, barY + barOffset() + BAR.height * 0.5, 0)
  screen.add(lath)

  // --- the diffuse reference ------------------------------------------------
  const bowl = solid(geo.bowl, mat.lime)
  bowl.position.set(7.05, 0.20, -0.95)
  bowl.rotation.y = -0.52
  bowl.scale.setScalar(1.14)

  // --- the control ----------------------------------------------------------
  // A sphere, in a frame that has just stopped needing one. It is here to be
  // *insufficient*: the eye reads the tablet, then reads this, and the
  // difference is the reason the composition changed this morning.
  const bead = solid(geo.bead, mat.glaze)
  bead.position.set(6.28, 0.66, 2.42)

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

  root.add(apron, tabletA, tabletB, bowl, bead, lintel, ...piers, ...blades)

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
    // Half yesterday's swing. The wide opening has to stay over the tablets:
    // the shafts may wander, the window's image may not.
    plateSlide.position.x = Math.sin(t * 0.0365) * 0.72
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
