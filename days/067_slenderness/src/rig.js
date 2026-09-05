// rig.js — Day 067「細さだけが決める」(the slenderness threshold)
//
// 再現元は UNIPLEX (https://uniplex.jp/)。あのサイトは「硬い→柔らかい」という
// 商品便益を、蛍光イエローグリーン #F7FD46 とウォームベージュ #E2DBD7 の
// 2色の対比だけで説明していた（スワイプファイルDBの実測メモ）。
// ここで再現するのは、その対比を色ではなく **それを実際に決めている一つの数** で
// 出すこと。硬い／柔らかいを分けているのは力でも材質でもなく、細さである。
//
// 装置：同じ長さの棒を並べ、上から1枚の平らな板を下ろす。板は全部に同じだけの
// 縮み δ を与える。倒れるか立っているかを決めているのは、棒ごとに違う
// 細長比 λ = L/√(I/A) ひとつだけ。この rig には「倒れる／立つ」という状態変数が
// 無い。あるのは δ と、棒ごとの δ_cr だけで、絵はその大小比較の結果でしかない。

export const PI = Math.PI
export const TAU = Math.PI * 2

export const FIELD = {
  L: 2.6, // 全部の棒が同じ長さ。ここが変数だと「細さだけが決める」が嘘になる
  COLS: 22,
  ROWS: 7,
  X0: -4.6,
  X1: 4.6,
  Z0: -1.35,
  Z1: 1.35,
  // 端の細長比。λ = 2L/r（円断面なので √(I/A) = r/2）
  EPS_MIN: 0.0022, // いちばん細い棒の臨界ひずみ
  EPS_MAX: 0.0460, // いちばん太い棒の臨界ひずみ
  // 板が下りきったときの縮み（絶対値）。EPS_MAX·L = 0.1196 をわずかに超える所に
  // 置く＝前線が右端まで走り切る所までで止める。これ以上下ろすと全部倒れて、
  // 「細さが分けている」が画面から消える。
  DELTA_MAX: 0.126,
}

// ── 力学 ────────────────────────────────────────────────────────────────
// 根元は台に固定、頭は板に押さえられて回れないが上下には滑る＝両端固定・
// 一端可動。有効長さ係数 K = 0.5。円断面は I/A = r²/4。
//   ε_cr = π²(I/A)/(K L)² = π² r² / L²
//   δ_cr = ε_cr · L
// つまり δ_cr は r だけの関数で、力も材質（E）も一度も出てこない。
// 座屈は「強さ」の問題ではなく「形」の問題だから、E が消えるのが正しい。
export const critStrain = (r, L = FIELD.L) => (PI * PI * r * r) / (L * L)
export const critShortening = (r, L = FIELD.L) => critStrain(r, L) * L

// 逆算：この縮みでちょうど座屈する棒の半径（＝前線がいまどこに居るか）
export const radiusAtEdge = (eps) => (Math.sqrt(Math.max(eps, 0)) * FIELD.L) / PI

// 細長比。λ = L / √(I/A) = 2L / r
export const slenderness = (r, L = FIELD.L) => (2 * L) / r

// 座屈後の第1モード（両端固定・頭が滑る）:  w(s) = (A/2)(1 − cos(2πs/L))
// 棒は伸びないので、縮んだぶんは全部たわみに行く：
//   δ − δ_cr = ∫₀^L ½ w′² ds = π²A²/(4L)   →   A = (2/π)√(L(δ − δ_cr))
// 振幅を決めているのは剛性ではなく「伸びないこと」だけ。
export const amplitude = (delta, dcr, L = FIELD.L) =>
  delta > dcr ? (2 / PI) * Math.sqrt(L * (delta - dcr)) : 0

