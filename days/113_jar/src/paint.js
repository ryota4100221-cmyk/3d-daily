// canvas に描く素材：胡瓜の輪切り・瓶の中身・ガラスの光・蓋の筋・水玉
import * as THREE from 'three'

// 決まった乱数（毎回同じ絵）
export function rng(seed) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function tex(canvas) {
  const t = new THREE.CanvasTexture(canvas)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  t.generateMipmaps = true
  t.minFilter = THREE.LinearMipmapLinearFilter
  return t
}

// 皮の縁：細かく波打つ半径
function rimR(R, th, ph) {
  return R * (1 + 0.010 * Math.sin(5 * th + ph[0]) + 0.012 * Math.abs(Math.sin(19 * th + ph[1])) + 0.006 * Math.sin(41 * th + ph[2]) + 0.004 * Math.sin(87 * th + ph[3]))
}
function rimPath(g, cx, cy, R, ph, k = 1) {
  g.beginPath()
  for (let i = 0; i <= 720; i++) {
    const th = (i / 720) * Math.PI * 2
    const r = rimR(R, th, ph) * k
    const x = cx + Math.cos(th) * r, y = cy + Math.sin(th) * r
    i ? g.lineTo(x, y) : g.moveTo(x, y)
  }
  g.closePath()
}

