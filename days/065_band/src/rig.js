// rig.js — 球面の枠（the sphere frame）
//
// 再現元は 丸の内イノベーションパートナーズ の FV。淡い水色の地の中央に、
// 紺・深緑・ターコイズの帯を球状に巻いた CG が1つ置いてある。
//
// 再現するのは「帯が球に巻きついている」という一点だけ。ここには
// 「帯をどっちに向けるか」を決める行が **1行も無い**。書いてあるのは
//
//     |p| = 1
//
// だけで、帯の姿勢はそこから落ちてくる。球面上の点 p では
//
//     N = p                （面の法線は、球の法線しかありえない）
//     B = p × T            （T に直交して、なお球面に接する向きは1つしかない）
//
// なので、帯の幅を B 方向に取った瞬間、ねじれ（torsion）は選択の余地なく決まる。
// 帯は自分ではねじれない。ねじっているのは球のほうである。
//
// ── 進み方 ──────────────────────────────────────────────────────────────
// 中心線は「球面上を測地曲率 k_g(s) で走る曲線」として積分する。
//
//     dp/ds = T
//     dT/ds = −p + k_g·B
//
// k_g = 0 なら大円（測地線）、k_g = const なら小円。数値的には微分方程式を
// 解かずに **2回の回転** で進める。こうすると誤差がどれだけ溜まっても
// |p| = 1 が壊れない（球から浮いた帯が出ない）。
//
//     ① (p, T) を軸 B のまわりに ds だけ回す   … 大円に沿って ds 進む
//     ② T を軸 p のまわりに k_g·ds だけ回す    … 接平面の中で曲がる
//
// ── 帯の張り方 ──────────────────────────────────────────────────────────
// 幅は「距離」ではなく「角度」で取る。v = (p·cos a ± B·sin a)·r とすれば
// 帯は平らな板ではなく球面に貼りついた面になり、法線がそのまま v になる。

import * as THREE from 'three'

// 帯3本。色は再現元の実測値をそのまま使う。
//   地 #A0C8D8 32.5% / 紺 #003B8F / 深緑 #005858 / ターコイズ #00B0A8
// 裏面は「地に 0.74 だけ寄せた同じ色」。帯の裏は光を受ける面ではなく、
// 球の向こう側にある面だからで、裏が見えている＝球を透かして見ている、が
// 色だけで読めるようにしてある（球そのものは1枚も描いていない）。
export const BANDS = [
  // k_g を大きく振ると帯は小さな円に巻き込み、自分の上に何周も重なって
  // 「帯」ではなく「塗り」になる（最初の試作が緑の塊になった）。
  // 巻きが読める範囲は |k_g| ≲ 0.35 で、そこは大円のすぐ隣にあたる。
  {
    name: 'NAVY',
    front: '#003B8F',
    radius: 1.0,
    width: 0.118,
    p0: [1.0, 0.0, 0.0],
    t0: [0.0, 0.30, 0.95],
    kgA: 0.02,
    kgB: 0.19,
    kgF: 0.33,
    kgP: 0.0,
  },
  {
    name: 'PINE',
    front: '#005858',
    radius: 1.03,
    width: 0.088,
    p0: [0.0, 1.0, 0.0],
    t0: [-0.28, 0.0, 0.95],
    kgA: 0.27,
    kgB: 0.16,
    kgF: 0.26,
    kgP: 2.10,
  },
  {
    name: 'TURQ',
    front: '#00B0A8',
    radius: 1.062,
    width: 0.104,
    // 面の法線をカメラのほうへ真っ直ぐ向けると、帯じゅうが終端線の上に乗り、
    // 表と裏が丸め誤差で決まって斑になる。30°ほど倒して逃がしてある。
    p0: [0.84, 0.50, 0.15],
    t0: [-0.2675, 0.6555, -0.687],
    kgA: -0.20,
    kgB: 0.23,
    kgF: 0.20,
    kgP: 4.30,
  },
]

export const GROUND = '#A0C8D8' // 地（再現元の実測 32.5%）
export const SKY = '#EDF3F6'
export const GLOW = '#F6FAFB'
export const INK = '#183048' // 再現元の実測 10.4%

export const DS = 0.006 // 中心線の刻み（rad）
export const SPAN = 9.0 // 窓の長さ（rad）＝ 大円 1.43 周ぶん
export const M = Math.round(SPAN / DS) // 窓のサンプル数
export const SPEED = 2.55 // 先頭の進む速さ（rad/s）＝ 大円 1 周 2.46 秒

// 裏面の色 = 表の色を地へ 0.74 寄せたもの
const BACK_MIX = 0.66

export function hexToVec(hex) {
  const n = parseInt(hex.slice(1), 16)
  return new THREE.Vector3(
    ((n >> 16) & 255) / 255,
    ((n >> 8) & 255) / 255,
    (n & 255) / 255
  )
}

export function backOf(hex) {
  const f = hexToVec(hex)
  const g = hexToVec('#E3EDF2')
  return new THREE.Vector3(
    f.x + (g.x - f.x) * BACK_MIX,
    f.y + (g.y - f.y) * BACK_MIX,
    f.z + (g.z - f.z) * BACK_MIX
  )
}

