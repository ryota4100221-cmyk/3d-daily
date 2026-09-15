// rig.js — 枚数は光に効かない / the count that never reaches the light
//
// Son Daven の FV は、夕方の建築CGを逆光で潰したシルエットで、DBの実測でも
// 「木のルーバーとレンガの暖色だけが色」（設計の色 0.01%）と出ている。
// 再現するのはその1点 —— **低い太陽を背にした木のルーバー**。
//
// ここに書いてあるのは「羽根の板を積む」ことだけで、
// 「何枚にすると明るい」に当たる式は一行も無い。
//
// ── 装置 ──────────────────────────────────────────────────────────────
// 水平ルーバーを、ピッチ s・奥行き d・厚み t で積む。太陽高度を α とする。
// 床の点が壁からの距離 a にあるとき、太陽へ向かう光線は
//
//     壁面 z=0 を  h0 = a·tanα           の高さで横切り
//     羽根の外端 z=d を  h1 = h0 + d·tanα の高さで抜ける
//
// ので、光が通るのは区間 [h0, h1] がどの羽根にも当たらないときだけ。
// 羽根を周期 s のまん中（y = (k+½)s）に置くと、1周期あたりの「通る」長さは
//
//     s − t − d·tanα
//
// つまり透過率は
//
//     T(α) = 1 − t/s − (d/s)·tanα = 1 − τ − ρ·tanα      （τ=t/s, ρ=d/s）
//
// **s がどこにも単独で残らない。** 羽根の寸法を全部ピッチごと相似に縮めれば、
// 6枚だろうと24枚だろうと透過率は同じ数になる。変わるのは床の縞の周期
// Δa = s/tanα ——つまり「見た目」だけが枚数に比例して変わり、「光の量」は動かない。
//
// この式は下では一切使っていない（表示のときだけ答え合わせに使う）。
// visible() は羽根の板との当たり判定そのもので、GLSL 版も同じ判定を書いてある。
// 絵と数字が同じ関数から出ていることが、この日の主張の担保になっている。

export const WALL_H = 3.0 // 壁の高さ（全パネル共通）

// パネル4枚。A/B/C は ρ・τ が同じ＝**相似**で、ピッチだけが 1/2 ずつ。
// D だけ ρ を変えた対照（相似でないものは、ちゃんと違う量を通す）。
const RHO = 0.55 // d/s — 羽根の奥行き比
const TAU = 0.1 // t/s — 羽根の厚み比

export const PANELS = [
  { id: 'A', n: 6, rho: RHO, tau: TAU },
  { id: 'B', n: 12, rho: RHO, tau: TAU },
  { id: 'C', n: 24, rho: RHO, tau: TAU },
  { id: 'D', n: 12, rho: 1.3, tau: TAU }, // 対照：相似でない
]

export const PANEL_W = 1.62 // パネル1枚の幅
export const PANEL_GAP = 0.1 // パネル間の柱の幅

// パネルを x 方向に並べ、寸法を確定させる。
export const RIG = PANELS.map((p, i) => {
  const s = WALL_H / p.n // ピッチ
  const d = p.rho * s //   奥行き（相似なので s に比例）
  const t = p.tau * s //   厚み  （同上）
  // +z を見込むカメラでは world +x が画面の左へ出る。読み順（A→D）を
  // 画面の左→右に合わせるため、x の並びを反転して置く。
  const x0 = (PANELS.length - 1 - i) * (PANEL_W + PANEL_GAP)
  return { ...p, s, d, t, x0, x1: x0 + PANEL_W }
})

// 全体を原点まわりに中央寄せするための平行移動
export const RIG_SPAN = RIG.length * PANEL_W + (RIG.length - 1) * PANEL_GAP
const X_SHIFT = -RIG_SPAN / 2
for (const p of RIG) {
  p.x0 += X_SHIFT
  p.x1 += X_SHIFT
}

