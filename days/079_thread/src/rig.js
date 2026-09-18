// rig.js — Day 079 / 蜜の糸が自分で選ぶ波長
//
// 元祖大阪みたらしだんご（ganso.osaka）は「逆みたらし」を名乗る。ふつう外にかける
// 蜜を、中に入れてしまった団子である。だからこの日は逆の側を測る——
// **蜜を外に出したままにすると、何が起きるのか。**
//
// 答えは「薄い衣のままではいられない」。円柱の液体は、周長より長い波長の
// ゆらぎに対して必ず不安定で（Plateau 1873 / Rayleigh 1878）、衣は必ず玉になる。
// そして玉の間隔は、注いだ量にも、揺すった強さにも、時間にもよらない。
// 決めているのは糸の半径ひとつで、λ* = 9.016 R。
//
// ここで組む装置は「選抜」である。最初に入っているのは白色雑音——すべての波長が
// 同じ振幅で同時に入っている。時間が経つと各波は exp(ω(k)·t) で伸びるが、
// ω が波長ごとに違うので、**一本だけが他を引き離す**。画面に見える波長は、
// 誰かが選んだものではなく、最初から全部そこにあったうちの一本でしかない。

const TWO_PI = Math.PI * 2

// ── 寸法 ────────────────────────────────────────────────────────────────
export const R = 0.072 // 糸の半径
export const L = 4.7 // 糸の長さ（= 65.3 R）
export const NM = 46 // 数える波の本数。k_n = 2πn/L（有限長の糸なので k は飛び飛び）
export const COLS = 7
export const GAP = 1.3
export const Y_MID = 0.07

// ── 第1種変形ベッセル関数（Abramowitz & Stegun 9.8.1 / 9.8.3、|x| < 3.75）────
// 使う範囲は x < 1 なのでこの級数で十分（相対誤差 < 1.6e-7）。
function I0(x) {
  const t2 = (x / 3.75) ** 2
  return (
    1 +
    3.5156229 * t2 +
    3.0899424 * t2 ** 2 +
    1.2067492 * t2 ** 3 +
    0.2659732 * t2 ** 4 +
    0.0360768 * t2 ** 5 +
    0.0045813 * t2 ** 6
  )
}
function I1(x) {
  const t2 = (x / 3.75) ** 2
  return (
    x *
    (0.5 +
      0.87890594 * t2 +
      0.51498869 * t2 ** 2 +
      0.15084934 * t2 ** 3 +
      0.02658733 * t2 ** 4 +
      0.00301532 * t2 ** 5 +
      0.00032411 * t2 ** 6)
  )
}

// ── 分散関係（非粘性 Rayleigh）────────────────────────────────────────────
//   ω² = (σ / ρR³) · x (1 − x²) · I₁(x)/I₀(x),      x = kR
// σ/(ρR³) = 1 と置いた無次元時間で測る。材料定数はここで全部消える。
//   x ≥ 1 ⇔ λ ≤ 2πR ⇔ 「周長より短い波」は ω が虚数＝伸びない。
//   だから細い糸ほど短い波しか切れず、玉は細かくなる。
export function omega(x) {
  if (x <= 0 || x >= 1) return 0
  return Math.sqrt(x * (1 - x * x) * (I1(x) / I0(x)))
}

// いちばん速い波（x* を 1e-6 刻みで走査して求める。式の最大値なので解析解は要らない）
function findPeak() {
  let bx = 0
  let bw = 0
  for (let x = 0.001; x < 1; x += 0.000001) {
    const w = omega(x)
    if (w > bw) {
      bw = w
      bx = x
    }
  }
  return { x: bx, w: bw }
}
export const PEAK = findPeak() // x* ≈ 0.6970, ω* ≈ 0.3421
export const LAMBDA_STAR = (TWO_PI * R) / PEAK.x // = 9.016 R

