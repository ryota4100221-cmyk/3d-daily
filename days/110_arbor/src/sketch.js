// 鉛筆の下書きを画面 px（1440×900）で1枚に描く。WebGL の面はこれを gl_FragCoord で引き、DOM はそのまま地に敷く
// 木目＝ノイズ場 φ の等高線（marching squares）。穴・外形は facade.json の同じ多角形から引く
import F from './facade.json'

const W = 1440, H = 900

function rng(seed) {
  let s = seed >>> 0
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
}

function grow(poly, d) {
  const cx = poly.reduce((a, p) => a + p[0], 0) / poly.length, cy = poly.reduce((a, p) => a + p[1], 0) / poly.length
  return poly.map(([x, y]) => { const l = Math.hypot(x - cx, y - cy); return [x + (x - cx) * d / l, y + (y - cy) * d / l] })
}

function rounded(ctx, poly, r) {
  const n = poly.length
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
  ctx.moveTo(...mid(poly[n - 1], poly[0]))
  for (let i = 0; i < n; i++) {
    const p = poly[i], q = poly[(i + 1) % n]
    const m = mid(p, q)
    ctx.arcTo(p[0], p[1], m[0], m[1], r)
  }
  ctx.closePath()
}

function pencil(ctx, a = 0.55, w = 0.8) {
  ctx.strokeStyle = `rgba(58,50,42,${a})`
  ctx.lineWidth = w
}

// 少し揺れる直線（手で引いた線）
function line(ctx, R, x0, y0, x1, y1, j = 0.6) {
  const n = Math.max(2, Math.round(Math.hypot(x1 - x0, y1 - y0) / 40))
  ctx.moveTo(x0, y0)
  for (let i = 1; i <= n; i++) {
    const t = i / n
    ctx.lineTo(x0 + (x1 - x0) * t + (R() - 0.5) * j, y0 + (y1 - y0) * t + (R() - 0.5) * j)
  }
}

let LEAF = new Path2D()
function tree(ctx, R, x, y, len, ang, depth) {
  if (depth === 0 || len < 4) {
    if (R() < 0.45) return
    const ctx0 = ctx; ctx = LEAF
    // 葉の塊：ぎざぎざの縁の輪郭を1つ（ref の樹は葉を1枚ずつでなく塊の輪郭で描く）
    const r = 9 + R() * 9, n = 11 + Math.floor(R() * 5), ox = x + (R() - 0.5) * 6, oy = y - r * 0.4
    for (let q = 0; q <= n; q++) {
      const a0 = (q / n) * Math.PI * 2, rr = r * (0.8 + R() * 0.35)
      const px = ox + Math.cos(a0) * rr, py = oy + Math.sin(a0) * rr * 0.8
      if (q === 0) ctx.moveTo(px, py)
      else { const am = a0 - Math.PI / n; ctx.quadraticCurveTo(ox + Math.cos(am) * rr * 1.28, oy + Math.sin(am) * rr * 1.05, px, py) }
    }
    ctx = ctx0
    return
  }
  const x1 = x + Math.cos(ang) * len, y1 = y + Math.sin(ang) * len
  ctx.moveTo(x, y)
  ctx.quadraticCurveTo((x + x1) / 2 + (R() - 0.5) * len * 0.15, (y + y1) / 2, x1, y1)
  const n = depth > 3 ? 2 : 2 + (R() < 0.4 ? 1 : 0)
  for (let i = 0; i < n; i++) {
    tree(ctx, R, x1, y1, len * (0.62 + R() * 0.18), ang + (i - (n - 1) / 2) * (0.5 + R() * 0.35), depth - 1)
  }
}

