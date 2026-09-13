// rig.js — 読める一点（the only angle that reads）
//
// 再現元は「読めない、GUNZE。」（グンゼ130周年）。サイトが持っている一つの主張は
// 「この社名は読まれない」で、それを 157px の極太コピーで自分から言っている。
// ここで再現するのはコピーでもマーキーでもなく、**読めない／読めるを実際に決めて
// いる一つの条件**のほうだけ。
//
// 装置の中身は projective geometry しかない。
//
//   1. 空間に原点 E（= 目の位置）を一つ置く。
//   2. E から距離 1 の面の上に GUNZE の5文字を組む。組んだ点 (u,v) ごとに、
//      E からその点へ向かう**直線を1本引く**。
//   3. 棒はその直線の上に置く。z 深さ d から d+L まで。
//
//   ⇒ E から見ると、棒は**どれだけ長くても点にしか映らない**。棒の全長が自分の
//      視線と重なっているから。だから E に立った瞬間だけ、字が読める。
//
// rig.js に「組み上がる」「ばらける」に当たる式は一行も無い。棒は 1mm も動かない。
// 動いているのはカメラだけで、読めなくなるのは棒の都合ではなく**見る側の都合**。
//
// 文字が壊れる順番も、ここから勝手に出てくる。カメラが E から b だけ横へ離れると、
//
//   ずれ  Δu = b (1/d − 1/d_aim)        ← 文字が互いに滑って離れる
//   にじみ s  = b · α / ((1+α) d)       ← 1本の棒が線分に伸びる（L = α d）
//
// どちらも 1/d。**近い文字ほど壊れる。** 5文字を 6 / 10 / 16 / 26 / 42 の
// 深さに分けて置いてあるので、b を上げていくと G → U → N → Z → E の順に、
// 手前から一文字ずつ読めなくなる。E が最後まで残る。
//
// そして E が最後まで残るのは、E が**世界の中でいちばん巨大**だからでもある。
// 画面で5文字の太さを揃えるには半径を距離に比例させるしかないので（r = ρ·ℓ）、
// 同じ太さに見えている5文字は、実際には 1 : 1.7 : 2.7 : 4.3 : 7.0 の大きさの差がある。

// ── 面の上の組版 ───────────────────────────────────────────────
// 実測（スワイプファイルDB）の「Dela Gothic One 157px の極太」「章題は1文字ずつ
// 分かち書き」だけを借りる。書体そのものは外部フォントなので持ってこない
// （この環境では 403 になるし、借りたいのは組み方のほうだった）。
export const GLYPH_W = 0.78 // 字幅（em）
export const STROKE = 0.26 // 画の太さ（em）— 極太
export const TRACK = 0.42 // 分かち書きの空き（em）
export const ADVANCE = GLYPH_W + TRACK
export const WORD = ['G', 'U', 'N', 'Z', 'E']
export const HALF_W = 0.55 // 語の半幅（距離1の面の上）
export const FIT = 0.74 // 画角の半幅。語より広く取らないと、伸びた胴が窓から出る
export const EM = (2 * HALF_W) / (WORD.length * ADVANCE - TRACK)
export const STROKE_PLANE = STROKE * EM

// ── 深さと色 ──────────────────────────────────────────────────
// 色は実測値そのまま（地 #000000 が92%、青 #1100FF が15.8%、ティール/ピンク/
// オレンジをほぼ等量、文字は白）。いちばん手前＝いちばん早く壊れる文字に、
// 実測でいちばん面積を持っていた青を置いた。
export const DEPTH = [6, 10, 16, 26, 42]
export const COLOR = ['#1100ff', '#00c8b3', '#ff2d55', '#ff9500', '#ffffff']
export const AIM = 16 // カメラが狙う深さ（＝ずれの基準面）

export const ALPHA = 4.0 // 棒の長さ L = α·d。自分の距離の4倍の長さがある
export const DX = 0.0235 // 面の上での標本間隔（em）
export const FILL = 1.15 // 隣の棒と少し重ねる係数
export const RHO = 0.5 * DX * EM * FILL // 見かけの太さ（角半径）。全文字で共通

export const B_MAX = 1.9 // カーソルを端まで振ったときの基線
export const B_HOLD = 0.42 // 放っておいたときに落ち着く基線
export const SWEEP = 5.0 // 起動直後、一度だけ端まで振って戻る秒数

