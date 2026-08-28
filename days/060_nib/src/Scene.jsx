import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { layout } from './glyphs.js'
import { glyphGeometry, inkMaterial, backdropMaterial } from './rig.js'

// CREDIT SAISON TYPEFACE の実測値から引いた色。
// 地 #F4FBFF / 文字 #004098 / 差し色 #009038（全体の1.6%しか使われていない）
const PAPER_TOP = '#ffffff'
const PAPER_BOTTOM = '#e6eef5'
const INK = '#004098'
const INK_LIGHT = '#8397aa'
const ACCENT = '#009038'
const RULE = '#c9d9e6'

// 見本帳の版面。1行 = 文字列・字送り・級数・ベースライン。
const ROWS = [
  { text: 'SAISON', tracking: 0.15, scale: 0.82, y: 0.36, tone: 'ink' },
  { text: 'ABCDEFGHIJKLM', tracking: 0.3, scale: 0.26, y: -0.62, tone: 'light' },
  { text: 'NOPQRSTUVWXYZ', tracking: 0.3, scale: 0.26, y: -1.18, tone: 'light' },
]

function Row({ row, mats }) {
  const { items, width } = useMemo(() => layout(row.text, row.tracking), [row])
  const x0 = (-width * row.scale) / 2
  return (
    <group position={[x0, row.y, 0]} scale={row.scale}>
      {items.map((it, i) => (
        <mesh
          key={i}
          position={[it.x, 0, 0]}
          geometry={glyphGeometry(it.ch)}
          material={
            row.tone === 'ink' ? mats.ink : it.ch === 'S' ? mats.accent : mats.light
          }
        />
      ))}
    </group>
  )
}

export default function Scene({ readout }) {
  const shared = useMemo(
    () => ({
      uNib: { value: 0.6 },
      uContrast: { value: 0.5 },
      uWeight: { value: 0.122 },
    }),
    []
  )

  const mats = useMemo(
    () => ({
      ink: inkMaterial(INK, shared),
      light: inkMaterial(INK_LIGHT, shared),
      accent: inkMaterial(ACCENT, shared),
    }),
    [shared]
  )
  const paper = useMemo(() => backdropMaterial(PAPER_TOP, PAPER_BOTTOM), [])
  const ruleMat = useMemo(
    () => new THREE.MeshBasicMaterial({ color: new THREE.Color(RULE) }),
    []
  )
  const nibMat = useMemo(
    () => new THREE.MeshBasicMaterial({ color: new THREE.Color(ACCENT) }),
    []
  )

  const sheet = useRef()
  const nibMark = useRef()
  const lastMove = useRef(-1e9)
  const state = useRef({ nib: 0.6, contrast: 0.5, rx: 0, ry: 0 })

  // ポインタが触られたかどうかだけを見る。触られていない間（＝ヘッドレスの
  // スクリーンショットもここ）は、ペン先がゆっくり回り続ける。
  useEffect(() => {
    const h = () => (lastMove.current = performance.now())
    window.addEventListener('pointermove', h)
    return () => window.removeEventListener('pointermove', h)
  }, [])

  useFrame((st, dt) => {
    const t = st.clock.elapsedTime
    const live = performance.now() - lastMove.current < 1800

    // ペン先の角度と、その差をどれだけ通すか（0 = SAISON Sans / 1 = Advance）
    const tNib = live ? (st.pointer.x * 0.5 + 0.5) * Math.PI : 0.55 + 0.78 * Math.sin(t * 0.17)
    const tCon = live
      ? THREE.MathUtils.clamp(st.pointer.y * 0.5 + 0.5, 0, 1)
      : 0.52 + 0.46 * Math.sin(t * 0.093 - 0.85)

    const k = 1 - Math.pow(0.001, Math.min(dt, 0.1))
    const s = state.current
    s.nib += (tNib - s.nib) * k
    s.contrast += (tCon - s.contrast) * k
    shared.uNib.value = s.nib
    shared.uContrast.value = s.contrast

    // 見本帳をわずかに傾けて、リボンの厚みが見えるようにする
    const px = live ? st.pointer.x : 0.42 * Math.sin(t * 0.11)
    const py = live ? st.pointer.y : 0.42 * Math.sin(t * 0.077 + 1.2)
    s.ry += (0.115 + px * 0.22 - s.ry) * k
    s.rx += (0.028 - py * 0.11 - s.rx) * k
    if (sheet.current) {
      sheet.current.rotation.y = s.ry
      sheet.current.rotation.x = s.rx
    }
    if (nibMark.current) nibMark.current.rotation.z = s.nib

    if (readout.nib.current) {
      const deg = ((((s.nib * 180) / Math.PI) % 180) + 180) % 180
      readout.nib.current.textContent = String(Math.round(deg)).padStart(3, '0') + '°'
    }
    if (readout.contrast.current) {
      readout.contrast.current.textContent =
        String(Math.round(s.contrast * 100)).padStart(2, '0') + '%'
    }
  })

  return (
    <>
      <mesh position={[0, 0, -2.6]} material={paper} renderOrder={-1}>
        <planeGeometry args={[16, 10]} />
      </mesh>

      <group ref={sheet}>
        {ROWS.map((row, i) => (
          <Row key={i} row={row} mats={mats} />
        ))}

        {/* 版面を割る罫。見本帳の紙面であることを、線1本で言う */}
        <mesh position={[0, -0.02, -0.02]} material={ruleMat}>
          <planeGeometry args={[5.0, 0.005]} />
        </mesh>
        <mesh position={[0, -0.645, -0.02]} material={ruleMat}>
          <planeGeometry args={[3.6, 0.003]} />
        </mesh>
        <mesh position={[0, -1.205, -0.02]} material={ruleMat}>
          <planeGeometry args={[3.6, 0.003]} />
        </mesh>

        {/* 装置そのものを1つだけ画面に出す。輪の中の短い棒がペン先。 */}
        <group position={[-2.72, -0.02, 0.02]}>
          <mesh material={ruleMat}>
            <ringGeometry args={[0.145, 0.149, 64]} />
          </mesh>
          <mesh ref={nibMark} material={nibMat}>
            <boxGeometry args={[0.235, 0.036, 0.036]} />
          </mesh>
        </group>
      </group>
    </>
  )
}
