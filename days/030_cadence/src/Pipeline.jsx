import { useMemo, useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import {
  makeGBufferMaterial,
  makeSSRMaterial,
  makeCompositeMaterial,
  makeTaaMaterial,
  makePresentMaterial,
} from './passes.js'

/**
 * Six passes, and R3F draws none of them.
 *
 *   1. G-buffer   one scene draw into two attachments (MRT, GLSL3):
 *                 normal + linear depth, and velocity + material id.
 *                 Every object hands in its own previous world matrix; the
 *                 instanced fin ring hands in one previous matrix per blade.
 *   2. Beauty     the lit scene, half float, ONE sample. No MSAA — for the
 *                 first time the anti-aliasing is pass 5's job.
 *   3. Reflection screen-space ray march, accumulated through the velocities
 *   4. Composite  beauty + reflection, still linear HDR, ungraded
 *   5. TAA        reproject, clip, blend: eight sub-pixel positions become one
 *   6. Present    motion blur along the velocity buffer, then the grade
 *
 * Day 028 built the first three-pass renderer; Day 029 gave it MRT and motion
 * vectors but had to keep the world frozen for them to be true. The two things
 * added here — a past for every object, and a temporal filter on the final
 * image — are what let the piece move at all.
 */

// Halton(2,3), the standard low-discrepancy jitter: eight positions that fill a
// pixel far more evenly than eight random ones would.
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

const SHUTTER = 1 / 30 // seconds of open shutter — a duration, not a pixel count

// The frame step is clamped at BOTH ends. The upper bound is why a slow machine
// shows the piece in slow motion instead of showing it wrong (see below). The
// lower bound exists because this page is captured headlessly, where Chrome's
// virtual clock can hand out deltas near zero: the velocity buffer then holds
// almost nothing, and the shutter scale that has to undo it (shutter/dt) runs
// away. Both ends protect the same quantity.
const DT_MIN = 1 / 600
const DT_MAX = 1 / 30

export default function Pipeline({ rig, mode = 0, freeze = null, phase = 0 }) {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)

  const ssrMat = useMemo(() => makeSSRMaterial(), [])
  const compMat = useMemo(() => makeCompositeMaterial(), [])
  const taaMat = useMemo(() => makeTaaMaterial(), [])
  const presentMat = useMemo(() => makePresentMaterial(), [])

  const fs = useMemo(() => {
    const s = new THREE.Scene()
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), compMat)
    mesh.frustumCulled = false
    s.add(mesh)
    return { scene: s, cam, mesh }
  }, [compMat])

  const targets = useMemo(() => {
    // The G-buffer is one render target with TWO colour attachments, point
    // sampled and un-multisampled: resolving MSAA across a silhouette would
    // average packed depths and velocities into values describing no surface.
    const gbuf = new THREE.WebGLRenderTarget(2, 2, {
      count: 2,
      type: THREE.HalfFloatType,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: true,
      stencilBuffer: false,
      colorSpace: THREE.LinearSRGBColorSpace,
    })
    gbuf.textures[0].name = 'gNormalDepth'
    gbuf.textures[1].name = 'gMotion'

    // samples: 0. Day 029 asked for 4x here and then had to feather the water
    // mask by a pixel because the G-buffer could not be resolved to match it.
    // TAA makes the two buffers agree by construction.
    const beauty = new THREE.WebGLRenderTarget(2, 2, {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
      stencilBuffer: false,
      samples: 0,
      colorSpace: THREE.LinearSRGBColorSpace,
    })

    const plain = () =>
      new THREE.WebGLRenderTarget(2, 2, {
        type: THREE.HalfFloatType,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        depthBuffer: false,
        stencilBuffer: false,
        colorSpace: THREE.LinearSRGBColorSpace,
      })

    return { gbuf, beauty, ssr: [plain(), plain()], hdr: plain(), taa: [plain(), plain()] }
  }, [])

  // one G-buffer material per mesh, because "previous model matrix" is a
  // per-object fact and a shared material can only carry one of them
  const reg = useRef(new Map())

  useEffect(
    () => () => {
      targets.gbuf.dispose()
      targets.beauty.dispose()
      targets.hdr.dispose()
      targets.ssr.forEach((t) => t.dispose())
      targets.taa.forEach((t) => t.dispose())
      reg.current.forEach((e) => e.gmat.dispose())
      reg.current.clear()
      ssrMat.dispose()
      compMat.dispose()
      taaMat.dispose()
      presentMat.dispose()
      fs.mesh.geometry.dispose()
    },
    [targets, ssrMat, compMat, taaMat, presentMat, fs]
  )

  const state = useRef({
    ping: 0,
    tPing: 0,
    frame: 0,
    warm: 0,
    t0: -1,
    sceneT: 0,
    reveal: 0,
    prevVP: new THREE.Matrix4(),
    curVP: new THREE.Matrix4(),
    projClean: new THREE.Matrix4(),
    jitterUV: new THREE.Vector2(),
    swapped: [],
    primed: false,
  })

  useEffect(() => {
    gl.setClearColor(0x000000, 0)
    gl.shadowMap.type = THREE.PCFSoftShadowMap
    // The sculpture turns, so the shadow map is no longer a static asset. It is
    // rebuilt once per frame — deliberately not twice: autoUpdate would rebuild
    // it for the G-buffer draw as well, which needs no shadows at all.
    gl.shadowMap.autoUpdate = false
  }, [gl])

  useEffect(() => {
    const dpr = gl.getPixelRatio()
    const w = Math.max(2, Math.floor(size.width * dpr))
    const h = Math.max(2, Math.floor(size.height * dpr))
    targets.gbuf.setSize(w, h)
    targets.beauty.setSize(w, h)
    targets.hdr.setSize(w, h)
    targets.ssr.forEach((t) => t.setSize(w, h))
    targets.taa.forEach((t) => t.setSize(w, h))

    const aspect = size.width / Math.max(1, size.height)
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov) * 0.5)
    for (const m of [ssrMat, compMat]) {
      m.uniforms.uFar.value = camera.far
      m.uniforms.uTanHalf.value = tanHalf
      m.uniforms.uAspect.value = aspect
    }
    taaMat.uniforms.uFar.value = camera.far
    compMat.uniforms.uTexel.value.set(1 / w, 1 / h)
    taaMat.uniforms.uTexel.value.set(1 / w, 1 / h)
    ssrMat.uniforms.uRes.value.set(w, h)
    taaMat.uniforms.uRes.value.set(w, h)
    presentMat.uniforms.uRes.value.set(w, h)
    // the longest smear allowed, as a fraction of frame height
    presentMat.uniforms.uMaxBlur.value = 0.055 * h

    // every history buffer now describes a resolution that no longer exists
    const prev = gl.getRenderTarget()
    for (const t of [...targets.ssr, ...targets.taa]) {
      gl.setRenderTarget(t)
      gl.clear(true, false, false)
    }
    gl.setRenderTarget(prev)
    state.current.warm = 0
  }, [gl, size, targets, ssrMat, compMat, taaMat, presentMat, camera])

  // Swapping materials by hand rather than scene.overrideMaterial: the override
  // is one material for the whole scene, and the entire point today is that
  // every object says something different about where it has been.
  const pushG = () => {
    const s = state.current
    const list = s.swapped
    list.length = 0
    scene.traverse((o) => {
      if (!o.isMesh || !o.visible) return
      let e = reg.current.get(o)
      if (!e) {
        e = {
          gmat: makeGBufferMaterial({
            far: camera.far,
            matId: o.userData.matId ?? 0,
            instanced: !!o.isInstancedMesh,
          }),
          prev: new THREE.Matrix4().copy(o.matrixWorld), // no bogus first frame
        }
        reg.current.set(o, e)
      }
      e.gmat.uniforms.uPrevModel.value.copy(e.prev)
      e.gmat.uniforms.uPrevViewProj.value.copy(s.prevVP)
      e.gmat.uniforms.uCurViewProj.value.copy(s.curVP)
      list.push(o, o.material)
      o.material = e.gmat
    })
  }
  const popG = () => {
    const list = state.current.swapped
    for (let i = 0; i < list.length; i += 2) list[i].material = list[i + 1]
    list.length = 0
  }

  // "this frame becomes next frame's past" — for every object, and for every
  // instance of every instanced object
  const remember = () => {
    reg.current.forEach((e, o) => {
      e.prev.copy(o.matrixWorld)
      if (o.isInstancedMesh) {
        const a = o.geometry.attributes.aPrevInstance
        if (a) {
          a.array.set(o.instanceMatrix.array)
          a.needsUpdate = true
        }
      }
    })
  }

  useFrame((st, delta) => {
    const s = state.current
    s.frame++

    // Two clocks, and they are not interchangeable.
    //
    // The REVEAL is a one-shot event, so it runs on the wall clock: Day 028
    // shipped a wipe built out of accumulated min(delta) and it turned into a
    // frame counter that never finished on a slow machine.
    //
    // The SCULPTURE runs on accumulated *clamped* delta, which is the opposite
    // choice, for the opposite reason. A velocity buffer holds the chord between
    // two poses, not the arc; let a frame take a second and the baton has spun
    // 230°, whose chord says almost nothing about how fast it is going. Clamping
    // the step means a slow machine shows the piece in slow motion instead of
    // showing it wrong — and the blur, which is scaled by this same dt, stays
    // exactly one shutter long at any frame rate.
    const dtScene = THREE.MathUtils.clamp(delta, DT_MIN, DT_MAX)
    if (freeze != null) s.sceneT = freeze
    else s.sceneT += dtScene
    const t = s.sceneT + (freeze != null ? 0 : phase)

    if (s.t0 < 0) s.t0 = st.clock.elapsedTime
    s.reveal = freeze != null ? 1 : Math.min(1, (st.clock.elapsedTime - s.t0) / 1.4)

    // ---- the sculpture turns ---------------------------------------------
    rig.step(t)
    scene.updateMatrixWorld(true)

    // ---- camera: a long, shallow drift ----------------------------------
    const px = st.pointer.x
    const py = st.pointer.y
    const tx = 0.2 + px * 0.42 + Math.sin(t * 0.081) * 0.20
    const ty = 1.20 + py * 0.13 + Math.sin(t * 0.061 + 1.3) * 0.05
    const tz = 8.3 + Math.cos(t * 0.049) * 0.26
    if (freeze != null) {
      camera.position.set(tx, ty, tz)
    } else {
      camera.position.x = THREE.MathUtils.damp(camera.position.x, tx, 1.8, dtScene)
      camera.position.y = THREE.MathUtils.damp(camera.position.y, ty, 1.8, dtScene)
      camera.position.z = THREE.MathUtils.damp(camera.position.z, tz, 1.8, dtScene)
    }
    camera.lookAt(0.55 + px * 0.07, 1.18 + py * 0.04, -0.3)
    camera.updateMatrixWorld()

    // ---- sub-pixel jitter (TAA) ------------------------------------------
    // The buffers must be jittered; the velocities must not be. So the clean
    // projection is kept for the velocity matrices, and the offset lives only in
    // the matrix the scene is actually drawn with.
    camera.updateProjectionMatrix()
    s.projClean.copy(camera.projectionMatrix)
    s.curVP.multiplyMatrices(s.projClean, camera.matrixWorldInverse)
    if (!s.primed) {
      s.prevVP.copy(s.curVP)
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
    // a shear of d in the z column shifts ndc by -d, so uv shifts by -d/2
    s.jitterUV.set(-dx * 0.5, -dy * 0.5)
    ssrMat.uniforms.uJitter.value.copy(s.jitterUV)
    compMat.uniforms.uJitter.value.copy(s.jitterUV)

    // ---- pass 1: G-buffer (one draw, two attachments) --------------------
    pushG()
    gl.setRenderTarget(targets.gbuf)
    gl.clear()
    gl.render(scene, camera)
    popG()

    // ---- pass 2: beauty (one sample) -------------------------------------
    gl.shadowMap.needsUpdate = true
    gl.setRenderTarget(targets.beauty)
    gl.clear()
    gl.render(scene, camera)

    // ---- pass 3: screen-space reflection ---------------------------------
    const read = targets.ssr[s.ping]
    const write = targets.ssr[1 - s.ping]
    ssrMat.uniforms.uGbuf.value = targets.gbuf.textures[0]
    ssrMat.uniforms.uMotion.value = targets.gbuf.textures[1]
    ssrMat.uniforms.uBeauty.value = targets.beauty.texture
    ssrMat.uniforms.uPrev.value = read.texture
    ssrMat.uniforms.uProj.value.copy(camera.projectionMatrix)
    ssrMat.uniforms.uCamWorld.value.copy(camera.matrixWorld)
    ssrMat.uniforms.uView.value.copy(camera.matrixWorldInverse)
    ssrMat.uniforms.uTime.value = t
    ssrMat.uniforms.uFrame.value = s.frame % 4096
    fs.mesh.material = ssrMat
    gl.setRenderTarget(write)
    gl.render(fs.scene, fs.cam)
    s.ping = 1 - s.ping

    // ---- pass 4: composite (linear HDR, no grade) ------------------------
    compMat.uniforms.uBeauty.value = targets.beauty.texture
    compMat.uniforms.uGbuf.value = targets.gbuf.textures[0]
    compMat.uniforms.uMotion.value = targets.gbuf.textures[1]
    compMat.uniforms.uRefl.value = write.texture
    compMat.uniforms.uCamWorld.value.copy(camera.matrixWorld)
    compMat.uniforms.uView.value.copy(camera.matrixWorldInverse)
    compMat.uniforms.uTime.value = t
    fs.mesh.material = compMat
    gl.setRenderTarget(targets.hdr)
    gl.render(fs.scene, fs.cam)

    // ---- pass 5: TAA resolve ---------------------------------------------
    const tRead = targets.taa[s.tPing]
    const tWrite = targets.taa[1 - s.tPing]
    taaMat.uniforms.uCur.value = targets.hdr.texture
    taaMat.uniforms.uHist.value = tRead.texture
    taaMat.uniforms.uMotion.value = targets.gbuf.textures[1]
    taaMat.uniforms.uGbuf.value = targets.gbuf.textures[0]
    taaMat.uniforms.uValid.value = s.warm > 1 ? 1 : 0
    fs.mesh.material = taaMat
    gl.setRenderTarget(tWrite)
    gl.render(fs.scene, fs.cam)
    s.tPing = 1 - s.tPing
    s.warm++

    // ---- pass 6: present -------------------------------------------------
    presentMat.uniforms.uColor.value = tWrite.texture
    presentMat.uniforms.uRaw.value = targets.hdr.texture
    presentMat.uniforms.uBeauty.value = targets.beauty.texture
    presentMat.uniforms.uGbuf.value = targets.gbuf.textures[0]
    presentMat.uniforms.uMotion.value = targets.gbuf.textures[1]
    presentMat.uniforms.uRefl.value = write.texture
    // uv-per-frame becomes uv-per-shutter, so the smear is the same length
    // whatever the machine is doing
    presentMat.uniforms.uVelScale.value = SHUTTER / dtScene
    presentMat.uniforms.uTime.value = t
    presentMat.uniforms.uFrame.value = s.frame % 4096
    presentMat.uniforms.uMode.value = mode
    presentMat.uniforms.uReveal.value = s.reveal
    fs.mesh.material = presentMat
    gl.setRenderTarget(null)
    gl.render(fs.scene, fs.cam)

    // ---- this frame becomes next frame's past ----------------------------
    s.prevVP.copy(s.curVP)
    remember()
  }, 1)

  return null
}
