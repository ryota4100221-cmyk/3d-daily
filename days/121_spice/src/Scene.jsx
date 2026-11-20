import React, { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { EffectComposer, DepthOfField } from '@react-three/postprocessing'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { makeBody, makeGlasses, makeBandana, makeNut } from './snack.js'

const BASE = import.meta.env.BASE_URL
const CAMZ = 10
const TANH = Math.tan((30 / 2) * Math.PI / 180)
// ref の画面座標（1440×900）→ 奥行き z の面の上の点
export const pxScale = (z) => (2 * (CAMZ - z) * TANH) / 900
export const at = (px, py, z) => { const s = pxScale(z); return [(px - 720) * s, (450 - py) * s, z] }

const BG = '#e3a898'
const INK = '#eae6e3'

function useFonts() {
  const [ok, setOk] = useState(false)
  useEffect(() => {
    const a = new FontFace('HeadC', `url(${BASE}ArchivoHead.ttf)`)
    const b = new FontFace('NavC', `url(${BASE}ArchivoNav.ttf)`)
    Promise.all([a.load(), b.load()]).then((fs) => { fs.forEach((f) => document.fonts.add(f)); setOk(true) }).catch(() => setOk(true))
  }, [])
  return ok
}

// 奥の板：地と見出し（見出しは 3D の豆より奥）
function Backdrop({ fontsOk }) {
  const Z = -0.35
  const s = pxScale(Z)
  const tex = useMemo(() => {
    const c = document.createElement('canvas'); c.width = 2880; c.height = 1800
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4
    return t
  }, [])
  useEffect(() => {
    const c = tex.image, g = c.getContext('2d')
    g.setTransform(2, 0, 0, 2, 0, 0)
    g.fillStyle = BG; g.fillRect(0, 0, 1440, 900)
    g.fillStyle = INK; g.strokeStyle = INK; g.lineJoin = 'round'; g.lineWidth = 9
    g.textAlign = 'center'; g.textBaseline = 'alphabetic'
    const line = (txt, cx, base, size, w) => {
      g.font = `${size}px HeadC`
      const m = g.measureText(txt).width
      g.save(); g.translate(cx, base); g.scale(w / m, 1)
      g.fillText(txt, 0, 0); g.strokeText(txt, 0, 0); g.restore()
    }
    line('OUTRAGEOUSLY', 720, 248, 168, 952)
    line('CHILI\u2004CRUNCH', 720, 403, 168, 864)
    tex.needsUpdate = true
  }, [fontsOk])
  return (
    <mesh position={[0, 0, Z]} renderOrder={-2}>
      <planeGeometry args={[1440 * s, 900 * s]} />
      <meshBasicMaterial map={tex} toneMapped={false} />
    </mesh>
  )
}

// 帯：罫2本と流れる効能
function Band({ fontsOk }) {
  const Z = -0.08
  const s = pxScale(Z)
  const H = 70
  const { tex, c } = useMemo(() => {
    const c = document.createElement('canvas'); c.width = 2880; c.height = H * 2
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace
    return { tex: t, c }
  }, [])
  const items = ['NO FAKE FLAVORS', 'GLUTEN FREE', 'ZERO ADDED SUGAR', '6 GRAMS OF PLANT PROTEIN', 'SMALL BATCH ROASTED', '4 GRAMS OF FIBER']
  useFrame((st) => {
    const g = c.getContext('2d')
    g.setTransform(2, 0, 0, 2, 0, 0)
    g.clearRect(0, 0, 1440, H)
    g.fillStyle = '#2b2522'
    g.fillRect(0, 2, 1440, 1.6); g.fillRect(0, 64.5, 1440, 1.6)
    g.font = '17px NavC'; g.letterSpacing = '1.4px'; g.textBaseline = 'middle'
    // 1周の長さ
    let total = 0; const ws = items.map((t) => { const w = g.measureText(t).width; total += w + 50; return w })
    let x = -((st.clock.elapsedTime * 38) % total) - 40
    while (x < 1440) {
      for (let i = 0; i < items.length; i++) {
        g.fillText(items[i], x, 34)
        g.beginPath(); g.arc(x + ws[i] + 25, 33.5, 3.6, 0, Math.PI * 2); g.fill()
        x += ws[i] + 50
      }
    }
    tex.needsUpdate = true
  })
  return (
    <mesh position={[0, (450 - (791 + H / 2)) * s, Z]} renderOrder={-1}>
      <planeGeometry args={[1440 * s, H * s]} />
      <meshBasicMaterial map={tex} transparent toneMapped={false} depthWrite={false} />
    </mesh>
  )
}

function Character() {
  const grp = useRef()
  const { body, glasses, bandana } = useMemo(() => ({ body: makeBody(), glasses: makeGlasses(), bandana: makeBandana() }), [])
  const ptr = useRef([0, 0])
  useEffect(() => {
    const f = (e) => { ptr.current = [e.clientX / innerWidth * 2 - 1, e.clientY / innerHeight * 2 - 1] }
    addEventListener('pointermove', f); return () => removeEventListener('pointermove', f)
  }, [])
  useFrame((st, dt) => {
    const t = st.clock.elapsedTime
    const g = grp.current
    const ty = ptr.current[0] * 0.22 + Math.sin(t * 0.6) * 0.03
    const tx = ptr.current[1] * 0.06 + Math.sin(t * 0.9) * 0.012
    g.rotation.y += (ty - g.rotation.y) * Math.min(1, dt * 3)
    g.rotation.x += (tx - g.rotation.x) * Math.min(1, dt * 3)
    g.position.y = Math.sin(t * 1.1) * 0.02
  })
  const s = pxScale(0)
  return (
    <group ref={grp} position={[(748 - 720) * s, 0, 0]}>
      <primitive object={body} />
      <primitive object={glasses} />
      <primitive object={bandana} />
    </group>
  )
}

// 舞う豆：ref の画面座標・長さ(px)・傾き(度)・奥行き・淡い豆か
const NUTS = [
  [88, 160, 52, 35, 0.1, 0], [232, 228, 92, -45, 0.3, 0], [476, 250, 44, -40, 0.0, 1], [1032, 140, 120, -60, 4.2, 0],
  [1388, 194, 82, -62, 0.2, 0], [108, 458, 62, -50, 0.1, 0], [1210, 430, 48, -70, 0.0, 1], [1438, 392, 60, -30, 0.0, 0],
  [238, 693, 46, -75, 0.0, 1], [402, 790, 115, 60, 4.0, 0], [990, 733, 78, 55, 0.6, 0], [1360, 765, 72, 15, 0.2, 0],
  [1192, 852, 120, -70, 4.4, 0], [552, -4, 70, 10, 2.6, 1], [1140, 0, 80, -15, 2.2, 0],
]

function Nuts() {
  const meshes = useMemo(() => NUTS.map(([px, py, len, ang, z, pale], i) => {
    const m = makeNut(i * 7.31 + 1, pale)
    const p = at(px, py, z)
    const L = len * pxScale(z)
    m.position.set(...p)
    m.userData = { p, L, ang: ang * Math.PI / 180, ph: i * 1.7, spin: 0.25 + (i % 5) * 0.08 }
    m.scale.setScalar(L / 2)
    m.rotation.set(0.4 * Math.sin(i), 0.6 * Math.cos(i * 2.1), ang * Math.PI / 180)
    return m
  }), [])
  useFrame((st) => {
    const t = st.clock.elapsedTime
    for (const m of meshes) {
      const u = m.userData
      m.position.x = u.p[0] + Math.sin(t * 0.5 + u.ph) * 0.03
      m.position.y = u.p[1] + Math.sin(t * 0.7 + u.ph * 1.3) * 0.05
      m.rotation.z = u.ang + Math.sin(t * u.spin + u.ph) * 0.15
      m.rotation.x = 0.4 * Math.sin(u.ph) + t * u.spin * 0.3
    }
  })
  return <>{meshes.map((m, i) => <primitive key={i} object={m} />)}</>
}

function Env() {
  const { gl, scene } = useThree()
  useEffect(() => {
    const pm = new THREE.PMREMGenerator(gl)
    const rt = pm.fromScene(new RoomEnvironment(), 0.04)
    scene.environment = rt.texture
    scene.environmentIntensity = 0.55
    return () => { rt.dispose(); pm.dispose() }
  }, [gl, scene])
  return null
}

export default function Scene() {
  const fontsOk = useFonts()
  return (
    <>
      <color attach="background" args={[BG]} />
      <Env />
      <ambientLight intensity={0.35} color="#ffe6d6" />
      <directionalLight position={[-5, 4.5, 4.5]} intensity={1.6} color="#fff3e2" castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004} shadow-normalBias={0.02} shadow-radius={6}
        shadow-camera-left={-3} shadow-camera-right={3} shadow-camera-top={3} shadow-camera-bottom={-3} shadow-camera-near={1} shadow-camera-far={20} />
      <directionalLight position={[5, -1, 3]} intensity={0.45} color="#ffb48a" />
      <directionalLight position={[2, 3, -6]} intensity={0.9} color="#ffe0c0" />
      <Backdrop fontsOk={fontsOk} />
      <Band fontsOk={fontsOk} />
      <Character />
      <Nuts />
      <EffectComposer multisampling={4}>
        <DepthOfField focusDistance={CAMZ + 0.1} focusRange={4.5} bokehScale={5} />
      </EffectComposer>
    </>
  )
}
