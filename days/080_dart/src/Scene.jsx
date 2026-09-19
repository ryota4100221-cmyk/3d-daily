import { useMemo, useRef, useLayoutEffect } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import {
  drape, gaussBonnet, surf, NW, NJ, NODES, idx, pos, alive, omega,
  reach, cidx, UMIN, UMAX,
} from './rig.js'

// ── 色（キヤスクの実測から）────────────────────────────────────────────
// 白 #FFFFFF と淡グレー #ECECEC／#F6F6F6 の地、文字 #000000 / #555555、
// 差し色サーモン #FF8A76 が「実測3箇所だけ」。その3箇所ぶんの節度を守る。
export const INK = '#111111'
export const SALMON = '#FF8A76'
const CLOTH = new THREE.Color('#F1F0ED')
const CLOTH_DARK = new THREE.Color('#D3D0CB')
const THREAD = new THREE.Color('#23211D')
const BODY = new THREE.Color('#DEDBD6')
const LIGHT_DIR = new THREE.Vector3(-0.45, 0.72, 0.85).normalize()

// ── 布：目を四角で張り、糸はフラグメントで引く ─────────────────────────
// 糸を線分で描かずシェーダの格子にしているのは手抜きではなく、そうすると
// **せん断で目が詰まった所が勝手に暗くなる**から。1本の糸の太さを画面上で
// 一定にすると、単位面積あたりの糸の本数＝1/(a²sin ω) がそのまま濃度になる。
// つまりこの絵の陰影は照明ではなく ω の地図で、光源は1つも要らない。
const clothVert = /* glsl */ `
  in vec2 aGrid;
  out vec2 vGrid;
  out vec3 vW;
  void main() {
    vGrid = aGrid;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vW = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`
const clothFrag = /* glsl */ `
  precision highp float;
  in vec2 vGrid;
  in vec3 vW;
  uniform vec3 uCloth, uClothDark, uThread, uLightDir;
  // three の GLSL3 経路は pc_fragColor も gl_FragColor も用意しない。
  // 出力は自分で宣言する（ここを GLSL1 の癖で書くと fragment だけ
  // コンパイルに落ちて、body と線だけが残った絵が出る＝実測）。
  layout(location = 0) out vec4 fragColor;
  void main() {
    vec3 n = normalize(cross(dFdx(vW), dFdy(vW)));
    if (!gl_FrontFacing) n = -n;
    float lam = 0.58 + 0.42 * dot(n, uLightDir);
    vec3 base = mix(uClothDark, uCloth, smoothstep(0.20, 1.0, lam));
    vec2 gw = max(fwidth(vGrid), vec2(1e-5));
    vec2 f = abs(fract(vGrid + 0.5) - 0.5) / gw;
    float l = min(f.x, f.y);
    float ink = 1.0 - smoothstep(0.25, 1.00, l);
    fragColor = vec4(mix(base, uThread, ink * 0.88), 1.0);
  }
`

function useCloth() {
  return useMemo(() => {
    const g = new THREE.BufferGeometry()
    const grid = new Float32Array(NODES * 2)
    for (let i = -NW; i <= NW; i++)
      for (let j = -NJ; j <= NJ; j++) {
        const n = idx(i, j)
        grid[n * 2] = i
        grid[n * 2 + 1] = j
      }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('aGrid', new THREE.BufferAttribute(grid, 2))
    g.setIndex(new THREE.BufferAttribute(new Uint32Array(2 * NW * 2 * NJ * 6), 1))
    const m = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: clothVert,
      fragmentShader: clothFrag,
      side: THREE.DoubleSide,
      uniforms: {
        uCloth: { value: CLOTH },
        uClothDark: { value: CLOTH_DARK },
        uThread: { value: THREAD },
        uLightDir: { value: LIGHT_DIR },
      },
    })
    return { g, m }
  }, [])
}

