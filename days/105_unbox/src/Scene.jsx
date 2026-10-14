import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { RoundedBox } from '@react-three/drei'
import * as THREE from 'three'

// 表紙の絵：左 band だけ背クロスの色（継ぎ表紙）、残りは平の紙。エンブレムは右上の丸。
function coverTexture({ cloth, paper, band, emblem }) {
  const W = 512, H = 768
  const c = document.createElement('canvas')
  c.width = W; c.height = H
  const g = c.getContext('2d')
  g.fillStyle = paper; g.fillRect(0, 0, W, H)
  g.fillStyle = cloth; g.fillRect(0, 0, W * band, H)
  // 紙とクロスのかすかなざらつき（明暗 ±3%）
  const img = g.getImageData(0, 0, W, H), px = img.data
  for (let i = 0; i < px.length; i += 4) {
    const n = (Math.random() - 0.5) * 14 + (((i >> 2) % W) % 3 === 0 ? -3 : 0)
    px[i] += n; px[i + 1] += n; px[i + 2] += n
  }
  g.putImageData(img, 0, 0)
  // 表紙の右（小口側）へ向かう沈み：左 1.0 → 右 0.84
  const grad = g.createLinearGradient(0, 0, W, 0)
  grad.addColorStop(0, 'rgba(0,0,0,0)'); grad.addColorStop(0.45, 'rgba(0,0,0,0.03)'); grad.addColorStop(1, 'rgba(0,0,0,0.16)')
  g.fillStyle = grad; g.fillRect(0, 0, W, H)
  // 継ぎ目の際の細いハイライト（背クロスが平へ折れる所）
  g.fillStyle = 'rgba(255,255,255,0.10)'; g.fillRect(W * 0.012, 0, W * 0.02, H)
  // クロスの布目：縦横の細い織り目（明暗 ±4%）
  g.globalAlpha = 0.03
  for (let x = 0; x < W; x += 2) { g.fillStyle = x % 4 ? '#fff' : '#000'; g.fillRect(x, 0, 1, H) }
  for (let y = 0; y < H; y += 2) { g.fillStyle = y % 4 ? '#000' : '#fff'; g.fillRect(0, y, W, 1) }
  g.globalAlpha = 1
  if (emblem) {
    const cx = W * 0.8, cy = H * 0.085, r = W * 0.075
    g.fillStyle = emblem; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill()
    // 開いた本の線画（架空のエンブレム）
    g.strokeStyle = '#fff'; g.lineWidth = r * 0.16; g.lineCap = 'round'; g.lineJoin = 'round'
    g.beginPath()
    g.moveTo(cx, cy + r * 0.45); g.quadraticCurveTo(cx - r * 0.3, cy + r * 0.25, cx - r * 0.6, cy + r * 0.35)
    g.lineTo(cx - r * 0.6, cy - r * 0.35); g.quadraticCurveTo(cx - r * 0.3, cy - r * 0.45, cx, cy - r * 0.25)
    g.quadraticCurveTo(cx + r * 0.3, cy - r * 0.45, cx + r * 0.6, cy - r * 0.35)
    g.lineTo(cx + r * 0.6, cy + r * 0.35); g.quadraticCurveTo(cx + r * 0.3, cy + r * 0.25, cx, cy + r * 0.45)
    g.lineTo(cx, cy - r * 0.25)
    g.stroke()
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  return t
}

// 本文の小口：細い横線（紙の束）
function pagesTexture(base, line) {
  const c = document.createElement('canvas')
  c.width = 64; c.height = 256
  const g = c.getContext('2d')
  g.fillStyle = base; g.fillRect(0, 0, 64, 256)
  g.strokeStyle = line; g.globalAlpha = 0.18; g.lineWidth = 1
  for (let y = 0; y < 256; y += 3) { g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(64, y + 0.5); g.stroke() }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  return t
}

// ハードカバー1冊 = 表紙板2枚＋丸背＋本文ブロック。原点は本の中心、背は -x、表は +z。
function Book({ w = 2, h = 3, d = 0.42, t = 0.05, cloth, paper, band = 0.3, emblem, spineSide, pages = '#f1e3c4' }) {
  const front = useMemo(() => coverTexture({ cloth, paper, band, emblem }), [cloth, paper, band, emblem])
  const pg = useMemo(() => pagesTexture(pages, '#7a5a6a'), [pages])
  const o = 0.045 // 表紙板の張り出し
  const inner = d - 2 * t
  const r = d / 2
  return (
    <group>
      {/* 表の表紙板：前面だけ絵を貼る */}
      <RoundedBox args={[w, h, t]} radius={0.012} smoothness={3} position={[0, 0, d / 2 - t / 2]}>
        <meshStandardMaterial attach="material" color={paper} roughness={1} />
      </RoundedBox>
      <mesh position={[0, 0, d / 2 + 0.0005]}>
        <planeGeometry args={[w - 0.004, h - 0.004]} />
        <meshStandardMaterial map={front} roughness={1} />
      </mesh>
      {/* 裏の表紙板 */}
      <RoundedBox args={[w, h, t]} radius={0.012} smoothness={3} position={[0, 0, -d / 2 + t / 2]}>
        <meshStandardMaterial color={paper} roughness={1} />
      </RoundedBox>
      {/* 本文ブロック：小口側へ寄せ、背側は丸背の内側に隠れる */}
      <mesh position={[o / 2, 0, 0]}>
        <boxGeometry args={[w - o, h - 2 * o, inner]} />
        <meshStandardMaterial map={pg} roughness={1} />
      </mesh>
      {/* 丸背：背クロスの色の半円柱（-x へ膨らむ） */}
      <mesh position={[-w / 2 + 0.01, 0, 0]} rotation={[0, 0, 0]}>
        <cylinderGeometry args={[r, r, h, 96, 1, true, Math.PI, Math.PI]} />
        <meshStandardMaterial color={spineSide || cloth} roughness={1} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[-w / 2 + 0.012, 0, d / 2 + 0.0008]}>
        <planeGeometry args={[0.022, h - 0.01]} />
        <meshStandardMaterial color={cloth} roughness={0.6} emissive={cloth} emissiveIntensity={0.15} />
      </mesh>
      {[1, -1].map((k) => (
        <mesh key={k} position={[-w / 2 + 0.01, k * (h / 2 - 0.001), 0]} rotation={[k * -Math.PI / 2, 0, 0]}>
          <circleGeometry args={[r * 0.86, 32, Math.PI / 2, Math.PI]} />
          <meshStandardMaterial color={pages} roughness={1} side={THREE.DoubleSide} />
        </mesh>
      ))}
      {[1, -1].map((k) => (
        <mesh key={'r' + k} position={[-w / 2 + 0.01, k * (h / 2 - 0.0015), 0]} rotation={[k * -Math.PI / 2, 0, 0]}>
          <ringGeometry args={[r * 0.86, r, 32, 1, Math.PI / 2, Math.PI]} />
          <meshStandardMaterial color={spineSide || cloth} roughness={1} side={THREE.DoubleSide} />
        </mesh>
      ))}
    </group>
  )
}

