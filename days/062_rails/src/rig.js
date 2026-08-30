// rig.js — 二本の軌条 / The Two Rails
//
// エスカレータの踏段は「水平に保たれている」のではない。水平になってしまうのだ。
// 踏段は前後2本の車軸を持ち、前軸（main roller）と後軸（trailing roller）が
// **別々の軌条**を走る。踏面の角度は2つの車軸を結ぶ直線の角度そのものなので、
// 2本の軌条の間隔さえ決めれば、傾斜部では水平に、乗降口では畳まれて重なる。
//
// このファイルには「踏面を水平にする」という式が1行も無い。書いてあるのは
//
//     p(s) = D · sin(θ(s))            ← 2本の軌条の垂直距離
//
// これだけで、あとは |A(s) − B(u)| = D を u について解いている。
// 傾斜角 θ の直線区間で、A から垂直距離 p だけ離れた平行線 B 上に
// 距離 D の点を取ると、その2点を結ぶ線は必ず水平になる:
//
//     A(t) − B(u) = (t−u)·(cosθ, sinθ) − p·(sinθ, −cosθ)
//     y成分 = 0  ⇔  t−u = −p·cotθ         → |A−B| = p/sinθ = D  ⇔  p = D·sinθ
//
// 乗降口では θ=0 なので p=0、つまり2本の軌条が1本に合流する。合流すれば
// 前後の車軸が同じ高さに並び、踏段は畳まれて平らな板の列になる。
// 「踏段が生まれる」あの動きは、軌条が別れていく過程そのもの。

export const P = {
  alpha: Math.PI / 6, // 傾斜角 30.0°（東芝エレベータの標準勾配）
  D: 0.8, // 軸距 800mm（main → trailing）
  W: 1.02, // 踏段の有効幅 1000mm
  TREAD: 0.3, // 踏面の高さ（main 軸から上に）
  R_CURVE: 2.3, // 上下曲率半径
  L_LAND: 3.4, // 乗降口の水平部
  L_INCL: 12.6, // 傾斜直線部
  H_BELT: 1.1, // 上行路と返り路の間隔（端部スプロケットの直径）
  DS: 0.02, // 軌条のサンプリング間隔
  SPEED: 0.5, // 定格速度 30m/min = 0.50 m/s
  Z_A: 0.63, // main track の z（左右・踏段より外）
  Z_B: 0.55, // trailing track の z（左右・少し内側）
}

P.RISE = P.D * Math.sin(P.alpha) // 蹴上げ 400mm
P.DEPTH = P.D * Math.cos(P.alpha) // 踏面奥行 693mm

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)

// ── 1. 上行路（乗降口—傾斜—乗降口）を等間隔で刻む ──────────────────────
function buildUpper() {
  const pts = []
  let x = 0
  let y = 0
  let psi = 0
  pts.push([x, y])
  const line = (len) => {
    const n = Math.max(1, Math.round(len / P.DS))
    const d = len / n
    for (let i = 0; i < n; i++) {
      x += d * Math.cos(psi)
      y += d * Math.sin(psi)
      pts.push([x, y])
    }
  }
  const arc = (R, dpsi) => {
    const len = R * Math.abs(dpsi)
    const n = Math.max(2, Math.round(len / P.DS))
    const dp = dpsi / n
    const d = len / n
    for (let i = 0; i < n; i++) {
      psi += dp * 0.5
      x += d * Math.cos(psi)
      y += d * Math.sin(psi)
      psi += dp * 0.5
      pts.push([x, y])
    }
  }
  line(P.L_LAND)
  arc(P.R_CURVE, P.alpha)
  line(P.L_INCL)
  arc(P.R_CURVE, -P.alpha)
  line(P.L_LAND)
  return pts
}

// ── 2. 返り路 = 上行路を進行方向の右手（＝下側）へ H_BELT だけずらして反転 ──
function rightNormals(pts) {
  const n = []
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)]
    const b = pts[Math.min(pts.length - 1, i + 1)]
    let tx = b[0] - a[0]
    let ty = b[1] - a[1]
    const l = Math.hypot(tx, ty) || 1
    tx /= l
    ty /= l
    n.push([ty, -tx, tx, ty]) // [mx, my, tx, ty]
  }
  return n
}

