// 確度場 — the confidence field
//
// Alethia (alethia.earth) が売っているのは風景ではなく「検証できる数値」だった。
// 生態系の会計。畑1枚から地球規模まで、同じ器械で測って、測ったことを証明する。
// ならば絵にすべきなのは地形ではない。**測ったという事実のほうだ。**
//
// だからこの日の地面は、どこにもモデリングされていない。
// 存在するのは 28 本の測点（サンプル）だけで、そのあいだの起伏は地面ではなく
// 「推定」でしかない。推定を推定として描くために、この装置は場を2つ持つ:
//
//   h(p)  形   = Σ wʰᵢ vᵢ / Σ wʰᵢ           … 測点の値を広い核で内挿した形
//   k(p)  確度 = 1 − exp(−G · Σ wᵏᵢ fᵢ)     … 近くに「新しい」測定がどれだけあるか
//
// 🔴 核が2つあることがこの装置の全部。**σʰ > σᵏ**。
// 形の推定は遠くの測点からも借りていい（土地は連続だから）。
// でも「確かだ」と言える範囲は借りられない。1本の測点が保証できる距離は、
// それが内挿に効く距離よりずっと短い。σ を2つに割った瞬間、
// 「よく見える地形」と「主張してよい地形」がズレて、そのズレが絵になる。
//
// 画面に出る高さは h ではなく **h · k**。測りたてのところだけ土地が起き、
// 測定が古びると（fᵢ が減衰すると）そこは静かに平らな紙に戻る。
// 等高線も k が低い場所には引かれない。地図は土地の写しではなく、
// 「最近たしかめた範囲」の写しになる。
//
// 各測点は自分の周期で測り直す。だから紙のあちこちが別々の呼吸で盛り上がる。

export const N = 28

// 版面（plate）。紙のサイズであって、土地の広さではない。
export const PLATE = { w: 12.6, d: 7.4 }

export const SIG_H = 1.55 // 形の核 — 内挿はここまで借りる
export const SIG_K = 0.78 // 確度の核 — 1本の測点が保証できる距離
export const GAIN = 1.55 // Σwf → 確度 への利得
export const AMP = 1.95 // h·k → 実際の起伏。版面 12.6 に対して ±1 弱で、紙が土地になる手前で止める
export const STEP = 0.055 // 等高線の間隔（h の単位）
export const REACH = 1.35 // 測り直しの波が広がりきる半径
export const PULSE_T = 1.5 // 波が広がりきるまでの秒数

// ── 決定的な擬似乱数と値ノイズ ──────────────────────────────────────────
// 測点の値がバラバラだと等高線がただのノイズになる。土地は連続なので、
// 測点の値のほうを連続な場からサンプルする（＝実測は連続な現実の抜き取り）。
function h2(i, j) {
  const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453
  return s - Math.floor(s)
}
function smooth(t) {
  return t * t * (3 - 2 * t)
}
function vnoise(x, y) {
  const i = Math.floor(x)
  const j = Math.floor(y)
  const fx = smooth(x - i)
  const fy = smooth(y - j)
  const a = h2(i, j)
  const b = h2(i + 1, j)
  const c = h2(i, j + 1)
  const d = h2(i + 1, j + 1)
  return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy
}
function fbm(x, y) {
  let v = 0
  let amp = 0.5
  let f = 1
  for (let o = 0; o < 4; o++) {
    v += amp * vnoise(x * f, y * f)
    amp *= 0.5
    f *= 2.05
  }
  return v
}

