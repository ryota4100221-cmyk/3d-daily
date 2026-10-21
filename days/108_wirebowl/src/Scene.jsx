import { useMemo, useRef, useEffect } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'

// 正投影・1 unit = 1 px。仰角 10°。高台の下端の中心 (0,0,0) が画面 y=720 に来るよう注視点を置く
export const TILT = (10 * Math.PI) / 180
export const TY = 270 / Math.cos(TILT)

// ref.png の行ごとの白の左右端から実測した外形 (r, h)。h は高台の下端から上へ
const OUTER = [
  [141, 0], [149, 15], [153, 30], [160, 52], [172, 76], [187, 99], [205, 122], [225, 145], [246, 167],
  [267, 190], [286, 213], [308, 244], [328, 274], [343, 297], [356, 320], [375, 351], [393, 381],
  [414, 405], [434, 426], [446, 440], [453, 452],
]
const WALL = 9

function spline(pts, n) {
  const c = new THREE.SplineCurve(pts.map(([r, h]) => new THREE.Vector2(r, h)))
  return c.getSpacedPoints(n)
}

// 外壁の半径を高さから引く（紋の射影で使う）
const OUT_S = spline(OUTER, 400)
export function rOut(h) {
  if (h <= OUT_S[0].y) return OUT_S[0].x
  for (let i = 1; i < OUT_S.length; i++) {
    if (OUT_S[i].y >= h) {
      const a = OUT_S[i - 1], b = OUT_S[i], t = (h - a.y) / (b.y - a.y || 1)
      return a.x + (b.x - a.x) * t
    }
  }
  return OUT_S[OUT_S.length - 1].x
}
const rIn = (h) => rOut(h) - WALL

// 断面：高台の内側 → 高台の下 → 外壁 → 口縁（半円）→ 内壁 → 見込み → 軸
function profile(wireOnly = false) {
  const p = []
  const push = (r, h) => p.push(new THREE.Vector2(Math.max(r, 0.01), h))
  // 高台の内側（裏）：線には張らない（張ると高台の底に白い塊ができる）
  if (!wireOnly) { push(0.01, 26); push(60, 26); push(100, 25); push(124, 18); push(128, 6); push(132, 0) }
  // 外壁（下ほど輪を細かく：高台の帯が白く詰まるように）
  for (let h = 0; h < 30; h += 3.75) push(rOut(h), h)
  const body = spline(OUTER.filter(([, h]) => h >= 30), 30)
  body.forEach((v) => push(v.x, v.y))
  // 口縁：外 → 上 → 内 の半円（輪を詰めて白い帯にする）。線では奥の半周だけ別に張る（lipProfile）
  if (wireOnly) return p
  const top = OUTER[OUTER.length - 1]
  const cx = top[0] - WALL / 2, cy = top[1]
  for (let i = 1; i <= 10; i++) {
    const a = (i / 10) * Math.PI
    push(cx + (WALL / 2) * Math.cos(a), cy + (WALL / 2) * Math.sin(a) * 1.4)
  }
  if (wireOnly) {
    // 線は外壁1枚だけ（内壁まで張ると4層重なって再現元より白くなる）。口の内側に少しだけ折り返す
    return p
  }
  // 内壁
  const inner = spline(OUTER.filter(([, h]) => h >= 52).reverse().map(([r, h]) => [r - WALL, h]), 28)
  inner.slice(1).forEach((v) => push(v.x, v.y))
  // 見込み：縁を密に（再現元の底の白い弧）
  const r0 = rIn(52)
  for (let i = 1; i <= 8; i++) push(r0 - i * 2.2, 52 - i * 0.9)
  push(r0 - 40, 43); push(r0 - 90, 41); push(60, 40); push(0.01, 40)
  return p
}

function lipProfile() {
  const p = []
  const top = OUTER[OUTER.length - 1]
  const cx = top[0] - WALL / 2, cy = top[1]
  for (let i = 0; i <= 10; i++) {
    const a = (i / 10) * Math.PI
    p.push(new THREE.Vector2(cx + (WALL / 2) * Math.cos(a), cy + (WALL / 2) * Math.sin(a) * 1.4))
  }
  for (let i = 1; i <= 3; i++) p.push(new THREE.Vector2(rIn(452 - i * 6), 452 - i * 6))
  return p
}

