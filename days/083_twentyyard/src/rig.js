// rig.js — Day 083「二十ヤードの穴」
//
// ここには「曲げる」という命令が一行も無い。書いてあるのは、面内の力を
// 速度に足して積分することだけ。曲がりはその帰結として出てくる。
//
// 回転軸を鉛直に取る＝真上から見るので、重力は面外に落ちて面内の式に現れない。
// 面内に残るのは2つだけ：
//
//   マグヌス力   F_M = ½ ρ A C_L |v|²  （速度に直交）
//   抗力         F_D = ½ ρ A C_D |v|²  （速度と逆向き）
//
// このとき軌跡の曲率は
//
//   dθ/ds = |a_⊥| / |v|² = (½ ρ A C_L |v|² / m) / |v|² = ρ A C_L / (2m) = 1/R
//
// ＝ |v| が約分で完全に消える。抗力は |v| を削るが、曲率の式に |v| は
// もう残っていないので**形は一切変わらない**。R は長さで、球の質量・空気密度・
// 断面積・揚力係数だけでできている。蹴りの強さはどこにも入らない。

// ── 競技規則の定数 ────────────────────────────────────────────────────
// 壁の最小距離。10ヤード = 9.144 m（競技規則 第13条）。
export const WALL = 9.144
// ゴール幅 7.32 m（8ヤード）
export const GOAL_W = 7.32
// ペナルティエリアのライン 16.5 m（18ヤード）
export const BOX = 16.5

// ── 球の既定値（FIFA Quality Pro の規格内）────────────────────────────
export const BALL = {
  m: 0.43, // kg（規格 410–450 g）
  r: 0.11, // m（外周 68–70 cm → 半径 0.1082–0.1114）
  rho: 1.225, // kg/m³（海面標準大気）
  CL: 0.33, // 揚力係数（スピン比 S = ωr/v ≒ 0.3 前後・よく巻いた曲球の実測帯）
  CD: 0.22, // 抗力係数（超臨界域）
}

/** 曲げ長さ R = 2m / (ρ A C_L)。速度も回転数も入らない。単位は m。 */
export function bendRadius({ m, r, rho, CL } = BALL) {
  return (2 * m) / (rho * Math.PI * r * r * CL)
}

/** C_L を逆算する（UIは R を直接いじるので、その表示用）。 */
export function liftFromRadius(R, { m, r, rho } = BALL) {
  return (2 * m) / (rho * Math.PI * r * r * R)
}

// ── 厳密解（円弧）──────────────────────────────────────────────────────
// 原点から +x 方向に蹴り出し、+z 側へ曲がる。曲率 1/R が一定なので厳密に円。

/** 飛距離 x における横ずれ z。x > R では円が折り返すので定義域外を返さない。 */
export function zAtX(R, x) {
  const t = x / R
  if (t >= 1) return R
  return R * (1 - Math.sqrt(1 - t * t))
}

/** 弧長 s における位置 [x, z]。 */
export function pointAtS(R, s) {
  const th = s / R
  return [R * Math.sin(th), R * (1 - Math.cos(th))]
}

/** 飛距離 x に達するまでの弧長。 */
export function sAtX(R, x) {
  return R * Math.asin(Math.min(1, x / R))
}

/** 飛距離 x での進行方向の傾き dz/dx。 */
export function slopeAtX(R, x) {
  const t = x / R
  return t / Math.sqrt(Math.max(1e-12, 1 - t * t))
}

// ── 装置本体 ──────────────────────────────────────────────────────────
// サッカーが測っているのは「飛距離」ではなく **ボールとゴールの直線距離** ＝ 弦 C。
// 競技規則が壁に課しているのも「ボールから 9.144 m」＝ 弦の上の距離。
// この2つが同じ物差しなので、装置は弦で書く。
//
// 弦を ξ 軸に取り、弧が +η 側へ膨らむとすると、中心は (0, −k)、k = √(R² − (C/2)²)。
//
//   弦からの離れ  d(ξ) = √(R² − ξ²) − k      （ξ ∈ [−C/2, +C/2]）
//
// これは ξ の偶関数なので、**最大は厳密に ξ = 0 ＝ 弦の中点**。近似ではない。
// 円弧は弦の垂直二等分線について対称、というそれだけのことである。
//
// 壁は弦上 9.144 m の位置、つまり ξ_wall = 9.144 − C/2。
// よって C = 2 × 9.144 = 18.288 m のとき ξ_wall = 0 ＝ **壁は、ボールが弦から
// いちばん離れている、ちょうどその点に立つ。** これが二十ヤードの穴。