// アトリウムの木目：φ の等高線
function grain(ctx) {
  const x0 = 540, x1 = 912, y0 = 200, y1 = 820, g = 2
  const nx = Math.ceil((x1 - x0) / g) + 1, ny = Math.ceil((y1 - y0) / g) + 1
  // 上半分：縦に長い尖った輪（幹の節）。下半分：中心へ寄り、y 560 から逆 V のアーチを避けて左右へ開く
  const knots = [[598, 400, 16, 120, 44], [648, 360, 18, 150, -46], [700, 395, 15, 130, 44], [752, 350, 18, 160, -46], [806, 400, 16, 135, 44], [858, 380, 14, 120, -26], [672, 520, 10, 70, 18], [785, 540, 10, 70, -18]]
  const phi = new Float32Array(nx * ny)
  for (let j = 0; j < ny; j++) {
    const y = y0 + j * g
    const t = (y - y0) / (y1 - y0)
    const u = Math.min(1, Math.max(0, (t - 0.25) / 0.5)), k = 1 + 1.1 * u * u * (3 - 2 * u)      // 下ほど詰まる＝線が中心へ寄る
    const sA = Math.min(1, Math.max(0, (y - 540) / 266)), w = 128 * Math.pow(sA, 1.15)                               // アーチの半幅
    for (let i = 0; i < nx; i++) {
      const x = x0 + i * g, dx = x - 722
      const ad = Math.max(0, Math.abs(dx) - w * Math.max(0, 1 - Math.abs(dx) / 200))
      let v = Math.sign(dx) * ad * k + 10 * Math.sin(dx * 0.013 + y * 0.005) * (1 - t)
      for (const [kx, ky, sx, sy, a] of knots) {
        const syy = y < ky ? sy * 1.5 : sy
        v += a * Math.exp(-(((x - kx) / (sx * (y < ky ? 0.6 + 0.4 * (1 - (ky - y) / syy) : 1))) ** 2 + ((y - ky) / syy) ** 2))
      }
      phi[j * nx + i] = Math.abs(dx) < w ? NaN : v
    }
  }
  const step = 6.5
  const paths = new Map()
  const P = (L) => { let p = paths.get(L); if (!p) paths.set(L, (p = new Path2D())); return p }
  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = phi[j * nx + i], b = phi[j * nx + i + 1], c = phi[(j + 1) * nx + i + 1], d = phi[(j + 1) * nx + i]
    const lo = Math.min(a, b, c, d), hi = Math.max(a, b, c, d)
    if (!(lo === lo && hi === hi)) continue
    for (let L = Math.ceil(lo / step) * step; L <= hi; L += step) {
      const px = x0 + i * g, py = y0 + j * g
      const pts = []
      const e = (va, vb, ax, ay, bx, by) => { if ((va - L) * (vb - L) < 0) { const t = (L - va) / (vb - va); pts.push([ax + (bx - ax) * t, ay + (by - ay) * t]) } }
      e(a, b, px, py, px + g, py); e(b, c, px + g, py, px + g, py + g); e(c, d, px + g, py + g, px, py + g); e(d, a, px, py + g, px, py)
      const p = P(L)
      if (pts.length >= 2) { p.moveTo(...pts[0]); p.lineTo(...pts[1]) }
      if (pts.length === 4) { p.moveTo(...pts[2]); p.lineTo(...pts[3]) }
    }
  }
  ctx.save(); ctx.filter = 'blur(14px)'
  for (const [kx, ky, sx, sy] of knots) { ctx.fillStyle = 'rgba(70,62,54,0.06)'; ctx.beginPath(); ctx.ellipse(kx + 10, ky - 10, sx * 1.4, sy * 1.2, 0, 0, Math.PI * 2); ctx.fill() }
  ctx.fillStyle = 'rgba(70,62,54,0.08)'; ctx.beginPath(); ctx.moveTo(722, 560); ctx.lineTo(600, 820); ctx.lineTo(845, 820); ctx.fill()
  ctx.restore()
  const R = rng(7)
  for (const [, p] of paths) {
    const r = R()
    pencil(ctx, r < 0.1 ? 0.38 : r < 0.45 ? 0.24 : 0.12, r < 0.1 ? 1.2 : r < 0.45 ? 0.75 : 0.55)
    ctx.stroke(p)
  }
}

