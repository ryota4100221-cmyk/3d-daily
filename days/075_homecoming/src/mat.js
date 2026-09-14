// mat.js — 盤に「刷る」ほうの層。
//
// 文字は3Dに置かない（troika のフォント読み込みが失敗すると Scene ごと落ちる。
// RUN.md の「Canvasが真っ白になる罠」）。代わりに canvas2d で一枚の版を作り、
// それを盤の天面に貼る。ページの上に浮く UI ではなく、盤に印刷された罫と数字になる。

import { ORIENT, EVEN, DEPTH, cornerDiag, FIELD } from './rig.js'

// Pelata Pieces の実測値そのまま
export const C = {
  paper: '#EFEBE0', // マットの生成り（地の白 #FFFFFF から一段だけ落とす）
  white: '#F8F5ED', // 盤面（マットより一段明るい）
  ink: '#646450', // 文字のグレージュ
  orange: '#FF7711',
  cyan: '#00A8E5',
  green: '#109848',
  yellow: '#E0B848',
}
export const DIAG_COLOR = [C.orange, C.cyan, C.green, C.yellow]

// 盤の実寸（ワールド単位）とテクスチャの解像度
export const MAT = { w: 12.6, d: 9.8, cw: 2048, ch: 1593 }

// 升の中心 → ワールド。盤の左奥に置く。
export const FX = -2.5
export const FZ = -1.9
export const cellX = (i) => FX + (i - (FIELD.w - 1) / 2)
export const cellZ = (j) => FZ + (j - (FIELD.h - 1) / 2)

// レールの 24 枠（手前・2段12列）
export const RAIL = { x0: 0, z0: 1.45, dz: 1.25, pitch: 1.03, pad: 0.95, cols: 12 }
export const railX = (k) => RAIL.x0 + ((k % RAIL.cols) - (RAIL.cols - 1) / 2) * RAIL.pitch
export const railZ = (k) => RAIL.z0 + ((k / RAIL.cols) | 0) * RAIL.dz

// ワールド(x,z) → canvas(px)
const px = (x) => ((x + MAT.w / 2) / MAT.w) * MAT.cw
const py = (z) => ((z + MAT.d / 2) / MAT.d) * MAT.ch
const S = MAT.cw / MAT.w // 1 ワールド単位あたりの px

const SANS = (w, s) => `${w} ${s}px sans-serif`
const MONO = (w, s) => `${w} ${s}px monospace`

function track(g, text, x, y, sp, font, color, align = 'left') {
  g.font = font
  g.fillStyle = color
  const chars = [...text]
  const total = chars.reduce((a, c) => a + g.measureText(c).width + sp, -sp)
  let cx = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x
  for (const c of chars) {
    g.fillText(c, cx, y)
    cx += g.measureText(c).width + sp
  }
  return total
}

// ── 姿勢のグリフ：小さな等角投影のサイコロを1つ刷る ─────────────────────
// 8隅を4本の体対角線で色分けしてあるので、24枚は全部ちがう絵になる。
// 「どれが帰ってこられるか」は絵からは読めない。読めるのはレールの明暗だけ。
function glyph(g, R, cx, cy, s, on) {
  const iso = (p) => [(p[0] - p[2]) * 0.866 * s + cx, ((p[0] + p[2]) * 0.5 - p[1]) * s + cy]
  const V = {}
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1])
    V[`${sx},${sy},${sz}`] = [sx, sy, sz]
  const face = (a, b, c, d, fill) => {
    g.beginPath()
    const pts = [a, b, c, d].map((v) => iso(v))
    g.moveTo(pts[0][0], pts[0][1])
    for (let i = 1; i < 4; i++) g.lineTo(pts[i][0], pts[i][1])
    g.closePath()
    g.fillStyle = fill
    g.fill()
    g.strokeStyle = on ? 'rgba(100,100,80,0.55)' : 'rgba(100,100,80,0.28)'
    g.lineWidth = Math.max(1.2, s * 0.05)
    g.stroke()
  }
  const a = on ? 1 : 0.34
  // 見えている3面（+y 上 / +x 右 / +z 手前）
  face(V['-1,1,-1'], V['1,1,-1'], V['1,1,1'], V['-1,1,1'], `rgba(255,255,255,${a})`)
  face(V['1,1,-1'], V['1,-1,-1'], V['1,-1,1'], V['1,1,1'], `rgba(238,236,230,${a})`)
  face(V['-1,1,1'], V['1,1,1'], V['1,-1,1'], V['-1,-1,1'], `rgba(226,224,216,${a})`)
  // 手前側の 7 隅に、その隅に来ている体対角線の色を打つ
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    if (sx === -1 && sy === -1 && sz === -1) continue // 裏の隅
    const c = [sx, sy, sz]
    const [ux, uy] = iso(c)
    g.beginPath()
    g.arc(ux, uy, s * 0.17, 0, Math.PI * 2)
    g.fillStyle = DIAG_COLOR[cornerDiag(R, c)]
    g.globalAlpha = on ? 1 : 0.26
    g.fill()
    g.globalAlpha = 1
  }
}

