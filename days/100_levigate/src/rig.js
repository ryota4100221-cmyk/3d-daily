// rig.js — 水簸（すいひ）の柱。粒は1つずつ、自分の終末速度で落ちるだけ。
//
// 選り分ける命令はどこにも無い。ふるいも、層の境界も、グラデーションも書かない。
// 粒径 d の粒は w(d) で落ち、床に着いた順に下から積もる。それだけで
//   ・上の水は時間とともに「細かいものしか残っていない水」になり
//   ・床には粗→細の級化層（graded bed）が勝手にできる。
//
// 単位: 長さは cm（シーン座標と同じ）、時間は s、粒径は µm。

export const H = 30 // 柱の水深 [cm]
export const W = 11 // 柱の幅 [cm]（見せ方）
export const SIPHON = 10 // 取水口は水面から 10 cm 下（Atterberg 円筒の慣習）
export const T_MAX = 7 * 24 * 3600 // スクロールの終点 = 7日

const G = 9.81 // m/s²
const NU = 1.0e-6 // 水の動粘性係数 20°C [m²/s]
// Ferguson & Church (2004)。小さい粒では Stokes（w = R g d²/18ν）そのものに戻り、
// 砂では慣性で頭打ちになる。C2=1.0 は自然な角ばった粒。
const C1 = 18
const C2 = 1.0

export const KINDS = [
  { name: 'Quartz sand', rho: 2.65, lo: 63, hi: 400 },
  { name: 'Silt', rho: 2.65, lo: 2, hi: 63 },
  { name: 'Kaolinite', rho: 2.6, lo: 0.4, hi: 2 },
]
// 粒の「数」の割合（質量ではない。見せるための割合で、実際の原鉱は質量で砂が勝つ）
const SHARE = [0.26, 0.32, 0.42]

/** 終末速度 [cm/s]。d は µm、rho は g/cm³。 */
export function settle(dUm, rho = 2.65) {
  const d = dUm * 1e-6
  const R = rho - 1.0
  const w = (R * G * d * d) / (C1 * NU + Math.sqrt(0.75 * C2 * R * G * d * d * d))
  return w * 100
}

/** 時刻 t に、水面から depth [cm] より上に残っていられる最大の粒径 d* [µm]。 */
export function cutDiameter(t, depth = SIPHON, rho = 2.65) {
  if (t <= 0) return Infinity
  const need = depth / t // この速さより遅い粒だけが、水面から出発してまだ上にいる
  let lo = 0.01
  let hi = 5000
  for (let i = 0; i < 80; i++) {
    const mid = Math.sqrt(lo * hi)
    if (settle(mid, rho) > need) hi = mid
    else lo = mid
  }
  return Math.sqrt(lo * hi)
}

/** 水面から depth を粒径 d が落ち切る時間 [s]。 */
export const clearTime = (dUm, depth = SIPHON, rho = 2.65) => depth / settle(dUm, rho)

// 再現できる乱数（毎回同じ柱）
function mulberry(seed) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function buildColumn(N = 52000, bins = 150, bedHeight = 4.2) {
  const rnd = mulberry(1892) // Sedlec の創業年
  const x = new Float32Array(N)
  const z = new Float32Array(N)
  const y0 = new Float32Array(N)
  const w = new Float32Array(N)
  const d = new Float32Array(N)
  const kind = new Float32Array(N)
  const slot = new Float32Array(N)
  const arrive = new Float64Array(N)
  const bin = new Int32Array(N)

  for (let i = 0; i < N; i++) {
    const r = rnd()
    const k = r < SHARE[0] ? 0 : r < SHARE[0] + SHARE[1] ? 1 : 2
    const K = KINDS[k]
    // 粒径は各区分の中で対数一様
    const dd = Math.exp(Math.log(K.lo) + rnd() * (Math.log(K.hi) - Math.log(K.lo)))
    // 列は順番に割り当てる（乱数だと列ごとの粒数がばらつき、床の上面がギザギザに立つ）
    const b = i % bins
    x[i] = ((b + rnd()) / bins - 0.5) * W
    z[i] = (rnd() - 0.5) * W * 0.6
    y0[i] = rnd() * H // 掻き混ぜた直後＝高さ方向に一様
    d[i] = dd
    kind[i] = k
    w[i] = settle(dd, K.rho)
    arrive[i] = y0[i] / w[i]
    bin[i] = b
  }

  // 床に着いた順に、その列（bin）の下から1段ずつ積む。
  // 先に着いた粒が下＝級化層。境界を書く命令はここにも無い。
  const perBin = Array.from({ length: bins }, () => [])
  for (let i = 0; i < N; i++) perBin[bin[i]].push(i)
  const dh = bedHeight / (N / bins)
  for (const list of perBin) {
    list.sort((a, b) => arrive[a] - arrive[b])
    list.forEach((i, rank) => (slot[i] = (rank + 0.5) * dh))
  }

  return { N, x, z, y0, w, d, kind, slot, arrive }
}

/** 時刻 t の集計（HUD 用）。中にまだ浮いている割合を種類ごとに。 */
export function census(col, t) {
  const up = [0, 0, 0]
  const all = [0, 0, 0]
  let aboveSiphon = 0
  let coarsestAbove = 0
  const ySiphon = H - SIPHON
  for (let i = 0; i < col.N; i++) {
    const k = col.kind[i]
    all[k]++
    if (t < col.arrive[i]) {
      up[k]++
      const y = col.y0[i] - col.w[i] * t
      if (y > ySiphon) {
        aboveSiphon++
        if (col.d[i] > coarsestAbove) coarsestAbove = col.d[i]
      }
    }
  }
  return {
    suspended: up.map((u, k) => u / all[k]),
    aboveSiphon,
    coarsestAbove,
  }
}