// ── 測量計画（the survey） ──────────────────────────────────────────────
// 7×4 の粗い格子をジッタさせる。等間隔だと「格子を描いた」ようにしか見えず、
// 完全なランダムだと空白が偏る。実際の観測網もだいたいこの中間にある。
export function makeSurvey() {
  const cols = 7
  const rows = 4
  const out = []
  const spanX = PLATE.w - 2.3
  const spanZ = PLATE.d - 1.9
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const r1 = h2(i * 3 + 11, j * 7 + 5)
      const r2 = h2(i * 13 + 2, j * 5 + 19)
      const r3 = h2(i * 29 + 7, j * 17 + 3)
      const cw = spanX / (cols - 1)
      const cd = spanZ / (rows - 1)
      const x = -spanX / 2 + i * cw + (r1 - 0.5) * cw * 0.6
      const z = -spanZ / 2 + j * cd + (r2 - 0.5) * cd * 0.6
      const v = fbm(x * 0.34 + 4.2, z * 0.34 + 1.7) * 2.0 - 1.0
      const period = 8.5 + r3 * 14.0
      out.push({
        x,
        z,
        v: v * 1.2,
        period, // 測り直しの周期（秒）
        phase: r1 * period, // 位相をずらす＝紙のあちこちが別々に呼吸する
      })
    }
  }
  return out
}

// ── 鮮度（freshness） ───────────────────────────────────────────────────
// 「検証済み」は永続の属性ではない。測ってからの時間の関数でしかない。
export function age(t, s) {
  return (((t - s.phase) % s.period) + s.period) % s.period
}
export function freshness(t, s) {
  return Math.exp(-age(t, s) / (s.period * 0.34))
}
export function pulse(t, s) {
  return Math.min(age(t, s) / PULSE_T, 1)
}

// ── CPU 側の場（読み値と測点の座標のため。GLSL と同じ式） ───────────────
export function fieldAt(px, pz, samples, fresh) {
  let ws = 0
  let hs = 0
  let kk = 0
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i]
    const dx = px - s.x
    const dz = pz - s.z
    const q = dx * dx + dz * dz
    const wh = Math.exp(-q / (2 * SIG_H * SIG_H))
    const wk = Math.exp(-q / (2 * SIG_K * SIG_K))
    ws += wh
    hs += wh * s.v
    kk += wk * fresh[i]
  }
  return { h: ws > 1e-5 ? hs / ws : 0, k: 1 - Math.exp(-GAIN * kk) }
}

// 版面のうち「引いてよい」と言える割合。地図が主張できる面積そのもの。
export function coverage(samples, fresh, thr = 0.4) {
  const GX = 48
  const GZ = 28
  let hit = 0
  for (let j = 0; j < GZ; j++) {
    const z = (-0.5 + (j + 0.5) / GZ) * PLATE.d
    for (let i = 0; i < GX; i++) {
      const x = (-0.5 + (i + 0.5) / GX) * PLATE.w
      if (fieldAt(x, z, samples, fresh).k > thr) hit++
    }
  }
  return hit / (GX * GZ)
}

// ── GLSL 側（頂点にも断片にも同じものを注入する。CPU 側と同じ式） ────────
export const FIELD_GLSL = /* glsl */ `
uniform vec3  uS[${N}];   // x, z, 測った値
uniform float uF[${N}];   // 鮮度 0..1
uniform float uP[${N}];   // 測り直しの波の進み 0..1
uniform float uSigH;
uniform float uSigK;
uniform float uGain;
uniform float uReach;

void fieldAt(in vec2 p, out float h, out float k) {
  float ws = 0.0, hs = 0.0, kk = 0.0;
  for (int i = 0; i < ${N}; i++) {
    vec2 d = p - uS[i].xy;
    float q = dot(d, d);
    float wh = exp(-q / (2.0 * uSigH * uSigH));
    float wk = exp(-q / (2.0 * uSigK * uSigK));
    ws += wh;
    hs += wh * uS[i].z;
    kk += wk * uF[i];
  }
  h = ws > 1e-5 ? hs / ws : 0.0;
  k = 1.0 - exp(-uGain * kk);
}

// 測り直しの波。測点が読まれた瞬間に一度だけ核の半径まで広がって消える。
// 別メッシュではなく紙の上で焼くので、起伏に沿うし版面の外へはみ出さない。
float pulseAt(in vec2 p) {
  float s = 0.0;
  for (int i = 0; i < ${N}; i++) {
    float pu = uP[i];
    if (pu < 1.0) {
      float r = length(p - uS[i].xy);
      float e = (r - pu * uReach) / 0.05;
      s += exp(-e * e) * (1.0 - pu) * (1.0 - pu);
    }
  }
  return clamp(s, 0.0, 1.0);
}
`