// ── 版を1枚刷る ────────────────────────────────────────────────────────
export function drawMat(canvas, { cen, route = [], ghosts = [], routesWalked = 0, lastHome = -1 }) {
  const g = canvas.getContext('2d')
  g.clearRect(0, 0, MAT.cw, MAT.ch)
  g.fillStyle = C.paper
  g.fillRect(0, 0, MAT.cw, MAT.ch)

  // ---- 盤（升目）----
  const gx0 = px(cellX(0) - 0.5)
  const gx1 = px(cellX(FIELD.w - 1) + 0.5)
  const gz0 = py(cellZ(0) - 0.5)
  const gz1 = py(cellZ(FIELD.h - 1) + 0.5)
  g.fillStyle = C.white
  g.fillRect(gx0, gz0, gx1 - gx0, gz1 - gz0)
  g.strokeStyle = 'rgba(100,100,80,0.30)'
  g.lineWidth = 2.6
  for (let i = 0; i <= FIELD.w; i++) {
    const x = px(cellX(0) - 0.5 + i)
    g.beginPath(); g.moveTo(x, gz0); g.lineTo(x, gz1); g.stroke()
  }
  for (let j = 0; j <= FIELD.h; j++) {
    const y = py(cellZ(0) - 0.5 + j)
    g.beginPath(); g.moveTo(gx0, y); g.lineTo(gx1, y); g.stroke()
  }
  g.strokeStyle = 'rgba(100,100,80,0.45)'
  g.lineWidth = 3
  g.strokeRect(gx0, gz0, gx1 - gx0, gz1 - gz0)

  // ---- これまで歩いた道の影（薄く積む）----
  g.lineJoin = 'round'
  g.lineCap = 'round'
  for (const gcells of ghosts) {
    g.strokeStyle = 'rgba(100,100,80,0.075)'
    g.lineWidth = S * 0.03
    g.beginPath()
    gcells.forEach(([i, j], k) => {
      const x = px(cellX(i)), y = py(cellZ(j))
      k ? g.lineTo(x, y) : g.moveTo(x, y)
    })
    g.stroke()
  }

  // ---- いま歩いている道 ----
  if (route.length > 1) {
    g.strokeStyle = C.orange
    g.lineWidth = S * 0.055
    g.beginPath()
    route.forEach(([i, j], k) => {
      const x = px(cellX(i)), y = py(cellZ(j))
      k ? g.lineTo(x, y) : g.moveTo(x, y)
    })
    g.stroke()
  }

  // ---- 出発／帰着の升 ----
  const hx = px(cellX(FIELD.home[0]))
  const hz = py(cellZ(FIELD.home[1]))
  g.strokeStyle = C.orange
  g.lineWidth = S * 0.045
  g.beginPath(); g.arc(hx, hz, S * 0.38, 0, Math.PI * 2); g.stroke()
  track(g, 'HOME', hx, hz + S * 0.72, 3, MONO(400, 27), C.ink, 'center')

  // ---- 右の刷り込み（数えた結果）----
  const rx = px(1.0)
  let ry = py(-3.72)
  track(g, `THE FIELD  ${FIELD.w} × ${FIELD.h}`, rx, ry, 9, MONO(400, 26),
    'rgba(100,100,80,0.6)')
  ry += 58
  track(g, 'A CLOSED ROUTE', rx, ry, 11, MONO(400, 29), C.ink)
  ry += 124
  g.font = SANS(700, 178)
  g.fillStyle = '#2A2A24'
  g.fillText('12', rx - 8, ry)
  const w12 = g.measureText('12').width
  g.font = SANS(700, 76)
  g.fillStyle = C.ink
  g.fillText('/ 24', rx + w12 + 18, ry)
  ry += 58
  track(g, 'WAYS TO COME HOME', rx, ry, 7, MONO(400, 31), C.ink)
  ry += 72
  g.font = MONO(400, 27)
  g.fillStyle = 'rgba(100,100,80,0.88)'
  const lines = [
    `${cen.routes.toLocaleString('en-US')} closed routes walked,`,
    `${cen.tips.toLocaleString('en-US')} tips in all.`,
    `${cen.reached} orientations came home.`,
    `The other ${cen.never} came home 0 times —`,
    `not rarely. Never.`,
  ]
  for (const t of lines) { g.fillText(t, rx, ry); ry += 37 }
  ry += 20
  g.fillStyle = C.orange
  g.fillText('every tip is an odd swap of the four', rx, ry); ry += 36
  g.fillText('body diagonals, and a closed route', rx, ry); ry += 36
  g.fillText('takes an even number of tips.', rx, ry)

  // ---- レール：24 の姿勢 ----
  const ly = py(RAIL.z0 - RAIL.dz * 0.58)
  const lw = track(g, 'THE 24 WAYS A DIE CAN SIT',
    px(railX(0) - RAIL.pad / 2), ly, 9, MONO(400, 30), C.ink)
  g.font = MONO(400, 25)
  g.fillStyle = 'rgba(100,100,80,0.55)'
  g.fillText('ordered by how many tips from the start', px(railX(0) - RAIL.pad / 2) + lw + 34, ly)
  g.font = MONO(400, 28)
  g.fillStyle = 'rgba(100,100,80,0.62)'
  const leg = 'filled = came home   ·   hollow = never'
  g.fillText(leg, px(railX(RAIL.cols - 1) + RAIL.pad / 2) - g.measureText(leg).width, ly)

  for (let k = 0; k < 24; k++) {
    const cx = px(railX(k))
    const cy = py(railZ(k))
    const h = (RAIL.pad / 2) * S
    const on = cen.tally[k] > 0
    g.beginPath()
    g.roundRect(cx - h, cy - h, h * 2, h * 2, 12)
    g.fillStyle = on ? 'rgba(255,119,17,0.10)' : 'rgba(0,168,229,0.03)'
    g.fill()
    g.strokeStyle = on ? C.orange : 'rgba(0,168,229,0.5)'
    g.lineWidth = on ? 4.5 : 2.5
    if (!on) g.setLineDash([8, 9])
    g.stroke()
    g.setLineDash([])

    glyph(g, ORIENT[k], cx, cy - h * 0.20, h * 0.40, on)

    // 何回帰ってきたか
    g.font = MONO(400, 26)
    g.fillStyle = on ? C.orange : 'rgba(0,168,229,0.8)'
    const n = on ? cen.tally[k].toLocaleString('en-US') : '0'
    g.fillText(n, cx - g.measureText(n).width / 2, cy + h - 16)
    // 通し番号と、単位姿勢からの手数
    g.font = MONO(400, 22)
    g.fillStyle = 'rgba(100,100,80,0.45)'
    g.fillText(String(k + 1).padStart(2, '0'), cx - h + 13, cy - h + 29)
    const dp = `${DEPTH[k]}t`
    g.fillStyle = DEPTH[k] % 2 === 0 ? 'rgba(255,119,17,0.8)' : 'rgba(0,168,229,0.7)'
    g.fillText(dp, cx + h - 13 - g.measureText(dp).width, cy - h + 29)

    // 手数が変わるところに区切り（偶数層＝塗り／奇数層＝抜き が縞になって出る）
    if (k > 0 && k % RAIL.cols !== 0 && DEPTH[k] !== DEPTH[k - 1]) {
      g.strokeStyle = 'rgba(100,100,80,0.5)'
      g.lineWidth = 2.5
      const mx = (cx - h + px(railX(k - 1)) + h) / 2
      g.beginPath(); g.moveTo(mx, cy - h - 16); g.lineTo(mx, cy + h + 16); g.stroke()
    }

    // いま帰ってきた枠に印
    if (k === lastHome) {
      g.strokeStyle = C.orange
      g.lineWidth = 6
      g.beginPath()
      g.roundRect(cx - h - 11, cy - h - 11, h * 2 + 22, h * 2 + 22, 14)
      g.stroke()
    }
  }

  // ---- 足もと ----
  const by = py(MAT.d / 2 - 0.5)
  track(g, 'AFTER  PELATA PIECES  ·  FINNISH DESIGN SHOP', px(-MAT.w / 2 + 0.45), by, 6,
    MONO(400, 27), 'rgba(100,100,80,0.72)')
  const r = `ROUTE ${String(routesWalked).padStart(3, '0')}`
  g.font = MONO(400, 27)
  g.fillStyle = C.orange
  g.fillText(r, px(MAT.w / 2 - 0.45) - g.measureText(r).width, by)

  return canvas
}