// 胡瓜の輪切り（正面）。opts.tint で漬かった色にずらす
export function sliceCanvas(seed, opts = {}) {
  const S = opts.size || 1024
  const c = document.createElement('canvas')
  c.width = c.height = S
  const g = c.getContext('2d')
  const r = rng(seed)
  const cx = S / 2, cy = S / 2, R = S * 0.485
  const ph = [r() * 6, r() * 6, r() * 6, r() * 6]
  const pickled = !!opts.pickled

  // 皮（濃緑）
  if (!pickled) g.filter = 'blur(1.6px)'
  rimPath(g, cx, cy, R, ph)
  if (pickled) { g.fillStyle = '#24420e' } else { const rg = g.createLinearGradient(0, 0, S, S); rg.addColorStop(0, '#7f9a2c'); rg.addColorStop(0.5, '#5e7c1c'); rg.addColorStop(1, '#8aa236'); g.fillStyle = rg }
  g.fill()
  // 皮の内側の淡緑の帯
  rimPath(g, cx, cy, R, ph, pickled ? 0.95 : 0.972)
  g.fillStyle = pickled ? '#6f8a2a' : '#b2c46a'
  g.fill()
  g.filter = 'none'
  // 果肉
  rimPath(g, cx, cy, R, ph, pickled ? 0.925 : 0.962)
  const fg = g.createRadialGradient(cx, cy, 0, cx, cy, R * 0.95)
  if (pickled) {
    fg.addColorStop(0, '#d6dea6'); fg.addColorStop(0.55, '#e4e9c0'); fg.addColorStop(0.85, '#c6d38a'); fg.addColorStop(1, '#8fab3e')
  } else {
    fg.addColorStop(0, '#e9ecd8'); fg.addColorStop(0.5, '#f4f4ea'); fg.addColorStop(0.82, '#eef0df'); fg.addColorStop(0.93, '#e6ebcf'); fg.addColorStop(1, '#d2dea8')
  }
  g.fillStyle = fg
  g.fill()
  g.save()
  rimPath(g, cx, cy, R, ph, pickled ? 0.948 : 0.962)
  g.clip()
  if (!pickled) g.filter = 'blur(1.2px)'

  // 葉脈の網：散らした点を近い 3 点と結ぶ
  const pts = []
  for (let i = 0; i < (pickled ? 420 : 300); i++) {
    const a = r() * Math.PI * 2, rr = Math.sqrt(r()) * R * 0.95
    pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr])
  }
  g.strokeStyle = pickled ? 'rgba(120,120,40,0.22)' : 'rgba(160,182,105,0.22)'
  g.lineWidth = S / 900
  for (const p of pts) {
    const d = pts.map((q) => [(q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2, q]).sort((a, b) => a[0] - b[0])
    for (let k = 1; k <= 3; k++) {
      const q = d[k][1]
      g.beginPath()
      g.moveTo(p[0], p[1])
      const mx = (p[0] + q[0]) / 2 + (r() - 0.5) * 8, my = (p[1] + q[1]) / 2 + (r() - 0.5) * 8
      g.quadraticCurveTo(mx, my, q[0], q[1])
      g.stroke()
    }
  }
  // 放射の筋（維管束）
  g.strokeStyle = pickled ? 'rgba(110,115,40,0.25)' : 'rgba(140,170,80,0.35)'
  g.lineWidth = S / 600
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + r() * 0.1
    g.beginPath()
    let x = cx + Math.cos(a) * R * 0.5, y = cy + Math.sin(a) * R * 0.5
    g.moveTo(x, y)
    for (let k = 1; k <= 6; k++) {
      const rr = R * (0.5 + k * 0.075), aa = a + (r() - 0.5) * 0.06
      g.lineTo(cx + Math.cos(aa) * rr, cy + Math.sin(aa) * rr)
    }
    g.stroke()
  }

  // 種の星：3 房 × 3 粒 ＝ 9 粒を 40° おきに、房の境に放射の膜の線
  const rot = r() * Math.PI * 2
  g.save()
  g.translate(cx, cy)
  g.filter = pickled ? 'blur(1px)' : 'blur(3.5px)'
  for (let l = 0; l < 3; l++) {
    const a = rot + (l / 3) * Math.PI * 2
    // 房の膜：うっすら黄緑の花びら形
    g.save(); g.rotate(a)
    const lg = g.createRadialGradient(R * 0.36, 0, 0, R * 0.36, 0, R * 0.42)
    lg.addColorStop(0, pickled ? 'rgba(200,195,120,0.45)' : 'rgba(215,224,180,0.5)')
    lg.addColorStop(1, 'rgba(222,230,192,0)')
    g.fillStyle = lg
    g.beginPath(); g.ellipse(R * 0.36, 0, R * 0.42, R * 0.32, 0, 0, Math.PI * 2); g.fill()
    g.restore()
    // 房の境：中心から外へ
    g.save(); g.rotate(a + Math.PI / 3)
    g.strokeStyle = pickled ? 'rgba(130,125,50,0.45)' : 'rgba(150,175,95,0.6)'
    g.lineWidth = S / 450
    g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(R * 0.3, R * 0.06, R * 0.6, -R * 0.02); g.stroke()
    g.restore()
  }
  for (let k = 0; k < 9; k++) {
    if (r() < 0.12) continue
    const a = rot + (k / 9) * Math.PI * 2 + (r() - 0.5) * 0.4
    const rr = R * (0.37 + (r() - 0.5) * 0.14)
    g.save()
    g.rotate(a)
    g.translate(rr, 0)
    g.rotate((r() - 0.5) * 0.4)
    const L = R * (0.13 + r() * 0.08), W = R * (0.045 + r() * 0.02)
    // 種の周りの明るい袋
    g.fillStyle = pickled ? 'rgba(236,232,186,0.6)' : 'rgba(250,251,240,0.4)'
    g.beginPath(); g.ellipse(0, 0, L * 1.25, W * 1.75, 0, 0, Math.PI * 2); g.fill()
    g.strokeStyle = pickled ? 'rgba(150,145,70,0.5)' : 'rgba(180,196,135,0.25)'
    g.lineWidth = S / 500
    g.stroke()
    const sg = g.createRadialGradient(0, 0, 0, 0, 0, L)
    sg.addColorStop(0, pickled ? '#e0e0b0' : '#d8dcb0')
    sg.addColorStop(0.75, pickled ? '#d4d6a0' : '#c8cf98')
    sg.addColorStop(1, pickled ? '#c6ca8e' : '#b8c284')
    g.fillStyle = sg
    g.beginPath(); g.ellipse(0, 0, L, W, 0, 0, Math.PI * 2); g.fill()
    g.restore()
    // 種から中心への細い筋
    g.save(); g.rotate(a)
    g.strokeStyle = pickled ? 'rgba(150,145,70,0.35)' : 'rgba(165,188,115,0.45)'
    g.lineWidth = S / 900
    g.beginPath(); g.moveTo(R * 0.03, 0); g.lineTo(rr - R * 0.2, 0); g.moveTo(rr + R * 0.21, 0); g.lineTo(R * 0.66, 0); g.stroke()
    g.restore()
  }
  g.filter = 'none'
  g.restore()
  // 中心の淡い点
  g.fillStyle = pickled ? 'rgba(220,214,150,0.6)' : 'rgba(236,240,222,0.8)'
  g.beginPath(); g.arc(cx, cy, R * 0.035, 0, Math.PI * 2); g.fill()

  g.filter = 'none'
  if (!pickled) {
    const wg = g.createLinearGradient(cx - R, cy - R, cx + R, cy + R)
    wg.addColorStop(0, 'rgba(255,255,255,0.28)'); wg.addColorStop(0.45, 'rgba(255,255,255,0)'); wg.addColorStop(1, 'rgba(120,140,60,0.08)')
    g.fillStyle = wg; g.fillRect(0, 0, S, S)
  }
  // 皮の際の陰（内側へぼかす）
  const eg = g.createRadialGradient(cx, cy, R * 0.78, cx, cy, R * 0.97)
  eg.addColorStop(0, 'rgba(160,190,90,0)')
  eg.addColorStop(1, pickled ? 'rgba(150,150,50,0.35)' : 'rgba(165,185,70,0.42)')
  g.fillStyle = eg
  g.fillRect(0, 0, S, S)
  g.restore()
  return c
}
export const sliceTexture = (seed, opts) => tex(sliceCanvas(seed, opts))

