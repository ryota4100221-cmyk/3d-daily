import { useMemo, useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import {
  makeLightDepthMaterial,
  makeGBufferMaterial,
  makeVolumetricMaterial,
  makeCompositeMaterial,
  makeTaaMaterial,
  makePresentMaterial,
} from './passes.js'
import { makeNoiseVolume } from './noise.js'
import { LIGHT, lightPosition } from './palette.js'

/**
 * Seven passes now, and R3F still draws none of them.
 *
 *   0. Light depth  the scene from the light's point of view, as linear
 *                   distance. New today, and the reason the next pass exists.
 *   1. G-buffer     one scene draw into two attachments: normal + linear depth,
 *                   and screen velocity + material id (Day 029/030).
 *   2. Beauty       the lit scene, half float, ONE sample. No MSAA.
 *   3. Volumetric   HALF RESOLUTION. Forty-eight steps of single scattering,
 *                   dithered, reprojected through the scattering centroid.
 *   4. Composite    depth-aware upsample, then beauty·T + in-scatter.
 *   5. TAA          reproject, clip, blend. Eight sub-pixel positions become one.
 *   6. Present      motion blur along the velocity buffer, then the grade.
 *
 * The shape of the frame is Day 030's. What is new is that two of these passes
 * are about the medium rather than the surfaces, and that the pipeline now
 * renders the scene from two different points of view in the same frame.
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

export default function Pipeline({ rig, mode = 0, freeze = null, phase = 0 }) {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)

  const lightMat = useMemo(() => makeLightDepthMaterial(), [])
  const noise = useMemo(() => makeNoiseVolume(32), [])
  const volMat = useMemo(() => {
    const m = makeVolumetricMaterial()
    m.uniforms.uNoise.value = noise
    return m
  }, [noise])
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
      samples: 0,
      colorSpace: THREE.LinearSRGBColorSpace,
    })

    // The light-space depth map. Square, because the light's frustum is square,
    // and independent of the window: a beam should not get sharper when the
    // browser is made wider.
    const light = new THREE.WebGLRenderTarget(LIGHT.size, LIGHT.size, {
      type: THREE.HalfFloatType,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: true,
      stencilBuffer: false,
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

    // The volumetric ping-pong is MRT too: in-scatter + transmittance in one
    // attachment, and the two depths the next frame needs in the other.
    // LinearFilter, because attachment 0 is read twice with two different
    // intentions — as a history, at arbitrary reprojected uvs, where bilinear is
    // wanted; and as an upsample source, at exact texel centres, where bilinear
    // is the identity.
    const vol = () =>
      new THREE.WebGLRenderTarget(2, 2, {
        count: 2,
        type: THREE.HalfFloatType,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        depthBuffer: false,
        stencilBuffer: false,
        colorSpace: THREE.LinearSRGBColorSpace,
      })

    return { gbuf, beauty, light, vol: [vol(), vol()], hdr: plain(), taa: [plain(), plain()] }
  }, [])

  // one G-buffer material per mesh — "previous model matrix" is a per-object
  // fact, and a shared material can only carry one of them
  const reg = useRef(new Map())

  useEffect(
    () => () => {
      targets.gbuf.dispose()
      targets.beauty.dispose()
      targets.light.dispose()
      targets.hdr.dispose()
      targets.vol.forEach((t) => t.dispose())
      targets.taa.forEach((t) => t.dispose())
      reg.current.forEach((e) => e.gmat.dispose())
      reg.current.clear()
      noise.dispose()
      lightMat.dispose()
      volMat.dispose()
      compMat.dispose()
      taaMat.dispose()
      presentMat.dispose()
      fs.mesh.geometry.dispose()
    },
    [targets, noise, lightMat, volMat, compMat, taaMat, presentMat, fs]
  )

  const state = useRef({
    vPing: 0,
    tPing: 0,
    frame: 0,
    warm: 0,
    vWarm: 0,
    t0: -1,
    sceneT: 0,
    reveal: 0,
    prevVP: new THREE.Matrix4(),
    curVP: new THREE.Matrix4(),
    prevView: new THREE.Matrix4(),
    projClean: new THREE.Matrix4(),
    jitterUV: new THREE.Vector2(),
    swapped: [],
    primed: false,
    clear: new THREE.Color(),
  })

  useEffect(() => {
    gl.setClearColor(0x000000, 0)
    gl.shadowMap.type = THREE.PCFSoftShadowMap
    gl.shadowMap.autoUpdate = false
  }, [gl])

  // The light camera's matrices never change — nothing about the light moves —
  // so they are uploaded once rather than every frame.
  useEffect(() => {
    lightCam.updateMatrixWorld(true)
    lightCam.updateProjectionMatrix()
    volMat.uniforms.uLightView.value.copy(lightCam.matrixWorldInverse)
    volMat.uniforms.uLightVP.value.multiplyMatrices(
      lightCam.projectionMatrix,
      lightCam.matrixWorldInverse
    )
  }, [lightCam, volMat])

  useEffect(() => {
    const dpr = gl.getPixelRatio()
    const w = Math.max(2, Math.floor(size.width * dpr))
    const h = Math.max(2, Math.floor(size.height * dpr))
    const hw = Math.max(1, Math.floor(w / 2))
    const hh = Math.max(1, Math.floor(h / 2))

    targets.gbuf.setSize(w, h)
    targets.beauty.setSize(w, h)
    targets.hdr.setSize(w, h)
    targets.taa.forEach((t) => t.setSize(w, h))
    targets.vol.forEach((t) => t.setSize(hw, hh))

    const aspect = size.width / Math.max(1, size.height)
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov) * 0.5)
    for (const m of [volMat, compMat]) {
      m.uniforms.uFar.value = camera.far
      m.uniforms.uTanHalf.value = tanHalf
      m.uniforms.uAspect.value = aspect
    }
    taaMat.uniforms.uFar.value = camera.far
    taaMat.uniforms.uTexel.value.set(1 / w, 1 / h)
    taaMat.uniforms.uRes.value.set(w, h)
    compMat.uniforms.uHalfRes.value.set(hw, hh)
    presentMat.uniforms.uRes.value.set(w, h)
    presentMat.uniforms.uMaxBlur.value = 0.05 * h

    const prev = gl.getRenderTarget()
    for (const t of [...targets.vol, ...targets.taa]) {
      gl.setRenderTarget(t)
      gl.clear(true, false, false)
    }
    gl.setRenderTarget(prev)
    state.current.warm = 0
    state.current.vWarm = 0
  }, [gl, size, targets, volMat, compMat, taaMat, presentMat, camera])

  // Material swaps by hand rather than scene.overrideMaterial, for two reasons:
  // the G-buffer needs a different previous matrix per object, and the light
  // depth pass needs to *skip* objects. An override renders everything, and
  // "everything" here includes a backdrop standing between the light and the
  // entire hall.
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
      reg.current.set(o, e)
    }
    e.gmat.uniforms.uPrevModel.value.copy(e.prev)
    e.gmat.uniforms.uPrevViewProj.value.copy(s.prevVP)
    e.gmat.uniforms.uCurViewProj.value.copy(s.curVP)
    return e.gmat
  }

  // castShadow is the scene's own statement about whether a thing blocks light.
  // The floor does not (nothing in this piece is below it), the backdrop must
  // not, and 220 grains of dust would only add noise to the map.
  const lPick = (o) => (o.castShadow ? lightMat : null)

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

    // Two clocks (Day 030): the reveal is a one-shot event and runs on the wall
    // clock; the sculpture runs on accumulated *clamped* delta, so a slow machine
    // sees the piece in slow motion rather than seeing it wrong.
    const dtScene = THREE.MathUtils.clamp(delta, DT_MIN, DT_MAX)
    if (freeze != null) s.sceneT = freeze
    else s.sceneT += dtScene
    const t = s.sceneT + (freeze != null ? 0 : phase)

    if (s.t0 < 0) s.t0 = st.clock.elapsedTime
    s.reveal = freeze != null ? 1 : Math.min(1, (st.clock.elapsedTime - s.t0) / 1.6)

    rig.step(t)
    scene.updateMatrixWorld(true)

    // ---- camera: a long, shallow drift ------------------------------------
    const px = st.pointer.x
    const py = st.pointer.y
    const tx = 0.35 + px * 0.50 + Math.sin(t * 0.073) * 0.26
    const ty = 2.10 + py * 0.18 + Math.sin(t * 0.057 + 1.3) * 0.07
    const tz = 13.6 + Math.cos(t * 0.045) * 0.34
    if (freeze != null) {
      camera.position.set(tx, ty, tz)
    } else {
      camera.position.x = THREE.MathUtils.damp(camera.position.x, tx, 1.8, dtScene)
      camera.position.y = THREE.MathUtils.damp(camera.position.y, ty, 1.8, dtScene)
      camera.position.z = THREE.MathUtils.damp(camera.position.z, tz, 1.8, dtScene)
    }
    camera.lookAt(1.40 + px * 0.08, 1.52 + py * 0.05, -0.35)
    camera.updateMatrixWorld()

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
    volMat.uniforms.uJitter.value.copy(s.jitterUV)
    compMat.uniforms.uJitter.value.copy(s.jitterUV)

    // ---- pass 0: light-space depth ----------------------------------------
    // White means "nothing in the way": every texel outside a silhouette has to
    // report the far plane, or the whole hall starts in shadow.
    gl.getClearColor(s.clear)
    const alpha = gl.getClearAlpha()
    gl.setClearColor(0xffffff, 1)
    push(lPick)
    gl.setRenderTarget(targets.light)
    gl.clear()
    gl.render(scene, lightCam)
    pop()
    gl.setClearColor(s.clear, alpha)

    // ---- pass 1: G-buffer (one draw, two attachments) ---------------------
    push(gPick)
    gl.setRenderTarget(targets.gbuf)
    gl.clear()
    gl.render(scene, camera)
    pop()

    // ---- pass 2: beauty (one sample) --------------------------------------
    gl.shadowMap.needsUpdate = true
    gl.setRenderTarget(targets.beauty)
    gl.clear()
    gl.render(scene, camera)

    // ---- pass 3: volumetric scattering, half resolution --------------------
    const vRead = targets.vol[s.vPing]
    const vWrite = targets.vol[1 - s.vPing]
    volMat.uniforms.uGbuf.value = targets.gbuf.textures[0]
    volMat.uniforms.uLightDepth.value = targets.light.texture
    volMat.uniforms.uHist.value = vRead.textures[0]
    volMat.uniforms.uHistAux.value = vRead.textures[1]
    volMat.uniforms.uCamWorld.value.copy(camera.matrixWorld)
    volMat.uniforms.uView.value.copy(camera.matrixWorldInverse)
    volMat.uniforms.uPrevViewProj.value.copy(s.prevVP)
    volMat.uniforms.uPrevView.value.copy(s.prevView)
    volMat.uniforms.uTime.value = t
    volMat.uniforms.uFrame.value = s.frame % 4096
    volMat.uniforms.uValid.value = s.vWarm > 1 ? 1 : 0
    fs.mesh.material = volMat
    gl.setRenderTarget(vWrite)
    gl.render(fs.scene, fs.cam)
    s.vPing = 1 - s.vPing
    s.vWarm++

    // ---- pass 4: composite (linear HDR, no grade) -------------------------
    compMat.uniforms.uBeauty.value = targets.beauty.texture
    compMat.uniforms.uGbuf.value = targets.gbuf.textures[0]
    compMat.uniforms.uVol.value = vWrite.textures[0]
    compMat.uniforms.uVolAux.value = vWrite.textures[1]
    fs.mesh.material = compMat
    gl.setRenderTarget(targets.hdr)
    gl.render(fs.scene, fs.cam)

    // ---- pass 5: TAA resolve ----------------------------------------------
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

    // ---- pass 6: present ---------------------------------------------------
    presentMat.uniforms.uColor.value = tWrite.texture
    presentMat.uniforms.uRaw.value = targets.hdr.texture
    presentMat.uniforms.uBeauty.value = targets.beauty.texture
    presentMat.uniforms.uGbuf.value = targets.gbuf.textures[0]
    presentMat.uniforms.uMotion.value = targets.gbuf.textures[1]
    presentMat.uniforms.uVol.value = vWrite.textures[0]
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
