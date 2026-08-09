import { useMemo, useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import {
  makeLightDepthMaterial,
  makeGBufferMaterial,
  makeCompositeMaterial,
  makeTaaMaterial,
  makePresentMaterial,
} from './passes.js'
import { makeInjectionMaterial, makeScanMaterial } from './froxel.js'
import { makeNoiseVolume } from './noise.js'
import { WINDOW_DATA } from './shadow.js'
import { ltcTextures } from './ltc.js'
import { buildGlass, GLASS_K } from './glass.js'
import { LIGHT, WINDOW, lightPosition, ATLAS, SCAN_STEPS, BOUNCE, RETURN } from './palette.js'

/**
 * Seven stages, the same seven as yesterday, and R3F still issues none of them.
 *
 *   0. Light depth   the scene from the light, as linear distance (Day 031).
 *                    The only shadow map in the renderer since yesterday.
 *   1. G-buffer      one scene draw, three attachments: normal + depth,
 *                    velocity + id, albedo + roughness.
 *   2. Injection     ONE draw over a 2048 x 1152 atlas = 256 x 144 x 64 froxels.
 *   3. Scan          six ping-pong passes. Offsets 1, 2, 4, 8, 16, 32.
 *   4. Composite     the whole of the lighting — direct, wash, volume — plus the
 *                    radiosity attachment the injection reads next frame.
 *   5. Motes         7,000 billboards, one draw, into a layer of their own.
 *   6. TAA           reproject, clip, blend — opaque surfaces only.
 *   7. Present       motion blur, the mote layer, the grade.
 *
 * The pipeline does not change today; the description of the lamp does. Two
 * numbers and an axis reach three of these stages — the injection (4 search taps
 * and 2 PCF taps per froxel), the composite (8 and 20 per pixel, plus the cosine
 * and the lobe), and the motes (3 and 1 per speck) — and this file's only new
 * job is making sure all three are handed the *same* two numbers on the same
 * frame. A frame where the air thinks the opening is round and the floor thinks
 * it is a slot is a frame with no single lamp in it.
 */

const HALTON = [
  [0.500000, 0.333333],
  [0.250000, 0.666667],
  [0.750000, 0.111111],
  [0.125000, 0.444444],
  [0.625000, 0.777778],
  [0.375000, 0.222222],
  [0.875000, 0.555556],
  [0.062500, 0.888889],
]

const SHUTTER = 1 / 30
const DT_MIN = 1 / 600
const DT_MAX = 1 / 30
const GOLDEN_ANGLE = 2.399963229728653

// Mode indices of the comparisons in App's PASSES list. They exist so the piece
// can put its own claims next to the picture without them, and they now take the
// lamp apart in five independent directions:
//
//   MODE_PANES  keeps everything — the shape, the mask, the integral, the
//               exposure — and puts Day 040's six constants back where the image
//               is. Today's claim, removed, and the one to look at first: the
//               near tablet's reflection loses its quarries and its roundel and
//               becomes two flat colours with stone between them, which is
//               exactly what six numbers can say and no more.
//   MODE_GREY   the same window with no colour at all — Day 039's shading, kept
//               as a URL mode. The image's mean is white by construction, so
//               this frame still delivers the same quantity of light.
//   MODE_FLAT   flattens the *visibility* to its own mean — the shading every
//               day up to Day 038 did. Yesterday's claim; URL only from today.
//   MODE_MRP    keeps the window and swaps the *integral* for Day 037's
//               representative point. Geometry identical, method different.
//   MODE_SOLID  keeps the integral and swaps the *window* for one solid
//               rectangle of the same extent — the tracery removed, the
//               radiance lowered to match, so the room receives the same light.
//               Yesterday this mode lost the glass along with the stone, because
//               a single pane cannot hold six colours. Today it does not: the
//               picture is in a texture and the texture never knew how many
//               panes there were, so ?pass=11 is a *complete* leaded window,
//               quarries and both roses, with no stone crossing it. That is the
//               clearest statement in the piece that the shape and the radiance
//               have come apart.
//   MODE_HARD   collapses the source to a point. Day 031's lamp.
const MODE_DIRECT = 1
const MODE_WASH = 6
const MODE_PANES = 7
const MODE_MRP = 8
const MODE_HARD = 9
const MODE_SOLID = 10 // URL only since Day 039; the keyboard is out of digits
const MODE_NO_RETURN = 11
const MODE_FLAT = 12
const MODE_GREY = 13 // URL only from today, displaced by the day's own claim

/**
 * A fresh orientation every frame, axis and angle both advancing by the golden
 * angle so consecutive frames never repeat one.
 */
function spin(n, axis, quat, mat) {
  const zc = 1 - (2 * ((n % 97) + 0.5)) / 97
  const rr = Math.sqrt(Math.max(0, 1 - zc * zc))
  const az = n * GOLDEN_ANGLE
  axis.set(Math.cos(az) * rr, Math.sin(az) * rr, zc).normalize()
  quat.setFromAxisAngle(axis, n * GOLDEN_ANGLE)
  mat.makeRotationFromQuaternion(quat)
}

export default function Pipeline({ rig, mode = 0, freeze = null, phase = 0, glassK = null }) {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)

  const lightMat = useMemo(() => makeLightDepthMaterial(), [])
  const noise = useMemo(() => makeNoiseVolume(32), [])
  const injMat = useMemo(() => {
    const m = makeInjectionMaterial()
    m.uniforms.uNoise.value = noise
    return m
  }, [noise])
  const scanFirst = useMemo(() => makeScanMaterial({ first: true }), [])
  const scanMat = useMemo(() => makeScanMaterial({ first: false }), [])
  const compMat = useMemo(() => makeCompositeMaterial(), [])
  const taaMat = useMemo(() => makeTaaMaterial(), [])
  const presentMat = useMemo(() => makePresentMaterial(), [])

  // The one camera down the light direction. There is no longer a second one to
  // agree with.
  const lightCam = useMemo(() => {
    const h = LIGHT.halfSize
    const c = new THREE.OrthographicCamera(-h, h, h, -h, 0.5, LIGHT.far)
    c.position.set(...lightPosition())
    c.lookAt(...LIGHT.target)
    c.updateMatrixWorld(true)
    return c
  }, [])

  const fs = useMemo(() => {
    const s = new THREE.Scene()
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), compMat)
    mesh.frustumCulled = false
    s.add(mesh)
    return { scene: s, cam, mesh }
  }, [compMat])

  const targets = useMemo(() => {
    const gbuf = new THREE.WebGLRenderTarget(2, 2, {
      count: 3,
      type: THREE.HalfFloatType,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: true,
      stencilBuffer: false,
      colorSpace: THREE.LinearSRGBColorSpace,
    })
    gbuf.textures[0].name = 'gNormalDepth'
    gbuf.textures[1].name = 'gMotion'
    gbuf.textures[2].name = 'gAlbedoRough'

    // Square, because the light's frustum is square, and independent of the
    // window: a shaft should not get sharper when the browser is made wider.
    const light = new THREE.WebGLRenderTarget(LIGHT.size, LIGHT.size, {
      type: THREE.HalfFloatType,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: true,
      stencilBuffer: false,
      colorSpace: THREE.LinearSRGBColorSpace,
    })

    const plain = (count = 1) =>
      new THREE.WebGLRenderTarget(2, 2, {
        count,
        type: THREE.HalfFloatType,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        depthBuffer: false,
        stencilBuffer: false,
        colorSpace: THREE.LinearSRGBColorSpace,
      })

    // The atlas. Fixed size — it is a property of the room, not of the window.
    const atlas = () =>
      new THREE.WebGLRenderTarget(ATLAS.w, ATLAS.h, {
        type: THREE.HalfFloatType,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        wrapS: THREE.ClampToEdgeWrapping,
        wrapT: THREE.ClampToEdgeWrapping,
        depthBuffer: false,
        stencilBuffer: false,
        colorSpace: THREE.LinearSRGBColorSpace,
      })

    return {
      gbuf,
      light,
      inj: [atlas(), atlas()],
      scan: [atlas(), atlas()],
      // Two attachments, and ping-ponged: attachment 1 is read by the *next*
      // frame's injection while attachment 0 goes to the resolve.
      hdr: [plain(2), plain(2)],
      motes: plain(),
      taa: [plain(), plain()],
    }
  }, [])

  // one G-buffer material per mesh — "previous model matrix" is a per-object
  // fact, and a shared material can only carry one of them
  const reg = useRef(new Map())

  useEffect(
    () => () => {
      targets.gbuf.dispose()
      targets.light.dispose()
      targets.motes.dispose()
      targets.inj.forEach((t) => t.dispose())
      targets.scan.forEach((t) => t.dispose())
      targets.hdr.forEach((t) => t.dispose())
      targets.taa.forEach((t) => t.dispose())
      reg.current.forEach((e) => e.gmat.dispose())
      reg.current.clear()
      noise.dispose()
      lightMat.dispose()
      injMat.dispose()
      scanFirst.dispose()
      scanMat.dispose()
      compMat.dispose()
      taaMat.dispose()
      presentMat.dispose()
      fs.mesh.geometry.dispose()
    },
    [targets, noise, lightMat, injMat, scanFirst, scanMat, compMat, taaMat, presentMat, fs]
  )

  const state = useRef({
    iPing: 0,
    tPing: 0,
    hPing: 0,
    frame: 0,
    warm: 0,
    vWarm: 0,
    t0: -1,
    sceneT: 0,
    reveal: 0,
    prevVP: new THREE.Matrix4(),
    curVP: new THREE.Matrix4(),
    curVPJ: new THREE.Matrix4(),
    prevView: new THREE.Matrix4(),
    projClean: new THREE.Matrix4(),
    jitterUV: new THREE.Vector2(),
    camPos: new THREE.Vector3(),
    msAxis: new THREE.Vector3(),
    msQuat: new THREE.Quaternion(),
    msMat: new THREE.Matrix4(),
    bsAxis: new THREE.Vector3(),
    bsQuat: new THREE.Quaternion(),
    bsMat: new THREE.Matrix4(),
    swapped: [],
    primed: false,
    clear: new THREE.Color(),
  })

  useEffect(() => {
    gl.setClearColor(0x000000, 0)
  }, [gl])

  // Nothing about the light moves, so its matrices — and, from this morning, its
  // geometry — are uploaded once rather than every frame, to all three customers
  // of the shadow test.
  // Built once and never rebuilt: 256x256 supersampled, nine levels of box
  // pyramid, half float. About four milliseconds of JavaScript at startup, and
  // the last time in the frame anybody thinks about how many quarries there are.
  const glass = useMemo(() => buildGlass(), [])

  useEffect(() => {
    lightCam.updateMatrixWorld(true)
    lightCam.updateProjectionMatrix()
    const vp = new THREE.Matrix4().multiplyMatrices(
      lightCam.projectionMatrix,
      lightCam.matrixWorldInverse
    )
    const dir = new THREE.Vector3(...LIGHT.dir).normalize()

    // The window's two axes in world space. The light view matrix's *rows* are
    // the light frame's axes expressed in world coordinates, and since GLSL — and
    // three — index a matrix by column, taking a row means picking one component
    // out of three columns. Then the pair is turned by WINDOW.axis inside its own
    // plane, which is the same turn `uSrcAxis` applies to a shadow tap; if these
    // two ever disagree the highlight and the penumbra are pictures of windows
    // rotated relative to each other, and nothing else in the frame says so.
    const iv = lightCam.matrixWorldInverse.elements
    const lx = new THREE.Vector3(iv[0], iv[4], iv[8])
    const ly = new THREE.Vector3(iv[1], iv[5], iv[9])
    const ca = Math.cos(WINDOW.axis)
    const sa = Math.sin(WINDOW.axis)
    const A = lx.clone().multiplyScalar(ca).addScaledVector(ly, sa).normalize()
    const B = ly.clone().multiplyScalar(ca).addScaledVector(lx, -sa).normalize()
    const C = new THREE.Vector3(...lightPosition())

    for (const m of [injMat, compMat, rig.moteMat]) {
      const u = m.uniforms
      u.uLightView.value.copy(lightCam.matrixWorldInverse)
      u.uLightVP.value.copy(vp)
      u.uSrcAxis.value.set(ca, sa)
      // The picture in the glass, and the two numbers that turn a lobe into a
      // level of it. All three consumers get it: the integral reads it at a
      // level it computes per pixel, the froxels and the specks at uGlassSoft.
      u.uGlass.value = glass.tex
      u.uGlassMax.value = glass.levels - 1
      u.uGlassK.value = glassK ?? GLASS_K
      if (u.uLightDir) u.uLightDir.value.copy(dir)
      if (u.uLightCol) u.uLightCol.value.setRGB(...LIGHT.color)
      if (u.uSrcC) {
        u.uSrcC.value.copy(C)
        u.uSrcA.value.copy(A)
        u.uSrcB.value.copy(B)
        u.uSrcDist.value = LIGHT.dist
        const ltc = ltcTextures()
        u.uLtcMat.value = ltc.m
        u.uLtcMag.value = ltc.f
      }
    }
  }, [lightCam, injMat, compMat, rig, glass, glassK])

  useEffect(() => {
    const dpr = gl.getPixelRatio()
    const w = Math.max(2, Math.floor(size.width * dpr))
    const h = Math.max(2, Math.floor(size.height * dpr))

    targets.gbuf.setSize(w, h)
    targets.motes.setSize(w, h)
    targets.hdr.forEach((t) => t.setSize(w, h))
    targets.taa.forEach((t) => t.setSize(w, h))
    // the atlases are never resized: the grid belongs to the frustum, not the
    // framebuffer

    const aspect = size.width / Math.max(1, size.height)
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov) * 0.5)
    for (const m of [injMat, scanFirst, scanMat, compMat]) {
      m.uniforms.uTanHalf.value = tanHalf
      m.uniforms.uAspect.value = aspect
    }
    injMat.uniforms.uFar.value = camera.far
    compMat.uniforms.uFar.value = camera.far
    taaMat.uniforms.uFar.value = camera.far
    taaMat.uniforms.uTexel.value.set(1 / w, 1 / h)
    taaMat.uniforms.uRes.value.set(w, h)
    presentMat.uniforms.uRes.value.set(w, h)
    presentMat.uniforms.uFar.value = camera.far
    presentMat.uniforms.uMaxBlur.value = 0.05 * h

    const mm = rig.moteMat.uniforms
    mm.uRes.value.set(w, h)
    mm.uFar.value = camera.far
    mm.uTanHalf.value = tanHalf

    const prev = gl.getRenderTarget()
    for (const t of [...targets.inj, ...targets.scan, ...targets.hdr, ...targets.taa]) {
      gl.setRenderTarget(t)
      gl.clear(true, false, false)
    }
    gl.setRenderTarget(prev)
    state.current.warm = 0
    state.current.vWarm = 0
  }, [gl, size, targets, injMat, scanFirst, scanMat, compMat, taaMat, presentMat, camera, rig])

  // Material swaps by hand rather than scene.overrideMaterial: the G-buffer needs
  // a different previous matrix per object, and the light depth pass needs to
  // *skip* objects. An override renders everything, and "everything" here
  // includes an aperture plate standing between the light and the entire court.
  const push = (pick) => {
    const list = state.current.swapped
    list.length = 0
    scene.traverse((o) => {
      if (!o.isMesh || !o.visible) return
      const m = pick(o)
      if (!m) return
      list.push(o, o.material)
      o.material = m
    })
  }
  const pop = () => {
    const list = state.current.swapped
    for (let i = 0; i < list.length; i += 2) list[i].material = list[i + 1]
    list.length = 0
  }

  const gPick = (o) => {
    const s = state.current
    let e = reg.current.get(o)
    if (!e) {
      const emissive = !!o.userData.emissive
      e = {
        gmat: makeGBufferMaterial({
          far: camera.far,
          matId: o.userData.matId ?? 0,
          instanced: !!o.isInstancedMesh,
          emissive,
        }),
        prev: new THREE.Matrix4().copy(o.matrixWorld),
      }
      // `pick` runs before the swap, so o.material is still the object's own.
      // Since this morning nothing renders those materials — they are read once,
      // here, for a colour and a roughness, and are data from then on.
      const src = o.material
      if (src && src.color && !emissive) e.gmat.uniforms.uAlbedo.value.copy(src.color)
      if (src && src.roughness != null) e.gmat.uniforms.uRough.value = src.roughness
      reg.current.set(o, e)
    }
    e.gmat.uniforms.uPrevModel.value.copy(e.prev)
    e.gmat.uniforms.uPrevViewProj.value.copy(s.prevVP)
    e.gmat.uniforms.uCurViewProj.value.copy(s.curVP)
    return e.gmat
  }

  const lPick = (o) => (o.castShadow ? lightMat : null)

  const remember = () => {
    reg.current.forEach((e, o) => e.prev.copy(o.matrixWorld))
  }

  useFrame((st, delta) => {
    const s = state.current
    s.frame++

    // Two clocks (Day 030): the reveal is a one-shot event on the wall clock;
    // the piece runs on accumulated *clamped* delta, so a slow machine sees it
    // in slow motion rather than seeing it wrong.
    const dtScene = THREE.MathUtils.clamp(delta, DT_MIN, DT_MAX)
    if (freeze != null) s.sceneT = freeze
    else s.sceneT += dtScene
    const t = s.sceneT + (freeze != null ? 0 : phase)

    if (s.t0 < 0) s.t0 = st.clock.elapsedTime
    s.reveal = freeze != null ? 1 : Math.min(1, (st.clock.elapsedTime - s.t0) / 2.0)

    rig.step(t)
    scene.updateMatrixWorld(true)

    // ---- camera: above the rake, looking down the shadows ------------------
    // Higher than yesterday and tilted further down. The subject is not the row
    // of blades, it is what the row *writes*, and a shadow read at a grazing
    // angle is a line while the same shadow read from above is a shape with a
    // gradient across it. A metre of camera height is worth more to this frame
    // than any amount of tap count.
    const px = st.pointer.x
    const py = st.pointer.y
    const tx = 1.30 + px * 0.46 + Math.sin(t * 0.067) * 0.26
    const ty = 4.05 + py * 0.26 + Math.sin(t * 0.051 + 1.3) * 0.08
    const tz = 11.4 + Math.cos(t * 0.041) * 0.34
    if (freeze != null) {
      camera.position.set(tx, ty, tz)
    } else {
      camera.position.x = THREE.MathUtils.damp(camera.position.x, tx, 1.8, dtScene)
      camera.position.y = THREE.MathUtils.damp(camera.position.y, ty, 1.8, dtScene)
      camera.position.z = THREE.MathUtils.damp(camera.position.z, tz, 1.8, dtScene)
    }
    camera.lookAt(2.55 + px * 0.08, 0.58 + py * 0.05, -1.15)
    camera.updateMatrixWorld()
    s.camPos.setFromMatrixPosition(camera.matrixWorld)

    // ---- sub-pixel jitter (TAA) -------------------------------------------
    camera.updateProjectionMatrix()
    s.projClean.copy(camera.projectionMatrix)
    s.curVP.multiplyMatrices(s.projClean, camera.matrixWorldInverse)
    if (!s.primed) {
      s.prevVP.copy(s.curVP)
      s.prevView.copy(camera.matrixWorldInverse)
      s.primed = true
    }

    const w = targets.gbuf.width
    const h = targets.gbuf.height
    const [jx, jy] = HALTON[s.frame % HALTON.length]
    const dx = ((jx - 0.5) * 2) / w
    const dy = ((jy - 0.5) * 2) / h
    camera.projectionMatrix.elements[8] += dx
    camera.projectionMatrix.elements[9] += dy
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert()
    s.jitterUV.set(-dx * 0.5, -dy * 0.5)
    // The jittered view-projection, kept as its own matrix. Anything that wants
    // to *index the G-buffer* has to project through this one; anything that
    // wants to index the volume has to project through the clean one.
    s.curVPJ.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    compMat.uniforms.uJitter.value.copy(s.jitterUV)
    presentMat.uniforms.uJitter.value.copy(s.jitterUV)
    rig.moteMat.uniforms.uJitter.value.copy(s.jitterUV)

    // The source's description, and the ways of taking it apart. Every consumer
    // of the shadow test is handed the same list, because a comparison where the
    // air and the stone disagree about the shape of the lamp is not a comparison.
    //
    // Note which number moves with the pane list. Removing the tracery adds the
    // mullion's and the transoms' area back to the opening — 22% of the bounding
    // rectangle — so a solid source at the same radiance would deliver 22% more
    // light and the render would differ by exposure as much as by shape. It is
    // handed uSrcRad = intensity / its own omega instead, and the two frames then
    // differ by exactly one thing.
    const solid = mode === MODE_SOLID
    const W = WINDOW_DATA
    for (const m of [injMat, compMat, rig.moteMat]) {
      const u = m.uniforms
      u.uHard.value = mode === MODE_HARD ? 1 : 0
      u.uPane.value = solid ? W.solid : W.panes
      u.uPaneCdf.value = solid ? W.solidCdf : W.cdf
      u.uPaneN.value = solid ? W.solidCount : W.count
      u.uPaneCol.value = solid ? W.solidCols : W.cols
      // uSrcRad does not appear in this line and that is the point of
      // normalising the tints on the CPU: colour and quantity are separable
      // here, so greying the glass is not an exposure change.
      u.uTint.value = mode === MODE_GREY ? 0 : 1
      // The image, or the six constants it replaced. Nothing else moves with
      // this line — not uSrcRad, not the panes, not the mask — because the
      // pyramid's mean is white for the same reason the six tints' was.
      u.uTexLight.value = mode === MODE_PANES ? 0 : 1
      u.uSrcRad.value = LIGHT.intensity / (solid ? W.solidOmega : W.omega)
      if (u.uLtc) u.uLtc.value = mode === MODE_MRP ? 0 : 1
      // Day 037's fallback has no way to take a mask — a representative point is
      // one direction, and one direction cannot be half occluded — so selecting
      // it flattens the visibility too. That is not a limitation being hidden;
      // it is the reason the approximation had to go.
      if (u.uMask) u.uMask.value = mode === MODE_FLAT || mode === MODE_MRP ? 0 : 1
    }

    // ---- pass 0: light-space depth ----------------------------------------
    // White means "nothing in the way": every texel outside a silhouette has to
    // report the far plane, or the whole court starts in shadow.
    //
    // The aperture plate is switched on for exactly this call and switched off
    // again. By the time the camera looks at the court it is gone, which is how
    // a thing can cut every beam in the frame without ever being in it.
    gl.getClearColor(s.clear)
    const alpha = gl.getClearAlpha()
    gl.setClearColor(0xffffff, 1)
    rig.screen.visible = true
    push(lPick)
    gl.setRenderTarget(targets.light)
    gl.clear()
    gl.render(scene, lightCam)
    pop()
    rig.screen.visible = false
    gl.setClearColor(s.clear, alpha)

    // ---- pass 1: G-buffer (one draw, three attachments) -------------------
    push(gPick)
    gl.setRenderTarget(targets.gbuf)
    gl.clear()
    gl.render(scene, camera)
    pop()

    // ---- pass 2: injection — the lamp, the air, and the room ---------------
    const iRead = targets.inj[s.iPing]
    const iWrite = targets.inj[1 - s.iPing]
    const hRead = targets.hdr[s.hPing]
    const hWrite = targets.hdr[1 - s.hPing]

    injMat.uniforms.uLightDepth.value = targets.light.texture
    injMat.uniforms.uPrevVol.value = iRead.texture
    // The return path's two inputs: last frame's radiosity, and this frame's
    // G-buffer.
    injMat.uniforms.uRadio.value = hRead.textures[1]
    injMat.uniforms.uGbuf.value = targets.gbuf.textures[0]
    injMat.uniforms.uCamWorld.value.copy(camera.matrixWorld)
    injMat.uniforms.uPrevViewProj.value.copy(s.prevVP)
    injMat.uniforms.uPrevView.value.copy(s.prevView)
    injMat.uniforms.uView.value.copy(camera.matrixWorldInverse)
    injMat.uniforms.uCurVPJ.value.copy(s.curVPJ)
    injMat.uniforms.uJitUV.value.copy(s.jitterUV)
    injMat.uniforms.uTime.value = t
    // The slab edges stay put; only the sample point inside each slab moves.
    injMat.uniforms.uJitterZ.value = ((s.frame % 4096) * 0.6180339887) % 1.0 - 0.5
    injMat.uniforms.uJitterXY.value.set(jx - 0.5, jy - 0.5)
    // The shadow spiral's per-frame turn. It is added to a per-cell angle inside
    // the shader, so a still camera keeps integrating rather than settling on
    // one four-tap opinion of where the shaft's edge is.
    injMat.uniforms.uSpin.value = ((s.frame % 4096) * 0.7548776662) % 1.0
    injMat.uniforms.uValid.value = s.vWarm > 1 ? 1 : 0
    injMat.uniforms.uRetGain.value = mode === MODE_NO_RETURN ? 0 : RETURN.gain

    // Kernels. The two 3D gathers get rotations from the same golden-angle
    // sequence walked at different rates.
    {
      const n = s.frame % 4096
      spin(n, s.msAxis, s.msQuat, s.msMat)
      injMat.uniforms.uMsBasis.value.setFromMatrix4(s.msMat)
      spin((n * 7 + 913) % 4096, s.bsAxis, s.bsQuat, s.bsMat)
      compMat.uniforms.uBasis.value.setFromMatrix4(s.bsMat)
      const a = n * GOLDEN_ANGLE * 1.7
      injMat.uniforms.uRetRot.value.set(Math.cos(a), Math.sin(a))
    }

    fs.mesh.material = injMat
    gl.setRenderTarget(iWrite)
    gl.render(fs.scene, fs.cam)
    s.iPing = 1 - s.iPing
    s.vWarm++

    // ---- pass 3: integration by prefix scan --------------------------------
    let src = iWrite
    let dst = targets.scan[0]
    for (let i = 0; i < SCAN_STEPS; i++) {
      const m = i === 0 ? scanFirst : scanMat
      m.uniforms.uSrc.value = src.texture
      m.uniforms.uOffset.value = 1 << i
      fs.mesh.material = m
      gl.setRenderTarget(dst)
      gl.render(fs.scene, fs.cam)
      src = dst
      dst = targets.scan[(i + 1) % 2] // 0 -> 1 -> 0 -> 1 ...
    }
    const volume = src.texture

    // ---- pass 4: composite — every term in the frame, in one shader --------
    compMat.uniforms.uGbuf.value = targets.gbuf.textures[0]
    compMat.uniforms.uMot.value = targets.gbuf.textures[1]
    compMat.uniforms.uAlb.value = targets.gbuf.textures[2]
    compMat.uniforms.uLightDepth.value = targets.light.texture
    compMat.uniforms.uMed.value = iWrite.texture
    compMat.uniforms.uVol.value = volume
    compMat.uniforms.uCamWorld.value.copy(camera.matrixWorld)
    compMat.uniforms.uViewProj.value.copy(s.curVP)
    compMat.uniforms.uVPJ.value.copy(s.curVPJ)
    compMat.uniforms.uView.value.copy(camera.matrixWorldInverse)
    compMat.uniforms.uBounce.value = BOUNCE.gain
    compMat.uniforms.uShow.value = mode === MODE_DIRECT ? 2 : mode === MODE_WASH ? 1 : 0
    compMat.uniforms.uSeed.value = s.frame % 4096
    fs.mesh.material = compMat
    gl.setRenderTarget(hWrite)
    gl.render(fs.scene, fs.cam)
    s.hPing = 1 - s.hPing

    // ---- pass 5: the motes, into a layer of their own ----------------------
    {
      const mm = rig.moteMat.uniforms
      mm.uGbuf.value = targets.gbuf.textures[0]
      mm.uLightDepth.value = targets.light.texture
      mm.uVol.value = volume
      gl.setRenderTarget(targets.motes)
      gl.render(rig.moteScene, camera)
    }

    // ---- pass 6: TAA resolve (opaque only) ---------------------------------
    const tRead = targets.taa[s.tPing]
    const tWrite = targets.taa[1 - s.tPing]
    taaMat.uniforms.uCur.value = hWrite.textures[0]
    taaMat.uniforms.uHist.value = tRead.texture
    taaMat.uniforms.uMotion.value = targets.gbuf.textures[1]
    taaMat.uniforms.uGbuf.value = targets.gbuf.textures[0]
    taaMat.uniforms.uValid.value = s.warm > 1 ? 1 : 0
    fs.mesh.material = taaMat
    gl.setRenderTarget(tWrite)
    gl.render(fs.scene, fs.cam)
    s.tPing = 1 - s.tPing
    s.warm++

    // ---- pass 7: present ---------------------------------------------------
    presentMat.uniforms.uColor.value = tWrite.texture
    presentMat.uniforms.uMotes.value = targets.motes.texture
    presentMat.uniforms.uGbuf.value = targets.gbuf.textures[0]
    presentMat.uniforms.uAlb.value = targets.gbuf.textures[2]
    presentMat.uniforms.uRadio.value = hWrite.textures[1]
    presentMat.uniforms.uMotion.value = targets.gbuf.textures[1]
    presentMat.uniforms.uVol.value = volume
    presentMat.uniforms.uVelScale.value = SHUTTER / dtScene
    presentMat.uniforms.uTime.value = t
    presentMat.uniforms.uFrame.value = s.frame % 4096
    presentMat.uniforms.uMode.value = mode
    presentMat.uniforms.uReveal.value = s.reveal
    fs.mesh.material = presentMat
    gl.setRenderTarget(null)
    gl.render(fs.scene, fs.cam)

    // ---- this frame becomes next frame's past ------------------------------
    s.prevVP.copy(s.curVP)
    s.prevView.copy(camera.matrixWorldInverse)
    remember()
  }, 1)

  return null
}
