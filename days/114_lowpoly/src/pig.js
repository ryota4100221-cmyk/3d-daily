// 面で折られた豚 — 陰関数の豚に、伸ばした二十面体を中心から当てて頂点を表面へ寄せる。
// 単位：1 ≒ 120 px（ref.png の実測を NOTES.md に）。豚は -x を向き、y が上、z が手前。
import * as THREE from 'three'

const v3 = (x, y, z) => new THREE.Vector3(x, y, z)

function sdEll(p, c, r) {
  const qx = (p.x - c[0]) / r[0], qy = (p.y - c[1]) / r[1], qz = (p.z - c[2]) / r[2]
  const k = Math.sqrt(qx * qx + qy * qy + qz * qz)
  return (k - 1) * Math.min(r[0], r[1], r[2])
}
// x 軸に沿った円柱（鼻の平らな面）
function sdCylX(p, c, rad, half, ry = 1) {
  const dy = (p.y - c[1]) / ry, dz = p.z - c[2]
  const d0 = Math.sqrt(dy * dy + dz * dz) - rad
  const d1 = Math.abs(p.x - c[0]) - half
  const ox = Math.max(d0, 0), oy = Math.max(d1, 0)
  return Math.min(Math.max(d0, d1), 0) + Math.sqrt(ox * ox + oy * oy)
}
function smin(a, b, k) {
  const h = Math.max(k - Math.abs(a - b), 0) / k
  return Math.min(a, b) - h * h * k * 0.25
}

export function bodySdf(p) {
  let d = sdEll(p, [0.55, 0.18, 0], [2.2, 1.08, 1.08])          // 胴
  d = smin(d, sdEll(p, [1.6, 0.08, 0], [1.3, 1.08, 1.0]), 0.8)  // 尻
  d = smin(d, sdEll(p, [-1.2, -0.18, 0], [1.05, 0.98, 0.98]), 0.6)  // 肩
  d = smin(d, sdEll(p, [0.3, -0.55, 0], [1.4, 0.8, 0.92]), 0.8)  // 腹
  d = smin(d, sdEll(p, [1.8, -0.6, 0], [0.7, 0.7, 0.9]), 0.4) // 腿
  d = smin(d, sdEll(p, [-1.45, -0.75, 0], [0.6, 0.65, 0.85]), 0.4) // 前脚の付け根
  d = smin(d, sdEll(p, [-2.0, -0.1, 0], [0.65, 0.8, 0.74]), 0.5)   // 首
  d = smin(d, sdEll(p, [-2.2, -0.75, 0], [0.85, 0.48, 0.66]), 0.4)  // 喉から胸
  return d
}
export function headSdf(p) {
  let d = sdEll(p, [-2.5, -0.12, 0], [0.85, 0.74, 0.66])            // 頭
  d = smin(d, sdEll(p, [-2.6, -0.82, 0], [0.75, 0.32, 0.48]), 0.35)  // 顎
  d = smin(d, sdCylX(p, [-3.33, -0.58, 0], 0.23, 0.52, 1.1), 0.1)   // 鼻
  return d
}

// 位置からの決定的な乱数（共有頂点が同じだけ動くように）
function hash3(x, y, z) {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453
  return s - Math.floor(s)
}

function addFaceRand(geo, seed) {
  const n = geo.attributes.position.count
  const fr = new Float32Array(n)
  for (let f = 0; f < n / 3; f++) {
    const r = hash3(f * 1.37 + seed, seed * 2.1, f * 0.71)
    fr[f * 3] = fr[f * 3 + 1] = fr[f * 3 + 2] = r
  }
  geo.setAttribute('fr', new THREE.BufferAttribute(fr, 1))
  return geo
}

