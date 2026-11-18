import * as THREE from 'three'

// 灰皿の断面（半径 r, 高さ y）を外の底から内の窪みまで1本で描いて回す。
// 64分割で回してから、半径を「角の丸い八角」へ寄せる（8分割の硬い稜線を作らない）。
function arc(pts, cx, cy, rad, a0, a1, n) {
  for (let i = 0; i <= n; i++) {
    const a = a0 + (a1 - a0) * (i / n)
    pts.push(new THREE.Vector2(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad))
  }
}

export function makeAshtray(o = {}) {
  const H = o.H ?? 0.24          // 天面の高さ
  const B = o.B ?? -0.30         // 底
  const Ri = o.Ri ?? 0.56        // 皿の口の半径
  const D = o.D ?? 0.10          // 皿の深さ
  const P = []
  P.push(new THREE.Vector2(0.0, B))
  P.push(new THREE.Vector2(0.80, B))
  arc(P, 0.80, B + 0.12, 0.12, -Math.PI / 2, 0, 8)      // 底の面取り
  P.push(new THREE.Vector2(0.94, H - 0.20))
  arc(P, 0.74, H - 0.20, 0.20, 0, Math.PI / 2, 12)      // 外の縁の丸み
    arc(P, Ri + 0.08, H - 0.08, 0.08, Math.PI / 2, Math.PI, 6) // 内の縁の丸み
  P.push(new THREE.Vector2(Ri, H - D + 0.02))
  arc(P, Ri - 0.12, H - D + 0.02, 0.12, 0, -Math.PI / 2, 6)
  P.push(new THREE.Vector2(0.10, H - D - 0.10))
  P.push(new THREE.Vector2(0.0, H - D - 0.10))
  const g = new THREE.LatheGeometry(P.reverse(), 96)
  const pos = g.attributes.position
  const k = o.oct ?? 0.75
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i)
    const th = Math.atan2(z, x)
    let a = ((th % (Math.PI / 4)) + Math.PI / 4) % (Math.PI / 4) - Math.PI / 8
    // 八角の辺までの距離（頂点で1）を、角だけ丸めて半径に掛ける
    const oct = Math.cos(Math.PI / 8) / Math.cos(a)
    const f = 1 + (oct * Math.cos(Math.PI / 8) / Math.cos(Math.PI / 8) - 1) * k
    const s = Math.pow(f, 1) / (1 + (1 / Math.cos(Math.PI / 8) - 1) * k * 0.5)
    pos.setX(i, x * s); pos.setZ(i, z * s)
  }
  g.computeVertexNormals()
  return g
}
