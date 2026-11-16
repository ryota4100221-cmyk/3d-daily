// 手で描く素材（canvas）。外部画像は使わない。
import * as THREE from 'three'

// --- 値ノイズ（決定的）
function hash(x, y, s) {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295
}
function vnoise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y)
  const xf = x - xi, yf = y - yi
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf)
  const a = hash(xi, yi, s), b = hash(xi + 1, yi, s), c = hash(xi, yi + 1, s), d = hash(xi + 1, yi + 1, s)
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}
export function fbm(x, y, s = 1, oct = 5) {
  let f = 0, amp = 0.5, fr = 1
  for (let i = 0; i < oct; i++) { f += amp * vnoise(x * fr, y * fr, s + i * 17); amp *= 0.5; fr *= 2.03 }
  return f
}

function tex(canvas, srgb = true, repeat = false) {
  const t = new THREE.CanvasTexture(canvas)
  if (srgb) t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping }
  return t
}

// 岩の壁：ずらした格子の塊（縦長）＋塊ごとの面の傾き＋境の割れ目
export function makeRock(W = 2048, H = 1152) {
  const col = document.createElement('canvas'); col.width = W; col.height = H
  const bmp = document.createElement('canvas'); bmp.width = W; bmp.height = H
  const c = col.getContext('2d'), b = bmp.getContext('2d')
  const ci = c.createImageData(W, H), bi = b.createImageData(W, H)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u0 = x / W * 16, v0 = y / H * 9
      // 境をゆがめる
      const u = u0 + (fbm(u0 * 0.5, v0 * 0.5, 71, 5) - 0.5) * 1.8
      const v = v0 + (fbm(u0 * 0.45 + 4, v0 * 0.45, 73, 5) - 0.5) * 1.5
      const cxi = Math.floor(u / 0.9)
      const rowOff = hash(cxi, 1, 77) * 1.3
      const bh = 0.7 + hash(cxi, 2, 79) * 1.6
      const cyi = Math.floor((v + rowOff) / bh)
      const fx = u / 0.9 - cxi, fy = (v + rowOff) / bh - cyi
      const r1 = hash(cxi, cyi, 81), r2 = hash(cxi, cyi, 83), r3 = hash(cxi, cyi, 85)
      // 塊の中の面：傾き＋ふくらみ
      let h = 0.4 + r1 * 0.15 + (fx - 0.5) * (r2 - 0.5) * 0.45 + (fy - 0.5) * (r3 - 0.5) * 0.3
      h += (1 - Math.pow(Math.abs(fx - 0.5) * 2, 3)) * 0.08 + (1 - Math.pow(Math.abs(fy - 0.5) * 2, 3)) * 0.06
      // 割れ目：塊の境
      const ex = Math.min(fx, 1 - fx) * 0.9, ey = Math.min(fy, 1 - fy) * bh
      const e = Math.min(ex, ey * (hash(cxi, cyi, 87) < 0.4 ? 9 : 1))
      const crack = (1 - Math.min(1, e / 0.025)) * (0.5 + 0.5 * fbm(u0 * 3, v0 * 3, 89, 3))
      const fine = fbm(u0 * 10, v0 * 6, 11, 4)
      const mid = fbm(u0 * 2.5, v0 * 1.2, 13, 4)
      h += fine * 0.3 + mid * 0.25 + fbm(u0 * 22, v0 * 14, 91, 3) * 0.12 + fbm(u0 * 7, v0 * 0.35, 93, 4) * 0.3 - crack * 0.03
      const hv = Math.max(0, Math.min(1, h))
      const i = (y * W + x) * 4
      bi.data[i] = bi.data[i + 1] = bi.data[i + 2] = hv * 255; bi.data[i + 3] = 255
      const tone = (0.6 + 0.4 * hv) * (1 - crack * 0.05) * (0.88 + 0.2 * r1) * (1 - 0.6 * Math.pow(Math.max(0, (y / H - 0.8) / 0.2), 1.3))
      const warm = fbm(u0 * 0.8, v0 * 0.8, 31, 3)
      ci.data[i] = Math.min(255, (104 + 26 * warm) * tone)
      ci.data[i + 1] = Math.min(255, (84 + 18 * warm) * tone)
      ci.data[i + 2] = Math.min(255, (68 + 10 * warm) * tone)
      ci.data[i + 3] = 255
    }
  }
  c.putImageData(ci, 0, 0); b.putImageData(bi, 0, 0)
  return { map: tex(col), bump: tex(bmp, false) }
}

