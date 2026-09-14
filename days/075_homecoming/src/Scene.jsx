import { useMemo, useRef, useLayoutEffect } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { RoundedBox } from '@react-three/drei'
import * as THREE from 'three'
import {
  ORIENT, NEXT, DIRS, MOVE, DIAG, FIELD, makeRoute, routeCells, census,
} from './rig.js'
import { drawMat, MAT, C, DIAG_COLOR, cellX, cellZ, railX, railZ } from './mat.js'

const TIP_DUR = 0.235 // 一手倒れるのにかかる秒
const REST = 0.045
const HOME_PAUSE = 1.05
const GHOST_MAX = 5

// 盤の天面は y = 0。サイコロは辺 1 なので中心は 0.5。
const TOP = 0

const smooth = (p) => p * p * (3 - 2 * p)

// 体の隅 → その隅が属する体対角線（色分け用。単位姿勢で一度だけ引く）
const diagOf = (b) =>
  DIAG.findIndex((e) => e.every((v, i) => v === b[i]) || e.every((v, i) => v === -b[i]))

const CORNERS = []
for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1])
  CORNERS.push({ p: [sx * 0.435, sy * 0.435, sz * 0.435], c: DIAG_COLOR[diagOf([sx, sy, sz])] })

function matrixToQuat(R, q) {
  const m = new THREE.Matrix4().set(
    R[0][0], R[0][1], R[0][2], 0,
    R[1][0], R[1][1], R[1][2], 0,
    R[2][0], R[2][1], R[2][2], 0,
    0, 0, 0, 1
  )
  return q.setFromRotationMatrix(m)
}

// 方位角 0、仰角 41°。**方位を振らない**のがこの絵の決めで、振った瞬間に
// 盤の辺が画面の水平から 9° ずれて「傾いた長方形」になる（試作1枚目がそれだった）。
// 盤面の x を画面の水平に一致させられるのは方位角 0 のときだけ。
// 代わりにサイコロは天面と正面の2面しか見せないので、隅の玉と落ち影で立体に持たせる。
const EL = (41 * Math.PI) / 180
const CAM = [0, Math.sin(EL) * 60, Math.cos(EL) * 60]
const SHIFT = [3.2, 0, 0.3] // 左の版面を空けるため、盤ごと画面の右へ寄せる

// preview.png 用の決定論モード（?still=N）。同じ仕組みを固定 dt・固定シードで
// N フレームだけ回して止める。撮るたび別のコマになると構図が確認できないため。
const STILL = Number(new URLSearchParams(
  typeof location === 'undefined' ? '' : location.search
).get('still')) || 0

function seeded(seed) {
  let s = seed >>> 0
  return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
}

// 状態機械そのもの。useFrame からも、?still の同期ループからも同じものを回す。
function step(s, dt, repaint) {
  s.t += dt
  if (s.phase === 'tip') {
    const p = Math.min(1, s.t / TIP_DUR)
    if (p >= 1) {
      const d = s.route[s.step]
      s.cell[0] += MOVE[d].d[0]
      s.cell[1] += MOVE[d].d[1]
      s.oi = NEXT[s.oi][DIRS.indexOf(d)]
      s.step++
      s.tips++
      s.t = 0
      if (s.step >= s.route.length) {
        // 帰着。ここで初めて「24 のうちどれか」が確定する
        s.phase = 'home'
        s.routes++
        s.lastHome = s.oi
        s.pulse = 1
        s.dirty = true
      } else {
        s.phase = 'rest'
      }
    }
  } else if (s.phase === 'rest') {
    if (s.t >= REST) { s.phase = 'tip'; s.t = 0 }
  } else if (s.phase === 'home') {
    if (s.dirty) { repaint?.(); s.dirty = false }
    if (s.t >= HOME_PAUSE) {
      s.ghosts.push(s.cells)
      if (s.ghosts.length > GHOST_MAX) s.ghosts.shift()
      s.route = makeRoute(s.rand)
      s.cells = routeCells(s.route)
      s.step = 0
      s.phase = 'tip'
      s.t = 0
      repaint?.()
    }
  }
  if (s.pulse > 0) s.pulse = Math.max(0, s.pulse - dt / 1.25)
}

function Rig() {
  const { camera, size } = useThree()
  useLayoutEffect(() => {
    camera.up.set(0, 1, 0)
    camera.position.set(...CAM)
    camera.lookAt(0, 0, 0)
    camera.zoom = Math.min(size.width / 21.2, size.height / 10.4)
    camera.updateProjectionMatrix()
  }, [camera, size])
  return null
}