// 画面 px (sx, sy) → 奥の内壁の上の点（同じ高さ h の内壁の、奥側 z<0）
function onFarWall(sx, sy, lift) {
  const x = sx - 720
  const v = 450 - sy
  let h = TY + v / Math.cos(TILT)
  let z = 0
  for (let k = 0; k < 8; k++) {
    const r = rIn(h)
    z = -Math.sqrt(Math.max(r * r - x * x, 1))
    h = TY + (v + z * Math.sin(TILT)) / Math.cos(TILT)
  }
  const r = Math.hypot(x, z)
  const s = (r - lift) / r
  // 浮かせは軸へ＋少し下へ：側面が画面に出て帯に厚みが見える（再現元の M の帯の斜めの側面）
  return new THREE.Vector3(x * s - lift * 0.55, h - lift * 0.7, z * s)
}

// 帯（中心線 + 幅）を奥の内壁に貼った浮き彫り。上面と両側面を格子で張る
function bandGeometry(center, width, nu, nv, depth) {
  const pos = [], idx = []
  const N = center.length
  const pts = (j, side, lift) => {
    const i = Math.min(j, N - 1)
    const a = center[Math.max(i - 1, 0)], b = center[Math.min(i + 1, N - 1)]
    let tx = b[0] - a[0], ty = b[1] - a[1]
    const l = Math.hypot(tx, ty) || 1
    tx /= l; ty /= l
    const c = center[i]
    return onFarWall(c[0] - ty * side * width / 2, c[1] + tx * side * width / 2, lift)
  }
  const grid = (rows, cols, f) => {
    const base = pos.length / 3
    for (let r = 0; r <= rows; r++) for (let c = 0; c <= cols; c++) { const v = f(r, c); pos.push(v.x, v.y, v.z) }
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const a = base + r * (cols + 1) + c, b = a + 1, d = a + cols + 1, e = d + 1
      idx.push(a, d, b, b, d, e)
    }
  }
  // 上面
  grid(N - 1, nv, (r, c) => pts(r, -1 + (2 * c) / nv, depth))
  // 両側面
  for (const side of [-1, 1]) grid(N - 1, 1, (r, c) => pts(r, side, depth * c))
  // 端の蓋
  for (const j of [0, N - 1]) grid(1, nv, (r, c) => pts(j, -1 + (2 * c) / nv, depth * r))
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setIndex(idx)
  // 帯の縁：上面と根元の長い辺を連続した線で（再現元の帯は縁の白い直線が立っている）
  const seg = []
  for (const side of [-1, 1]) for (const lift of [depth, 0]) {
    for (let j = 0; j < N - 1; j++) { const a = pts(j, side, lift), b = pts(j + 1, side, lift); seg.push(a.x, a.y, a.z, b.x, b.y, b.z) }
  }
  const e = new THREE.BufferGeometry()
  e.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3))
  g.userData.edges = e
  return g
}

const line = (x0, y0, x1, y1, n) => Array.from({ length: n + 1 }, (_, i) => [x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n])
const arc = (cx, cy, rx, ry, a0, a1, n) =>
  Array.from({ length: n + 1 }, (_, i) => {
    const a = a0 + ((a1 - a0) * i) / n
    return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)]
  })

