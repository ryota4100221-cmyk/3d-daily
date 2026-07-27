import { useMemo, useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { makeGBufferMaterial, makeAOMaterial, makeCompositeMaterial } from './passes.js'

/**
 * Day 028 takes the renderer away from R3F.
 *
 * `useFrame(cb, 1)` (priority > 0) switches off R3F's automatic render, so the
 * four passes below are the *entire* frame:
 *
 *   1. G-buffer  — scene.overrideMaterial, view normals + linear depth
 *   2. Beauty    — the lit scene (MSAA) into a float target, no tone mapping
 *   3. AO        — SSAO from the G-buffer, accumulated into a ping-pong buffer
 *   4. Composite — the only pass that writes the screen
 *
 * Every earlier day handed three.js a scene and let it draw. This one decides
 * what a frame *is*.
 */
export default function Pipeline({ mode = 0, onStats }) {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)

  const gbufMat = useMemo(() => makeGBufferMaterial(camera.far), [camera.far])
  const aoMat = useMemo(() => makeAOMaterial(), [])
  const compMat = useMemo(() => makeCompositeMaterial(), [])

  // full-screen triangle-ish quad in its own micro scene
  const fs = useMemo(() => {
    const s = new THREE.Scene()
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), aoMat)
    mesh.frustumCulled = false
    s.add(mesh)
    return { scene: s, cam, mesh }
  }, [aoMat])

  const targets = useMemo(() => {
    const common = {
      type: THREE.HalfFloatType,
      depthBuffer: true,
      stencilBuffer: false,
      colorSpace: THREE.LinearSRGBColorSpace,
    }
    // the G-buffer must NOT be multisampled: resolving would average packed
    // depths across silhouettes and poison the reconstruction
    const gbuf = new THREE.WebGLRenderTarget(2, 2, {
      ...common,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
    })
    const beauty = new THREE.WebGLRenderTarget(2, 2, {
      ...common,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      samples: 4,
    })
    const ao = [0, 1].map(
      () =>
        new THREE.WebGLRenderTarget(2, 2, {
          type: THREE.HalfFloatType,
          depthBuffer: false,
          stencilBuffer: false,
          minFilter: THREE.LinearFilter,
          magFilter: THREE.LinearFilter,
        })
    )
    return { gbuf, beauty, ao }
  }, [])

  useEffect(
    () => () => {
      targets.gbuf.dispose()
      targets.beauty.dispose()
      targets.ao.forEach((t) => t.dispose())
      gbufMat.dispose()
      aoMat.dispose()
      compMat.dispose()
      fs.mesh.geometry.dispose()
    },
    [targets, gbufMat, aoMat, compMat, fs]
  )

  const state = useRef({ ping: 0, frame: 0, t0: -1, reveal: 0, shadowFrames: 6 })

  // renderer setup + resize
  useEffect(() => {
    gl.setClearColor(0x000000, 0)
    gl.shadowMap.type = THREE.PCFSoftShadowMap
    gl.shadowMap.autoUpdate = false
    state.current.shadowFrames = 6
  }, [gl])

  useEffect(() => {
    const dpr = gl.getPixelRatio()
    const w = Math.max(2, Math.floor(size.width * dpr))
    const h = Math.max(2, Math.floor(size.height * dpr))
    targets.gbuf.setSize(w, h)
    targets.beauty.setSize(w, h)
    targets.ao.forEach((t) => t.setSize(w, h))

    const aspect = size.width / Math.max(1, size.height)
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov) * 0.5)
    for (const m of [aoMat, compMat]) {
      m.uniforms.uFar.value = camera.far
      m.uniforms.uTanHalf.value = tanHalf
      m.uniforms.uAspect.value = aspect
    }
    compMat.uniforms.uTexel.value.set(1 / w, 1 / h)

    // history is meaningless at a new resolution
    const prev = gl.getRenderTarget()
    targets.ao.forEach((t) => {
      gl.setRenderTarget(t)
      gl.clear(true, false, false)
    })
    gl.setRenderTarget(prev)
    state.current.shadowFrames = Math.max(state.current.shadowFrames, 2)
  }, [gl, size, targets, aoMat, compMat, camera])

  useFrame((st, delta) => {
    const s = state.current
    const dt = Math.min(delta, 1 / 30)
    s.frame++

    // ---- camera: a slow breath plus pointer parallax --------------------
    const t = st.clock.elapsedTime
    // the opening wipe runs on wall-clock, not on accumulated frame deltas —
    // on a slow device the frame-counted version never finished
    if (s.t0 < 0) s.t0 = t
    s.reveal = Math.min(1, (t - s.t0) / 1.15)
    const px = st.pointer.x
    const py = st.pointer.y
    const tx = -0.15 + px * 0.42 + Math.sin(t * 0.11) * 0.09
    const ty = 1.34 + py * 0.20 + Math.sin(t * 0.083 + 1.7) * 0.05
    const tz = 5.45 + Math.cos(t * 0.07) * 0.16
    camera.position.x = THREE.MathUtils.damp(camera.position.x, tx, 2.2, dt)
    camera.position.y = THREE.MathUtils.damp(camera.position.y, ty, 2.2, dt)
    camera.position.z = THREE.MathUtils.damp(camera.position.z, tz, 2.2, dt)
    camera.lookAt(-0.32 + px * 0.06, 0.78 + py * 0.03, 0)
    camera.updateMatrixWorld()

    // the key light never moves, so the shadow map is drawn a handful of times
    // and then frozen — it would otherwise be rebuilt twice per frame
    if (s.shadowFrames > 0) {
      gl.shadowMap.needsUpdate = true
      s.shadowFrames--
    }

    const sky = scene.getObjectByName('sky-quad')

    // ---- pass 1: G-buffer ----------------------------------------------
    if (sky) sky.visible = false
    scene.overrideMaterial = gbufMat
    gl.setRenderTarget(targets.gbuf)
    gl.clear()
    gl.render(scene, camera)
    scene.overrideMaterial = null
    if (sky) sky.visible = true

    // ---- pass 2: beauty --------------------------------------------------
    gl.setRenderTarget(targets.beauty)
    gl.clear()
    gl.render(scene, camera)

    // ---- pass 3: SSAO + temporal accumulation ---------------------------
    const read = targets.ao[s.ping]
    const write = targets.ao[1 - s.ping]
    aoMat.uniforms.uGbuf.value = targets.gbuf.texture
    aoMat.uniforms.uPrev.value = read.texture
    aoMat.uniforms.uProj.value.copy(camera.projectionMatrix)
    aoMat.uniforms.uFrame.value = s.frame
    fs.mesh.material = aoMat
    gl.setRenderTarget(write)
    gl.render(fs.scene, fs.cam)
    s.ping = 1 - s.ping

    // ---- pass 4: composite to screen ------------------------------------
    compMat.uniforms.uBeauty.value = targets.beauty.texture
    compMat.uniforms.uGbuf.value = targets.gbuf.texture
    compMat.uniforms.uAO.value = write.texture
    compMat.uniforms.uTime.value = t
    compMat.uniforms.uMode.value = mode
    compMat.uniforms.uReveal.value = s.reveal
    fs.mesh.material = compMat
    gl.setRenderTarget(null)
    gl.render(fs.scene, fs.cam)

    if (onStats && s.frame % 12 === 0) onStats(s.frame)
  }, 1)

  return null
}
