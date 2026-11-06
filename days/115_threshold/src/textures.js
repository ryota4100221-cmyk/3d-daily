// canvas で描く素材（漆喰・スレート・切石・空・柳）。毎回白紙から。
import * as THREE from 'three'

function rng(seed) {
  let s = seed >>> 0
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
}

function tex(canvas, { repeat = [1, 1], srgb = true } = {}) {
  const t = new THREE.CanvasTexture(canvas)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(...repeat)
  t.anisotropy = 8
  if (srgb) t.colorSpace = THREE.SRGBColorSpace
  return t
}

function mk(w, h) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return [c, c.getContext('2d', { willReadFrequently: true })]
}

// 漆喰：明るい生成りの上に細かい粒と大きな斑
export function plaster() {
  const [c, g] = mk(1024, 1024)
  g.fillStyle = '#a99f88'
  g.fillRect(0, 0, 1024, 1024)
  const r = rng(7)
  for (let i = 0; i < 260; i++) {
    const x = r() * 1024, y = r() * 1024, rad = 30 + r() * 140
    const gr = g.createRadialGradient(x, y, 0, x, y, rad)
    const d = r() < 0.5 ? '120,105,80' : '210,198,170'
    gr.addColorStop(0, `rgba(${d},0.06)`)
    gr.addColorStop(1, `rgba(${d},0)`)
    g.fillStyle = gr
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2)
  }
  const id = g.getImageData(0, 0, 1024, 1024)
  for (let i = 0; i < id.data.length; i += 4) {
    const n = (r() - 0.5) * 34
    id.data[i] += n; id.data[i + 1] += n; id.data[i + 2] += n * 0.9
  }
  g.putImageData(id, 0, 0)
  return tex(c)
}

// スレート：千鳥に並ぶ長方形の板。行ごとに少し色が違う
export function slate() {
  const [c, g] = mk(1024, 512)
  g.fillStyle = '#1b1a16'
  g.fillRect(0, 0, 1024, 512)
  const r = rng(11)
  const rows = 18, rh = 512 / rows, cw = 1024 / 40
  for (let j = 0; j < rows; j++) {
    const off = (j % 2) * cw * 0.5
    for (let i = -1; i < 41; i++) {
      const x = i * cw + off + (r() - 0.5) * 3
      const v = 58 + r() * 26
      g.fillStyle = `rgb(${v},${v + 1},${v - 2})`
      g.fillRect(x + 1.2, j * rh + 1.4, cw - 2.4, rh - 1.6)
      g.fillStyle = 'rgba(200,195,180,0.12)'
      g.fillRect(x + 1.2, j * rh + 1.4, cw - 2.4, 2)
      // 下端の影
      g.fillStyle = 'rgba(0,0,0,0.35)'
      g.fillRect(x + 1.2, j * rh + rh - 3, cw - 2.4, 2)
    }
  }
  const lg = g.createLinearGradient(0, 0, 0, 512)
  lg.addColorStop(0, 'rgba(0,0,0,0.35)')
  lg.addColorStop(0.55, 'rgba(0,0,0,0)')
  lg.addColorStop(1, 'rgba(255,245,220,0.10)')
  g.fillStyle = lg
  g.fillRect(0, 0, 1024, 512)
  const id = g.getImageData(0, 0, 1024, 512)
  for (let i = 0; i < id.data.length; i += 4) {
    const n = (r() - 0.5) * 16
    id.data[i] += n; id.data[i + 1] += n; id.data[i + 2] += n
  }
  g.putImageData(id, 0, 0)
  return tex(c)
}

