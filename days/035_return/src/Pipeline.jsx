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
import { LIGHT, lightPosition, ATLAS, SCAN_STEPS, BOUNCE, RETURN } from './palette.js'

/**
 * Nine stages, sixteen draws, and R3F still issues none of them.
 *
 *   0. Light depth   the scene from the light, as linear distance (Day 031).
 *   1. G-buffer      one scene draw, three attachments: normal + depth,
 *                    velocity + material id, albedo.
 *   2. Beauty        the lit opaque scene, half float, ONE sample.
 *   3. Injection     ONE draw over a 2048 x 1152 atlas = 256 x 144 x 64 froxels.
 *                    Direct light, one Jacobi iteration of the air's own
 *                    diffusion (Day 033), and — new today — five screen-space
 *                    taps into the previous frame's radiosity, which is how the
 *                    room gets to light the air instead of only the other way
 *                    round.
 *   4. Scan          six ping-pong passes. Offsets 1, 2, 4, 8, 16, 32.
 *   5. Composite     the volume along the eye ray, the wash around each surface
 *                    (now with a screen-space visibility march), and a second
 *                    colour attachment holding what each surface sends back.
 *   6. Motes         7,000 billboards, one draw, into a layer of their own.
 *   7. TAA           reproject, clip, blend — opaque surfaces only.
 *   8. Present       motion blur, the mote layer, the grade.
 *
 * The dependency that defines today runs backwards through the frame: stage 5
 * writes radiosity, stage 3 of the *next* frame reads it, and stage 5 reads what
 * stage 3 wrote. That is a cycle, and it is supposed to be — it is the same
 * cycle a real room has. It is solved the way Day 033 solved the air's own: one
 * iteration per frame, with the temporal filter accumulating the series. Nothing
 * in the pipeline had to be reordered to allow it; the loop closes through time.
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

// mode indices of the three comparisons in App's PASSES list. They exist so the
// piece can put its own claims next to the picture without them: the wash alone,
// the frame with the return path cut, and the frame with the wash allowed to
// shine through walls again.
const MODE_WASH = 6
const MODE_NO_RETURN = 7
const MODE_NO_VIS = 8

/**
 * A fresh orientation every frame, axis and angle both advancing by the golden
 * angle so consecutive frames never repeat one. Two 3D gathers use this — the
 * diffusion between froxels and the hemisphere a surface asks about — and they
 * are given *different* sequences, because two four-tap estimates that spin
 * together would share their error and the temporal filter would average a
 * correlated pair instead of eight independent directions.
 */
function spin(n, axis, quat, mat) {
  const zc = 1 - (2 * ((n % 97) + 0.5)) / 97
  const rr = Math.sqrt(Math.max(0, 1 - zc * zc))
  const az = n * GOLDEN_ANGLE
  axis.set(Math.cos(az) * rr, Math.sin(az) * rr, zc).normalize()
  quat.setFromAxisAngle(axis, n * GOLDEN_ANGLE)
  mat.makeRotationFromQuaternion(quat)
}

