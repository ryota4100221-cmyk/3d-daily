import { useMemo, useRef, useEffect } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useFBO } from '@react-three/drei'
import * as THREE from 'three'
import {
  CLAY,
  LACQUER,
  VERMILION,
  RIM_R,
  RIM_Y,
  SIM,
  dropAt,
  cupProfile,
  innerProfile,
  makeEnvironment,
  makePaperGrain,
  makeSimMaterial,
  makeSurfaceMaterial,
  WIN1,
} from './rig.js'

export const GROUND = CLAY

// 高さ場は固定の刻み（1/120 秒）で進め、フレームの実経過ぶんだけ回す。
//
// 🔴 フレーム数で数えてはいけない。headless の --virtual-time-budget 下では
//    performance.now() は 11.9 秒進むのに rAF は 45 回しか来ない（実測 raf=45 /
//    setInterval=743 / now=11900）。フレーム基準だと 0.75 秒ぶんしか回らず、
//    「水面が静止した1枚」が焼き上がる。ビルドもプレビューも成功したまま。
const DT = 1 / 120
const MAX_SUB = 64
// 最初の1フレームを描く前に回しておくステップ数（= 5.33 秒ぶん）
const WARM = 640

export default function Scene({ readouts }) {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)

  // ── 環境と地の粒 ──────────────────────────────────────────────────────
  const env = useMemo(() => makeEnvironment(gl), [gl])
  const grain = useMemo(() => makePaperGrain(), [])
  useEffect(() => {
    scene.environment = env
    grain.repeat.set(9, 9)
    return () => {
      scene.environment = null
    }
  }, [scene, env, grain])

  // ── カメラ：望遠で寄る。器は右上、卓の余白は左下に残す ────────────────
  useEffect(() => {
    camera.position.set(-0.15, 3.02, 8.16)
    camera.lookAt(-0.72, 0.02, -0.1)
    camera.updateProjectionMatrix()
  }, [camera])

  // ── 高さ場のソルバ（ピンポン）────────────────────────────────────────
  const opts = {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
    stencilBuffer: false,
  }
  const rtA = useFBO(SIM, SIM, opts)
  const rtB = useFBO(SIM, SIM, opts)

  const sim = useMemo(() => makeSimMaterial(), [])
  const surf = useMemo(() => makeSurfaceMaterial(), [])

  const simScene = useMemo(() => {
    const s = new THREE.Scene()
    s.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), sim))
    return s
  }, [sim])
  const simCam = useMemo(() => new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), [])

  const state = useRef({
    read: rtA,
    write: rtB,
    seeded: 0,
    pointer: null,
    lastPointer: null,
    drops: 0,
    frames: 0,
    simT: 0,
    cleared: false,
  })

  const NO_DROP = useMemo(() => new THREE.Vector4(0, 0, 0, 0.05), [])

  // 起動直後は両方のバッファがゴミなので 0 で塗り、そのうえで **最初の1フレームを
  // 描く前に WARM ステップぶん回しておく**。
  //
  // 🔴 これが無いと preview が博打になる。headless の rAF は虚時間 11.9 秒に対して
  //    42 回しか来ないことも 1 回しか来ないこともあり（両方実測した）、後者だと
  //    「波が1本も立っていない静止した水面」が焼き上がる。バイト数では検出できない
  //    （169KB 出た）。予熱しておけば、何フレーム描けても水面は必ず生きている。
  useEffect(() => {
    const st = state.current
    const prev = gl.getRenderTarget()
    for (const rt of [rtA, rtB]) {
      gl.setRenderTarget(rt)
      gl.setClearColor(0x000000, 0)
      gl.clear(true, false, false)
    }
    st.read = rtA
    st.write = rtB
    for (let i = 0; i < WARM; i++) {
      const t = i * DT
      let drop = null
      while (dropAt(st.seeded).t <= t) {
        drop = dropAt(st.seeded++)
        st.drops++
      }
      sim.uniforms.uPrev.value = st.read.texture
      if (drop) sim.uniforms.uDrop.value.set(drop.x, drop.y, drop.a, drop.r)
      else sim.uniforms.uDrop.value.copy(NO_DROP)
      gl.setRenderTarget(st.write)
      gl.render(simScene, simCam)
      const tmp = st.read
      st.read = st.write
      st.write = tmp
    }
    gl.setRenderTarget(prev)
    st.simT = WARM * DT
    surf.uniforms.uH.value = st.read.texture
    st.cleared = true
  }, [gl, rtA, rtB, sim, surf, simScene, simCam, NO_DROP])

  useFrame(({ clock }) => {
    const st = state.current
    if (!st.cleared) return
    const t = WARM * DT + clock.getElapsedTime()
    const steps = Math.max(1, Math.min(MAX_SUB, Math.round((t - st.simT) / DT)))
    st.simT += steps * DT
    st.frames++

    // そのフレームで落とす一滴を決める。ポインタが動いていればそれが主役。
    let drop = null
    if (st.pointer) {
      const p = st.pointer
      const lp = st.lastPointer
      const v = lp ? Math.hypot(p.x - lp.x, p.y - lp.y) : 0
      st.lastPointer = { x: p.x, y: p.y }
      if (v > 0.0015) drop = { x: p.x, y: p.y, a: Math.min(0.42, v * 5.5), r: 0.05 }
      st.pointer = null
    }
    if (!drop) {
      while (dropAt(st.seeded).t <= t) {
        drop = dropAt(st.seeded++)
        st.drops++
      }
    }

    const prevRT = gl.getRenderTarget()
    for (let i = 0; i < steps; i++) {
      sim.uniforms.uPrev.value = st.read.texture
      if (drop && i === 0) sim.uniforms.uDrop.value.set(drop.x, drop.y, drop.a, drop.r)
      else sim.uniforms.uDrop.value.copy(NO_DROP)
      gl.setRenderTarget(st.write)
      gl.render(simScene, simCam)
      const tmp = st.read
      st.read = st.write
      st.write = tmp
    }
    gl.setRenderTarget(prevRT)

    surf.uniforms.uH.value = st.read.texture
    surf.uniforms.uCam.value.copy(camera.position)

    if (readouts) {
      const put = (ref, v) => {
        if (ref.current) ref.current.textContent = v
      }
      put(readouts.grid, `${SIM}²`)
      put(readouts.drops, String(st.drops).padStart(2, '0'))
      put(readouts.rise, '+1.38 %R')
      put(readouts.clock, `${t.toFixed(1)} s`)
    }
  })

  // ── 器 ────────────────────────────────────────────────────────────────
  const outerGeo = useMemo(() => new THREE.LatheGeometry(cupProfile(), 220), [])
  const innerGeo = useMemo(() => new THREE.LatheGeometry(innerProfile(), 220), [])
  const liquidGeo = useMemo(() => {
    const g = new THREE.CircleGeometry(RIM_R, 256)
    return g
  }, [])

  const onMove = (e) => {
    e.stopPropagation()
    // ローカル座標へ：CircleGeometry を -90° 倒しているので ly = -z
    state.current.pointer = { x: e.point.x, y: -e.point.z }
  }

  return (
    <>
      {/* 窓は1枚。影を落とすのはこれだけ */}
      <directionalLight
        position={[WIN1.x * 9, WIN1.y * 9, WIN1.z * 9]}
        intensity={1.2}
        color="#FFFBF3"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0009}
        shadow-normalBias={0.012}
      >
        <orthographicCamera attach="shadow-camera" args={[-2.6, 2.6, 2.6, -2.6, 0.5, 22]} />
      </directionalLight>
      <ambientLight intensity={0.12} color="#EFE6DE" />

      {/* 卓（和紙） */}
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[60, 60]} />
        <meshStandardMaterial
          color={GROUND}
          roughness={0.93}
          metalness={0}
          bumpMap={grain}
          bumpScale={0.0035}
          envMapIntensity={0.28}
        />
      </mesh>

      {/* 黒漆の外側 */}
      <mesh geometry={outerGeo} castShadow receiveShadow>
        <meshPhysicalMaterial
          color={LACQUER}
          roughness={0.42}
          metalness={0}
          clearcoat={1}
          clearcoatRoughness={0.035}
          envMapIntensity={0.62}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* 朱漆の見込み（普段は液面の下） */}
      <mesh geometry={innerGeo}>
        <meshPhysicalMaterial
          color={VERMILION}
          roughness={0.3}
          metalness={0}
          clearcoat={1}
          clearcoatRoughness={0.14}
          envMapIntensity={0.8}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* 液面 */}
      <mesh
        geometry={liquidGeo}
        material={surf}
        rotation-x={-Math.PI / 2}
        position-y={RIM_Y}
        onPointerMove={onMove}
      />
    </>
  )
}