// 切石：明るい石灰岩の粒
export function stone(seed = 3, base = '#c3b79a') {
  const [c, g] = mk(512, 512)
  g.fillStyle = base
  g.fillRect(0, 0, 512, 512)
  const r = rng(seed)
  for (let i = 0; i < 90; i++) {
    const x = r() * 512, y = r() * 512, rad = 10 + r() * 70
    const gr = g.createRadialGradient(x, y, 0, x, y, rad)
    const d = r() < 0.55 ? '110,98,75' : '235,225,200'
    gr.addColorStop(0, `rgba(${d},0.13)`)
    gr.addColorStop(1, `rgba(${d},0)`)
    g.fillStyle = gr
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2)
  }
  const id = g.getImageData(0, 0, 512, 512)
  for (let i = 0; i < id.data.length; i += 4) {
    const n = (r() - 0.5) * 30
    id.data[i] += n; id.data[i + 1] += n; id.data[i + 2] += n * 0.9
  }
  g.putImageData(id, 0, 0)
  return tex(c)
}

// 塗装の木（扉・鎧戸）：縦の淡い木目
export function paintedWood(base, seed = 5) {
  const [c, g] = mk(256, 512)
  g.fillStyle = base
  g.fillRect(0, 0, 256, 512)
  const r = rng(seed)
  for (let i = 0; i < 60; i++) {
    const x = r() * 256
    g.strokeStyle = `rgba(${r() < 0.5 ? '0,0,0' : '255,255,240'},${0.01 + r() * 0.015})`
    g.lineWidth = 1 + r() * 3
    g.beginPath()
    g.moveTo(x, 0)
    g.bezierCurveTo(x + (r() - 0.5) * 10, 170, x + (r() - 0.5) * 10, 340, x + (r() - 0.5) * 8, 512)
    g.stroke()
  }
  return tex(c)
}

// 空：暗いオリーブのまだら（夜の雲と木々の向こう）
export function sky() {
  const [c, g] = mk(1024, 512)
  const lg = g.createLinearGradient(0, 0, 0, 512)
  lg.addColorStop(0, '#0d0c06')
  lg.addColorStop(0.45, '#38331f')
  lg.addColorStop(1, '#464030')
  g.fillStyle = lg
  g.fillRect(0, 0, 1024, 512)
  const r = rng(21)
  for (let i = 0; i < 500; i++) {
    const x = r() * 1024, y = 120 + r() * 400, rad = 8 + r() * 50
    const gr = g.createRadialGradient(x, y, 0, x, y, rad)
    const d = r() < 0.5 ? '10,10,4' : '70,64,46'
    gr.addColorStop(0, `rgba(${d},0.24)`)
    gr.addColorStop(1, `rgba(${d},0)`)
    g.fillStyle = gr
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2)
  }
  return tex(c, { repeat: [1, 1] })
}