export function kick(R, C) {
  const half = C / 2
  const k = Math.sqrt(Math.max(0, R * R - half * half))
  const sagitta = R - k // 弦の中点での離れ（＝ 離れの最大値・厳密）
  const xiWall = WALL - half // 壁の弦上位置（中点を 0 とする）
  const clearWall = Math.sqrt(Math.max(0, R * R - xiWall * xiWall)) - k

  // 蹴り出し方向は弦に対して φ/2 傾く（接弦角）。着弾方向も同じ角だけ傾く。
  const phi = 2 * Math.asin(Math.min(1, half / R)) // 弧の中心角
  const Y = R * (1 - Math.cos(phi)) // 狙い線（蹴り出し方向）からの総曲がり幅
  const Lx = R * Math.sin(phi) // 狙い線に沿った到達距離

  // 壁の時点で「済んでいる曲がり」（狙い線から見た割合）
  const tWall = phi / 2 + Math.asin(xiWall / R)
  const zWall = R * (1 - Math.cos(tWall))
  const xWall = R * Math.sin(tWall)
  const u = WALL / C // 壁の弦上の相対位置

  // キーパーが壁の位置で接線を引いて読んだ着弾予測と、その不足。
  const predicted = zWall + slopeAtX(R, xWall) * (Lx - xWall)
  const keeperShort = (Y - predicted) / Y

  return {
    R,
    C,
    phi,
    Y,
    Lx,
    u,
    sagitta,
    clearWall,
    xiWall,
    xWall,
    zWall,
    predicted,
    keeperShort,
    aimOff: phi / 2, // 狙い線がゴールから外れている角（rad）
    clearFrac: clearWall / sagitta, // 壁での離れ ÷ 最大の離れ（C=18.288 で 1）
    doneAtWall: zWall / Y, // 壁で済んでいる曲がりの割合（厳密）
    doneAtWallParabola: u * u, // 放物線近似の予言
    sagFrac: sagitta / Y, // 放物線近似では厳密に 1/4
  }
}

/** 軌跡上の点列（等弧長）。描画用。返り値は狙い線基準の [x, z]。 */
export function path(R, C, n = 256) {
  const phi = 2 * Math.asin(Math.min(1, C / (2 * R)))
  const out = []
  for (let i = 0; i <= n; i++) {
    const t = (phi * i) / n
    out.push([R * Math.sin(t), R * (1 - Math.cos(t))])
  }
  return out
}

// ── 積分器（形が速度を覚えていないことを、式ではなく数値で言う）─────────
// 面内だけの RK4。状態は [x, z, vx, vz]。
// マグヌスは速度に直交、抗力は速度と逆向き。どちらも |v|² に比例。

function deriv(st, c) {
  const [, , vx, vz] = st
  const v = Math.hypot(vx, vz) || 1e-12
  const ux = vx / v
  const uz = vz / v
  const q = (0.5 * c.rho * Math.PI * c.r * c.r * v * v) / c.m
  // 直交方向は (−uz, ux) ＝ 左手側。+z へ曲げたいので符号はこのまま。
  const ax = q * (c.CL * -uz - c.CD * ux)
  const az = q * (c.CL * ux - c.CD * uz)
  return [vx, vz, ax, az]
}

/**
 * 蹴り出し速度 v0 で L まで飛ばし、等飛距離でサンプルした横ずれ z(x) を返す。
 * v0 を変えても返り値が変わらない、というのがこの装置の主張。
 */
export function integrate({ v0, L, nOut = 64, dt = 2e-5, ...over } = {}) {
  const c = { ...BALL, ...over }
  let st = [0, 0, v0, 0]
  const xs = []
  for (let i = 0; i <= nOut; i++) xs.push((L * i) / nOut)
  const out = [0]
  let k = 1
  let t = 0
  let guard = 0
  while (k <= nOut && guard++ < 20_000_000) {
    const prev = st
    const a = deriv(st, c)
    const b = deriv(st.map((s, i) => s + (dt / 2) * a[i]), c)
    const d = deriv(st.map((s, i) => s + (dt / 2) * b[i]), c)
    const e = deriv(st.map((s, i) => s + dt * d[i]), c)
    st = st.map((s, i) => s + (dt / 6) * (a[i] + 2 * b[i] + 2 * d[i] + e[i]))
    t += dt
    while (k <= nOut && st[0] >= xs[k]) {
      // x について線形補間（dt が十分小さいので誤差は dt² 以下）
      const f = (xs[k] - prev[0]) / (st[0] - prev[0])
      out.push(prev[1] + f * (st[1] - prev[1]))
      k++
    }
    if (st[2] <= 0) break // 減速しきって前に進まなくなった
  }
  return { xs, zs: out, t }
}

// ── タイルの網点（面そのものに u² を刷り込む）──────────────────────────
// 再現元は白／コバルト青／緑のタイルで面を作っている。その面を、
// 「その地点までに済んでいる曲がりの割合」の網点にする。
// 値じゃなくて**密度**で持たせるので、グラデーションではなくタイルのままになる。

function hash2(i, j) {
  let h = Math.imul(i + 0x9e37, 374761393) ^ Math.imul(j + 0x85eb, 668265263)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/**
 * 列 i に色タイルを何個どこに置くか。
 *
 * 乱数のしきい値で切ると、22個しかない列では二項分布のばらつき（σ ≦ 0.107）が
 * そのまま密度の誤差になって、面に刷った数字が嘘になる。なので**順位**で切る：
 * 列ごとに固定のハッシュで行を並べ替え、上から round(frac × NZ) 個だけ塗る。
 * 密度は構成上ぴったり合い、並びは列ごとに違うので網点のまま散らばる。
 *
 * 返り値: 長さ NZ の配列（0 = 白, 1 = コバルト青, 2 = 緑）
 */
export function inkColumn(i, NZ, frac) {
  const order = []
  for (let j = 0; j < NZ; j++) order.push([hash2(i, j), j])
  order.sort((a, b) => a[0] - b[0])
  const n = Math.round(Math.max(0, Math.min(1, frac)) * NZ)
  const out = new Int8Array(NZ)
  for (let k = 0; k < n; k++) {
    const j = order[k][1]
    out[j] = hash2(j + 977, i + 131) < 0.26 ? 2 : 1
  }
  return out
}