// 窓の中の太り方。尾は 0 まで細って地に消え、先頭はわずかに絞る。
// u = 0 が尾、u = 1 が先頭。
function taper(u) {
  const grow = smoothstep(0.0, 0.20, u)
  const tip = 1.0 - 0.28 * smoothstep(0.62, 1.0, u)
  return grow * tip
}

function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

// ── 1本の帯 ─────────────────────────────────────────────────────────────
// リングバッファに中心線を貯め、毎フレーム「最後の M サンプル」だけを
// 三角形に張る。テーブルを事前に作って添字を回す方式にすると、表の終わりで
// 帯が一度ワープする。走らせ続ける絵なので、継ぎ目を持たないほうを取った。
export function createBand(cfg) {
  const pos = new Float32Array(M * 3)
  const bin = new Float32Array(M * 3)
  let head = -1
  let arc = 0

  const p = new THREE.Vector3(...cfg.p0).normalize()
  const T = new THREE.Vector3(...cfg.t0)
  T.addScaledVector(p, -T.dot(p)).normalize()
  const B = new THREE.Vector3()

  function push() {
    B.crossVectors(p, T).normalize() // 幅の向き。球面に接し、進行方向に直交する
    head = (head + 1) % M
    const i = head * 3
    pos[i] = p.x
    pos[i + 1] = p.y
    pos[i + 2] = p.z
    bin[i] = B.x
    bin[i + 1] = B.y
    bin[i + 2] = B.z

    // ① 大円に沿って ds 進む（p も T も同じ軸で回すので球から離れない）
    p.applyAxisAngle(B, DS)
    T.applyAxisAngle(B, DS)
    // ② 接平面の中で k_g·ds だけ曲がる
    const kg = cfg.kgA + cfg.kgB * Math.sin(cfg.kgF * arc + cfg.kgP)
    T.applyAxisAngle(p, kg * DS)
    // 丸め誤差の掃除。ここが唯一の「拘束を書いている場所」。
    p.normalize()
    T.addScaledVector(p, -T.dot(p)).normalize()
    arc += DS
  }

  for (let k = 0; k < M; k++) push() // 窓を1本ぶん満たしてから始める

  let carry = 0
  function advance(dt) {
    carry += dt * SPEED
    let steps = Math.floor(carry / DS)
    if (steps > M) steps = M // タブを裏に置いた等で dt が飛んでも1周ぶんで打ち切る
    carry -= steps * DS
    for (let k = 0; k < steps; k++) push()
    return steps
  }

  // ── 三角形を張る ──────────────────────────────────────────────────────
  const vCount = M * 2
  const vPos = new Float32Array(vCount * 3)
  const vNor = new Float32Array(vCount * 3)
  const vU = new Float32Array(vCount)
  const index = new Uint32Array((M - 1) * 6)
  for (let j = 0; j < M - 1; j++) {
    const a0 = j * 2
    const a1 = a0 + 1
    const b0 = a0 + 2
    const b1 = a0 + 3
    const o = j * 6
    index[o] = a0
    index[o + 1] = a1
    index[o + 2] = b0
    index[o + 3] = a1
    index[o + 4] = b1
    index[o + 5] = b0
  }

  const W = cfg.width
  const R = cfg.radius

  function build() {
    for (let j = 0; j < M; j++) {
      const src = ((head + 1 + j) % M) * 3
      const u = j / (M - 1)
      const a = W * taper(u)
      const ca = Math.cos(a)
      const sa = Math.sin(a)
      const px = pos[src], py = pos[src + 1], pz = pos[src + 2]
      const bx = bin[src], by = bin[src + 1], bz = bin[src + 2]
      // 法線 = 球面法線。帯の姿勢はここでしか決まっていない。
      const n0x = px * ca + bx * sa
      const n0y = py * ca + by * sa
      const n0z = pz * ca + bz * sa
      const n1x = px * ca - bx * sa
      const n1y = py * ca - by * sa
      const n1z = pz * ca - bz * sa
      const o = j * 6
      vPos[o] = n0x * R
      vPos[o + 1] = n0y * R
      vPos[o + 2] = n0z * R
      vPos[o + 3] = n1x * R
      vPos[o + 4] = n1y * R
      vPos[o + 5] = n1z * R
      vNor[o] = n0x
      vNor[o + 1] = n0y
      vNor[o + 2] = n0z
      vNor[o + 3] = n1x
      vNor[o + 4] = n1y
      vNor[o + 5] = n1z
      vU[j * 2] = u
      vU[j * 2 + 1] = u
    }
  }

  build()

  return {
    cfg,
    index,
    vPos,
    vNor,
    vU,
    advance,
    build,
    get arc() {
      return arc
    },
    get kg() {
      return cfg.kgA + cfg.kgB * Math.sin(cfg.kgF * arc + cfg.kgP)
    },
    // 先頭が今いる緯度。帯が球のどこを走っているかの唯一の数値。
    get lat() {
      const i = head * 3
      return (Math.asin(Math.max(-1, Math.min(1, pos[i + 1]))) * 180) / Math.PI
    },
  }
}