// 端部の半円キャップ。中心は C = P + (h/2)·m、m を −τ 回転して掃く。
function cap(px, py, mx, my, h, segs) {
  const cx = px + (h / 2) * mx
  const cy = py + (h / 2) * my
  const vx = px - cx
  const vy = py - cy
  const out = []
  for (let i = 1; i < segs; i++) {
    const t = -(Math.PI * i) / segs
    out.push([cx + vx * Math.cos(t) - vy * Math.sin(t), cy + vx * Math.sin(t) + vy * Math.cos(t)])
  }
  return out
}

function buildLoopRaw() {
  const up = buildUpper()
  const nrm = rightNormals(up)
  const ret = up.map((p, i) => [p[0] + P.H_BELT * nrm[i][0], p[1] + P.H_BELT * nrm[i][1]])
  const last = up.length - 1
  const segs = Math.max(6, Math.round((Math.PI * (P.H_BELT / 2)) / P.DS))
  const capTop = cap(up[last][0], up[last][1], nrm[last][0], nrm[last][1], P.H_BELT, segs)
  const capBot = cap(ret[0][0], ret[0][1], -nrm[0][0], -nrm[0][1], P.H_BELT, segs)
  return [...up, ...capTop, ...ret.slice().reverse(), ...capBot]
}

// ── 3. 閉ループを弧長で等間隔に貼り直す ─────────────────────────────────
function resampleClosed(raw, ds) {
  const cum = [0]
  for (let i = 1; i <= raw.length; i++) {
    const a = raw[i - 1]
    const b = raw[i % raw.length]
    cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]))
  }
  const L = cum[raw.length]
  const N = Math.round(L / ds)
  const step = L / N
  const out = new Float64Array(N * 2)
  let j = 0
  for (let k = 0; k < N; k++) {
    const target = k * step
    while (j < raw.length - 1 && cum[j + 1] < target) j++
    const seg = cum[j + 1] - cum[j] || 1
    const f = (target - cum[j]) / seg
    const a = raw[j]
    const b = raw[(j + 1) % raw.length]
    out[k * 2] = a[0] + (b[0] - a[0]) * f
    out[k * 2 + 1] = a[1] + (b[1] - a[1]) * f
  }
  return { pts: out, N, L, step }
}