// 瓶の中身（円筒の前半分に巻く）：横 u＝左端→右端、縦 v＝上→下。
// 縦横の tex/px を揃える（前半分の弧 π·112 px ≈ 352 px → 1024、高さ 334 px → 972）
export function contentsTexture(seed) {
  const W = 1024, H = 972
  const c = document.createElement('canvas')
  c.width = W; c.height = H
  const g = c.getContext('2d')
  const r = rng(seed)
  // 漬け汁：淡い黄緑
  const lg = g.createLinearGradient(0, 0, 0, H)
  lg.addColorStop(0, '#dadc94'); lg.addColorStop(0.5, '#c6cc6c'); lg.addColorStop(1, '#a6b04c')
  g.fillStyle = lg
  g.fillRect(0, 0, W, H)

  const sl = [0, 1, 2, 3].map((k) => sliceCanvas(seed + 11 + k, { pickled: true, size: 512 }))
  const dill = (x, y, len, ang, w) => {
    g.save()
    g.translate(x, y)
    g.rotate(ang)
    g.strokeStyle = 'rgba(46,84,18,1)'
    g.lineWidth = 3.2 * w
    g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(len * 0.5, (r() - 0.5) * 30, len, (r() - 0.5) * 40); g.stroke()
    for (let t = 0.08; t < 1; t += 0.08) {
      const px = len * t
      for (const s of [-1, 1]) {
        const a = s * (0.35 + r() * 0.6), l = len * (0.2 + r() * 0.14) * (1 - t * 0.5)
        g.lineWidth = 1.8 * w
        g.beginPath(); g.moveTo(px, 0)
        const ex = px + Math.cos(a) * l, ey = Math.sin(a) * l
        g.quadraticCurveTo(px + Math.cos(a) * l * 0.5, Math.sin(a) * l * 0.4, ex, ey); g.stroke()
        g.lineWidth = 1.2 * w
        for (let q = 0.2; q < 1; q += 0.16) {
          const qx = px + Math.cos(a) * l * q, qy = Math.sin(a) * l * q
          for (const s2 of [-1, 1]) {
            const b = a + s2 * (0.5 + r() * 0.3), m = l * 0.4 * (1.15 - q)
            g.beginPath(); g.moveTo(qx, qy); g.lineTo(qx + Math.cos(b) * m, qy + Math.sin(b) * m); g.stroke()
          }
        }
      }
    }
    g.restore()
  }
  // 斜めに重なる輪切り（面がこちらを向く度合 sq）
  const drawSlices = (n, scale, y0, y1) => {
    for (let i = 0; i < n; i++) {
      const x = (i / n) * W * 1.1 - W * 0.05 + (r() - 0.5) * 160, y = y0 + r() * (y1 - y0)
      const s = scale * (0.85 + r() * 0.3)
      g.save()
      g.translate(x, y)
      g.rotate((r() - 0.5) * 1.4)
      const sq = 0.32 + r() * 0.45
      g.scale(1, sq)
      // 厚み：濃緑の皮の帯を少し下にずらして先に描く
      g.fillStyle = '#2c4a10'
      g.beginPath(); g.ellipse(0, s * 0.09 * (1 - sq) / sq, s * 0.485, s * 0.485, 0, 0, Math.PI * 2); g.fill()
      g.drawImage(sl[i % 4], -s / 2, -s / 2, s, s)
      g.restore()
    }
  }
  drawSlices(6, 380, H * 0.1, H * 0.9)
  g.fillStyle = 'rgba(205,210,130,0.4)'
  g.fillRect(0, 0, W, H)
  for (let i = 0; i < 4; i++) dill(r() * W, H * (0.15 + r() * 0.7), 200 + r() * 150, (r() - 0.5) * 3, 0.8)
  drawSlices(4, 500, H * 0.12, H * 0.38)
  drawSlices(4, 500, H * 0.4, H * 0.64)
  drawSlices(4, 500, H * 0.64, H * 0.9)
  for (let i = 0; i < 8; i++) dill(W * (0.1 + r() * 0.8), H * (0.3 + r() * 0.65), 320 + r() * 220, -Math.PI / 2 + (r() - 0.5) * 2.0, 1.5)
  // 粒マスタード：上端の列・底の列・散らし
  const seedDot = (x, y, s) => {
    const sg = g.createRadialGradient(x - s * 0.3, y - s * 0.3, 0, x, y, s)
    const tone = r()
    sg.addColorStop(0, tone < 0.4 ? '#e6cb7a' : '#d4b25a')
    sg.addColorStop(0.7, tone < 0.4 ? '#b08a36' : tone < 0.75 ? '#9a7428' : '#5a3818')
    sg.addColorStop(1, '#4a3212')
    g.fillStyle = sg
    g.beginPath(); g.arc(x, y, s, 0, Math.PI * 2); g.fill()
  }
  for (let i = 0; i < 120; i++) { const x = r() * W; seedDot(x, H * (0.03 + 0.025 * Math.cos((x / W - 0.5) * Math.PI) + r() * r() * 0.06), 6 + r() * 4) }
  g.fillStyle = 'rgba(255,255,235,0.55)'; g.fillRect(0, H * 0.012, W, 4)
  for (let i = 0; i < 150; i++) { const x = r() * W; seedDot(x, H * (0.99 - r() * r() * (0.06 + 0.03 * Math.sin(x / 90))), 6 + r() * 4) }
  for (let i = 0; i < 40; i++) seedDot(r() * W, H * (0.1 + r() * 0.8), 6 + r() * 3)
  // 小さな気泡
  for (let i = 0; i < 40; i++) {
    const x = r() * W, y = r() * H, s = 3 + r() * 4
    g.fillStyle = 'rgba(255,255,240,0.7)'
    g.beginPath(); g.arc(x, y, s, 0, Math.PI * 2); g.fill()
  }
  // 円筒の両脇ほど暗く・緑に（ガラスの厚みと屈折）
  const sg = g.createLinearGradient(0, 0, W, 0)
  sg.addColorStop(0, 'rgba(90,100,30,0.55)'); sg.addColorStop(0.1, 'rgba(110,120,40,0.12)'); sg.addColorStop(0.5, 'rgba(0,0,0,0)')
  sg.addColorStop(0.9, 'rgba(110,120,40,0.12)'); sg.addColorStop(1, 'rgba(90,100,30,0.6)')
  g.fillStyle = sg
  g.fillRect(0, 0, W, H)
  return tex(c)
}