// 🔴 壁の左右端と方立の位置は「配列の最初と最後」ではなく **x の最小・最大**から出す。
// 並びを反転したとき RIG[0] がいちばん右になり、uWallX0 > uWallX1 になって
// `x < X0 || x > X1` が全 x で真＝**壁が丸ごと消えて全面が陽なたになった**。
// 床に縞が1本も出ないのに絵は破綻しないので、ここも気づきにくい類。
export const WALL_X0 = Math.min(...RIG.map((p) => p.x0)) - PANEL_GAP
export const WALL_X1 = Math.max(...RIG.map((p) => p.x1)) + PANEL_GAP

// 方立（柱）は、x 順に並べたパネルの隙間のまん中に立てる。
export const STILE_XS = (() => {
  const sorted = [...RIG].sort((a, b) => a.x0 - b.x0)
  const xs = [sorted[0].x0 - PANEL_GAP / 2]
  for (const p of sorted) xs.push(p.x1 + PANEL_GAP / 2)
  return xs
})()

export { RHO, TAU }

// 羽根1枚ごとの高さ（周期のまん中に置く＝床の縞が厳密に周期的になる）
export function bladeYs(p) {
  const ys = []
  for (let k = 0; k < p.n; k++) ys.push((k + 0.5) * p.s)
  return ys
}

// ── 当たり判定 ────────────────────────────────────────────────────────
// 壁から a だけ離れた床の点から、高度 α の太陽が見えるか。
// 1 = 見える / 0 = 羽根に隠れている。式ではなく板との交差で決めている。
export function visible(p, a, tanA) {
  if (tanA <= 0) return 0
  const h0 = a * tanA
  if (h0 >= WALL_H) return 1 // 壁の上を越える（＝ルーバーを通っていない）
  const h1 = h0 + p.d * tanA

  const k = Math.floor(h0 / p.s)
  const by = (k + 0.5) * p.s // 羽根 k の下面
  if (!(h1 < by || h0 > by + p.t)) return 0 // 羽根 k に当たった

  // h0 が羽根 k より上に出ているときは、次の羽根まで届くことがある
  const k2 = k + 1
  if (k2 < p.n) {
    const by2 = (k2 + 0.5) * p.s
    if (!(h1 < by2 || h0 > by2 + p.t)) return 0
  }
  return 1
}

// ── 測る ──────────────────────────────────────────────────────────────
// 縞のある帯を一様に刻んで、見えた割合をそのまま数える。閉じた式は使わない。
//
// 🔴 ここで2つに分けているのには理由がある。最初は壁の全高 (0, H) だけを
// 測っていて、太陽が高いところで A/B/C がばらけた（54°で 0.186 / 0.164 / 0.154）。
// 「枚数は効かない」が崩れたのかと思ったが、崩れていたのは**いちばん上の羽根の上**
// だけだった。周期的な内部では相似な3枚は 1e-5 まで一致していて、
// ばらけていたぶんはそのまま「天端から漏れた光」で、しかもピッチに正比例する
// ＝ちょうど 1/n で消える。**枚数が効く場所は壁の中に1箇所しかない。**
function measureRange(p, tanA, aLo, aHi, samples) {
  let hit = 0
  for (let i = 0; i < samples; i++) {
    const a = aLo + ((i + 0.5) / samples) * (aHi - aLo)
    hit += visible(p, a, tanA)
  }
  return hit / samples
}

// 周期的な内部だけ（h0 が 0..(n−1)s＝上下の羽根が両方そろっている範囲）。
// ここが「相似なら同じ」が厳密に成り立つところ。
export function measureBulk(p, tanA, samples = 4096) {
  if (tanA <= 0) return 0
  return measureRange(p, tanA, 0, ((p.n - 1) * p.s) / tanA, samples)
}

// 壁の全高（天端の漏れを含む）。実際に床に落ちている光はこちら。
export function measureWhole(p, tanA, samples = 4096) {
  if (tanA <= 0) return 0
  return measureRange(p, tanA, 0, WALL_H / tanA, samples)
}

