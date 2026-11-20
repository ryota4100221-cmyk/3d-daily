import * as THREE from 'three'

// 主役の座標：ref の画面 px を z=0 の面へ。原点は主役の軸 x=742px・y=450px
const CAMZ = 10
const S = (2 * CAMZ * Math.tan(15 * Math.PI / 180)) / 900
const AX = 748
const DEPTH = 0.86 // 体の奥行きの潰れ

// 涙形の輪郭（画面 y px, 半径 px）
const PROFILE = [
  [437, 0], [437.6, 6], [439, 12], [442, 18], [447, 25], [457, 35], [470, 46], [486, 58], [508, 78], [536, 104], [570, 133], [610, 158], [650, 176],
  [700, 189], [760, 196], [840, 199], [920, 197], [1040, 192],
]
export function rBody(py) {
  if (py <= PROFILE[0][0]) return 0
  for (let i = 1; i < PROFILE.length; i++) {
    const [y1, r1] = PROFILE[i], [y0, r0] = PROFILE[i - 1]
    if (py <= y1) return r0 + (r1 - r0) * (py - y0) / (y1 - y0)
  }
  return PROFILE[PROFILE.length - 1][1]
}

// --- 小さなノイズ ---
function hash3(x, y, z) { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return s - Math.floor(s) }
function vnoise(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z)
  const xf = x - xi, yf = y - yi, zf = z - zi
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf)
  let r = 0
  for (let dz = 0; dz < 2; dz++) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
    const h = hash3(xi + dx, yi + dy, zi + dz)
    r += h * (dx ? u : 1 - u) * (dy ? v : 1 - v) * (dz ? w : 1 - w)
  }
  return r
}
function rng(seed) { let s = seed * 9301 + 49297; return () => { s = (s * 9301 + 49297) % 233280; return s / 233280 } }

const hex = (h) => new THREE.Color(h)
const mixc = (a, b, t) => a.clone().lerp(b, Math.max(0, Math.min(1, t)))
const css = (c) => `rgb(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)})`
const sm = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t) }

// ---------- 体 ----------
function bodyTexture() {
  const W = 2048, H = 1024
  const c = document.createElement('canvas'); c.width = W; c.height = H
  const g = c.getContext('2d')
  const img = g.createImageData(W, H)
  const yel = hex('#f7cf5a'), org = hex('#f27412'), deep = hex('#cf4a14'), pale = hex('#fbe08a')
  // 色は sRGB の値のまま混ぜる（Color は既定で線形に直すので getHex で戻す）
  const Y = [0xf7, 0xcf, 0x5a], O = [0xf2, 0x74, 0x12], D = [0xcc, 0x44, 0x12], P = [0xfb, 0xe2, 0x92]
  const lerp3 = (a, b, t) => { t = Math.max(0, Math.min(1, t)); return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t] }
  for (let y = 0; y < H; y++) {
    const v = y / H
    for (let x = 0; x < W; x++) {
      const u = x / W
      const f = -Math.sin(u * Math.PI * 2) // 継ぎ目を背中へ（phiStart=π）：+1 右, -1 左
      const n = vnoise(u * 9, v * 6, 1.3) * 0.5 + vnoise(u * 22, v * 14, 4.1) * 0.3 + vnoise(u * 60, v * 36, 7.7) * 0.2
      let col = lerp3(Y, O, sm(-0.75, 0.25, f + (n - 0.5) * 1.3))
      col = lerp3(col, D, sm(0.45, 1.0, f + (n - 0.5) * 0.4) * 0.85)
      // 正面の左寄りに明るい筋、上は少し明るく
      col = lerp3(col, P, sm(0.25, 0, Math.abs(f + 0.45)) * 0.35 * (1 - v))
      col = lerp3(col, D, sm(0.55, 1.0, v) * 0.35)
      const i = (y * W + x) * 4
      img.data[i] = col[0]; img.data[i + 1] = col[1]; img.data[i + 2] = col[2]; img.data[i + 3] = 255
    }
  }
  g.putImageData(img, 0, 0)
  // 唐辛子の欠片・白い粒
  const r = rng(7)
  for (let k = 0; k < 5200; k++) {
    const x = r() * W, y = Math.pow(r(), 1.9) * H
    const big = r() < 0.18
    const sz = big ? 3 + r() * 3.5 : 1.2 + r() * 1.8
    const t = r()
    g.fillStyle = t < 0.7 ? (r() < 0.5 ? '#d8340e' : '#e5501a') : t < 0.8 ? '#ffe2a0' : '#b0280c'
    g.globalAlpha = 0.75 + r() * 0.25
    g.beginPath()
    const m = 3 + Math.floor(r() * 3)
    for (let q = 0; q < m; q++) { const a = q / m * Math.PI * 2 + r(); const rr = sz * (0.5 + r() * 0.7); g.lineTo(x + Math.cos(a) * rr * 1.6, y + Math.sin(a) * rr) }
    g.closePath(); g.fill()
  }
  g.globalAlpha = 1
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace; t.flipY = true; t.anisotropy = 8; t.wrapS = THREE.RepeatWrapping
  return t
}