// ── 最初に入っている雑音 ────────────────────────────────────────────────
// 全モード等振幅・位相だけランダム＝白色雑音。振幅に差を付けないのが肝で、
// 差が付いていたら「選抜」ではなく「仕込み」になる。
function mulberry32(a) {
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rnd = mulberry32(0x079 * 2654435761)

export const modes = []
for (let n = 1; n <= NM; n++) {
  const k = (TWO_PI * n) / L
  const x = k * R
  modes.push({ n, k, x, w: omega(x), phi: rnd() * TWO_PI })
}
export const UNSTABLE = modes.filter((m) => m.w > 0).length // x < 1 を満たす本数
export const WINNER = modes.reduce((a, b) => (b.w > a.w ? b : a))
export const RUNNERUP = modes
  .filter((m) => m !== WINNER)
  .reduce((a, b) => (b.w > a.w ? b : a))

// ── 7 本の糸 = 7 つの時刻 ──────────────────────────────────────────────
// 左から右へ、同じ雑音が同じ式で伸びていく途中を並べただけ。左端は雑音そのもの。
// T_END = 63 は ω* で 21.6 e-fold＝初期振幅 4e-10·R（熱ゆらぎの桁）から立ち上がる量。
export const T_END = 63
export const times = [0, 0.17, 0.34, 0.51, 0.68, 0.84, 1].map((f) => f * T_END)

// 見える振幅（max|u|）は別に決める。モード比だけが時刻 t の情報で、全体の倍率は
// 「どれだけ育ったか」を画面に収めるための正規化——比を変えないので選抜は壊れない。
const TARGET = [0.024, 0.062, 0.14, 0.3, 0.55, 0.82, 0.985]

const SAMPLES = 1400

function sumU(A, s) {
  let u = 0
  for (let i = 0; i < NM; i++) u += A[i] * Math.cos(modes[i].k * s + modes[i].phi)
  return u
}

function build(t, target) {
  // exp((ω − ω*)t)。ω* を引いておかないと 21 e-fold で桁が溢れる（比は不変）
  const A = modes.map((m) => Math.exp((m.w - PEAK.w) * t))
  let peak = 0
  for (let i = 0; i < SAMPLES; i++) peak = Math.max(peak, Math.abs(sumU(A, (i / SAMPLES) * L)))
  const gain = target / peak
  return A.map((v) => v * gain)
}

// 育った形から玉の数と間隔を「数えて」出す。予言 L/λ* と突き合わせるため、
// 予言のほうを使って作ってはいけない——ここは必ず実測側から取る。
function count(A, target) {
  const p = new Float64Array(SAMPLES + 1)
  for (let i = 0; i <= SAMPLES; i++) p[i] = 1 + sumU(A, (i / SAMPLES) * L)
  const peaks = []
  for (let i = 1; i < SAMPLES; i++) {
    if (p[i] > p[i - 1] && p[i] >= p[i + 1] && p[i] > 1 + 0.22 * target) peaks.push((i / SAMPLES) * L)
  }
  let gapMean = 0
  if (peaks.length > 1) gapMean = (peaks[peaks.length - 1] - peaks[0]) / (peaks.length - 1)
  return { n: peaks.length, gapMean }
}

export const columns = times.map((t, j) => {
  const A = build(t, TARGET[j])
  const c = count(A, TARGET[j])
  return {
    j,
    t,
    x: (j - (COLS - 1) / 2) * GAP,
    amp: TARGET[j],
    A: Float32Array.from(A),
    beads: c.n,
    gapMean: c.gapMean,
  }
})

export const PHI = Float32Array.from(modes.map((m) => m.phi))

// 予言（作る側では一度も使っていない数）
export const PREDICTED = L / LAMBDA_STAR
export const MEASURED = columns[COLS - 1]
export const SPACING_IN_R = MEASURED.gapMean / R

// 接戦の度合い。1 に近いほど「勝ったのは僅差」
export const MARGIN = WINNER.w / RUNNERUP.w
export const RUNNERUP_LEFT = Math.exp(-(WINNER.w - RUNNERUP.w) * T_END)