// ── 開いたときに出てくるもの ──────────────────────────────────
// 胴 s は、棒の手前端 (1/d) と奥端 (1/(d+L)) の視差の差そのもの。
// 1文字の棒は全部おなじ深さに居るので、この差は**文字ぜんぶで揃っている**——
// だから開いても字はばらけない。ばらけるかわりに、字が**厚みを持つ**。
export const smear = (b, d) => (b * ALPHA) / ((1 + ALPHA) * d)
// 画の太さ T と同じだけ伸びる基線。字が「立体になった」と言える境目に置いた。
export const bodyBaseline = (d) => (STROKE_PLANE * (1 + ALPHA) * d) / ALPHA
// 文字どうしの滑り（基準面 AIM に対して）。近い字ほど大きく、語は横へ伸びる。
export const slip = (b, d) => b * (1 / d - 1 / AIM)
// 棒の全長。画面では点にしか映らない長さ。
export const rodLength = (d) => ALPHA * d

// ── 字形 ─────────────────────────────────────────────────────
// 極太ゴシックを、矩形の和と斜めの帯だけで書く。アウトラインは持たない
// （持つ必要がない——中身を面で塗るのではなく、点で標本するので）。
const T = STROKE
const W = GLYPH_W
const R = (x0, y0, x1, y1) => ({ k: 'r', x0, y0, x1, y1 })
const B = (ax, ay, bx, by, hw) => ({ k: 'b', ax, ay, bx, by, hw })

const GLYPH = {
  G: [
    R(0, 1 - T, W, 1),
    R(0, 0, T, 1),
    R(0, 0, W, T),
    R(W - T, 0, W, 0.58),
    R(0.40, 0.38, W, 0.58),
  ],
  U: [R(0, 0, T, 1), R(W - T, 0, W, 1), R(0, 0, W, T)],
  N: [R(0, 0, T, 1), R(W - T, 0, W, 1), B(T / 2, 1 - T / 2, W - T / 2, T / 2, T / 2)],
  Z: [R(0, 1 - T, W, 1), R(0, 0, W, T), B(W - T / 2, 1 - T / 2, T / 2, T / 2, T / 2)],
  E: [R(0, 0, T, 1), R(0, 1 - T, W, 1), R(0, 0, W, T), R(0, 0.5 - T / 2, W * 0.86, 0.5 + T / 2)],
}

function insideBand(x, y, s) {
  const dx = s.bx - s.ax
  const dy = s.by - s.ay
  const t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (y - s.ay) * dy) / (dx * dx + dy * dy)))
  const px = s.ax + t * dx - x
  const py = s.ay + t * dy - y
  return px * px + py * py <= s.hw * s.hw
}

function inside(ch, x, y) {
  for (const s of GLYPH[ch]) {
    if (s.k === 'r') {
      if (x >= s.x0 && x <= s.x1 && y >= s.y0 && y <= s.y1) return true
    } else if (insideBand(x, y, s)) return true
  }
  return false
}

// 乱数は固定種。毎回同じ絵が出ないと、変化ゲートが測っているのが
// その日の違いなのか jitter なのか分からなくなる。
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ── 棒を置く ─────────────────────────────────────────────────
// 返すのは「面の上の座標 (u,v)」「深さ d」「文字番号」だけ。
// 三次元の姿勢はここでは作らない（Scene.jsx が行列に直す）。
export function buildRods() {
  const rand = rng(0x47554e5a) // 'GUNZ'
  const u = []
  const v = []
  const depth = []
  const letter = []
  const total = WORD.length * ADVANCE - TRACK

  WORD.forEach((ch, k) => {
    const d = DEPTH[k]
    for (let gy = DX * 0.5; gy < 1; gy += DX) {
      for (let gx = DX * 0.5; gx < W; gx += DX) {
        const x = gx + (rand() - 0.5) * DX * 0.55
        const y = gy + (rand() - 0.5) * DX * 0.55
        if (!inside(ch, x, y)) continue
        u.push((k * ADVANCE + x - total / 2) * EM)
        v.push((y - 0.5) * EM)
        depth.push(d)
        letter.push(k)
      }
    }
  })

  return {
    count: u.length,
    u: Float32Array.from(u),
    v: Float32Array.from(v),
    depth: Float32Array.from(depth),
    letter: Uint8Array.from(letter),
  }
}

// 文字ごとの本数（NOTES に書く数字）。
export function perLetter(rods) {
  const n = WORD.map(() => 0)
  for (let i = 0; i < rods.count; i++) n[rods.letter[i]]++
  return n
}
