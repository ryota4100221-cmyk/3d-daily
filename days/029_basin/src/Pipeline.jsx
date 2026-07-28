import { useMemo, useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { makeGBufferMaterial, makeSSRMaterial, makeCompositeMaterial } from './passes.js'

/**
 * Four passes, and R3F draws none of them.
 *
 *   1. G-buffer   ONE scene draw into TWO attachments (WebGL2 MRT, GLSL3):
 *                 normals + linear depth, and screen-space velocity + material id
 *   2. Beauty     the lit scene into a half-float target, no tone mapping
 *   3. Reflection a screen-space ray march, one jittered ray per pixel, blended
 *                 into last frame's buffer *through the velocity* — so the
 *                 history survives a moving camera instead of being thrown away
 *   4. Composite  the only pass that writes the canvas
 *
 * Day 028 built the first three-pass renderer here; the two things it could not
 * do were "one draw, many buffers" and "keep history while the camera moves".
 * Those are exactly what today adds.
 */
export default function Pipeline({ mode = 0 }) {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)

  const gSolid = useMemo(() => makeGBufferMaterial(camera.far, 0.0), [camera.far])
  const gWater = useMemo(() => makeGBufferMaterial(camera.far, 1.0), [camera.far])
  const ssrMat = useMemo(() => makeSSRMaterial(), [])
  const compMat = useMemo(() => makeCompositeMaterial(), [])

  const fs = useMemo(() => {
    const s = new THREE.Scene()
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), ssrMat)
    mesh.frustumCulled = false
    s.add(mesh)
    return { scene: s, cam, mesh }
  }, [ssrMat])

  const targets = useMemo(() => {
    // The G-buffer is one render target with TWO colour attachments. Both are
    // point-sampled and un-multisampled: resolving MSAA across a silhouette
    // would average packed depths and velocities into values that describe no
    // surface at all.
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

    const beauty = new THREE.WebGLRenderTarget(2, 2, {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
      stencilBuffer: false,
      samples: 4,
      colorSpace: THREE.LinearSRGBColorSpace,
    })

    const ssr = [0, 1].map(
      () =>
        new THREE.WebGLRenderTarget(2, 2, {
          type: THREE.HalfFloatType,
          minFilter: THREE.LinearFilter,
          magFilter: THREE.LinearFilter,
          depthBuffer: false,
          stencilBuffer: false,
        })
    )
    return { gbuf, beauty, ssr }
  }, [])

  useEffect(
    () => () => {
      targets.gbuf.dispose()
      targets.beauty.dispose()
      targets.ssr.forEach((t) => t.dispose())
      gSolid.dispose()
      gWater.dispose()
      ssrMat.dispose()
      compMat.dispose()
      fs.mesh.geometry.dispose()
    },
    [targets, gSolid, gWater, ssrMat, compMat, fs]
  )

  const state = useRef({
    ping: 0,
    frame: 0,
    t0: -1,
    reveal: 0,
    shadowFrames: 5,
    prevVP: new THREE.Matrix4(),
    primed: false,
    swapped: [],
  })

  useEffect(() => {
    gl.setClearColor(0x000000, 0)
    gl.shadowMap.type = THREE.PCFSoftShadowMap
    gl.shadowMap.autoUpdate = false
    state.current.shadowFrames = 5
  }, [gl])

  useEffect(() => {
    const dpr = gl.getPixelRatio()
    const w = Math.max(2, Math.floor(size.width * dpr))
    const h = Math.max(2, Math.floor(size.height * dpr))
    targets.gbuf.setSize(w, h)
    targets.beauty.setSize(w, h)
    targets.ssr.forEach((t) => t.setSize(w, h))

    const aspect = size.width / Math.max(1, size.height)
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov) * 0.5)
    for (const m of [ssrMat, compMat]) {
      m.uniforms.uFar.value = camera.far
      m.uniforms.uTanHalf.value = tanHalf
      m.uniforms.uAspect.value = aspect
    }
    compMat.uniforms.uTexel.value.set(1 / w, 1 / h)

    // history describes a resolution that no longer exists
    const prev = gl.getRenderTarget()
    targets.ssr.forEach((t) => {
      gl.setRenderTarget(t)
      gl.clear(true, false, false)
    })
    gl.setRenderTarget(prev)
    state.current.shadowFrames = Math.max(state.current.shadowFrames, 2)
  }, [gl, size, targets, ssrMat, compMat, camera])

  // Swapping materials by hand rather than using scene.overrideMaterial: the
  // override is a single material for the whole scene, and the whole point of
  // the second attachment is that the basin can say "I am water" while the
  // porcelain says "I am not".
  const pushG = () => {
    const list = state.current.swapped
    list.length = 0
    scene.traverse((o) => {
      if (!o.isMesh || !o.visible) return
      list.push(o, o.material)
      o.material = o.userData.water ? gWater : gSolid
    })
  }
  const popG = () => {
    const list = state.current.swapped
    for (let i = 0; i < list.length; i += 2) list[i].material = list[i + 1]
    list.length = 0
  }

  useFrame((st, delta) => {
    const s = state.current
    const dt = Math.min(delta, 1 / 30)
    s.frame++

    const t = st.clock.elapsedTime
    if (s.t0 < 0) s.t0 = t
    // wall-clock, never accumulated frame deltas (Day 028's wipe never finished
    // on a slow device because it was secretly counting frames)
    s.reveal = Math.min(1, (t - s.t0) / 1.5)

    // ---- camera: a long, shallow drift ----------------------------------
    const px = st.pointer.x
    const py = st.pointer.y
    const tx = px * 0.38 + Math.sin(t * 0.087) * 0.22
    const ty = 0.62 + py * 0.11 + Math.sin(t * 0.063 + 1.3) * 0.045
    const tz = 8.4 + Math.cos(t * 0.052) * 0.28
    camera.position.x = THREE.MathUtils.damp(camera.position.x, tx, 1.8, dt)
    camera.position.y = THREE.MathUtils.damp(camera.position.y, ty, 1.8, dt)
    camera.position.z = THREE.MathUtils.damp(camera.position.z, tz, 1.8, dt)
    camera.lookAt(px * 0.06, 0.74 + py * 0.03, -0.6)
    camera.updateMatrixWorld()

    // on the very first frame there is no previous camera; using the identity
    // would paint the whole screen with a bogus velocity
    if (!s.primed) {
      s.prevVP.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
      s.primed = true
    }

    // ---- pass 1: G-buffer (one draw, two attachments) --------------------
    gSolid.uniforms.uPrevViewProj.value.copy(s.prevVP)
    gWater.uniforms.uPrevViewProj.value.copy(s.prevVP)
    pushG()
    gl.setRenderTarget(targets.gbuf)
    gl.clear()
    gl.render(scene, camera)
    popG()

    // ---- pass 2: beauty ---------------------------------------------------
    // the key light never moves, so the shadow map is built a handful of times
    // and then frozen instead of being rebuilt on every pass
    if (s.shadowFrames > 0) {
      gl.shadowMap.needsUpdate = true
      s.shadowFrames--
    }
    gl.setRenderTarget(targets.beauty)
    gl.clear()
    gl.render(scene, camera)

    // ---- pass 3: screen-space reflection + reprojection -------------------
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

    // ---- pass 4: composite -----------------------------------------------
    compMat.uniforms.uBeauty.value = targets.beauty.texture
    compMat.uniforms.uGbuf.value = targets.gbuf.textures[0]
    compMat.uniforms.uMotion.value = targets.gbuf.textures[1]
    compMat.uniforms.uRefl.value = write.texture
    compMat.uniforms.uCamWorld.value.copy(camera.matrixWorld)
    compMat.uniforms.uView.value.copy(camera.matrixWorldInverse)
    compMat.uniforms.uTime.value = t
    compMat.uniforms.uMode.value = mode
    compMat.uniforms.uReveal.value = s.reveal
    fs.mesh.material = compMat
    gl.setRenderTarget(null)
    gl.render(fs.scene, fs.cam)

    // this frame becomes next frame's past
    s.prevVP.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
  }, 1)

  return null
}