// ガラスの光（白・アルファで重ねる）
export function glassTexture() {
  const W = 512, H = 1024
  const c = document.createElement('canvas')
  c.width = W; c.height = H
  const g = c.getContext('2d')
  const band = (u0, u1, a) => {
    const lg = g.createLinearGradient(W * u0, 0, W * u1, 0)
    lg.addColorStop(0, 'rgba(255,255,255,0)'); lg.addColorStop(0.5, `rgba(255,255,255,${a})`); lg.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = lg
    g.fillRect(W * u0, 0, W * (u1 - u0), H)
  }
  band(0.015, 0.05, 0.2)
  band(0.14, 0.18, 0.55)
  band(0.23, 0.27, 0.15)
  band(0.75, 0.79, 0.25)
  band(0.93, 0.975, 0.18)
  g.fillStyle = 'rgba(70,78,50,0.55)'; g.fillRect(0, 0, W * 0.012, H); g.fillRect(W * 0.988, 0, W * 0.012, H)
  // 肩と底の明るい縁
  const vg = g.createLinearGradient(0, 0, 0, H)
  vg.addColorStop(0, 'rgba(255,255,255,0.12)'); vg.addColorStop(0.03, 'rgba(255,255,255,0)'); vg.addColorStop(0.96, 'rgba(255,255,255,0)'); vg.addColorStop(1, 'rgba(255,255,255,0.45)')
  g.fillStyle = vg
  g.fillRect(0, 0, W, H)
  return tex(c)
}