// ── 場をつくる ──────────────────────────────────────────────────────────
function mulberry32(a) {
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// 太さは x に沿って並べる。ただし ε_cr が x に対して線形になるように r を取る
// （r を線形にすると ε ∝ r² なので前線が左で走って右で止まり、板の速さと
// 前線の速さが噛み合わない）。ここが噛み合って初めて「板が下りた量 = 前線の位置」
// という一対一が目で読める。
export function buildField(seed = 20260906) {
  const rnd = mulberry32(seed)
  const { COLS, ROWS, X0, X1, Z0, Z1, EPS_MIN, EPS_MAX, L } = FIELD
  const rods = []
  const dx = (X1 - X0) / (COLS - 1)
  const dz = ROWS > 1 ? (Z1 - Z0) / (ROWS - 1) : 0

  for (let iz = 0; iz < ROWS; iz++) {
    const stagger = iz % 2 ? 0.5 : 0 // 千鳥。格子に見えると「棚」になって標本に見えない
    for (let ix = 0; ix < COLS; ix++) {
      const u0 = (ix + stagger) / (COLS - 1)
      if (u0 > 1.0001) continue
      const x = X0 + (X1 - X0) * u0 + (rnd() - 0.5) * dx * 0.16
      const z = Z0 + dz * iz + (rnd() - 0.5) * dz * 0.3

      // 太さのゆらぎ。前線を1本のカミソリにしないためだけに入れている。
      // 完全に単調だと境界が定規になり、決めているのが x に見えてしまう。
      const jit = (rnd() - 0.5) * 0.16
      const u = Math.min(1, Math.max(0, u0 + jit))
      const eps = EPS_MIN + (EPS_MAX - EPS_MIN) * u
      const r = radiusAtEdge(eps)

      // 座屈する向き。±x を中心に散らす（真横に倒れると正面から弓が見えない）
      const side = rnd() < 0.5 ? 0 : PI
      const az = side + (rnd() - 0.5) * 1.15

      rods.push({
        x,
        z,
        r,
        eps,
        dcr: eps * L,
        lam: slenderness(r, L),
        az,
        tint: (rnd() - 0.5) * 0.075,
      })
    }
  }
  return rods
}

// いま座屈している本数と、前線の x / λ。DOM に出す数はここから引く。
// 画面に出る数字を別のロジックで作らないこと（Day 063 でずれた）。
export function survey(rods, delta) {
  let n = 0
  for (const rod of rods) if (delta > rod.dcr) n++
  const epsFront = delta / FIELD.L
  const rFront = radiusAtEdge(epsFront)
  return {
    buckled: n,
    total: rods.length,
    lamFront: slenderness(Math.max(rFront, 1e-4)),
    epsFront,
  }
}

// 前線の x（地面に引く1本の線）。ε_cr が x に線形なので逆算は割り算1回。
export function frontX(delta) {
  const { X0, X1, EPS_MIN, EPS_MAX, L } = FIELD
  const u = (delta / L - EPS_MIN) / (EPS_MAX - EPS_MIN)
  return X0 + (X1 - X0) * Math.min(1.08, Math.max(-0.08, u))
}

// ── 棒のジオメトリ ──────────────────────────────────────────────────────
// 曲がった形は頂点シェーダが作る。ここが作るのは (s, θ) の格子だけで、
// position は境界球のためのダミー。
export function rodLattice(RINGS = 22, SIDES = 8) {
  const ring = SIDES + 1 // 継ぎ目の頂点を1つ重ねる（θ=0 と θ=2π を別頂点にする）
  const vCount = (RINGS + 1) * ring + ring + 1 // 胴 + 天面のリング + 天面の中心
  const position = new Float32Array(vCount * 3)
  const aS = new Float32Array(vCount)
  const aAng = new Float32Array(vCount)
  const aRad = new Float32Array(vCount) // 中心軸からの距離（天面の中心だけ0）
  const aCap = new Float32Array(vCount) // 1 なら法線は接線 T（天面）

  let k = 0
  const put = (s, ang, rad, cap) => {
    aS[k] = s
    aAng[k] = ang
    aRad[k] = rad
    aCap[k] = cap
    position[k * 3] = Math.cos(ang) * 0.1 * rad
    position[k * 3 + 1] = s * FIELD.L
    position[k * 3 + 2] = Math.sin(ang) * 0.1 * rad
    k++
  }

  for (let i = 0; i <= RINGS; i++)
    for (let j = 0; j <= SIDES; j++) put(i / RINGS, (j / SIDES) * TAU, 1, 0)

  const capStart = k
  for (let j = 0; j <= SIDES; j++) put(1, (j / SIDES) * TAU, 1, 1)
  const capCenter = k
  put(1, 0, 0, 1)

  const index = []
  // 巻きは外から見て CCW。ここを1つ入れ替えるだけで全部の棒が裏返り、
  // 陰影が反転して真っ黒になる（この日の1回目の実描画がそれだった）
  for (let i = 0; i < RINGS; i++) {
    for (let j = 0; j < SIDES; j++) {
      const a = i * ring + j
      const b = a + 1
      const c = a + ring
      const d = c + 1
      index.push(a, b, c, b, d, c)
    }
  }
  for (let j = 0; j < SIDES; j++) {
    index.push(capStart + j, capStart + j + 1, capCenter)
  }

  return { position, aS, aAng, aRad, aCap, index: new Uint16Array(index) }
}