export function drawSketch(canvas, scale = 2, hand = 'cursive') {
  canvas.width = W * scale; canvas.height = H * scale
  const ctx = canvas.getContext('2d')
  ctx.setTransform(scale, 0, 0, scale, 0, 0)
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H)
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'
  const R = rng(110)
  LEAF = new Path2D()

  // 地平の線・中心の作図線
  ctx.beginPath(); line(ctx, R, 0, 223, W, 221, 0.8); pencil(ctx, 0.45, 0.7); ctx.stroke()
  ctx.beginPath(); line(ctx, R, 713, 0, 713, H, 0.4); pencil(ctx, 0.12, 0.6); ctx.stroke()
  ctx.beginPath(); line(ctx, R, 0, 727, W, 729, 1); pencil(ctx, 0.35, 0.7); ctx.stroke()

  // 庇の弧（2本）と下の細かい線
  ctx.beginPath()
  for (const [dy, a] of [[0, 1], [-6, 1]]) {
    ctx.moveTo(355, 222 + dy)
    ctx.quadraticCurveTo(728, 132 + dy, 1100, 222 + dy)
  }
  pencil(ctx, 0.5, 0.8); ctx.stroke()
  ctx.beginPath()
  for (let x = 520; x <= 940; x += 4) { const y = 222 - 90 * (1 - ((x - 728) / 372) ** 2) * 0.5 + 18; ctx.moveTo(x, y); ctx.lineTo(x + 2, y + 9) }
  pencil(ctx, 0.3, 0.5); ctx.stroke()

  // 外形と穴の輪郭
  ctx.beginPath()
  for (const k of ['L', 'R']) {
    const [a, b, c, d] = F.slabs[k]
    line(ctx, R, a, b, c, b); line(ctx, R, c, b, c, d); line(ctx, R, c, d, a, d)
    for (const h of F.holes[k]) rounded(ctx, grow(h, F.grow || 0), F.radius)
  }
  pencil(ctx, 0.42, 0.75); ctx.stroke()

  // 穴の奥：室内の格子（階・窓の縦枠）
  ctx.beginPath()
  for (const y of [330, 395, 468, 520, 560, 640, 690]) { line(ctx, R, 0, y, 535, y + 1); line(ctx, R, 925, y, W, y - 1) }
  for (let x = 20; x < 535; x += 46 + R() * 30) line(ctx, R, x, 300, x + (R() - 0.5) * 4, 716)
  for (let x = 940; x < W; x += 40 + R() * 34) line(ctx, R, x, 300, x + (R() - 0.5) * 4, 716)
  pencil(ctx, 0.3, 0.6); ctx.stroke()
  // ハッチ（斜めの影の線）
  ctx.beginPath()
  for (const [cx, cy, w, h] of [[350, 330, 80, 70], [430, 310, 50, 90], [1000, 320, 60, 60], [1150, 330, 70, 50], [470, 420, 50, 60]]) {
    for (let t = 0; t < w + h; t += 5) ctx.moveTo(cx + Math.min(t, w), cy + Math.max(0, t - w)), ctx.lineTo(cx + Math.max(0, t - h), cy + Math.min(t, h))
  }
  pencil(ctx, 0.22, 0.5); ctx.stroke()

  // 穴の奥：セピアの温度と部屋のパース（各穴の外接矩形から奥の矩形へ）
  ctx.fillStyle = 'rgba(196,160,118,0.14)'
  ctx.fillRect(0, 296, 540, 424); ctx.fillRect(920, 296, 520, 424)
  for (const k of ['L', 'R']) for (const h of F.holes[k]) {
    const xs = h.map((p) => p[0]), ys = h.map((p) => p[1])
    const a = Math.min(...xs), b = Math.max(...xs), c = Math.min(...ys), d = Math.max(...ys)
    const gx = ctx.createLinearGradient(a, c, b, d)
    gx.addColorStop(0, 'rgba(90,76,62,0.22)'); gx.addColorStop(0.55, 'rgba(90,76,62,0.06)'); gx.addColorStop(1, 'rgba(90,76,62,0)')
    ctx.fillStyle = gx; ctx.fillRect(a - 4, c - 4, b - a + 8, d - c + 8)
  }
  ctx.beginPath()
  for (const k of ['L', 'R']) for (const h of F.holes[k]) {
    const xs = h.map((p) => p[0]), ys = h.map((p) => p[1])
    const a = Math.min(...xs), b = Math.max(...xs), c = Math.min(...ys), d = Math.max(...ys)
    const cx = (a + b) / 2 + (720 - (a + b) / 2) * 0.08, cy = (c + d) / 2 - 6
    const ia = cx - (b - a) * 0.3, ib = cx + (b - a) * 0.3, ic = cy - (d - c) * 0.28, id = cy + (d - c) * 0.3
    line(ctx, R, ia, ic, ib, ic); line(ctx, R, ib, ic, ib, id); line(ctx, R, ib, id, ia, id); line(ctx, R, ia, id, ia, ic)
    line(ctx, R, a, c, ia, ic); line(ctx, R, b, c, ib, ic); line(ctx, R, b, d, ib, id); line(ctx, R, a, d, ia, id)
    for (let q = 1; q <= 3; q++) { const y = id - (id - ic) * q / 4 + (R() - 0.5) * 4; if (R() < 0.6) line(ctx, R, ia, y, ib, y) }
    if (R() < 0.5) { const x = ia + (ib - ia) * (0.2 + R() * 0.6); line(ctx, R, x, id, x, id - (id - ic) * 0.5); line(ctx, R, x - 8, id - (id - ic) * 0.5, x + 8, id - (id - ic) * 0.5) }
  }
  pencil(ctx, 0.3, 0.55); ctx.stroke()
  // 樹（左に3本、右に1本）
  ctx.beginPath()
  tree(ctx, R, 250, 730, 130, -Math.PI / 2 - 0.1, 6)
  tree(ctx, R, 352, 700, 150, -Math.PI / 2 + 0.04, 6)
  tree(ctx, R, 470, 720, 105, -Math.PI / 2 + 0.05, 5)
  tree(ctx, R, 990, 725, 85, -Math.PI / 2, 6)
  tree(ctx, R, 1160, 725, 70, -Math.PI / 2 + 0.1, 5)
  tree(ctx, R, 120, 720, 80, -Math.PI / 2 - 0.05, 6)
  tree(ctx, R, 1330, 725, 80, -Math.PI / 2 + 0.05, 6)
  pencil(ctx, 0.4, 0.7); ctx.stroke()
  ctx.fillStyle = 'rgba(110,96,80,0.07)'; ctx.fill(LEAF)
  pencil(ctx, 0.3, 0.55); ctx.stroke(LEAF)

  // アトリウム：枠・階の線・木目
  ctx.beginPath()
  line(ctx, R, 545, 230, 545, 810); line(ctx, R, 905, 230, 905, 790)
  for (const y of [262, 356, 446, 528]) line(ctx, R, 545, y, 905, y + 1)
  pencil(ctx, 0.4, 0.7); ctx.stroke()
  // アトリウムの陰：庇の下の帯・右の返しの影・輪の間の薄い鉛筆の面
  ctx.filter = 'blur(10px)'
  let gr = ctx.createLinearGradient(0, 205, 0, 280)
  gr.addColorStop(0, 'rgba(70,62,54,0.28)'); gr.addColorStop(1, 'rgba(70,62,54,0)')
  ctx.fillStyle = gr; ctx.fillRect(545, 205, 360, 75)
  gr = ctx.createLinearGradient(870, 0, 905, 0)
  gr.addColorStop(0, 'rgba(70,62,54,0)'); gr.addColorStop(1, 'rgba(70,62,54,0.16)')
  ctx.fillStyle = gr; ctx.fillRect(870, 230, 35, 560)
  for (const [x, y, w, h] of [[620, 260, 50, 260], [725, 250, 45, 240], [830, 270, 40, 230]]) {
    gr = ctx.createLinearGradient(0, y, 0, y + h)
    gr.addColorStop(0, 'rgba(70,62,54,0.10)'); gr.addColorStop(1, 'rgba(70,62,54,0)')
    ctx.fillStyle = gr; ctx.fillRect(x, y, w, h)
  }
  ctx.fillStyle = 'rgba(190,160,124,0.12)'; ctx.fillRect(545, 230, 360, 580)
  for (const [x, y, w, h, a] of [[560, 300, 70, 330, 0.06], [655, 280, 60, 300, 0.05], [770, 290, 60, 300, 0.06], [850, 320, 50, 380, 0.08], [600, 600, 250, 220, 0.05]]) {
    ctx.fillStyle = `rgba(70,62,54,${a})`; ctx.beginPath(); ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2); ctx.fill()
  }
  ctx.filter = 'none'
  // アーチの奥の窓の格子
  ctx.beginPath()
  for (const y of [640, 690, 740, 790]) { const hw = 128 * Math.pow((y - 556) / 250, 0.8) - 6; line(ctx, R, 722 - hw, y, 722 + hw, y) }
  for (const x of [680, 702, 742, 764]) line(ctx, R, x, 640 + Math.abs(x - 722) * 1.2, x, 800)
  pencil(ctx, 0.3, 0.6); ctx.stroke()
  grain(ctx)

  // 寸法と手書きの数字
  ctx.beginPath()
  line(ctx, R, 525, 150, 525, 215); line(ctx, R, 525, 150, 640, 150)
  line(ctx, R, 345, 177, 395, 177); line(ctx, R, 350, 177, 372, 222)
  line(ctx, R, 950, 146, 1030, 146); line(ctx, R, 950, 146, 945, 215)
  line(ctx, R, 960, 181, 1030, 181); line(ctx, R, 1030, 181, 1000, 222)
  pencil(ctx, 0.45, 0.7); ctx.stroke()
  ctx.fillStyle = 'rgba(58,50,42,0.62)'
  ctx.font = `22px ${hand}`
  ctx.fillText('3426 970', 566, 146); ctx.fillText('29.5', 982, 177)
  ctx.font = `18px ${hand}`
  ctx.fillText('557', 367, 173); ctx.fillText('Pane', 983, 142); ctx.fillText('1220', 1104, 160)

  // 外壁の下の落ち影と、ぼけた人の残像
  ctx.save(); ctx.filter = 'blur(9px)'
  ctx.fillStyle = 'rgba(80,72,64,0.16)'; ctx.fillRect(150, 766, 390, 26); ctx.fillRect(920, 766, 520, 26)
  const RG = rng(31)
  for (let i = 0; i < 26; i++) {
    const x = 120 + RG() * 1200, h = 30 + RG() * 26
    ctx.fillStyle = `rgba(80,72,64,${0.05 + RG() * 0.08})`
    ctx.fillRect(x, 850 - h, 8 + RG() * 8, h)
  }
  ctx.restore()
  // 足元の人（ぼんやりした棒の人）
  ctx.beginPath()
  for (const [x, s] of [[612, 1], [640, 0.9], [690, 1.05], [770, 1], [600, 0.8], [905, 0.9], [258, 0.9], [1110, 0.85]]) {
    const y = 812
    ctx.moveTo(x + 4 * s, y - 34 * s); ctx.arc(x, y - 34 * s, 4 * s, 0, Math.PI * 2)
    line(ctx, R, x, y - 30 * s, x - 1, y - 12 * s); line(ctx, R, x - 1, y - 12 * s, x - 4 * s, y); line(ctx, R, x - 1, y - 12 * s, x + 4 * s, y)
    line(ctx, R, x, y - 26 * s, x - 6 * s, y - 16 * s); line(ctx, R, x, y - 26 * s, x + 6 * s, y - 16 * s)
  }
  pencil(ctx, 0.14, 0.5); ctx.stroke()
  return canvas
}