export default function Scene({ onReadout }) {
  const { gl } = useThree()
  useLayoutEffect(() => {
    gl.setClearColor('#FFFFFF', 1)
  }, [gl])

  // ── 先に数える。絵はその結果を見せているだけ ──────────────────────────
  const cen = useMemo(() => census(20000), [])

  // ── 盤に刷る版 ────────────────────────────────────────────────────────
  const { canvas, texture } = useMemo(() => {
    const cv = document.createElement('canvas')
    cv.width = MAT.cw
    cv.height = MAT.ch
    const tx = new THREE.CanvasTexture(cv)
    tx.anisotropy = 8
    tx.colorSpace = THREE.SRGBColorSpace
    return { canvas: cv, texture: tx }
  }, [])

  const die = useRef()
  const ring = useRef()

  const S = useRef(null)
  if (!S.current) {
    const rand = STILL ? seeded(7717) : Math.random
    const route = makeRoute(rand)
    S.current = {
      rand,
      frames: 0,
      cell: [...FIELD.home],
      oi: 0,
      route,
      cells: routeCells(route),
      step: 0,
      phase: 'tip',
      t: 0,
      ghosts: [],
      routes: 0,
      tips: 0,
      lastHome: -1,
      pulse: 0,
      dirty: true,
    }
  }

  const q0 = useMemo(() => new THREE.Quaternion(), [])
  const qx = useMemo(() => new THREE.Quaternion(), [])
  const v0 = useMemo(() => new THREE.Vector3(), [])

  const repaint = () => {
    const s = S.current
    drawMat(canvas, {
      cen,
      route: s.cells,
      ghosts: s.ghosts,
      routesWalked: s.routes,
      lastHome: s.lastHome,
    })
    texture.needsUpdate = true
  }
  // ?still=N: N/60 秒ぶんを同期で回し切ってから止める。仮想時間の下では rAF が
  // 何回呼ばれるか読めないので、フレーム数ではなく**シミュレーション時間**で決める。
  useLayoutEffect(() => {
    if (STILL) {
      const s = S.current
      for (let f = 0; f < STILL; f++) step(s, 1 / 60, null)
    }
    repaint()
  }, [])

  useFrame((_, dtRaw) => {
    const s = S.current
    if (!STILL) step(s, Math.min(dtRaw, 0.05), repaint)

    // --- 置き場所と向き ---
    const [i, j] = s.cell
    matrixToQuat(ORIENT[s.oi], q0)
    const cx = cellX(i)
    const cz = cellZ(j)
    const p = s.phase === 'tip' ? Math.min(1, s.t / TIP_DUR) : 0
    if (p > 0) {
      const mv = MOVE[s.route[s.step]]
      const ang = (Math.PI / 2) * smooth(p)
      qx.setFromAxisAngle(v0.set(mv.axis[0], mv.axis[1], mv.axis[2]), ang)
      const pvx = cx + mv.pivot[0]
      const pvz = cz + mv.pivot[1]
      v0.set(cx - pvx, 0.5, cz - pvz).applyQuaternion(qx)
      die.current.position.set(pvx + v0.x, TOP + v0.y, pvz + v0.z)
      die.current.quaternion.copy(qx).multiply(q0)
    } else {
      die.current.position.set(cx, TOP + 0.5, cz)
      die.current.quaternion.copy(q0)
    }

    // --- 帰ってきた枠が光る ---
    if (s.pulse > 0) {
      const k = s.lastHome
      ring.current.visible = true
      ring.current.position.set(railX(k), 0.006, railZ(k))
      ring.current.scale.setScalar(0.55 + (1 - s.pulse) * 0.75)
      ring.current.material.opacity = s.pulse * 0.85
    } else if (ring.current.visible) {
      ring.current.visible = false
    }

    onReadout?.(s.routes, s.tips, s.lastHome)
  })

  return (
    <>
      <Rig />

      <ambientLight intensity={1.25} />
      <directionalLight
        position={[-5, 17, -3.5]}
        intensity={2.3}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
        shadow-camera-left={-9}
        shadow-camera-right={9}
        shadow-camera-top={9}
        shadow-camera-bottom={-9}
        shadow-camera-near={0.1}
        shadow-camera-far={40}
      />
      <directionalLight position={[5, 3, 9]} intensity={0.55} />

      <group position={SHIFT}>
      {/* 盤そのもの。厚みを持たせて、白地の上に「置いてある」ようにする */}
      <mesh position={[0, -0.055, 0]} receiveShadow castShadow>
        <boxGeometry args={[MAT.w, 0.11, MAT.d]} />
        <meshStandardMaterial attach="material-0" color="#F0EEE8" roughness={0.95} />
        <meshStandardMaterial attach="material-1" color="#F0EEE8" roughness={0.95} />
        <meshStandardMaterial attach="material-2" map={texture} roughness={0.92} metalness={0} />
        <meshStandardMaterial attach="material-3" color="#E8E6DE" roughness={0.95} />
        <meshStandardMaterial attach="material-4" color="#F0EEE8" roughness={0.95} />
        <meshStandardMaterial attach="material-5" color="#F0EEE8" roughness={0.95} />
      </mesh>

      {/* 帰着した枠のパルス */}
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
        <ringGeometry args={[0.52, 0.6, 48]} />
        <meshBasicMaterial color={C.orange} transparent opacity={0} depthWrite={false} />
      </mesh>

      {/* 駒 */}
      <group ref={die}>
        <RoundedBox args={[1, 1, 1]} radius={0.085} smoothness={4} castShadow receiveShadow>
          <meshStandardMaterial color="#FFFFFF" roughness={0.5} metalness={0} />
        </RoundedBox>
        {CORNERS.map((c, k) => (
          <mesh key={k} position={c.p} castShadow>
            <sphereGeometry args={[0.125, 20, 16]} />
            <meshStandardMaterial color={c.c} roughness={0.42} metalness={0} />
          </mesh>
        ))}
      </group>
      </group>
    </>
  )
}

export { census }