// 木目：縦に流れる年輪の筋（v が高さ方向）
export function makeWood(W = 512, H = 1024) {
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H
  const c = cv.getContext('2d'); const im = c.createImageData(W, H)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / W, v = y / H
      const warp = fbm(u * 2, v * 1.5, 5, 5) * 0.9 + fbm(u * 8, v * 5, 6, 3) * 0.25
      const ring = u * 70 + warp * 4.0
      const r = 0.5 + 0.5 * Math.sin(ring * Math.PI * 2)
      const line = Math.pow(r, 6)
      const fleck = hash(Math.floor(u * 300), Math.floor(v * 90), 9) > 0.93 ? 0.4 : fbm(u * 60, v * 8, 9, 2)
      const fiber = fbm(u * 180, v * 6, 15, 3)
      const base = (0.78 + 0.22 * fbm(u * 4, v * 3, 13, 3)) * (0.82 + 0.3 * fiber)
      let k = base * (1 - 0.16 * line) * (0.92 + 0.12 * fleck)
      const i = (y * W + x) * 4
      im.data[i] = Math.min(255, 150 * k)
      im.data[i + 1] = Math.min(255, 108 * k)
      im.data[i + 2] = Math.min(255, 72 * k)
      im.data[i + 3] = 255
    }
  }
  c.putImageData(im, 0, 0)
  return tex(cv, true, true)
}

// 透ける石（オニキス／アラバスター）：生成りの雲＋細い網の筋
export function makeOnyx(W = 512, H = 1024) {
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H
  const c = cv.getContext('2d'); const im = c.createImageData(W, H)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / W * 6, v = y / H * 12
      const cloud = fbm(u * 0.8, v * 0.8, 41, 5)
      const vein1 = 1 - Math.abs(fbm(u * 0.9, v * 0.9, 43, 3) * 2 - 1)
      const vein2 = 1 - Math.abs(fbm(u * 1.8 + 5, v * 1.8, 47, 3) * 2 - 1)
      const veins = Math.pow(vein1, 9) * 0.55 + Math.pow(vein2, 10) * 0.4
      let k = 0.8 + 0.3 * cloud - veins * 0.55
      const i = (y * W + x) * 4
      im.data[i] = Math.min(255, 255 * k)
      im.data[i + 1] = Math.min(255, 200 * k - veins * 30)
      im.data[i + 2] = Math.min(255, 120 * k - veins * 40)
      im.data[i + 3] = 255
    }
  }
  c.putImageData(im, 0, 0)
  return tex(cv, true, true)
}

// 床：暗い板張り（横長の板・わずかな艶むら）
export function makeFloor(W = 1024, H = 1024) {
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H
  const c = cv.getContext('2d'); const im = c.createImageData(W, H)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / W, v = y / H
      const plank = Math.floor(v * 10)
      const off = hash(plank, 3, 5)
      const grain = fbm(u * 3 + off * 9, v * 40, 51 + plank, 4)
      const seam = (v * 10 - plank) < 0.008 ? 0.8 : 1
      const tone = (0.85 + off * 0.12) * (0.9 + 0.16 * grain) * seam
      const i = (y * W + x) * 4
      im.data[i] = Math.min(255, 150 * tone)
      im.data[i + 1] = Math.min(255, 112 * tone)
      im.data[i + 2] = Math.min(255, 78 * tone)
      im.data[i + 3] = 255
    }
  }
  c.putImageData(im, 0, 0)
  return tex(cv, true, true)
}

// 窓の光の型（gobo）：斜めの桟の影と、外の枝の影
export function makeGobo(W = 512, H = 512) {
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H
  const c = cv.getContext('2d')
  const g = c.createRadialGradient(W * 0.5, H * 0.5, 0, W * 0.5, H * 0.5, W * 0.5)
  g.addColorStop(0, '#fff'); g.addColorStop(0.6, '#ddd'); g.addColorStop(1, '#000')
  c.fillStyle = g; c.fillRect(0, 0, W, H)
  // 桟の影（太い斜めの帯）
  c.fillStyle = 'rgba(0,0,0,0.6)'
  c.save(); c.translate(W * 0.5, H * 0.5); c.rotate(-0.5)
  c.filter = 'blur(10px)'
  c.rotate(0.15); c.fillRect(-W * 0.2, -H, W * 0.09, H * 2)
  c.filter = 'none'
  c.restore()
  // 外の枝
  c.strokeStyle = 'rgba(0,0,0,0.8)'; c.lineCap = 'round'
  let s = 7
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647
  function branch(x, y, a, len, w, d) {
    if (d > 6 || len < 4) return
    const x2 = x + Math.cos(a) * len, y2 = y + Math.sin(a) * len
    c.lineWidth = w; c.beginPath(); c.moveTo(x, y); c.lineTo(x2, y2); c.stroke()
    branch(x2, y2, a + (rnd() - 0.5) * 0.9 - 0.25, len * 0.72, w * 0.7, d + 1)
    if (rnd() < 0.7) branch(x2, y2, a + (rnd() - 0.2) * 1.0 + 0.3, len * 0.6, w * 0.6, d + 1)
  }
  branch(W * 0.62, H * 0.95, -1.9, 70, 5, 0)
  branch(W * 0.75, H * 0.9, -1.4, 60, 4, 0)
  branch(W * 0.5, H * 0.92, -2.3, 55, 4, 0)
  return tex(cv, true)
}