export function makeBody() {
  const pts = []
  for (let py = 437; py <= 1040; py += 4) pts.push(new THREE.Vector2(rBody(py) * S, (450 - py) * S))
  pts.reverse()
  const geo = new THREE.LatheGeometry(pts, 160, Math.PI)
  geo.scale(1, 1, DEPTH)
  // 少しだけ凸凹
  const p = geo.attributes.position
  const v = new THREE.Vector3()
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i)
    const rr = Math.hypot(v.x, v.z / DEPTH)
    if (rr < 1e-4) continue
    const d = (vnoise(v.x * 2.2, v.y * 2.2, v.z * 2.2) - 0.5) * 0.08 + (vnoise(v.x * 6, v.y * 6, v.z * 6) - 0.5) * 0.03 + (vnoise(v.x * 18, v.y * 18, v.z * 18) - 0.5) * 0.008
    const k = (rr + d) / rr
    p.setXYZ(i, v.x * k, v.y, v.z * k)
  }
  geo.computeVertexNormals()
  const bt = bodyTexture()
  const mat = new THREE.MeshPhysicalMaterial({ map: bt, emissiveMap: bt, emissive: new THREE.Color('#ff7a1a'), emissiveIntensity: 0.22, sheen: 0.5, sheenRoughness: 0.6, sheenColor: new THREE.Color('#ff9a3a'), bumpMap: bt, bumpScale: 2.0, roughness: 0.58, clearcoat: 0.15, clearcoatRoughness: 0.4, envMapIntensity: 0.6, })
  const m = new THREE.Mesh(geo, mat)
  m.receiveShadow = true
  // 浮き出た唐辛子の欠片：表面の点に小さな多角形の板を法線向きに貼る
  const r = rng(29)
  const fg = new THREE.CircleGeometry(1, 5)
  const fm = new THREE.MeshStandardMaterial({ color: '#d0300c', roughness: 0.55 })
  const N = 900
  const inst = new THREE.InstancedMesh(fg, fm, N)
  const P = geo.attributes.position, NN = geo.attributes.normal
  const o = new THREE.Object3D(), n = new THREE.Vector3(), q = new THREE.Vector3(), col = new THREE.Color()
  let k = 0, guard = 0
  while (k < N && guard++ < 20000) {
    const i = Math.floor(r() * P.count)
    q.fromBufferAttribute(P, i); n.fromBufferAttribute(NN, i)
    if (n.z < -0.2) continue
    const py = 450 - q.y / S
    if (py > 760 && r() < 0.6) continue
    o.position.copy(q).addScaledVector(n, 0.004)
    o.lookAt(q.clone().add(n))
    o.rotateZ(r() * 6.28)
    const sz = (r() < 0.15 ? 2.2 + r() * 1.8 : 0.9 + r() * 1.1) * S
    o.scale.set(sz * (1 + r()), sz, 1)
    o.updateMatrix(); inst.setMatrixAt(k, o.matrix)
    col.set(r() < 0.75 ? (r() < 0.5 ? '#d22e0a' : '#e8461a') : '#fff0c8'); inst.setColorAt(k, col)
    k++
  }
  inst.count = k
  m.add(inst)
  return m
}

