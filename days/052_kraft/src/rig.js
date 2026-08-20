// rig.js — Day 052 の被写体は「格子」そのものである。
//
// meesverberne.com の FV は、ポインタを揺らすと背景の粗いピクセルが波打つ。
// 見ているうちに気づくのは、動いているのは絵ではないということ。絵は止まっていて、
// 動いているのは「どの段に落ちるか」の境界のほうだ。だからここで組み立てるのは
//
//   1. 高さ場   h(x,y) ∈ [0,1]   ——  文字マスク + 低周波の粒。**一度作ったら二度と動かさない**
//   2. 格子     COLS x ROWS の正方セル。1セル = 1インスタンス = 1ピクセル
//
// の2つだけで、波はここには無い。波はシェーダ側の「しきい値」に足される（Scene.jsx）。
// 幾何を動かさずに絵を動かす、というのが今日の再現対象そのものなので、
// この分離は実装の都合ではなく主題である。

// ── 格子 ────────────────────────────────────────────────────────────────
// 1600x1000 で撮るので 1.6:1。セルが正方でないと市松が菱形になり、
// ディザの段が縦横で違う太さに出る（これは実際に一度やって気づいた）。
export const COLS = 288
export const ROWS = 180

// 世界座標での版面。カメラは正投影で、この幅がそのまま画角になる。
export const PLANE_W = 16
export const PLANE_H = (PLANE_W * ROWS) / COLS // = 10

export const CELL = PLANE_W / COLS // 0.125
export const GAP = 0.14 // セル間の目地。0 にするとただの起伏になり、粒に見えない

// ── パレット ────────────────────────────────────────────────────────────
// 実測値（スワイプファイルDB）:
//   地   クラフト紙のベージュ #D7C6AD
//   文字 紺 #22264B
//   差し 橙 #F7A026 を「筆記体の1語にだけ」
// 3色しか無いということは、階調が3段しか無いということで、
// 中間の色は全部ディザで作るしかない。橙が段の境界にだけ出るのはそのため。
export const PALETTE = {
  kraft: '#d7c6ad',
  paper: '#e3d6c1', // 市松の明るいほう（実測の「薄く透かす」）
  accent: '#f7a026',
  ink: '#22264b',
}

// ── 文字マスク ──────────────────────────────────────────────────────────
// 元サイトは「MEES / VERBERNE」を Doner Display Black の全大文字で2行、
// 画面幅を超えるサイズで置いて左右を切っている。切るのが効いていて、
// 単語が読めることより「版面より大きい」ことが情報になっている。
// ここでは2行を装置の名前にした。フォントは環境に無い可能性があるので
// 実測幅で目標幅に合わせてスケールする（書体が変わっても版面は崩れない）。
// 元サイトの効き所は「2行を同じ幅に揃える」ことのほうで、
// 揃えた結果として短い語（MEES）が長い語（VERBERNE）より倍以上背が高くなる。
// 語の長さの差が、そのまま級数の差として画面に出る。ここでも2語の長さを変えてある。
const LINES = ['KRAFT', 'HALFTONE']
const BLEED = 1.00 // 版面いっぱい。字面は左右の端で切れる寸前まで来る

// 格子より細かく焼いてから平均する。エッジに 0..1 の傾斜が生まれ、
// そこにだけ橙が出る。SS=1 だと段が2段（地と紺）しか出ず、差し色が死ぬ。
const SS = 4

function rasterizeType(w, h) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d', { willReadFrequently: true })
  g.fillStyle = '#000'
  g.fillRect(0, 0, w, h)
  g.fillStyle = '#fff'
  g.textBaseline = 'alphabetic'

  const target = w * BLEED
  const FONT = (px) => `900 ${px}px "Arial Black", "Helvetica Neue", Impact, sans-serif`

  // 各行を「同じ幅」に合わせる。級数はその結果として決まる（指定しない）。
  const rows = LINES.map((word) => {
    const probe = 400
    g.font = FONT(probe)
    const size = (probe * target) / Math.max(1, g.measureText(word).width)
    g.font = FONT(size)
    const m = g.measureText(word)
    return {
      word,
      size,
      width: m.width,
      asc: m.actualBoundingBoxAscent || size * 0.72, // 大文字だけなので ascent = キャップハイト
    }
  })

  const LEAD = 1.13 // 行間。1.02 まで詰めたら K の脚と H の肩が食い合った（実際にやった）
  const block = rows.reduce((s, r) => s + r.asc * LEAD, 0)
  // 版面の中央より少し上。下に地を残すのは、粒とポインタの潮が見える場所が要るから
  let y = h * 0.47 - block * 0.5
  for (const r of rows) {
    g.font = FONT(r.size)
    y += r.asc
    g.fillText(r.word, (w - r.width) * 0.5, y)
    y += r.asc * (LEAD - 1)
  }
  return g.getImageData(0, 0, w, h).data
}

// ── 低周波の粒 ──────────────────────────────────────────────────────────
// 文字が無いところが完全な平面だと、ディザが一様になって「紙」に見えない。
// 元サイトの背景がざらついて見えるのは、平らな地に段が1段だけ立っているから。
// 値ノイズ2オクターブで ±0.5 くらいの緩い場を作る。
function hash2(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453
  return s - Math.floor(s)
}
function vnoise(x, y) {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const xf = x - xi
  const yf = y - yi
  const u = xf * xf * (3 - 2 * xf)
  const v = yf * yf * (3 - 2 * yf)
  const a = hash2(xi, yi)
  const b = hash2(xi + 1, yi)
  const c = hash2(xi, yi + 1)
  const d = hash2(xi + 1, yi + 1)
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}

/**
 * 格子を1回だけ組む。返るのは「動かないもの」だけ。
 *   height : セルごとの高さ場 0..1（文字マスク + 粒）
 *   mask   : 文字だけの成分 0..1（色の判定には使わないが、NOTES 用に残す）
 */
export function buildLattice() {
  const tw = COLS * SS
  const th = ROWS * SS
  const src = rasterizeType(tw, th)

  const height = new Float32Array(COLS * ROWS)
  const mask = new Float32Array(COLS * ROWS)

  for (let j = 0; j < ROWS; j++) {
    for (let i = 0; i < COLS; i++) {
      // SSxSS を平均 → エッジが 0..1 の傾斜になる
      let acc = 0
      for (let b = 0; b < SS; b++) {
        for (let a = 0; a < SS; a++) {
          const px = ((j * SS + b) * tw + (i * SS + a)) * 4
          acc += src[px] / 255
        }
      }
      const m = acc / (SS * SS)

      // 粒。2オクターブ。文字の上でも少しだけ効かせて、面をベタにしない
      const n =
        0.62 * vnoise(i * 0.025, j * 0.025) + 0.38 * vnoise(i * 0.075 + 31, j * 0.075 + 17)

      const k = j * COLS + i
      mask[k] = m
      // 地は 0.10〜0.34 あたりを漂い、文字は 0.72〜0.96。
      // 段は3つ（地/橙/紺）なので、この2帯の間にちょうど境界が1本入る。
      height[k] = Math.min(1, 0.10 + n * 0.26 + m * 0.66)
    }
  }
  return { height, mask, cols: COLS, rows: ROWS }
}