export function shrinkWrap(sdf, c, S, { detail = 3, jitter = 0.1, seed = 1 } = {}) {
  const ico = new THREE.IcosahedronGeometry(1, detail)
  ico.rotateZ(0.31).rotateY(0.17)  // 極を真横から外す（尻が縦の面で切れないように）
  const pos = ico.attributes.position
  const p = new THREE.Vector3(), d = new THREE.Vector3()
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i)
    d.set(x * S.x, y * S.y, z * S.z).normalize()
    // 中心から外へ歩いて最初に外へ出る所
    let t = 0, step = 0.03
    while (t < 7) {
      p.copy(d).multiplyScalar(t).add(c)
      if (sdf(p) > 0) break
      t += step
    }
    let lo = Math.max(0, t - step), hi = t
    for (let k = 0; k < 20; k++) {
      const m = (lo + hi) / 2
      p.copy(d).multiplyScalar(m).add(c)
      if (sdf(p) > 0) hi = m; else lo = m
    }
    p.copy(d).multiplyScalar(lo).add(c)
    const j = jitter
    p.x += (hash3(x + seed, y, z) - 0.5) * j * 2
    p.y += (hash3(y + 3.1, z, x) - 0.5) * j
    p.z += (hash3(z + 7.7, x, y) - 0.5) * j
    pos.setXYZ(i, p.x, p.y, p.z)
  }
  ico.computeVertexNormals()
  return addFaceRand(ico, seed)
}
export const bodyGeometry = () => shrinkWrap(bodySdf, v3(0.1, -0.15, 0), v3(2.9, 1.2, 1.05), { detail: 2, jitter: 0.14, seed: 1 })
export const headGeometry = () => shrinkWrap(headSdf, v3(-2.75, -0.3, 0), v3(1.3, 0.7, 0.62), { detail: 1, jitter: 0.03, seed: 11 })

// 三角形の列から非 index の geometry を作る
function trisToGeo(tris, seed) {
  const arr = new Float32Array(tris.length * 9)
  tris.forEach((t, i) => t.forEach((v, k) => { arr[i * 9 + k * 3] = v.x; arr[i * 9 + k * 3 + 1] = v.y; arr[i * 9 + k * 3 + 2] = v.z }))
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(arr, 3))
  g.computeVertexNormals()
  return addFaceRand(g, seed)
}

// 輪の列（各輪 = 中心・半径・角数）を筒に張る
function loft(rings, sides, seed, twist = 0) {
  const pts = rings.map((r, ri) => {
    const out = []
    for (let s = 0; s < sides; s++) {
      const a = (s / sides) * Math.PI * 2 + twist * ri
      out.push(v3(r.c.x + Math.cos(a) * r.rx, r.c.y, r.c.z + Math.sin(a) * r.rz))
    }
    return out
  })
  const tris = []
  for (let ri = 0; ri < rings.length - 1; ri++) {
    for (let s = 0; s < sides; s++) {
      const a = pts[ri][s], b = pts[ri][(s + 1) % sides], c2 = pts[ri + 1][s], d = pts[ri + 1][(s + 1) % sides]
      tris.push([a, c2, b], [b, c2, d])
    }
  }
  // 底の蓋
  const last = pts[pts.length - 1]
  const cen = rings[rings.length - 1].c
  for (let s = 0; s < sides; s++) tris.push([last[s], v3(cen.x, cen.y, cen.z), last[(s + 1) % sides]])
  return trisToGeo(tris, seed)
}