// 3冊それぞれ：置き場所・姿勢・揺れの周期
const BOOKS = [
  { // 右の主役：青の平＋ピンクの背クロス
    pos: [2.3, 0.02, 0], rot: [0.3, 0.2, 0.3], amp: 0.05, period: 7.3,
    book: { w: 1.6, h: 2.9, d: 0.42, cloth: '#DD6DA4', paper: '#003581', band: 0.3, emblem: '#DB79AC', spineSide: '#7a3560', pages: '#cfc5b2' },
  },
  { // 左上：青緑（画面外から角だけ）
    pos: [-2.7, 3.3, -0.5], rot: [-0.25, 0.42, -0.56], amp: 0.04, period: 9.1,
    book: { w: 2.2, h: 3.2, d: 0.45, cloth: '#94C9DC', paper: '#008E94', band: 0.2, spineSide: '#5f9fb8', pages: '#8a847a' },
  },
  { // 下中央：赤（画面外から）
    pos: [-2.0, -3.6, -0.3], rot: [0.5, 0.45, -0.95], amp: 0.035, period: 8.2,
    book: { w: 2.0, h: 3.0, d: 0.42, cloth: '#A65042', paper: '#9C0A20', band: 0.22, pages: '#8f6f62' },
  },
]

function Floating({ pos, rot, amp, period, children, i }) {
  const ref = useRef()
  useFrame(({ clock, pointer }) => {
    const s = (clock.elapsedTime / period) * Math.PI * 2 + i * 1.7
    const g = ref.current
    g.position.set(pos[0] + pointer.x * 0.05, pos[1] + Math.sin(s) * amp + pointer.y * 0.04, pos[2])
    g.rotation.set(rot[0] + Math.sin(s * 0.8) * amp * 0.6, rot[1] + Math.cos(s) * amp, rot[2] + Math.sin(s * 1.3) * amp * 0.4)
  })
  return <group ref={ref}>{children}</group>
}

// layer='front' は主役だけ、'back' は手前と奥の2冊（App で CSS のぼかしを掛ける）
export default function Scene({ layer = 'front' }) {
  return (
    <>
      <ambientLight intensity={1.9} />
      <directionalLight position={[6, 3, 5]} intensity={1.6} />
      {BOOKS.map((b, i) => ((layer === 'front') === (i === 0)) && (
        <Floating key={i} i={i} {...b}>
          <Book {...b.book} />
        </Floating>
      ))}
    </>
  )
}
