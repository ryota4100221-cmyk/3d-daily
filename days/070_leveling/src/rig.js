// rig.js — Day 070 「四乗 / the fourth power」
//
// 見本板の刷毛目そのもの。ここには「消える」も「閾値」も書いていない。
// 書いてあるのは薄膜の潤滑方程式を平均膜厚まわりで線形化したときの、
// 波数モードごとの減衰時定数ひとつだけ。
//
//   ∂h/∂t = −(γ/3μ) ∇·( h³ ∇∇²h )              （表面張力駆動のレベリング）
//   h = h̄ + ε cos(k y) を入れて ε の1次を取ると
//   ∂ε/∂t = −(γ h̄³ / 3μ) k⁴ ε
//   τ(λ) = 3μ / (γ h̄³ k⁴) = 3μ λ⁴ / (16π⁴ γ h̄³)
//
// 指数は 4。粘度でも表面張力でもなく、**間隔の4乗**だけが順番を決める。
// λ が2倍 → τ は16倍。逆に言えば、16倍待って初めて「消える刷毛目の間隔」が
// 2倍になる（λ ∝ t^{1/4}）。臨界波長は式のどこにも無い。
//
// 材料定数はニトロセルロースラッカーの実用域から取った。
const MU = 0.05 // Pa·s   粘度
const GAMMA = 0.028 // N/m    表面張力
const HBAR = 60e-6 // m      平均膜厚 60µm（1回塗りのウェット膜厚）

export const MATERIAL = { MU, GAMMA, HBAR }

// τ = C · λ⁴
export const C_TAU = (3 * MU) / (16 * Math.PI ** 4 * GAMMA * HBAR ** 3)
export const tau = (lam) => C_TAU * lam ** 4

// 見本板の梯子。1段ごとに間隔ちょうど2倍＝時定数ちょうど16倍。
// 2mm・4mm は刷毛の毛筋、8〜16mm は刷毛の返し、32〜64mm は木地のうねり。
export const LADDER = [0.002, 0.004, 0.008, 0.016, 0.032, 0.064]

// 観測時刻。8mm の見本板がちょうど 1/e まで落ちる時刻に置く。
export const T0 = tau(0.008) // 65.2 s
// 下段は上段のちょうど16倍。境目が「ちょうど1段」しか動かないことを見せる。
export const ROW_T = [T0, 16 * T0]

// 全部の見本板を同じ「初期勾配」で刻む。山の高さではなく傾きを揃えるのは、
// 映り込みが読んでいるのが高さではなく傾きだから（反射角のずれ = 2×勾配）。
// 高さの側はその結果として決まる: a = s·λ/2π（2mm → 0.22µm、64mm → 7.1µm）。
export const SLOPE0 = (0.04 * Math.PI) / 180 // 0.04°

// 刷毛目は「完全に平行な溝」ではない。波数ベクトルの向きに ±24° の散らばりを
// 持たせる——これが無いと場が y だけの関数になり、映り込んだ横縞は「曲がる」
// のではなく「太さが変わる」だけになって、勾配が読めなくなる。
export const MODES = 9 // 主 7（刷毛の毛筋）+ 従 2（刷毛の返し）

function mulberry32(a) {
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// 1枚の見本板。単一の正弦ではなく λ の周りの狭い帯（×0.82〜×1.22）にする。
// 実際の刷毛目は単色ではないし、帯にしておくと「1本だけ生き残る」ような
// 嘘の見え方にならない。
export function makeSpecimen(index) {
  const lam = LADDER[index]
  const rnd = mulberry32(0x5eed * (index + 7) + 1013)

  // dir: 波数ベクトルの向き（0 = 稜線が横に走る＝刷毛を横に引いた跡）
  const build = (n, centre, weight, dir, spread) => {
    const out = []
    for (let m = 0; m < n; m++) {
      const u = n === 1 ? 0.5 : m / (n - 1)
      const l = centre * Math.exp(Math.log(1.5) * (u - 0.5))
      const k = (2 * Math.PI) / l
      const th = dir + spread * (rnd() * 2 - 1)
      out.push({
        lam: l,
        k,
        kx: k * Math.sin(th),
        ky: k * Math.cos(th),
        ph: rnd() * Math.PI * 2,
        w: (0.55 + 0.9 * rnd()) * weight,
        tau: tau(l),
      })
    }
    return out
  }

  const modes = [
    ...build(7, lam, 1.0, 0, 0.42), // 毛筋。稜線はおおむね横だが ±24° ばらす
    ...build(2, lam * 2.7, 0.25, Math.PI / 2, 0.26), // 刷毛の返し（縦向きの弱い成分）
  ]
  // rms 勾配を SLOPE0 に揃える。山の高さではなく傾きを揃えるのは、
  // 映り込みが読んでいるのが傾きだから。
  const norm = SLOPE0 / Math.sqrt(modes.reduce((a, m) => a + m.w * m.w, 0))
  for (const m of modes) {
    m.s0 = m.w * norm
    m.a0 = m.s0 / m.k
  }
  return { index, lam, tau: tau(lam), modes }
}

export const SPECIMENS = LADDER.map((_, i) => makeSpecimen(i))

// t 秒後に残っている勾配。各モードは独立に exp(−t/τ_m) で落ちる。
// 「消えた」という状態は持たない——常に全部が減衰し続けているだけ。
export function slopesAt(bank, t) {
  return bank.map((m) => m.s0 * Math.exp(-t / m.tau))
}

export function slopeRms(bank, t) {
  let s = 0
  for (const m of bank) {
    const v = m.s0 * Math.exp(-t / m.tau)
    s += v * v
  }
  return Math.sqrt(s)
}

// 見本板1枚の「残っている度合い」。1 = 塗ったまま、0 = 鏡面。
export function survival(spec, t) {
  return slopeRms(spec.modes, t) / slopeRms(spec.modes, 0)
}

// 板の寸法（m）と並べ方。実際の試験板に寄せて 200 × 260 mm。
export const PANEL = { w: 0.2, h: 0.26 }
export const GAP = { x: 0.038, y: 0.052 }

export const fmtTau = (s) => {
  if (s < 1) return `${s.toFixed(2)} s`
  if (s < 90) return `${s.toFixed(1)} s`
  if (s < 5400) return `${(s / 60).toFixed(1)} min`
  if (s < 172800) return `${(s / 3600).toFixed(1)} h`
  return `${(s / 86400).toFixed(1)} d`
}