// 脚：関節の点を通る5角の筒＋前へ尖った蹄の塊
// kind 'f' 前脚：肩→肘→膝→球節→蹄 ／ 'r' 後脚：腿→膝→飛節（後ろへ折れる）→球節→蹄
export function legGeometry(x, z, { kind = 'f', seed = 2, rTop = 0.5, splay = 0 } = {}) {
  const P = kind === 'f'
    ? [[0, -0.2, rTop], [0.08, -1.15, rTop * 0.55], [-0.02, -1.85, 0.17], [0.03, -2.28, 0.15]]
    : [[0, 0.0, rTop], [-0.12, -0.95, rTop * 0.6], [0.22, -1.7, 0.16], [0.06, -2.28, 0.14]]
  const rings = P.map(([dx, y, r]) => ({ c: v3(x + dx + splay * (y / -2.3), y, z), rx: r * 1.05, rz: r }))
  const leg = loft(rings, 5, seed, 0.35)
  // 蹄：上の輪より少し太く、つま先が -x へ出た6点の塊
  const hx = x + P[3][0] + splay - 0.04, hy = -2.3
  const t = 0.2
  const top = [v3(hx + 0.12, hy, z), v3(hx, hy, z + 0.15), v3(hx - 0.13, hy, z + 0.05), v3(hx - 0.13, hy, z - 0.05), v3(hx, hy, z - 0.15)]
  const bot = [v3(hx + 0.16, hy - t, z), v3(hx - 0.02, hy - t - 0.02, z + 0.19), v3(hx - 0.3, hy - t - 0.02, z + 0.06), v3(hx - 0.3, hy - t - 0.02, z - 0.06), v3(hx - 0.02, hy - t - 0.02, z - 0.19)]
  const tris = []
  for (let k = 0; k < 5; k++) {
    const a1 = top[k], b1 = top[(k + 1) % 5], c1 = bot[k], d1 = bot[(k + 1) % 5]
    tris.push([a1, c1, b1], [b1, c1, d1])
  }
  const hoof = trisToGeo(tris, seed + 20)
  return [leg, hoof]
}

// 鼻の円盤：-x を向いた平らな六角
export function snoutGeometry(seed) {
  const c = v3(-3.88, -0.58, 0), r = 0.27
  const tris = []
  const pts = []
  for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2 + 0.3; pts.push(v3(c.x - 0.01, c.y + Math.cos(a) * r * 1.05, c.z + Math.sin(a) * r)) }
  for (let k = 0; k < 6; k++) tris.push([v3(c.x - 0.03, c.y, c.z), pts[k], pts[(k + 1) % 6]])
  return trisToGeo(tris, seed)
}

// 耳：根元の三角と先端。厚みのある木の葉
export function earGeometry(side, seed) {
  const s = side // +1 手前 / -1 奥
  const b0 = v3(-2.35, 0.32, 0.2 * s)
  const b1 = v3(-2.6, 0.3, 0.42 * s)
  const b2 = v3(-2.85, 0.05, 0.58 * s)
  const tip = s > 0 ? v3(-3.5, 0.78, 0.3) : v3(-2.95, 0.74, -0.55)
  const mid = v3(-3.12, 0.5, (s > 0 ? 0.42 : 0.66) * s)
  const back = v3(-2.7, 0.6, 0.4 * s)
  const tris = [
    [b0, back, b1], [b1, back, mid], [b1, mid, b2], [mid, back, tip], [b2, mid, tip],
    [b0, b2, back], [back, b2, tip],
  ]
  return trisToGeo(tris, seed)
}

// 尾：細い三角の筒が二度折れる
export function tailGeometry(seed) {
  const path = [v3(2.8, 0.5, 0), v3(3.12, 0.66, 0), v3(3.3, 0.98, 0), v3(3.18, 1.22, 0), v3(3.34, 1.5, 0)]
  const tris = []
  const sides = 4, r = 0.11
  const rings = path.map((c, i) => {
    const out = []
    for (let k = 0; k < sides; k++) {
      const a = (k / sides) * Math.PI * 2 + i
      out.push(v3(c.x + Math.cos(a) * r * 0.6, c.y + Math.cos(a) * r, c.z + Math.sin(a) * r))
    }
    return out
  })
  for (let i = 0; i < rings.length - 1; i++) for (let k = 0; k < sides; k++) {
    const a = rings[i][k], b = rings[i][(k + 1) % sides], c2 = rings[i + 1][k], d = rings[i + 1][(k + 1) % sides]
    tris.push([a, c2, b], [b, c2, d])
  }
  return trisToGeo(tris, seed)
}
