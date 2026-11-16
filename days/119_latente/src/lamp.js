// 内へ光を向ける灯り：ねじれた三日月断面の殻。
// 断面は楕円の弧（開口の半角 g）。開口の向き θ を高さに沿って回すと、
// 凹んだ内側（光る石）が上と下で交互にこちらを向き、外側（木）が斜めに横切る。
import * as THREE from 'three'

const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }
const lerp = (a, b, t) => a + (b - a) * t
function curve(pts, t) { // 単調3次エルミート（Fritsch–Carlson）：段も行き過ぎも出さない
  const n = pts.length
  if (t <= pts[0][0]) return pts[0][1]
  if (t >= pts[n - 1][0]) return pts[n - 1][1]
  const d = [], m = []
  for (let i = 0; i < n - 1; i++) d.push((pts[i + 1][1] - pts[i][1]) / (pts[i + 1][0] - pts[i][0]))
  m.push(d[0])
  for (let i = 1; i < n - 1; i++) m.push(d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2)
  m.push(d[n - 2])
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue }
    const a = m[i] / d[i], b = m[i + 1] / d[i], h = a * a + b * b
    if (h > 9) { const k = 3 / Math.sqrt(h); m[i] = k * a * d[i]; m[i + 1] = k * b * d[i] }
  }
  let i = 0; while (t > pts[i + 1][0]) i++
  const x0 = pts[i][0], x1 = pts[i + 1][0], hh = x1 - x0, u = (t - x0) / hh
  const h00 = 2 * u ** 3 - 3 * u ** 2 + 1, h10 = u ** 3 - 2 * u ** 2 + u, h01 = -2 * u ** 3 + 3 * u ** 2, h11 = u ** 3 - u ** 2
  return h00 * pts[i][1] + h10 * hh * m[i] + h01 * pts[i + 1][1] + h11 * hh * m[i + 1]
}

export const P = {
  H: 3.38, y0: 0.13,
  // 半幅（x）・奥行き比
  a: [[0, 0.1], [0.05, 0.15], [0.13, 0.27], [0.23, 0.35], [0.36, 0.31], [0.5, 0.27], [0.7, 0.32], [0.82, 0.29], [0.9, 0.22], [0.96, 0.13], [1, 0.03]],
  depth: 0.7,
  // 中心のずれ（x, z）
  cx: [[0, 0.0], [0.18, -0.03], [0.5, 0.0], [0.72, 0.05], [0.88, -0.02], [0.95, 0.08], [1, 0.22]],
  cz: [[0, 0], [0.6, 0], [1, -0.05]],
  // 開口の半角（0=閉じた筒）
  g: [[0, 0], [0.24, 0], [0.33, 1.75], [0.7, 1.75], [0.78, 0.5], [0.85, 0]],
  // 開口の向き（rad・π/2 = カメラ側）
  th: [[0, 2.25], [0.42, 2.25], [0.64, 7.1], [1, 7.0]],
  wall: 0.075,
}

export function lampGeometries(p = P, NT = 220, NS = 96) {
  const outer = [], inner = [], uvO = [], uvI = []
  const edgeA = [], edgeB = []
  for (let i = 0; i <= NT; i++) {
    const t = i / NT
    const a = curve(p.a, t), b = a * p.depth
    const cx = curve(p.cx, t), cz = curve(p.cz, t)
    const g = curve(p.g, t), th = curve(p.th, t)
    const y = p.y0 + t * p.H
    const w = Math.min(p.wall, a * 0.45)
    const ai = a - w, bi = b - w
    for (let j = 0; j <= NS; j++) {
      const s = j / NS
      const phi = th + g + s * (Math.PI * 2 - 2 * g)
      const co = Math.cos(phi), si = Math.sin(phi)
      outer.push(cx + a * co, y, cz + b * si)
      inner.push(cx + ai * co, y, cz + bi * si)
      uvO.push(s * a * 4.2, t * 2.2)
      uvI.push(s * 1.0, t * 2.0)
    }
    // 開口の両縁（外→内）
    for (const [arr, phi] of [[edgeA, th + g], [edgeB, th + Math.PI * 2 - g]]) {
      arr.push([cx + a * Math.cos(phi), y, cz + b * Math.sin(phi), cx + ai * Math.cos(phi), y, cz + bi * Math.sin(phi)])
    }
  }
  const grid = (pos, uv, flip) => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    const idx = []
    for (let i = 0; i < NT; i++) for (let j = 0; j < NS; j++) {
      const A = i * (NS + 1) + j, B = A + 1, C = A + NS + 1, D = C + 1
      if (flip) idx.push(A, C, B, B, C, D); else idx.push(A, B, C, B, D, C)
    }
    g.setIndex(idx); g.computeVertexNormals()
    return g
  }
  const strip = (arr, flip) => {
    const pos = [], uv = [], idx = []
    arr.forEach((r, i) => { pos.push(...r); uv.push(0, i / NT * 2.2, 0.08, i / NT * 2.2) })
    for (let i = 0; i < NT; i++) {
      const A = i * 2, B = A + 1, C = A + 2, D = A + 3
      if (flip) idx.push(A, C, B, B, C, D); else idx.push(A, B, C, B, D, C)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    g.setIndex(idx); g.computeVertexNormals()
    return g
  }
  return {
    outer: grid(outer, uvO, false),
    inner: grid(inner, uvI, true),
    edgeA: strip(edgeA, false),
    edgeB: strip(edgeB, true),
  }
}
