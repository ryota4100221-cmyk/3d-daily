// rig.js — Day 057 / 距離の輪（range circle）
//
// 再現元は CITIZEN PROMASTER STB「Frontiers of Hope」。あの時計が名前に背負っている
// STB = Satellite Timekeeping System の、たった一つの事実を装置にする：
//
//   受信機は自分がどこに居るかを一度も知らない。知っているのは「いつ届いたか」だけで、
//   場所のほうが、届いた時刻から後で出てくる。
//
// だからこの rig には「受信機の座標」を保持する変数が無い。あるのは
//   ・24機の衛星がどこに居るか（軌道要素だけで決まる）
//   ・各機から出た波面が今どこまで広がったか（角半径ひとつ）
// の2つで、画面に映る赤い点は毎フレーム「4本の輪が同時に通る点」として解き直される。
// 解くのをやめれば点は消える。位置は状態ではなく、交わりの副産物として存在する。

import * as THREE from 'three'

export const R_EARTH = 1.0
export const R_ORBIT = 1.62 // 地球半径の約1.6倍。GPSの実比（4.16）だと衛星が画面外に出る
export const SV_COUNT = 24
export const PLANE_COUNT = 6
export const INCLINATION = (55 * Math.PI) / 180 // GPS の軌道傾斜角
export const TRACKED = 4 // 3次元＋時計のずれ＝未知数4つ。だから最低4機

// 波面の広がる角速度 [rad/s]。地心角 1.4rad（ほぼ地平線際）まで 2.3 秒かけて届く。
export const WAVE_RATE = 0.62
export const CYCLE = 6.2 // 1エポック：全機到達 → FIX を見せる → 次のエポックへ

// ── 軌道 ──────────────────────────────────────────────────────────────
// Walker デルタ配置。面ごとに昇交点赤経を 60° ずつ、面内で 4 機を 90° ずつ、
// さらに面番号に応じて位相をずらす（同じ経度に同時に3機並ぶのを避けるため）。
export function makeConstellation() {
  const svs = []
  for (let p = 0; p < PLANE_COUNT; p++) {
    const raan = (p / PLANE_COUNT) * Math.PI * 2
    for (let k = 0; k < SV_COUNT / PLANE_COUNT; k++) {
      const phase = (k / (SV_COUNT / PLANE_COUNT)) * Math.PI * 2 + (p * Math.PI * 2) / SV_COUNT
      svs.push({
        id: p * (SV_COUNT / PLANE_COUNT) + k + 1,
        plane: p,
        raan,
        phase,
        // 面ごとに公転速度をわずかに変える。完全に同期していると
        // 24機が「6本の線」にしか見えず、群れにならない。
        rate: 0.0855 + p * 0.0011,
      })
    }
  }
  return svs
}

const _q = new THREE.Quaternion()
const _axis = new THREE.Vector3(0, 1, 0)

// 軌道面：赤道面を x 軸まわりに傾け、それを y 軸まわりに raan だけ回す
export function svPosition(sv, t, out = new THREE.Vector3()) {
  const a = sv.phase + t * sv.rate * Math.PI * 2
  out.set(Math.cos(a) * R_ORBIT, 0, Math.sin(a) * R_ORBIT)
  out.applyAxisAngle(new THREE.Vector3(1, 0, 0), INCLINATION)
  _q.setFromAxisAngle(_axis, sv.raan)
  out.applyQuaternion(_q)
  return out
}

// 軌道そのものを線で引くための点列（面ごとに1本）
export function planeRing(raan, segments = 160) {
  const pts = []
  const q = new THREE.Quaternion().setFromAxisAngle(_axis, raan)
  const tilt = new THREE.Vector3(1, 0, 0)
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2
    const v = new THREE.Vector3(Math.cos(a) * R_ORBIT, 0, Math.sin(a) * R_ORBIT)
    v.applyAxisAngle(tilt, INCLINATION)
    v.applyQuaternion(q)
    pts.push(v)
  }
  return pts
}

// ── 受信機（画面には出さない。出るのは解いた結果だけ）────────────────────
// エポックごとに地表を移り歩く。ただし完全な自由ではなく、こちらを向いている
// 半球の内側（視軸から 0.42rad 以内）に留める。裏側に立たれると、輪が球の
// 向こうへ回り込んで「交わり」が1枚の絵にならない。
const _e1 = new THREE.Vector3()
const _e2 = new THREE.Vector3()
function hash(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return s - Math.floor(s)
}
export function receiverAt(epoch, center) {
  const c = center || new THREE.Vector3(0, 1, 0)
  // center に直交する正規直交基底。極を向いているときだけ参照軸を差し替える
  const ref = Math.abs(c.y) > 0.94 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)
  _e1.copy(ref).cross(c).normalize()
  _e2.copy(c).cross(_e1).normalize()
  const az = hash(epoch + 0.31) * Math.PI * 2
  const r = 0.16 + Math.sqrt(hash(epoch + 7.13)) * 0.26
  return new THREE.Vector3()
    .copy(c)
    .multiplyScalar(Math.cos(r))
    .addScaledVector(_e1, Math.sin(r) * Math.cos(az))
    .addScaledVector(_e2, Math.sin(r) * Math.sin(az))
    .normalize()
}