// 紋：輪の枠（3本の同心の帯）＋ 架空の頭文字 K（縦の帯1本＋斜めの帯2本）。位置は ref の M の外接枠に合わせる
function markGeometries() {
  const gs = []
  // 枠：再現元の輪は円ではなく内壁に沿う卵形（上が広く下がすぼむ）。画面の y ごとに外形の半径の f 倍で回る
  const halfW = (y) => rOut((720 - y) / Math.cos(TILT)) - 34
  for (const [f, w] of [[0.9, 18], [0.8, 12], [0.72, 9]]) {
    const c = []
    for (let i = 0; i <= 60; i++) {
      const t = (i / 60) * Math.PI * 2
      const y = 435 - 190 * f * Math.sin(t) * 1.05
      c.push([720 + f * halfW(y) * Math.cos(t), y])
    }
    gs.push(bandGeometry(c, w, 0, 2, 10))
  }
  // K の各画は平行な3本の細い帯の束（再現元の M も束で、縁の線が立って浮き彫りの厚みが読める）
  const stroke = (x0, y0, x1, y1, n) => {
    const l = Math.hypot(x1 - x0, y1 - y0), nx = -(y1 - y0) / l, ny = (x1 - x0) / l
    for (const o of [-18, 18]) gs.push(bandGeometry(line(x0 + nx * o, y0 + ny * o, x1 + nx * o, y1 + ny * o, n), 26, 0, 2, 20))
  }
  stroke(575, 285, 575, 590, 12)
  stroke(600, 490, 930, 300, 14)
  stroke(668, 432, 905, 598, 11)
  return gs
}

// ---- 筆跡（画面 px の直近 48 点）----
const NPTS = 48
const brush = { pts: Array.from({ length: NPTS }, () => new THREE.Vector3(-1e4, -1e4, -1e3)), head: 0 }

const brushGLSL = /* glsl */ `
  uniform vec3 uPts[${NPTS}];
  uniform float uTime;
  uniform float uDpr;
  uniform float uH;
  float segD(vec2 p, vec2 a, vec2 b) {
    vec2 ab = b - a; float t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-3), 0.0, 1.0);
    return length(p - a - ab * t);
  }
  float brushMask() {
    vec2 p = vec2(gl_FragCoord.x, uH - gl_FragCoord.y) / uDpr;
    float m = 0.0;
    for (int i = 0; i < ${NPTS - 1}; i++) {
      vec3 a = uPts[i], b = uPts[i + 1];
      if (b.z < a.z - 0.0001 || a.z < -100.0) continue;
      float age = uTime - b.z;
      if (age > 6.0 || b.z - a.z > 0.25) continue;
      float d = segD(p, a.xy, b.xy);
      float w = 46.0 + 16.0 * sin(float(i) * 0.37);
      m = max(m, (1.0 - smoothstep(w * 0.45, w, d)) * exp(-age / 2.2));
    }
    return m;
  }
`

function useBrushUniforms() {
  return useMemo(() => ({ uPts: { value: brush.pts }, uTime: { value: 0 }, uDpr: { value: 1 }, uH: { value: 900 }, uAlpha: { value: 0.58 } }), [])
}

