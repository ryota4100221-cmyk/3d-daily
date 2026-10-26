import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { applyBaked } from './baked.js'

const BASE = import.meta.env.BASE_URL
// 面ごとの下書きの濃さ（模型が立ち上がりきった状態で）。奥ほど鉛筆が残る
const INK = { slabBack: 0.6, slab: 0.1, return: 0.32, back: 1.0, atrium: 1.0, floor: 0.7, ground: 0.55, canopy: 0.3 }
const LIFT = { slabBack: 0.8, back: 0.22, atrium: 0.12, return: 0.1 }
const liftOf = (name) => LIFT[Object.keys(LIFT).find((k) => name.startsWith(k))] ?? 0
const inkOf = (name) => INK[Object.keys(INK).find((k) => name.startsWith(k))] ?? 0.2

export default function Scene({ sketch, state }) {
  const { scene, camera, gl } = useThree()
  const root = useRef(new THREE.Group())
  const U = useMemo(() => ({
    uSketch: { value: null },
    uRes: { value: new THREE.Vector2(1440, 900) },
    uModel: { value: 0 },
    uPaper: { value: new THREE.Color().setRGB(0xf8 / 255, 0xf2 / 255, 0xea / 255, THREE.LinearSRGBColorSpace) },   // 書き出し後（sRGB）の段で混ぜるので変換しない
  }), [])

  useEffect(() => {
    camera.position.set(0, 0, 18.05)
    camera.lookAt(0, 0, 0)
    const tex = new THREE.CanvasTexture(sketch)
    tex.colorSpace = THREE.NoColorSpace
    tex.generateMipmaps = false
    tex.minFilter = THREE.LinearFilter
    U.uSketch.value = tex
    let dead = false
    ;(async () => {
      const manifest = await (await fetch(`${BASE}lm/manifest.json`)).json()
      const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(`${BASE}scene.glb`)
      if (dead) return
      const baked = applyBaked(gltf.scene, manifest, { base: BASE, envIntensity: 0 })
      baked.gain.value = state.gain
      state.baked = baked
      gltf.scene.traverse((o) => {
        if (!o.isMesh) return
        const name = manifest.objects[o.name] ? o.name : o.parent?.name || o.name
        const m = o.material
        const prev = m.onBeforeCompile
        const uInk = { value: inkOf(name) }, uLift = { value: liftOf(name) }
        m.onBeforeCompile = (sh, r) => {
          prev?.(sh, r)
          Object.assign(sh.uniforms, U, { uInk, uLift })
          sh.fragmentShader = sh.fragmentShader
            .replace('#include <common>', '#include <common>\nuniform sampler2D uSketch;\nuniform vec2 uRes;\nuniform float uModel;\nuniform vec3 uPaper;\nuniform float uInk;\nuniform float uLift;')
            .replace('#include <dithering_fragment>', `
              vec2 suv = gl_FragCoord.xy / uRes;
              float ink = texture2D( uSketch, suv ).r;
              vec3 col = mix( uPaper, mix( gl_FragColor.rgb, uPaper, uLift ), uModel );
              col *= mix( 1.0, ink, mix( 1.0, uInk, uModel ) );
              gl_FragColor.rgb = col;
              #include <dithering_fragment>`)
        }
        m.customProgramCacheKey = () => 'arbor-' + (prev ? 'b' : 'p')
        m.needsUpdate = true
      })
      root.current.add(gltf.scene)
    })()
    return () => { dead = true }
  }, [])

  useFrame(() => {
    gl.getDrawingBufferSize(U.uRes.value)
    U.uModel.value = state.model
    if (state.baked) state.baked.gain.value = state.gain
  })

  return <primitive object={root.current} />
}