// 答え合わせ用の閉じた式（描画にも測定にも使っていない）
export function closedForm(p, tanA) {
  return Math.max(0, 1 - p.tau - p.rho * tanA)
}

// 床の縞の周期。ピッチに比例する＝**見た目だけが枚数で変わる**側。
export function stripePitch(p, tanA) {
  return tanA > 0 ? p.s / tanA : Infinity
}

// ── 太陽 ──────────────────────────────────────────────────────────────
// 方位は振らない。振ると縞が x に流れて「枚数」と「角度」が混ざり、
// 何が効いているのか画面から読めなくなる（太陽は y-z 面に置く）。
export const SUN_MIN = 6 * (Math.PI / 180)
export const SUN_MAX = 54 * (Math.PI / 180)

export function sunAltitudeAt(tSec) {
  // 往復。端で止まらないよう正弦で振る。
  const u = 0.5 - 0.5 * Math.cos(tSec * 0.38)
  return SUN_MIN + (SUN_MAX - SUN_MIN) * u
}

export function sunDirection(alt) {
  // 太陽は +z 側の上空。x 成分は 0。
  return [0, Math.sin(alt), Math.cos(alt)]
}

// ── GLSL ──────────────────────────────────────────────────────────────
// 上の visible() と同じ判定。床のシェーダはこれだけで縞を出している
// （シャドウマップは使っていない）。
export const GLSL_VISIBLE = /* glsl */ `
  uniform vec4 uPanel[4];   // x0, x1, s, d
  uniform float uPanelT[4]; // t
  uniform float uPanelN[4]; // 羽根の枚数
  uniform float uWallX0;
  uniform float uWallX1;
  uniform float uWallH;
  uniform float uTanA;

  // 上の visible() と同じ判定を、壁のどこにある点でも効くように書いたもの。
  // 点 q（ワールド座標・壁面は z=0・羽根は z∈[0,d]）から太陽が見えるか。
  // 1.0 = 見える / 0.0 = 遮られている。
  float louverVisible(vec3 q) {
    if (uTanA <= 0.0) return 0.0;
    if (q.x < uWallX0 || q.x > uWallX1) return 1.0;   // 壁の外（両脇の素通し）

    // 内側の点は、まず壁面 z=0 をこの高さで横切る
    float hEnter = q.y + max(0.0, -q.z) * uTanA;
    if (hEnter >= uWallH) return 1.0;                 // 壁の天端を越えていく

    for (int i = 0; i < 4; i++) {
      vec4 P = uPanel[i];
      if (q.x < P.x || q.x > P.y) continue;           // このパネルではない
      float s = P.z, d = P.w;
      float t = uPanelT[i], n = uPanelN[i];
      if (q.z >= d) return 1.0;                       // 羽根より外側にいる

      // 羽根の外端 z=d を抜けるときの高さ。
      // 🔴 ここを (d - max(q.z, 0.0)) と書いて1枚まるごと失敗した。床の点は
      // q.z が負（壁の手前）なので、clamp すると「壁からの距離」が式から消え、
      // hExit が hEnter より低くなって**どの羽根にも当たらない**＝全面が陽なたになる。
      // 縞が1本も出ないのに絵は破綻せず、ただ明るい床が出てくるので気づきにくい。
      float hExit = q.y + (d - q.z) * uTanA;

      float k = floor(hEnter / s);
      float by = (k + 0.5) * s;                       // 羽根 k の下面
      if (k >= 0.0 && k < n) {
        if (!(hExit < by || hEnter > by + t)) return 0.0;
      }
      float k2 = k + 1.0;                             // 次の羽根まで届くことがある
      if (k2 >= 0.0 && k2 < n) {
        float by2 = (k2 + 0.5) * s;
        if (!(hExit < by2 || hEnter > by2 + t)) return 0.0;
      }
      return 1.0;
    }
    return 0.0;  // 壁の中だがパネルではない＝方立（柱）に隠れている
  }
`