export function toLatLon(v) {
  const lat = (Math.asin(THREE.MathUtils.clamp(v.y, -1, 1)) * 180) / Math.PI
  let lon = (Math.atan2(v.z, v.x) * 180) / Math.PI
  if (lon > 180) lon -= 360
  if (lon < -180) lon += 360
  return { lat, lon }
}

// ── 可視衛星の選抜 ─────────────────────────────────────────────────────
// 仰角が高い順ではなく「地心角がばらける順」に4機選ぶ。全部真上に居ると
// 4本の輪が同心円になって交点が決まらない（実際の受信機も DOP でこれを避ける）。
export function selectTracked(svs, t, rx, scratch) {
  const cand = []
  for (const sv of svs) {
    const p = svPosition(sv, t, scratch.next())
    const sub = p.clone().normalize()
    const ang = Math.acos(THREE.MathUtils.clamp(sub.dot(rx), -1, 1))
    if (ang < 1.42) cand.push({ sv, pos: p.clone(), sub, ang })
  }
  cand.sort((a, b) => a.ang - b.ang)
  if (cand.length <= TRACKED) return cand
  // 近い1機・遠い1機・中間2機。これで輪の半径が確実にばらける
  const pick = [cand[0], cand[cand.length - 1]]
  const mid = cand.slice(1, cand.length - 1)
  pick.push(mid[Math.floor(mid.length * 0.36)])
  pick.push(mid[Math.floor(mid.length * 0.72)])
  return pick.sort((a, b) => a.ang - b.ang)
}

// 使い回しの Vector3 プール（毎フレーム 24 個 new するのを避ける）
export function pool(n) {
  const arr = Array.from({ length: n }, () => new THREE.Vector3())
  let i = 0
  return {
    next() {
      const v = arr[i % n]
      i++
      return v
    },
    reset() {
      i = 0
    },
  }
}

// ── 交わりを解く ───────────────────────────────────────────────────────
// 輪 i は「sub_i から角距離 r_i の点の集合」。単位球上ではこれは平面
//   dot(x, sub_i) = cos(r_i)
// との交線なので、4本ぶんを最小二乗で解けば交点が出る。ここが装置の芯で、
// **受信機の座標はどこにも保存されていない**——4つの cos(r_i) だけから毎フレーム出る。
const _A = new THREE.Matrix3()
export function solveFix(tracked, radii) {
  const n = Math.min(tracked.length, radii.length)
  if (n < 3) return null
  // 正規方程式 (SᵀS) x = Sᵀ b
  let m00 = 0, m01 = 0, m02 = 0, m11 = 0, m12 = 0, m22 = 0
  let b0 = 0, b1 = 0, b2 = 0
  for (let i = 0; i < n; i++) {
    const s = tracked[i].sub
    const c = Math.cos(radii[i])
    m00 += s.x * s.x; m01 += s.x * s.y; m02 += s.x * s.z
    m11 += s.y * s.y; m12 += s.y * s.z; m22 += s.z * s.z
    b0 += s.x * c; b1 += s.y * c; b2 += s.z * c
  }
  _A.set(m00, m01, m02, m01, m11, m12, m02, m12, m22)
  const det = _A.determinant()
  if (Math.abs(det) < 1e-7) return null
  const inv = _A.clone().invert()
  const e = inv.elements
  const x = new THREE.Vector3(
    e[0] * b0 + e[3] * b1 + e[6] * b2,
    e[1] * b0 + e[4] * b1 + e[7] * b2,
    e[2] * b0 + e[5] * b1 + e[8] * b2
  )
  if (x.lengthSq() < 1e-9) return null
  x.normalize()
  // 残差＝各輪から解までの角度のずれ。全機が届ききるまでは 0 にならない。
  let sig = 0
  for (let i = 0; i < n; i++) {
    const d = Math.acos(THREE.MathUtils.clamp(x.dot(tracked[i].sub), -1, 1))
    sig += (d - radii[i]) * (d - radii[i])
  }
  return { p: x, sigma: Math.sqrt(sig / n) }
}

// ── 時間 ───────────────────────────────────────────────────────────────
// エポック内の各波面の半径。全機が同時に送信し、同じ角速度で広がり、
// 自分の相手（受信機）に届いた瞬間に止まる。近い機から順に止まり、
// 最後の1機が止まった瞬間だけ、4本が1点で交わる。
export function waveRadius(tracked, tin) {
  return tracked.map((c) => Math.min(WAVE_RATE * tin, c.ang))
}

export function epochOf(t) {
  const e = Math.floor(t / CYCLE)
  return { epoch: e, tin: t - e * CYCLE }
}