// ---------- 眼鏡 ----------
function lensPts(cx, a, b, inflate = 0, n = 120, top = null) {
  const out = []
  for (let i = 0; i < n; i++) {
    const th = (i / n) * Math.PI * 2
    const c = Math.cos(th), s = Math.sin(th)
    const inf = top == null ? inflate : inflate + (top - inflate) * Math.max(0, s) ** 2 + 30 * S * Math.max(0, Math.sign(cx) * c) ** 3 * Math.max(0, s) ** 0.6
    let x = (a + inf) * Math.sign(c) * Math.pow(Math.abs(c), s > 0 ? 0.42 : 0.62)
    let y = (b + inf) * Math.sign(s) * Math.pow(Math.abs(s), s > 0 ? 0.25 : 0.8)
    if (y < 0) x *= 1 - 0.2 * (-y / b)
    y += Math.sign(cx) * x * 0.015
    out.push(new THREE.Vector2(cx + x, y))
  }
  return out
}
// 外周と内周（同じ角度で並ぶ）から縁の立体を張る
function rimGeo(outer, inner, depth) {
  const n = outer.length, pos = [], idx = []
  const rings = [[outer, 0], [inner, 0], [inner, -depth], [outer, -depth]]
  for (const [pts, z] of rings) for (const p of pts) pos.push(p.x, p.y, z)
  for (let r = 0; r < 4; r++) {
    const A = r * n, B = ((r + 1) % 4) * n
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n
      idx.push(A + i, A + j, B + i, A + j, B + j, B + i)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx)
  return g
}
function fanGeo(pts, cx, cy) {
  const pos = [cx, cy, 0], idx = []
  for (const p of pts) pos.push(p.x, p.y, 0)
  for (let i = 0; i < pts.length; i++) idx.push(0, 1 + i, 1 + (i + 1) % pts.length)
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx)
  return g
}
// 眼鏡を体の面に沿わせる：前は平ら気味の弧、体の面より必ず off だけ手前
const GOFF = (772 - AX) * S
function bend(geo, z0, k, off = 0.17) {
  const p = geo.attributes.position
  const R = rBody(660) * S
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i)
    const xb = x + GOFF
    const zs = DEPTH * Math.sqrt(Math.max(R * R - xb * xb, 0))
    p.setZ(i, p.getZ(i) + Math.max(z0 - k * x * x, zs + off))
  }
  geo.computeVertexNormals()
}

export function makeGlasses() {
  const G = new THREE.Group()
  const GX = (772 - AX) * S, GY = (450 - 640) * S
  const A = 78 * S, B = 70 * S
  const frameMat = new THREE.MeshPhysicalMaterial({ side: THREE.DoubleSide, color: '#f26a12', roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.12, transmission: 0, sheen: 0.2 })
  const lensMat = new THREE.MeshPhysicalMaterial({ side: THREE.DoubleSide, color: '#1e2a17', roughness: 0.3, metalness: 0.35, specularIntensity: 0.4, clearcoat: 0.7, clearcoatRoughness: 0.22, envMapIntensity: 2.2 })
  const z0 = 1.3, k = 0.28
  for (const side of [-1, 1]) {
    const cx = side * 104 * S
    const fg = rimGeo(lensPts(cx, A, B, 7 * S, 120, 13 * S), lensPts(cx, A, B, 0), 0.07)
    bend(fg, z0, k)
    { const fm = new THREE.Mesh(fg, frameMat); fm.castShadow = true; G.add(fm) }
    const lg = fanGeo(lensPts(cx, A, B, 2 * S), cx, 0)
    bend(lg, z0 - 0.05, k)
    { const lm = new THREE.Mesh(lg, lensMat); lm.castShadow = true; G.add(lm) }
    // つる
    const tx = side * (104 + 78 + 30) * S
    const tz = z0 - k * tx * tx - 0.05
    const tg = new THREE.BoxGeometry(0.04, 0.07, 0.75)
    const t = new THREE.Mesh(tg, frameMat)
    tg.translate(0, 0, -0.37)
    t.position.set(side * (104 + 78 + 22) * S, B * 0.72, 0.62)
    t.rotation.set(-0.5, side * -0.25, 0)
    t.castShadow = true
    G.add(t)
  }
  G.position.set(GX, GY, 0)
  return G
}

// ---------- バンダナ（赤い水玉） ----------
function clothTexture() {
  const W = 1024, H = 256
  const c = document.createElement('canvas'); c.width = W; c.height = H
  const g = c.getContext('2d')
  g.fillStyle = '#efe5d6'; g.fillRect(0, 0, W, H)
  const r = rng(11)
  // 大小の水玉（赤・橙）を散らす
  for (let k = 0; k < 260; k++) {
    const x = r() * W, y = r() * H, big = r() < 0.35
    g.fillStyle = r() < 0.65 ? '#c9361c' : '#ec7a22'
    g.beginPath(); g.arc(x, y, big ? 9 + r() * 4 : 3 + r() * 2.5, 0, Math.PI * 2); g.fill()
  }
  // 縁の二重線
  g.fillStyle = '#c9361c'; g.fillRect(0, 0, W, 6); g.fillStyle = '#efe5d6'; g.fillRect(0, 6, W, 3); g.fillStyle = '#c9361c'; g.fillRect(0, 9, W, 2)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.anisotropy = 8; t.flipY = false
  return t
}