// 柳の垂れ枝：透過の板1枚。side = -1（左上）/ 1（右上）。ピントの外なので blur をかける
export function willow(side, seed) {
  // 柳の垂れ枝：房（3〜6本の枝の束）ごとに垂らす。葉は枝に沿って下向きの細い葉。
  // 少しだけ小さく描いて引き伸ばす（手前のぼけ）。中央へ行くほど房が短く疎になる
  const W = 1024, H = 1024, k = 1 / 3
  const [c, g] = mk(W * k, H * k)
  const r = rng(seed)
  g.scale(k, k)
  const clusters = 44
  for (let q = 0; q < clusters; q++) {
    const t = r()
    const edge = side < 0 ? Math.pow(t, 1.9) : 1 - Math.pow(t, 1.9)
    const near = 1 - Math.abs(edge - (side < 0 ? 0 : 1)) // 縁=1・中央=0
    const cx = edge * W * 0.95 + 20
    const nb = 2 + Math.floor(r() * 4)
    const clen = (0.2 + r() * 0.45 + near * 0.45) * H
    const tone = r()
    for (let bI = 0; bI < nb; bI++) {
      let x = cx + (r() - 0.5) * (30 + r() * 70)
      let y = -10 + r() * 60
      const len = clen * (0.7 + r() * 0.4)
      const sway = (r() - 0.5) * 0.14 + side * -0.05
      const shade = 34 + tone * 40 + r() * 10
      g.strokeStyle = `rgba(${shade - 4},${shade - 2},${shade - 20},0.55)`
      g.lineWidth = 1.4
      g.beginPath()
      g.moveTo(x, y)
      const pts = []
      for (let s2 = 0; s2 < len; s2 += 6) {
        x += sway * 6 + Math.sin(s2 * 0.012 + bI + q) * 0.5
        y += 6
        pts.push([x, y])
        g.lineTo(x, y)
      }
      g.stroke()
      for (let i = 0; i < pts.length; i++) {
        const [px, py] = pts[i]
        if (r() < 0.3) continue
        const sd = r() < 0.5 ? -1 : 1
        const l = 9 + r() * 11
        const ang = Math.PI / 2 + sd * (0.25 + r() * 0.35)
        const v = shade + r() * 34
        g.fillStyle = `rgba(${v + 32},${v + 26},${v - 18},${0.55 + r() * 0.35})`
        g.beginPath()
        g.ellipse(px + Math.cos(ang) * l * 0.55, py + Math.sin(ang) * l * 0.55, l * 0.5, 1.6, ang, 0, Math.PI * 2)
        g.fill()
      }
    }
  }
  // 根元の塊（画面の角の暗い葉群）
  for (let i = 0; i < 700; i++) {
    const x = side < 0 ? r() * W * 0.45 : W - r() * W * 0.45
    const y = Math.pow(r(), 1.6) * H * 0.35 * (1 - Math.abs(x / W - (side < 0 ? 0 : 1)))
    const v = 26 + r() * 34
    g.fillStyle = `rgba(${v + 16},${v + 14},${v - 10},0.5)`
    g.beginPath()
    g.ellipse(x, y, 10 + r() * 22, 3 + r() * 5, r() * 3.14, 0, Math.PI * 2)
    g.fill()
  }
  const t = tex(c)
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping
  return t
}

// 縁の葉群：画面の左右の縁を全高で覆う、ピントの外の大きな葉と花。小さく描いて引き伸ばす＝ぼけ
export function bush(side, seed) {
  const W = 600, H = 1000, k = 1 / 4
  const [c, g] = mk(W * k, H * k)
  const r = rng(seed)
  g.scale(k, k)
  const edgeX = side < 0 ? 0 : W
  for (let i = 0; i < 2400; i++) {
    // 縁ほど密：縁からの距離は指数分布
    const d = -Math.log(1 - r() * 0.985) * 230
    const x = side < 0 ? d : W - d
    const y = r() * H
    const fade = Math.max(0, 1 - d / 600)
    const l = 30 + r() * 80
    const a = (r() - 0.5) * 1.2 + Math.PI / 2 + side * 0.3
    const v = 22 + r() * 46
    const yellow = r() < 0.4 ? 14 : 0
    g.fillStyle = `rgba(${v + 22 + yellow},${v + 16 + yellow},${v - 18},${(0.24 + r() * 0.32) * fade})`
    g.beginPath()
    g.ellipse(x, y, l * 0.5, l * 0.11 + 3, a, 0, Math.PI * 2)
    g.fill()
  }
  // 白い花（左下だけ）
  if (false) {
    for (let i = 0; i < 6; i++) {
      const cx = 40 + r() * 150, cy = 480 + r() * 320, R = 26 + r() * 22
      for (let p = 0; p < 14; p++) {
        const a = (p / 14) * Math.PI * 2 + r() * 0.2
        g.fillStyle = `rgba(${110 + r() * 30},${100 + r() * 30},${95 + r() * 30},0.3)`
        g.beginPath()
        g.ellipse(cx + Math.cos(a) * R * 0.5, cy + Math.sin(a) * R * 0.5, R * 0.5, R * 0.12, a, 0, Math.PI * 2)
        g.fill()
      }
      g.fillStyle = 'rgba(150,120,50,0.6)'
      g.beginPath(); g.arc(cx, cy, R * 0.15, 0, Math.PI * 2); g.fill()
    }
  }
  const t = tex(c)
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping
  return t
}
