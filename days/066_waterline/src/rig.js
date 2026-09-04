// rig.js — Day 066 / THE WATERLINE
//
// 再現元（電通 新卒採用サイト 2026）は、水色の空と青い海で画面を上下に割り、
// その境界線だけに人を泳がせている。写真は1枚も使わず、フラットな塗り分けだけ。
// 再現するのはその「境界線」ひとつ。
//
// ここに置いてあるのは3つだけ:
//   ① 波の場          — CPU（体の浮き沈み）と GPU（頂点の付け替え）が同じ表を読む
//   ② 泳者の骨格      — クロールの1周期。10本のカプセルしか無い
//   ③ 二度目の読みの定数 — 水面より下に落ちた点を、もう一度だけ読み直すための数
//
// 水面のメッシュは1枚も無い。海は色の領域であって、面ではない。
// 水があることは、水面をまたいだ体が「短く・横へずれ・色が抜ける」ことだけで分かる。

import { Vector2, Vector3, LatheGeometry, Float32BufferAttribute } from 'three'

// ── ③ 二度目の読み ──────────────────────────────────────────────────────
// 水中の点 P は、そこにあるようには見えない。見かけの深さは d/η まで浮き上がり、
// 水面が傾いていればその傾きぶん横へ流れる。これは材質ではなく座標の付け替え。
export const ETA = 1.34 // 見かけの深さ  d′ = d / η
export const BEND = 1.05 // 面の傾き ∇h ぶん、横へどれだけ流すか
export const WASH = 1.35 // 沈むほど地の色へ寄る速さ（水は色を洗う）

// ── ① 波の場 ────────────────────────────────────────────────────────────
// 3成分だけ。低い・長い・ゆるい。海面ではなく「プールの水面」の温度にする。
// ax=振幅 / (kx,kz)=波数 / w=角速度 / ph=位相
export const WAVES = [
  { ax: 0.052, kx: 0.44, kz: 0.13, w: 0.92, ph: 0.0 },
  { ax: 0.030, kx: -0.21, kz: 0.58, w: 1.29, ph: 1.72 },
  { ax: 0.017, kx: 0.81, kz: -0.67, w: 1.94, ph: 3.41 },
]

export function waveH(x, z, t) {
  let h = 0
  for (let i = 0; i < WAVES.length; i++) {
    const s = WAVES[i]
    h += s.ax * Math.sin(s.kx * x + s.kz * z + s.w * t + s.ph)
  }
  return h
}

// 同じ表を GLSL 側でも読む。uniform に流し込むので式は1回しか書かれていない。
export const WAVE_GLSL = /* glsl */ `
  uniform vec4  uWave[3];   // (ax, kx, kz, w)
  uniform float uWavePh[3];

  float waveH(vec2 p, float t) {
    float h = 0.0;
    for (int i = 0; i < 3; i++) {
      vec4 s = uWave[i];
      h += s.x * sin(s.y * p.x + s.z * p.y + s.w * t + uWavePh[i]);
    }
    return h;
  }
  // ∇h。水面がどちらへ傾いているか＝水中の点がどちらへ流れて見えるか。
  vec2 waveGrad(vec2 p, float t) {
    vec2 g = vec2(0.0);
    for (int i = 0; i < 3; i++) {
      vec4 s = uWave[i];
      float c = s.x * cos(s.y * p.x + s.z * p.y + s.w * t + uWavePh[i]);
      g += vec2(s.y, s.z) * c;
    }
    return g;
  }
`

// ── 配色 ────────────────────────────────────────────────────────────────
// 再現元は「設計の色を持たず、フラットな塗り分けだけ」。こちらも面光源も影も持たない。
export const PALETTE = {
  skyHigh: '#d7e5ea',
  skyLow: '#e7eef0',
  sea: '#2b6d8d',
  haze: '#9db9c5',
  body: '#1b2b38',
  capWarm: '#de6a38', // 補色側。画面に散る点はこれだけ
  capBone: '#f2efe8',
}

// ── ② 泳者の骨格 ────────────────────────────────────────────────────────
// 前方は +x。カプセル10本（胴・頭・上腕2・前腕2・腿2・脛2）。
// 頭のカプセルはそのままスイムキャップなので、色はここに1つだけ乗る。
export const PARTS = 10
export const HEAD_PART = 1

