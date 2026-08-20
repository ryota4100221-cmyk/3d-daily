import { useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { buildLattice, COLS, ROWS, CELL, GAP, PLANE_W, PLANE_H, PALETTE } from './rig.js'

// 版面をわずかに倒す。正投影なので遠近は付かず、倒した分だけ
// 「立っているセル」の側面が見える。エンボスした紙に見えるのはこの側面のせいで、
// 倒さないと高さは完全に情報から消える（正投影で真正面は高さが見えない）。
const TILT = -0.34

// 3色しか無いので、階調は3段しか作れない。中間は全部ディザで作る。
const rgb = (hex) => {
  const n = parseInt(hex.slice(1), 16)
  return new THREE.Vector3(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255)
}

const VERT = /* glsl */ `
  attribute float aHeight;
  attribute vec2 aCell;
  varying float vH;
  varying vec2 vCell;
  varying vec3 vNObj;

  void main() {
    vH = aHeight;
    vCell = aCell;
    vNObj = normal;
    vec4 p = instanceMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * modelViewMatrix * p;
  }
`

const FRAG = /* glsl */ `
  precision highp float;

  uniform vec3  uKraft, uPaper, uAccent, uInk;
  uniform float uTime;
  uniform float uAmp, uK, uSpeed;   // 自走する潮
  uniform float uPush, uPushR;      // ポインタが押す量と半径（セル単位）
  uniform vec2  uPointer;

  varying float vH;
  varying vec2  vCell;
  varying vec3  vNObj;

  // 8x8 の秩序ディザ。ビット反転を再帰で書く古い手。
  // ここが「格子」の実体で、しきい値は一度もセルから離れない。
  float bayer2(vec2 a) { a = floor(a); return fract(a.x / 2.0 + a.y * a.y * 0.75); }
  float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
  float bayer8(vec2 a) { return bayer4(0.5 * a) * 0.25 + bayer2(a); }

  void main() {
    // ── 潮 ──────────────────────────────────────────────────────────
    // ここが今日の装置。波は f には一切足さない。しきい値のほうに足す。
    // だから絵（高さ場）は完全に静止したまま、段の境界だけが通り過ぎる。
    float phase = dot(vCell, vec2(0.62, 0.78)) * uK - uTime * uSpeed;
    float tide  = uAmp * sin(phase);

    float d = length(vCell - uPointer);
    tide += uPush * exp(-(d * d) / (uPushR * uPushR)) * (0.62 + 0.38 * sin(d * 0.5 - uTime * 2.1));

    float th = bayer8(vCell) - 0.5;

    // ── 地の粒 ──────────────────────────────────────────────────────
    // 地は kraft と paper の2値をディザで混ぜたもの。市松（4セル角）を薄く透かす。
    // 橙をここに使わないのは、実測が「差し色は1語にだけ」だったから。
    vec2  q = floor(vCell / 6.0);
    float checker = mod(q.x + q.y, 2.0);
    float grain = clamp((vH - 0.06) * 3.4, 0.0, 1.0);
    // 紙の繊維。白色ノイズを一掴み。市松と Bayer だけだと地が完全な周期になり、
    // 「刷ってある」ではなく「敷いてある」に見える（PNG が 16KB まで縮むのが目印だった）
    float fibre = fract(sin(dot(vCell, vec2(12.9898, 78.233))) * 43758.5453);
    vec3  ground = mix(uKraft, uPaper,
                       step(0.5, grain * 0.56 + checker * 0.24 + fibre * 0.20 + th));

    // ── 3段 ─────────────────────────────────────────────────────────
    // g は高さ場だけで決まる。g=0 が地、g=1 が文字の天面。
    float g = smoothstep(0.42, 0.72, vH);

    // 面の向きは陰影ではなく「段を落とす量」として効かせる。3色しか無い版では、
    // 立ち上がりの壁は暗くなるのではなく **1段下の色になる**（これが3色印刷の見え方で、
    // 連続階調のライティングを足すと段の間に居場所の無い色ができてしまう）。
    float drop = -0.30;                        // 左右の壁
    if (vNObj.z >  0.5) drop =  0.0;           // 天面
    else if (vNObj.y < -0.5) drop = -0.52;     // 手前（倒した側）の壁 → 紺が橙に落ちる
    else if (vNObj.y >  0.5) drop = -0.14;

    // 秩序ディザの正しい量子化は floor(v*(L-1) + 0.5 + th)。
    // +0.5 を落とすと g=1 でも半分が1段下に落ちて、輪郭のはずの橙が面を埋める
    // （最初の実装がこれで、文字の内側が橙になった）。
    float v   = clamp(g + drop, 0.0, 1.0) * 2.0 + 0.5;
    float lvl = clamp(floor(v + th + tide), 0.0, 2.0);

    vec3 col = ground;
    if (lvl > 1.5) col = uInk;
    else if (lvl > 0.5) col = uAccent;

    gl_FragColor = vec4(col, 1.0);
  }
`

export default function Scene() {
  const mesh = useRef()
  const mat = useRef()
  const { camera, size } = useThree()

  // 高さ場は一度だけ。二度と動かさない（動くのはしきい値のほう）
  const lattice = useMemo(() => buildLattice(), [])

  const uniforms = useMemo(
    () => ({
      uKraft: { value: rgb(PALETTE.kraft) },
      uPaper: { value: rgb(PALETTE.paper) },
      uAccent: { value: rgb(PALETTE.accent) },
      uInk: { value: rgb(PALETTE.ink) },
      uTime: { value: 0 },
      uAmp: { value: 0.21 },
      uK: { value: 0.042 },
      uSpeed: { value: 0.85 },
      uPush: { value: 0.86 },
      uPushR: { value: 25.0 },
      // headless では pointermove が来ない。来ないままだと装置の半分が
      // 写真に写らないので、既定値を地の上（文字と重ならない場所）に置く。
      uPointer: { value: new THREE.Vector2(154, 160) },
    }),
    []
  )

  const geom = useMemo(() => {
    const w = CELL * (1 - GAP)
    const g = new THREE.BoxGeometry(w, w, 1)
    g.translate(0, 0, 0.5) // 底を z=0 に。instanceMatrix の z スケールがそのまま高さになる
    const aHeight = new Float32Array(COLS * ROWS)
    const aCell = new Float32Array(COLS * ROWS * 2)
    for (let j = 0; j < ROWS; j++) {
      for (let i = 0; i < COLS; i++) {
        const k = j * COLS + i
        aHeight[k] = lattice.height[k]
        aCell[k * 2] = i
        aCell[k * 2 + 1] = j
      }
    }
    g.setAttribute('aHeight', new THREE.InstancedBufferAttribute(aHeight, 1))
    g.setAttribute('aCell', new THREE.InstancedBufferAttribute(aCell, 2))
    return g
  }, [lattice])

  useLayoutEffect(() => {
    const m = new THREE.Matrix4()
    const pos = new THREE.Vector3()
    const quat = new THREE.Quaternion()
    const scl = new THREE.Vector3()
    for (let j = 0; j < ROWS; j++) {
      for (let i = 0; i < COLS; i++) {
        const k = j * COLS + i
        pos.set(
          -PLANE_W * 0.5 + (i + 0.5) * CELL,
          PLANE_H * 0.5 - (j + 0.5) * CELL,
          0
        )
        // 起伏は控えめ。倒した版面では高さがそのまま画面上のズレになるので、
        // 大きくすると字がセル1〜2個ぶん上へ滲んで読めなくなる（実際になった）。
        scl.set(1, 1, 0.03 + lattice.height[k] * 0.36)
        m.compose(pos, quat, scl)
        mesh.current.setMatrixAt(k, m)
      }
    }
    mesh.current.instanceMatrix.needsUpdate = true
  }, [lattice])

  // 正投影。版面 16x10 を画面に「覆う」ように合わせる（はみ出た分は切れてよい：
  // 元サイトも見出しを左右で切っている）
  useLayoutEffect(() => {
    camera.zoom = Math.max(size.width / PLANE_W, size.height / PLANE_H)
    camera.updateProjectionMatrix()
  }, [camera, size])

  useLayoutEffect(() => {
    const onMove = (e) => {
      const x = e.clientX / window.innerWidth
      const y = e.clientY / window.innerHeight
      uniforms.uPointer.value.set(x * COLS, y * ROWS)
    }
    window.addEventListener('pointermove', onMove)
    return () => window.removeEventListener('pointermove', onMove)
  }, [uniforms])

  useFrame((_, dt) => {
    uniforms.uTime.value += Math.min(dt, 0.05)
  })

  return (
    <group rotation={[TILT, 0, 0]} scale={[1, 1 / Math.cos(TILT), 1]}>
      <instancedMesh ref={mesh} args={[geom, undefined, COLS * ROWS]} frustumCulled={false}>
        <shaderMaterial
          ref={mat}
          attach="material"
          vertexShader={VERT}
          fragmentShader={FRAG}
          uniforms={uniforms}
        />
      </instancedMesh>
    </group>
  )
}