// 蓋の側面：細い縦の筋、上が明るく下に暗い帯
export function lidTexture() {
  const W = 2048, H = 256
  const c = document.createElement('canvas')
  c.width = W; c.height = H
  const g = c.getContext('2d')
  const r = rng(7)
  const lg = g.createLinearGradient(0, 0, 0, H)
  lg.addColorStop(0, '#8c8c8c'); lg.addColorStop(0.07, '#d8d8d8'); lg.addColorStop(0.5, '#c8c8c8'); lg.addColorStop(0.78, '#a6a6a6'); lg.addColorStop(0.85, '#6e6e6e'); lg.addColorStop(0.93, '#5a5a5a'); lg.addColorStop(1, '#8a8a8a')
  g.fillStyle = lg
  g.fillRect(0, 0, W, H)
  for (let x = 0; x < W; x += 4) {
    g.fillStyle = `rgba(${r() < 0.5 ? '0,0,0' : '255,255,255'},${0.03 + r() * 0.06})`
    g.fillRect(x, 0, 2, H * 0.82)
  }
  // 横方向の光の当たり（中央左が明るく、両端が暗い）
  const hg = g.createLinearGradient(0, 0, W, 0)
  hg.addColorStop(0, 'rgba(0,0,0,0.45)'); hg.addColorStop(0.12, 'rgba(0,0,0,0.1)'); hg.addColorStop(0.3, 'rgba(255,255,255,0.35)'); hg.addColorStop(0.5, 'rgba(0,0,0,0.12)'); hg.addColorStop(0.7, 'rgba(255,255,255,0.2)'); hg.addColorStop(0.9, 'rgba(0,0,0,0.2)'); hg.addColorStop(1, 'rgba(0,0,0,0.5)')
  g.fillStyle = hg
  g.fillRect(0, 0, W, H)
  return tex(c)
}

// 水玉：細い輪
export function bubbleTexture() {
  const S = 256
  const c = document.createElement('canvas')
  c.width = c.height = S
  const g = c.getContext('2d')
  const cx = S / 2
  const rg = g.createRadialGradient(cx, cx, S * 0.3, cx, cx, S * 0.49)
  rg.addColorStop(0, 'rgba(225,238,248,0)')
  rg.addColorStop(0.75, 'rgba(215,232,246,0.25)')
  rg.addColorStop(0.93, 'rgba(160,195,225,0.85)')
  rg.addColorStop(1, 'rgba(200,220,240,0)')
  g.fillStyle = rg
  g.fillRect(0, 0, S, S)
  const ir = g.createLinearGradient(0, 0, S, S)
  ir.addColorStop(0, 'rgba(255,180,200,0.5)'); ir.addColorStop(0.35, 'rgba(170,220,255,0.5)'); ir.addColorStop(0.7, 'rgba(200,255,200,0.45)'); ir.addColorStop(1, 'rgba(255,220,160,0.5)')
  g.strokeStyle = ir; g.lineWidth = S * 0.025
  g.beginPath(); g.arc(cx, cx, S * 0.455, 0, Math.PI * 2); g.stroke()
  g.strokeStyle = 'rgba(255,255,255,0.9)'
  g.lineWidth = S * 0.03
  g.beginPath(); g.arc(cx, cx, S * 0.36, Math.PI * 1.1, Math.PI * 1.45); g.stroke()
  return tex(c)
}

