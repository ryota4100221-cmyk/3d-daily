import { useMemo, useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import {
  field, buildStroke, strokeVert, strokeFrag, toneVert, toneFrag,
  ROW_GAP, WAVELEN, LINE_W,
} from './rig.js'

const FIXED_T = (() => {
  const v = new URLSearchParams(window.location.search).get('t')
  return v == null ? null : Number(v)
})()
const TONE_H = 220 // texels across the field height
const HEAD_HALF_H = 1.45 // head units visible above/below the field centre

export default function Scene({ pointer, onStats }) {
  const { size, gl } = useThree()
  const f = useMemo(() => field(size.width, size.height), [size.width, size.height])

  const stroke = useMemo(() => {
    const s = buildStroke(f)
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(s.base, 3))
    g.setAttribute('aNext', new THREE.BufferAttribute(s.next, 3))
    g.setAttribute('aSide', new THREE.BufferAttribute(s.side, 1))
    g.setAttribute('aRow', new THREE.BufferAttribute(s.onRow, 1))
    g.setIndex(new THREE.BufferAttribute(s.index, 1))
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5)
    return { g, rows: s.rows, vertices: s.vertices, length: s.length }
  }, [f])
  useEffect(() => () => stroke.g.dispose(), [stroke])

  const fw = f.right - f.left
  const fh = f.top - f.bottom

  const tone = useMemo(() => {
    const w = Math.max(8, Math.round((TONE_H * fw) / fh))
    const rt = new THREE.WebGLRenderTarget(w, TONE_H, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
    })
    const mat = new THREE.ShaderMaterial({
      vertexShader: toneVert,
      fragmentShader: toneFrag,
      uniforms: {
        uAspect: { value: new THREE.Vector2((HEAD_HALF_H * fw) / fh, HEAD_HALF_H) },
        uYaw: { value: 0 },
        uPitch: { value: 0 },
        uLight: { value: new THREE.Vector3(0, 0, 1) },
        uFloor: { value: 0.26 },
      },
      depthTest: false,
      depthWrite: false,
    })
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat)
    quad.frustumCulled = false
    const scene = new THREE.Scene()
    scene.add(quad)
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
    // the read-back used for the HUD: how much of the field the head occupies
    const px = new Uint8Array(w * TONE_H * 4)
    return { rt, mat, scene, cam, w, px }
  }, [fw, fh])
  useEffect(() => () => { tone.rt.dispose(); tone.mat.dispose() }, [tone])

  const strokeMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: strokeVert,
        fragmentShader: strokeFrag,
        uniforms: {
          uTone: { value: null },
          uField: { value: new THREE.Vector4() },
          uAmp: { value: ROW_GAP * 0.47 },
          uK: { value: (2 * Math.PI) / WAVELEN },
          uPhase: { value: 0 },
          uW: { value: LINE_W },
          uInk: { value: new THREE.Color('#ffffff') },
        },
        side: THREE.DoubleSide,
        depthTest: false,
      }),
    []
  )

  const lightV = useRef(new THREE.Vector3())
  const smooth = useRef({ az: -0.85, el: 0.45 })
  const statT = useRef(1)

  useFrame((state, dt) => {
    const t = FIXED_T ?? state.clock.elapsedTime
    const u = tone.mat.uniforms
    // the head turns slowly a little either side of profile
    u.uYaw.value = 0.30 * Math.sin(t * 0.21) + 0.05
    u.uPitch.value = 0.06 * Math.sin(t * 0.17 + 1.0)
    // light: pointer x → azimuth, y → elevation; idle = slow orbit
    const p = pointer.current
    const tgtAz = p.active ? p.x * 2.4 : 0.7 * Math.sin(t * 0.13) - 0.85
    const tgtEl = p.active ? p.y * 1.1 : 0.45 + 0.2 * Math.sin(t * 0.09)
    const k = 1 - Math.exp(-dt * 4)
    smooth.current.az += (tgtAz - smooth.current.az) * k
    smooth.current.el += (tgtEl - smooth.current.el) * k
    const { az, el } = smooth.current
    // az = 0 → light from the viewer; negative → from the face side (−x)
    lightV.current.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).normalize()
    u.uLight.value.copy(lightV.current)

    gl.setRenderTarget(tone.rt)
    gl.render(tone.scene, tone.cam)
    gl.setRenderTarget(null)

    const su = strokeMat.uniforms
    su.uTone.value = tone.rt.texture
    su.uField.value.set(f.left, f.bottom, fw, fh)
    su.uPhase.value = -t * 1.6

    gl.render(state.scene, state.camera)

    statT.current += dt
    if (onStats && statT.current > 0.5) {
      statT.current = 0
      gl.readRenderTargetPixels(tone.rt, 0, 0, tone.w, TONE_H, tone.px)
      let on = 0
      let sum = 0
      const n = tone.w * TONE_H
      for (let i = 0; i < n; i++) {
        const v = tone.px[i * 4] / 255
        if (v > 0.004) { on++; sum += v }
      }
      onStats({
        rows: stroke.rows,
        vertices: stroke.vertices,
        length: stroke.length,
        cover: on / n,
        meanTone: on ? sum / on : 0,
        az: (az * 180) / Math.PI,
        el: (el * 180) / Math.PI,
        yaw: (u.uYaw.value * 180) / Math.PI,
      })
    }
  }, 1)

  return <mesh geometry={stroke.g} material={strokeMat} frustumCulled={false} />
}