// ── 体（トルソー）。網とは独立に一度だけ張る ─────────────────────────
function useBody() {
  return useMemo(() => {
    const NU = 150, NV = 128
    const p = new Float32Array(((NU + 1) * (NV + 1) + 2) * 3)
    const t = [0, 0, 0]
    for (let a = 0; a <= NU; a++) {
      const u = UMIN + ((UMAX - UMIN) * a) / NU
      for (let b = 0; b <= NV; b++) {
        surf(u, (b / NV) * Math.PI * 2, t)
        const k = (a * (NV + 1) + b) * 3
        p[k] = t[0]; p[k + 1] = t[1]; p[k + 2] = t[2]
      }
    }
    const ix = []
    for (let a = 0; a < NU; a++)
      for (let b = 0; b < NV; b++) {
        const q = a * (NV + 1) + b
        ix.push(q, q + NV + 1, q + 1, q + 1, q + NV + 1, q + NV + 2)
      }
    // 上下の口を塞ぐ。塞がないと筒の内側が見えて、ボディの裾が
    // 末広がりのラッパに見える（実測：1回目のプレビューがそれ）。
    const base = (NU + 1) * (NV + 1)
    surf(UMIN, 0, t); p[base * 3] = 0; p[base * 3 + 1] = t[1]; p[base * 3 + 2] = 0
    surf(UMAX, 0, t); p[(base + 1) * 3] = 0; p[(base + 1) * 3 + 1] = t[1]; p[(base + 1) * 3 + 2] = 0
    for (let b = 0; b < NV; b++) {
      ix.push(base, b + 1, b)
      const top = NU * (NV + 1)
      ix.push(base + 1, top + b, top + b + 1)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(p, 3))
    g.setIndex(ix)
    g.computeVertexNormals()
    return g
  }, [])
}

// ── 線分の束を細い角柱の InstancedMesh で描く ─────────────────────────
function makeBars(count) {
  const geo = new THREE.BoxGeometry(1, 1, 1)
  geo.translate(0, 0.5, 0) // +Y に 0..1 で伸びる
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial(), count)
  mesh.frustumCulled = false
  mesh.count = 0
  return mesh
}
const _o = new THREE.Object3D()
const _a = new THREE.Vector3()
const _b = new THREE.Vector3()
const _d = new THREE.Vector3()
const _up = new THREE.Vector3(0, 1, 0)
const _q = new THREE.Quaternion()
function setBars(mesh, segs, w) {
  let k = 0
  for (const [ax, ay, az, bx, by, bz] of segs) {
    _a.set(ax, ay, az); _b.set(bx, by, bz)
    _d.subVectors(_b, _a)
    const len = _d.length()
    if (!(len > 1e-9)) continue
    _q.setFromUnitVectors(_up, _d.divideScalar(len))
    _o.position.copy(_a)
    _o.quaternion.copy(_q)
    _o.scale.set(w, len, w)
    _o.updateMatrix()
    mesh.setMatrixAt(k++, _o.matrix)
  }
  mesh.count = k
  mesh.instanceMatrix.needsUpdate = true
}
const P3 = (n) => [pos[n * 3], pos[n * 3 + 1], pos[n * 3 + 2]]