// 首のねじ山：淡い灰緑に横の明暗の筋
export function neckTexture() {
  const W = 512, H = 64
  const c = document.createElement('canvas')
  c.width = W; c.height = H
  const g = c.getContext('2d')
  g.fillStyle = '#bfc3a6'
  g.fillRect(0, 0, W, H)
  for (let y = 3; y < H; y += 12) {
    g.fillStyle = 'rgba(245,247,236,0.75)'; g.fillRect(0, y, W, 3)
    g.fillStyle = 'rgba(95,102,70,0.6)'; g.fillRect(0, y + 4, W, 3)
  }
  const sg = g.createLinearGradient(0, 0, W, 0)
  sg.addColorStop(0, 'rgba(100,110,80,0.5)'); sg.addColorStop(0.15, 'rgba(0,0,0,0)'); sg.addColorStop(0.85, 'rgba(0,0,0,0)'); sg.addColorStop(1, 'rgba(100,110,80,0.5)')
  g.fillStyle = sg; g.fillRect(0, 0, W, H)
  return tex(c)
}

// 外側のガラス：淡い灰緑、両脇に明るい反射と暗い縁
export function rimTexture() {
  const W = 512, H = 16
  const c = document.createElement('canvas')
  c.width = W; c.height = H
  const g = c.getContext('2d')
  const lg = g.createLinearGradient(0, 0, W, 0)
  lg.addColorStop(0, '#6f7748'); lg.addColorStop(0.03, '#b7bc8a'); lg.addColorStop(0.07, '#9fa66a'); lg.addColorStop(0.5, '#c2c690')
  lg.addColorStop(0.93, '#9fa66a'); lg.addColorStop(0.97, '#b3b886'); lg.addColorStop(1, '#6a7244')
  g.fillStyle = lg
  g.fillRect(0, 0, W, H)
  return tex(c)
}

// 蓋の上の丸い縁：上が白く光り、下に細い影
export function lidTopTexture() {
  const W = 1024, H = 32
  const c = document.createElement('canvas')
  c.width = W; c.height = H
  const g = c.getContext('2d')
  const lg = g.createLinearGradient(0, 0, 0, H)
  lg.addColorStop(0, '#bdbdbd'); lg.addColorStop(0.35, '#f6f6f6'); lg.addColorStop(0.7, '#d0d0d0'); lg.addColorStop(1, '#7a7a7a')
  g.fillStyle = lg; g.fillRect(0, 0, W, H)
  const hg = g.createLinearGradient(0, 0, W, 0)
  hg.addColorStop(0, 'rgba(0,0,0,0.45)'); hg.addColorStop(0.15, 'rgba(0,0,0,0)'); hg.addColorStop(0.85, 'rgba(0,0,0,0)'); hg.addColorStop(1, 'rgba(0,0,0,0.5)')
  g.fillStyle = hg; g.fillRect(0, 0, W, H)
  return tex(c)
}

// 接地の影：横長のぼけた楕円
export function shadowTexture() {
  const W = 512, H = 64
  const c = document.createElement('canvas')
  c.width = W; c.height = H
  const g = c.getContext('2d')
  g.filter = 'blur(10px)'
  g.fillStyle = 'rgba(70,75,55,0.6)'
  g.beginPath(); g.ellipse(W / 2, H / 2, W * 0.36, H * 0.16, 0, 0, Math.PI * 2); g.fill()
  return tex(c)
}