// ── 4. 軌条 A / B と、車軸拘束 |A(s) − B(u)| = D の解 ────────────────────
function build() {
  const { pts: A, N, L, step } = resampleClosed(buildLoopRaw(), P.DS)
  const tan = new Float64Array(N * 2)
  for (let i = 0; i < N; i++) {
    const a = ((i - 1) + N) % N
    const b = (i + 1) % N
    let tx = A[b * 2] - A[a * 2]
    let ty = A[b * 2 + 1] - A[a * 2 + 1]
    const l = Math.hypot(tx, ty) || 1
    tan[i * 2] = tx / l
    tan[i * 2 + 1] = ty / l
  }

  // 🔴 このファイルで「装置」と呼べるのはこの2行だけ。
  //    p は軌条 A の傾きだけから決まり、踏面の角度は一度も出てこない。
  //    端部の半円では傾きが ±90° まで振れて p が曲率半径を超え軌条が自分と
  //    交わるので、傾斜角 alpha で頭打ちにしている（見えない区間の都合）。
  const B = new Float64Array(N * 2)
  const pOff = new Float64Array(N)
  for (let i = 0; i < N; i++) {
    const elev = Math.asin(clamp(tan[i * 2 + 1], -1, 1))
    // 符号は上向き。傾斜を後ろへ D だけ水平に戻ると、鎖の線より上に出る
    // （鎖は下がり、踏面は下がらない）。だから後軸の軌条は鎖の上に敷かれる。
    const p = -P.D * Math.sin(clamp(elev, -P.alpha, P.alpha))
    pOff[i] = p
    B[i * 2] = A[i * 2] + p * tan[i * 2 + 1]
    B[i * 2 + 1] = A[i * 2 + 1] - p * tan[i * 2]
  }

  const bAt = (u) => {
    const f = u - Math.floor(u)
    const i = ((Math.floor(u) % N) + N) % N
    const j = (i + 1) % N
    return [B[i * 2] + (B[j * 2] - B[i * 2]) * f, B[i * 2 + 1] + (B[j * 2 + 1] - B[i * 2 + 1]) * f]
  }

  // 各 i について、後方に距離 D の点を軌条 B 上に探す。
  // 近い側では |A−B| = |p| < D、遠ざかると D を超えるので符号が変わる。
  const phi = new Float64Array(N)
  const trail = new Float64Array(N * 2)
  const near = 0.08 * P.D / step
  const far = 2.4 * P.D / step
  for (let i = 0; i < N; i++) {
    const ax = A[i * 2]
    const ay = A[i * 2 + 1]
    let lo = i - near
    let hi = lo
    let found = false
    for (let k = near; k <= far; k += 1) {
      const u = i - k
      const b = bAt(u)
      if (Math.hypot(ax - b[0], ay - b[1]) >= P.D) {
        hi = u
        lo = u + 1
        found = true
        break
      }
    }
    if (!found) hi = i - far
    for (let it = 0; it < 26; it++) {
      const mid = (lo + hi) / 2
      const b = bAt(mid)
      if (Math.hypot(ax - b[0], ay - b[1]) >= P.D) hi = mid
      else lo = mid
    }
    const b = bAt((lo + hi) / 2)
    trail[i * 2] = b[0]
    trail[i * 2 + 1] = b[1]
    phi[i] = Math.atan2(ay - b[1], ax - b[0])
  }

  return { A, B, tan, pOff, phi, trail, N, L, step }
}

export const track = build()

// ── 5. 参照 ─────────────────────────────────────────────────────────────
const wrap = (s) => {
  const N = track.N
  let i = s / track.step
  i = ((i % N) + N) % N
  return i
}

// 弧長 s（m）での main 軸位置・踏面角・軌条間隔
export function poseAt(s) {
  const t = track.N
  const fi = wrap(s)
  const i = Math.floor(fi)
  const j = (i + 1) % t
  const f = fi - i
  const x = track.A[i * 2] + (track.A[j * 2] - track.A[i * 2]) * f
  const y = track.A[i * 2 + 1] + (track.A[j * 2 + 1] - track.A[i * 2 + 1]) * f
  let d = track.phi[j] - track.phi[i]
  if (d > Math.PI) d -= 2 * Math.PI
  if (d < -Math.PI) d += 2 * Math.PI
  return { x, y, phi: track.phi[i] + d * f, p: track.pOff[i] + (track.pOff[j] - track.pOff[i]) * f }
}

// 上行路の弧長。返り路と端部スプロケットは実機ではトラス内で見えないので、
// 軌条も踏段もここで切る。切ると画面には「2本の線と、その上の踏段」しか残らない。
export const UPPER_LEN = 2 * P.L_LAND + 2 * P.R_CURVE * P.alpha + P.L_INCL

// 軌条を3D折れ線として吐く（TubeGeometry 用・上行路だけ）
export function railPoints(which, z) {
  const src = which === 'B' ? track.B : track.A
  const last = Math.floor(UPPER_LEN / track.step)
  const out = []
  for (let i = 2; i <= last - 2; i += 3) out.push([src[i * 2], src[i * 2 + 1], z])
  return out
}

// 踏段の総数（軸距ちょうどで詰める＝実機と同じ）
export const STEP_COUNT = Math.round(track.L / P.D)
export const STEP_PITCH = track.L / STEP_COUNT

// 傾斜直線部の弧長レンジ（カメラと検証で使う）
export const INCLINE = {
  from: P.L_LAND + P.R_CURVE * P.alpha,
  to: P.L_LAND + P.R_CURVE * P.alpha + P.L_INCL,
}