export default function Scene({ onStats }) {
  const cloth = useCloth()
  const body = useBody()
  const { camera, size } = useThree()

  // 地の目（中心前）と横地（バストライン）— 網が建っている2本の軸。
  // 太さを糸より上げて、「この2本だけが与えられている」ことを絵の中で言う。
  const axisBars = useMemo(() => makeBars(2 * (NW + NJ) + 8), [])
  const edgeBars = useMemo(() => makeBars(4096), [])
  const pinRef = useRef()
  const clothRef = useRef()

  useLayoutEffect(() => {
    axisBars.material.color.set('#1B1815')
    edgeBars.material.color.set(SALMON)
  }, [axisBars, edgeBars])

  // 正投影。太さを比べる絵ではなく「どこで止まるか」の絵なので、
  // 遠近で布の目の大きさが変わると ω の地図が読めなくなる。
  useLayoutEffect(() => {
    camera.zoom = Math.min(size.width / 2.62, size.height / 1.70)
    camera.updateProjectionMatrix()
  }, [camera, size])

  useFrame(({ clock }) => {
    const qs = new URLSearchParams(window.location.search)
    const fixed = qs.get('t')
    const t = fixed !== null ? Number(fixed) : clock.getElapsedTime()
    // 布を当てはじめる1点だけが動く。型紙の「地の目をどこに置くか」にあたる。
    const u0 = 0.59 + 0.13 * Math.sin((t / 34) * Math.PI * 2)

    const r = drape(u0)
    const gb = gaussBonnet()

    // 覆えた目だけを三角形にする
    const ix = cloth.g.index.array
    let k = 0
    for (let i = -NW; i < NW; i++)
      for (let j = -NJ; j < NJ; j++) {
        if (!reach[cidx(i, j)]) continue
        const a = idx(i, j), b = idx(i + 1, j), c = idx(i, j + 1), d = idx(i + 1, j + 1)
        ix[k++] = a; ix[k++] = b; ix[k++] = c
        ix[k++] = c; ix[k++] = b; ix[k++] = d
      }
    cloth.g.index.needsUpdate = true
    cloth.g.setDrawRange(0, k)
    cloth.g.attributes.position.needsUpdate = true
    cloth.g.computeBoundingSphere()

    // 2本の軸
    const ax = []
    for (let i = -NW; i < NW; i++)
      if (alive[idx(i, 0)] && alive[idx(i + 1, 0)]) ax.push([...P3(idx(i, 0)), ...P3(idx(i + 1, 0))])
    for (let j = -NJ; j < NJ; j++)
      if (alive[idx(0, j)] && alive[idx(0, j + 1)]) ax.push([...P3(idx(0, j)), ...P3(idx(0, j + 1))])
    setBars(axisBars, ax, 0.0062)

    // 布が止まった線 — 覆えた目と覆えなかった目の境界の辺だけ
    const fr = []
    for (let i = -NW; i < NW; i++)
      for (let j = -NJ; j < NJ; j++) {
        if (!reach[cidx(i, j)]) continue
        const out = (ii, jj) =>
          ii < -NW || ii >= NW || jj < -NJ || jj >= NJ || !reach[cidx(ii, jj)]
        if (out(i + 1, j)) fr.push([...P3(idx(i + 1, j)), ...P3(idx(i + 1, j + 1))])
        if (out(i - 1, j)) fr.push([...P3(idx(i, j)), ...P3(idx(i, j + 1))])
        if (out(i, j + 1)) fr.push([...P3(idx(i, j + 1)), ...P3(idx(i + 1, j + 1))])
        if (out(i, j - 1)) fr.push([...P3(idx(i, j)), ...P3(idx(i + 1, j))])
      }
    setBars(edgeBars, fr, 0.0075)

    // 布を留めた1点
    if (pinRef.current) {
      const n = idx(0, 0)
      pinRef.current.position.set(pos[n * 3], pos[n * 3 + 1], pos[n * 3 + 2])
    }

    onStats({
      u0,
      covered: r.covered,
      okCount: r.okCount,
      locked: r.lockedCount,
      maxShear: (r.maxShear * 180) / Math.PI,
      edgeErr: r.maxEdgeErr,
      frontier: fr.length,
      gb,
    })
  })

  return (
    <group position={[0.30, -0.621, 0]}>
      <ambientLight intensity={1.55} />
      <directionalLight position={[-2.2, 3.4, 4.0]} intensity={1.15} />
      <mesh geometry={body}>
        <meshStandardMaterial color={BODY} roughness={1} metalness={0} flatShading={false} />
      </mesh>
      <mesh ref={clothRef} geometry={cloth.g} material={cloth.m} />
      <primitive object={axisBars} />
      <primitive object={edgeBars} />
      <mesh ref={pinRef}>
        <sphereGeometry args={[0.0165, 20, 16]} />
        <meshBasicMaterial color={SALMON} />
      </mesh>
    </group>
  )
}