export default function Pipeline({ rig, mode = 0, freeze = null, phase = 0 }) {
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

  // Our own camera down the light direction. Same numbers as three's shadow
  // camera, from the same function, for the reason spelled out in Scene.jsx.
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
    gbuf.textures[2].name = 'gAlbedo'

    const beauty = new THREE.WebGLRenderTarget(2, 2, {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
      stencilBuffer: false,
      samples: 0,
      colorSpace: THREE.LinearSRGBColorSpace,
    })

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

    // The atlas. Fixed size — it is a property of the room, not of the window,
    // which is the single largest practical difference from a ray march: at 4K
    // this costs exactly what it costs at 720p.
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
      beauty,
      light,
      inj: [atlas(), atlas()],
      scan: [atlas(), atlas()],
      // Two attachments, and ping-ponged: attachment 1 is read by the *next*
      // frame's injection while attachment 0 goes to the resolve. A single
      // buffer would have this frame's composite writing the texture this
      // frame's injection is still holding a binding to.
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
      targets.beauty.dispose()
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
    gl.shadowMap.type = THREE.PCFSoftShadowMap
    gl.shadowMap.autoUpdate = false
  }, [gl])

  // Nothing about the light moves, so its matrices are uploaded once rather than
  // every frame — to the injection, and to the motes, which are the one thing in
  // the frame three's own shadow machinery never shades.
  useEffect(() => {
    lightCam.updateMatrixWorld(true)
    lightCam.updateProjectionMatrix()
    const vp = new THREE.Matrix4().multiplyMatrices(
      lightCam.projectionMatrix,
      lightCam.matrixWorldInverse
    )
    injMat.uniforms.uLightView.value.copy(lightCam.matrixWorldInverse)
    injMat.uniforms.uLightVP.value.copy(vp)
    rig.moteMat.uniforms.uLightView.value.copy(lightCam.matrixWorldInverse)
    rig.moteMat.uniforms.uLightVP.value.copy(vp)
  }, [lightCam, injMat, rig])

  useEffect(() => {
    const dpr = gl.getPixelRatio()
    const w = Math.max(2, Math.floor(size.width * dpr))
    const h = Math.max(2, Math.floor(size.height * dpr))

    targets.gbuf.setSize(w, h)
    targets.beauty.setSize(w, h)
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
  // includes an aperture wall standing between the light and the entire court.
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
      e = {
        gmat: makeGBufferMaterial({
          far: camera.far,
          matId: o.userData.matId ?? 0,
          instanced: !!o.isInstancedMesh,
        }),
        prev: new THREE.Matrix4().copy(o.matrixWorld),
      }
      // `pick` runs before the swap, so o.material is still the object's own.
      // Anything without a colour — the backdrop's shader material — registers
      // black and therefore neither receives the wash nor returns anything to
      // the air, which is right: it is a painted gradient standing twenty metres
      // behind the room, not a surface in it.
      const src = o.material
      if (src && src.color) e.gmat.uniforms.uAlbedo.value.copy(src.color)
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

    // ---- camera: low, and looking up ---------------------------------------
    // The subject is an underside. Every frame in this series so far has been
    // shot from above eye level looking slightly down at a floor; this one has
    // to see the bottom of a slab, so the camera drops to 1.5m and tilts up.
    const px = st.pointer.x
    const py = st.pointer.y
    const tx = 0.60 + px * 0.44 + Math.sin(t * 0.067) * 0.26
    const ty = 1.30 + py * 0.18 + Math.sin(t * 0.051 + 1.3) * 0.07
    const tz = 12.6 + Math.cos(t * 0.041) * 0.34
    if (freeze != null) {
      camera.position.set(tx, ty, tz)
    } else {
      camera.position.x = THREE.MathUtils.damp(camera.position.x, tx, 1.8, dtScene)
      camera.position.y = THREE.MathUtils.damp(camera.position.y, ty, 1.8, dtScene)
      camera.position.z = THREE.MathUtils.damp(camera.position.z, tz, 1.8, dtScene)
    }
    camera.lookAt(1.60 + px * 0.08, 2.30 + py * 0.05, -0.55)
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
    // wants to index the volume has to project through the clean one. Two
    // matrices, two buffers, and mixing them up is a half-pixel crawl that only
    // appears when the camera is still.
    s.curVPJ.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    compMat.uniforms.uJitter.value.copy(s.jitterUV)
    presentMat.uniforms.uJitter.value.copy(s.jitterUV)
    rig.moteMat.uniforms.uJitter.value.copy(s.jitterUV)

    // ---- pass 0: light-space depth ----------------------------------------
    // White means "nothing in the way": every texel outside a silhouette has to
    // report the far plane, or the whole court starts in shadow.
    //
    // The aperture plate is switched on for exactly this call and switched off
    // again. Both of the frame's light-space maps are built here — ours,
    // explicitly, and three's own, because a render with needsUpdate set builds
    // it on the way in — so this is the one moment the plate has to exist. By
    // the time the camera looks at the court it is gone, which is how a thing
    // can cut every beam in the frame without ever being in it.
    gl.getClearColor(s.clear)
    const alpha = gl.getClearAlpha()
    gl.setClearColor(0xffffff, 1)
    rig.screen.visible = true
    gl.shadowMap.needsUpdate = true
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

    // ---- pass 2: beauty (one sample, opaque only) -------------------------
    gl.setRenderTarget(targets.beauty)
    gl.clear()
    gl.render(scene, camera)

    // ---- pass 3: injection — the lamp, the air, and the room ---------------
    const iRead = targets.inj[s.iPing]
    const iWrite = targets.inj[1 - s.iPing]
    const hRead = targets.hdr[s.hPing]
    const hWrite = targets.hdr[1 - s.hPing]

    injMat.uniforms.uLightDepth.value = targets.light.texture
    injMat.uniforms.uPrevVol.value = iRead.texture
    // The return path's two inputs: last frame's radiosity, and this frame's
    // G-buffer. They disagree by one frame of camera drift — a fraction of a
    // pixel at this speed — and pairing them this way is what avoids keeping a
    // second copy of the G-buffer around purely to be consistent about it.
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
    injMat.uniforms.uValid.value = s.vWarm > 1 ? 1 : 0
    injMat.uniforms.uRetGain.value = mode === MODE_NO_RETURN ? 0 : RETURN.gain

    // Kernels. The two 3D gathers get rotations from the same golden-angle
    // sequence walked at different rates; the return path's screen-space disc
    // gets a plain angle from the same source, because four spokes that never
    // move print four spokes into the air.
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

    // ---- pass 4: integration by prefix scan --------------------------------
    // out[k] = in[k - offset] (+) in[k], six times. The first pass is the one
    // that turns (rate, extinction) into (radiance, transmittance); the rest are
    // pure applications of the operator.
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

    // ---- pass 5: composite, the wash, and what the surfaces give back ------
    compMat.uniforms.uBeauty.value = targets.beauty.texture
    compMat.uniforms.uGbuf.value = targets.gbuf.textures[0]
    compMat.uniforms.uAlb.value = targets.gbuf.textures[2]
    compMat.uniforms.uMed.value = iWrite.texture
    compMat.uniforms.uVol.value = volume
    compMat.uniforms.uCamWorld.value.copy(camera.matrixWorld)
    compMat.uniforms.uViewProj.value.copy(s.curVP)
    compMat.uniforms.uVPJ.value.copy(s.curVPJ)
    compMat.uniforms.uView.value.copy(camera.matrixWorldInverse)
    compMat.uniforms.uBounce.value = BOUNCE.gain
    compMat.uniforms.uVis.value = mode === MODE_NO_VIS ? 0 : 1
    compMat.uniforms.uShow.value = mode === MODE_WASH ? 1 : 0
    compMat.uniforms.uSeed.value = s.frame % 4096
    fs.mesh.material = compMat
    gl.setRenderTarget(hWrite)
    gl.render(fs.scene, fs.cam)
    s.hPing = 1 - s.hPing

    // ---- pass 6: the motes, into a layer of their own ----------------------
    {
      const mm = rig.moteMat.uniforms
      mm.uGbuf.value = targets.gbuf.textures[0]
      mm.uLightDepth.value = targets.light.texture
      mm.uVol.value = volume
      gl.setRenderTarget(targets.motes)
      gl.render(rig.moteScene, camera)
    }

    // ---- pass 7: TAA resolve (opaque only) ---------------------------------
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

    // ---- pass 8: present ---------------------------------------------------
    presentMat.uniforms.uColor.value = tWrite.texture
    presentMat.uniforms.uMotes.value = targets.motes.texture
    presentMat.uniforms.uBeauty.value = targets.beauty.texture
    presentMat.uniforms.uGbuf.value = targets.gbuf.textures[0]
    presentMat.uniforms.uAlb.value = targets.gbuf.textures[2]
    presentMat.uniforms.uRadio.value = hWrite.textures[1]
    presentMat.uniforms.uMotion.value = targets.gbuf.textures[1]
    presentMat.uniforms.uVol.value = volume
    presentMat.uniforms.uLightDepth.value = targets.light.texture
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