export function makeBandana() {
  const NU = 200, NV = 30
  const pos = [], uv = [], idx = []
  for (let j = 0; j <= NV; j++) {
    const t = j / NV
    for (let i = 0; i <= NU; i++) {
      const u = i / NU, phi = u * Math.PI * 2
      const front = Math.max(0, Math.cos(phi))
      const top = 728 + 115 * Math.pow(front, 1.2) + 18 * Math.sin(phi * 3 + 0.8) + 8 * Math.sin(phi * 9)
      const bot = Math.min(1080, top + 110 + 120 * Math.pow(front, 2.2))
      const py = top + t * (bot - top)
      const fold = (Math.sin(phi * 6 + t * 6) * 0.6 + Math.sin(phi * 4 - t * 2.3) * 0.4) * 16 * (0.5 + t)
      const lip = (1 - sm(0, 0.15, t)) * 14
      const r = (rBody(py) + 16 + fold * 0.5 + Math.abs(fold) * 0.5 + lip) * S
      pos.push(Math.sin(phi) * r, (450 - py) * S, Math.cos(phi) * r * DEPTH)
      uv.push(u * 3, t)
    }
  }
  for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) {
    const a = j * (NU + 1) + i, b = a + 1, c = a + NU + 1, d = c + 1
    idx.push(a, c, b, b, c, d)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  geo.setIndex(idx); geo.computeVertexNormals()
  const mat = new THREE.MeshStandardMaterial({ map: clothTexture(), roughness: 0.85, side: THREE.DoubleSide })
  const bm = new THREE.Mesh(geo, mat); bm.receiveShadow = true; bm.castShadow = true
  const G = new THREE.Group(); G.add(bm)
  // 前の結び目：中央の塊と左右に開く2枚の耳
  const zf = (rBody(890) + 26) * S * DEPTH
  const knot = (sx, sy, sz, x, y, rz) => {
    const kg = new THREE.SphereGeometry(1, 32, 20)
    const kp = kg.attributes.position
    for (let i = 0; i < kp.count; i++) { const k = 1 + (vnoise(kp.getX(i) * 3, kp.getY(i) * 3, kp.getZ(i) * 3 + x) - 0.5) * 0.35; kp.setXYZ(i, kp.getX(i) * k, kp.getY(i) * k, kp.getZ(i) * k) }
    kg.computeVertexNormals()
    const km = new THREE.Mesh(kg, mat); km.scale.set(sx * S, sy * S, sz * S)
    km.position.set(x * S, (450 - y) * S, zf); km.rotation.z = rz; km.castShadow = true; km.receiveShadow = true
    G.add(km)
  }
  knot(34, 26, 22, -8, 878, 0.2)
  knot(70, 26, 14, -78, 900, 0.5)
  knot(64, 24, 14, 58, 905, -0.6)
  return G
}

// ---------- 舞う豆 ----------
function nutTexture(seed, pale) {
  const W = 256, H = 128
  const c = document.createElement('canvas'); c.width = W; c.height = H
  const g = c.getContext('2d')
  g.fillStyle = pale ? '#e8c87a' : '#dd5a1a'; g.fillRect(0, 0, W, H)
  const r = rng(seed * 13 + 3)
  const n = pale ? 380 : 700
  for (let k = 0; k < n; k++) {
    const x = r() * W, y = r() * H, s = 0.6 + r() * (pale ? 1.8 : 2.4)
    const t = r()
    g.fillStyle = pale ? (t < 0.5 ? '#5a3a1a' : t < 0.8 ? '#a8742a' : '#f4dc9a') : (t < 0.35 ? '#7a2208' : t < 0.7 ? '#f08a36' : t < 0.82 ? '#3a1206' : '#f7b866')
    g.globalAlpha = 0.6 + r() * 0.4
    g.beginPath(); g.ellipse(x, y, s * 1.3, s, r() * 3, 0, Math.PI * 2); g.fill()
  }
  g.globalAlpha = 1
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace
  return t
}

export function makeNut(seed, pale) {
  const geo = new THREE.SphereGeometry(1, 48, 28)
  const p = geo.attributes.position
  const v = new THREE.Vector3()
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i)
    const d = 1 + (vnoise(v.x * 4 + seed, v.y * 4, v.z * 4) - 0.5) * (pale ? 0.1 : 0.22) + (vnoise(v.x * 11, v.y * 11 + seed, v.z * 11) - 0.5) * (pale ? 0.03 : 0.08)
    v.multiplyScalar(d)
    v.y *= pale ? 0.62 : 0.46; v.z *= pale ? 0.58 : 0.42
    v.y += 0.07 * v.x * v.x
    p.setXYZ(i, v.x, v.y, v.z)
  }
  geo.computeVertexNormals()
  const map = nutTexture(seed, pale)
  const mat = new THREE.MeshStandardMaterial({ map, bumpMap: map, bumpScale: 2.5, roughness: 0.62 })
  return new THREE.Mesh(geo, mat)
}