export default function Scene() {
  const { gl, size, camera } = useThree()
  const uni = useBrushUniforms()

  useEffect(() => {
    camera.up.set(0, 1, 0)
    camera.position.set(0, TY + Math.sin(TILT) * 1500, Math.cos(TILT) * 1500)
    camera.lookAt(0, TY, 0)
    camera.updateProjectionMatrix()
  }, [camera])

  const lathe = useMemo(() => new THREE.LatheGeometry(profile(), 144), [])
  const wire = useMemo(() => new THREE.LatheGeometry(profile(true), 120), [])
  // 再現元は手前の口縁の線が胴を横切らない：口縁の帯は奥の 200° だけ
  const lip = useMemo(() => new THREE.LatheGeometry(lipProfile(), 70, Math.PI * 0.44, Math.PI * 1.12), [])
  // 見込みの縁と底：輪を詰めた2本の帯（再現元の底の白い2本の弧）
  // 再現元の2本の弧は見込みの輪にしては反りが強い（端と中央の差 ≈ 35 px）。平面で奥行き方向に伸ばした楕円の手前だけを置く
  const rings = useMemo(
    () =>
      [[150, 470, 168, 1.05], [175, 380, 98, 1.16]].map(([rx, rz, h, span]) => {
        const g = new THREE.LatheGeometry(Array.from({ length: 18 }, (_, i) => new THREE.Vector2(rx - i * 0.3, h - i * 0.6)), 48, Math.PI * 2 - span, span * 2)
        g.scale(1, 1, rz / rx)
        return g
      }),
    []
  )
  const marks = useMemo(() => markGeometries(), [])

  const wireMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: uni,
        wireframe: true,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexShader: `void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: brushGLSL + `
          uniform float uAlpha;
          void main(){ float m = brushMask(); gl_FragColor = vec4(vec3(uAlpha * (1.0 - m)), 1.0); }`,
      }),
    [uni]
  )

  // 紋は帯の線を詰めた上でさらに明るく（再現元の M は白い束に見える）
  const markMat = useMemo(() => {
    const m = wireMat.clone()
    m.uniforms = { ...uni, uAlpha: { value: 0.9 } }
    return m
  }, [wireMat, uni])

  // 墨の膜：鉢の内側が地より暗い（再現元は鉢の中が #000〜#080808、地は #232323）
  const inkMat = useMemo(() => new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.66, side: THREE.DoubleSide, depthWrite: false }), [])

  const solidMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: uni,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
        vertexShader: `
          varying vec3 vN; varying vec3 vV;
          void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vV = -mv.xyz; vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * mv; }`,
        fragmentShader: brushGLSL + `
          varying vec3 vN; varying vec3 vV;
          void main(){
            float m = brushMask(); if (m < 0.01) discard;
            vec3 n = normalize(vN); if (!gl_FrontFacing) n = -n;
            vec3 L = normalize(vec3(-0.5, 0.7, 0.6));
            float k = 0.5 + 0.5 * dot(n, L);
            vec3 base = vec3(0.96, 0.90, 0.74);
            vec3 c = base * (0.42 + 0.62 * k);
            float sp = pow(max(dot(reflect(-L, n), normalize(vec3(0.0,0.0,1.0))), 0.0), 24.0);
            c += 0.12 * sp;
            gl_FragColor = vec4(c, m);
            #include <colorspace_fragment>
          }`,
      }),
    [uni]
  )

  // ポインタの軌跡（?demo で筆を1本自動で引く＝撮影用）
  useEffect(() => {
    const add = (x, y) => {
      const t = performance.now() / 1000
      const last = brush.pts[(brush.head + NPTS - 1) % NPTS]
      if (Math.hypot(last.x - x, last.y - y) < 6 && t - last.z < 0.2) return
      brush.pts.copyWithin(0, 1)
      brush.pts[NPTS - 1] = new THREE.Vector3(x, y, t)
      uni.uPts.value = brush.pts
    }
    const onMove = (e) => add(e.clientX, e.clientY)
    window.addEventListener('pointermove', onMove)
    let raf
    if (new URLSearchParams(location.search).has('demo')) {
      let t0 = 0
      const step = () => {
        const s = (performance.now() - t0) / 1600
        if (s <= 1) {
          add(300 + 520 * s, 300 + 90 * s + 50 * Math.sin(s * 3.1))
          raf = requestAnimationFrame(step)
        }
      }
      setTimeout(() => { t0 = performance.now(); raf = requestAnimationFrame(step) }, 2500)
    }
    return () => { window.removeEventListener('pointermove', onMove); cancelAnimationFrame(raf) }
  }, [uni])

  useFrame(() => {
    uni.uTime.value = performance.now() / 1000
    uni.uDpr.value = gl.getPixelRatio()
    uni.uH.value = size.height * gl.getPixelRatio()
  })

  return (
    <group>
      <mesh geometry={lathe} material={inkMat} renderOrder={0} />
      <mesh geometry={lathe} material={solidMat} renderOrder={1} />
      <mesh geometry={wire} material={wireMat} renderOrder={2} />
      <mesh geometry={lip} material={wireMat} renderOrder={2} />
      {rings.map((g, i) => (
        <mesh key={'r' + i} geometry={g} material={markMat} renderOrder={2} />
      ))}
      {marks.map((g, i) => (
        <group key={i}>
          <mesh geometry={g} material={markMat} renderOrder={2} />
          <lineSegments geometry={g.userData.edges} material={markMat} renderOrder={3} />
          <lineSegments geometry={g.userData.edges} material={markMat} renderOrder={3} position={[0.8, -0.8, 0]} />
        </group>
      ))}
    </group>
  )
}