function mulberry32(a) {
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function makeShoal(n, seed = 20260905) {
  const rnd = mulberry32(seed)
  const out = []
  for (let i = 0; i < n; i++) {
    // 遠いほど密に。奥へ行くほど1体が小さくなるので、数で線を保たせる。
    const z = -2.2 - 46 * Math.pow(rnd(), 1.08)
    const span = 3.1 + 0.62 * Math.abs(z) // 画面外まで往復させる幅
    const r = rnd()
    out.push({
      z,
      span,
      x0: (rnd() * 2 - 1) * span,
      speed: 0.46 + 0.10 * rnd(),
      rate: 0.50 + 0.13 * rnd(), // ストローク周期（回/秒）
      phase: rnd(),
      scale: 0.94 + 0.14 * rnd(),
      lift: 0.86 + 0.20 * rnd(), // 波にどれだけ乗るか
      cap: r < 0.22 ? PALETTE.capWarm : r < 0.36 ? PALETTE.capBone : PALETTE.body,
    })
  }
  // 手前から描かれる順に並べておくと、色を差した個体が奥に埋もれない
  out.sort((a, b) => a.z - b.z)
  return out
}

export function makeSegments() {
  return Array.from({ length: PARTS }, () => ({ a: new Vector3(), b: new Vector3(), r: 0 }))
}

// 1体を1フレーム分ポーズする。out は makeSegments() の戻り値、hands は Vector3 ×2。
export function poseSwimmer(sw, t, out, hands) {
  const cyc = sw.phase + t * sw.rate
  const s = sw.scale
  const z = sw.z

  // 帯を往復させる。折り返しは常に画面の外側で起きる。
  const raw = sw.x0 + sw.speed * t + sw.span
  const x = (((raw % (2 * sw.span)) + 2 * sw.span) % (2 * sw.span)) - sw.span

  const roll = 0.42 * Math.sin(2 * Math.PI * cyc) // クロールのローリング
  const cr = Math.cos(roll)
  const sr = Math.sin(roll)
  const y0 = waveH(x, z, t) * sw.lift + 0.012 * s

  let k = 0
  const put = (ax, ay, az, bx, by, bz, r) => {
    const o = out[k++]
    o.a.set(x + ax * s, y0 + (ay * cr - az * sr) * s, z + (ay * sr + az * cr) * s)
    o.b.set(x + bx * s, y0 + (by * cr - bz * sr) * s, z + (by * sr + bz * cr) * s)
    o.r = r * s
  }

  put(-0.58, 0.0, 0.0, 0.18, 0.012, 0.0, 0.126) // 0 胴
  put(0.28, 0.035, 0.0, 0.40, 0.05, 0.0, 0.104) // 1 頭（＝キャップ）

  let hi = 0
  for (const side of [1, -1]) {
    // 腕は肩まわりの1周。上で戻し（リカバリ）、下で掻く（プル）。
    const p = cyc + (side > 0 ? 0 : 0.5)
    const th = Math.PI - 2 * Math.PI * (p - Math.floor(p))
    const dx = Math.cos(th)
    const dy = Math.sin(th)
    const shX = 0.13
    const shZ = 0.155 * side
    const ex = shX + 0.30 * dx
    const ey = 0.30 * dy
    const ez = shZ + 0.055 * side
    const fa = th - 0.85 * Math.max(0, -dy) // 掻いている間だけ肘が折れる
    const hx = ex + 0.28 * Math.cos(fa)
    const hy = ey + 0.28 * Math.sin(fa)
    const hz = ez + 0.03 * side
    put(shX, 0.0, shZ, ex, ey, ez, 0.055)
    put(ex, ey, ez, hx, hy, hz, 0.045)
    if (hands) hands[hi++].copy(out[k - 1].b) // 手先＝入水点
  }

  for (const side of [1, -1]) {
    const kp = cyc * 2 + (side > 0 ? 0 : 0.5)
    const a1 = -Math.PI + 0.30 * Math.sin(2 * Math.PI * kp)
    const hipX = -0.54
    const hipZ = 0.085 * side
    const kx = hipX + 0.30 * Math.cos(a1)
    const ky = 0.30 * Math.sin(a1)
    const a2 = a1 + 0.46 * Math.sin(2 * Math.PI * kp - 0.9)
    put(hipX, 0.0, hipZ, kx, ky, hipZ, 0.068)
    put(kx, ky, hipZ, kx + 0.30 * Math.cos(a2), ky + 0.30 * Math.sin(a2), hipZ, 0.050)
  }
}

// ── カプセル ────────────────────────────────────────────────────────────
// 半径1の球を、赤道に「引き伸ばし用の帯」を挟んで作る。帯は同じ点を stripSeg 本
// 重ねただけの縮退した輪で、頂点シェーダで aStretch * aHalf だけ上下へ開くと
// はじめて円筒になる。ここを1枚のクアッドで済ませると、水面をまたいだ腕が
// 折れずに直線で刺さる（＝二度目の読みが効いていないように見える）。
export function capsuleGeometry(capSeg = 7, stripSeg = 16, radial = 14) {
  const pts = []
  const stretch = []
  for (let i = 0; i <= capSeg; i++) {
    const a = -Math.PI / 2 + (Math.PI / 2) * (i / capSeg)
    pts.push(new Vector2(Math.cos(a), Math.sin(a)))
    stretch.push(-1)
  }
  for (let i = 1; i < stripSeg; i++) {
    pts.push(new Vector2(1, 0))
    stretch.push(-1 + 2 * (i / stripSeg))
  }
  for (let i = 0; i <= capSeg; i++) {
    const a = (Math.PI / 2) * (i / capSeg)
    pts.push(new Vector2(Math.cos(a), Math.sin(a)))
    stretch.push(1)
  }

  const geo = new LatheGeometry(pts, radial)
  const P = pts.length
  const pos = geo.attributes.position
  const nrm = new Float32Array(pos.count * 3)
  const str = new Float32Array(pos.count)
  for (let i = 0; i < pos.count; i++) {
    str[i] = stretch[i % P] // LatheGeometry は [セグメント][プロファイル] の順
    const px = pos.getX(i)
    const py = pos.getY(i)
    const pz = pos.getZ(i)
    // 単位球（と半径1の帯）なので、法線は位置そのもの。縮退した帯でも正しく出る。
    const L = Math.hypot(px, py, pz) || 1
    nrm[i * 3] = px / L
    nrm[i * 3 + 1] = py / L
    nrm[i * 3 + 2] = pz / L
  }
  geo.setAttribute('normal', new Float32BufferAttribute(nrm, 3))
  geo.setAttribute('aStretch', new Float32BufferAttribute(str, 1))
  return geo
}
