import { useMemo, useRef, useLayoutEffect } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { PRISMS, PALETTE, FRAME_W, SUN, sunAt } from './rig.js'

const MAXP = 16
const TERN = 10 // 掃引の帯で sdf が最小になる t を求める三分探索の反復数

// 露出。物撮りは露出を1点で決める。ここでは θ=44° の水平面が
// ちょうど albedo に写る位置に置いた（θ の中央 52° で決めると、
// 影がいちばん長くて読める低い側で展示台が灰色に沈む——1枚撮って分かった）。
// 高い側では白が少し飛ぶので、0.88 から上だけ寝かせる肩を1本入れてある。
const AMB_I = 0.34
const SUN_I = (1 - AMB_I) / Math.sin((44 * Math.PI) / 180)

// ── 影 ─────────────────────────────────────────────────────────────────
// シャドウマップは使わない。使うと「影が h·cot θ である」ことが
// 測定結果ではなく偶然になるし、接地部のボケ幅も嘘になる。
//
// 真上から見える面は必ず水平なので、受け面の高さ y_r は
// フラグメントのワールド y そのもの。そこへ角柱 j が落とす影は、
// **footprint を (Δh·cot θ)·d だけ平行移動した領域**でしかない。
// Δh は角柱の下端〜上端を y_r から測った差なので、床に立つ柱では
// 0 から h まで連続して動く＝影は物体に貼り付いたまま伸びる。
// つまり影は「平行移動の帯（掃引）」。
//
// 最初は帯を10点でサンプルして max を取った。1枚撮って見たら影の縁が
// 階段状に見えた——帯を離散化すると、**装置が生む連続量を10段に量子化した絵**に
// なる。刻みを増やすのは負けなので、代わりに閉じた形で解く：
// sdf は凸、t ↦ q−t·d はアフィンなので、合成 f(t)=sdf(q−t·d) は t について凸。
// 凸なら三分探索が使える。10反復＝20評価で、階段は消えて縁は真の包絡線になる。
// おまけに、最小を与える t* がそのまま「その点に影を落とした高さ」なので、
// 半影幅 w = 2·tanα·Δh/sinθ を**その点ごとに正しく**決められる
// （＝接地点は必ずシャープ、天辺の影はいちばんボケる）。
const FRAG = /* glsl */ `
precision highp float;

varying vec3 vWPos;
varying vec3 vWNrm;

uniform vec4  uA[${MAXP}];   // box:(cx,cz, ex, ez>=0) / cyl:(cx,cz, r, -1)
uniform vec4  uB[${MAXP}];   // (y0, y1, 0, 0)
uniform int   uCount;
uniform vec2  uDir;          // 影の進む向き（単位・xz）
uniform vec3  uL;            // 面 → 光源
uniform float uCot;
uniform float uSin;
uniform float uPen;          // 2*tan(alpha)
uniform vec3  uAlbedo;
uniform vec3  uAmb;          // 天空光（地の青を混ぜてある）
uniform vec3  uSunCol;
uniform float uGround;       // 1 = ホリゾント（falloff と紙目を乗せる）
uniform float uTime;

float sdBox2(vec2 p, vec2 b){ vec2 d = abs(p) - b; return min(max(d.x, d.y), 0.0) + length(max(d, 0.0)); }

float sdSeg(vec2 p, vec2 a, vec2 b){
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-9), 0.0, 1.0);
  return length(pa - ba * h);
}

float footprint(vec4 A, vec2 q){
  return (A.w >= 0.0) ? sdBox2(q - A.xy, A.zw) : (length(q - A.xy) - A.z);
}

// interleaved gradient noise — 紙目に使う
float ign(vec2 p){ return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }

float shadowAt(vec3 p){
  float yr = p.y;
  float s  = 0.0;
  for (int j = 0; j < ${MAXP}; j++) {
    if (j >= uCount) break;
    vec4 A = uA[j];
    vec4 B = uB[j];
    float y0 = max(B.x, yr);
    float y1 = B.y;
    if (y1 <= y0 + 1e-5) continue;           // 受け面より上に何も無い＝影を落とせない

    float t0 = (y0 - yr) * uCot;             // ← 装置。帯の両端はこの2つ
    float t1 = (y1 - yr) * uCot;
    float Rb = (A.w >= 0.0) ? length(A.zw) : A.z;
    float wmax = uPen * (y1 - yr) / uSin;
    // 芯線から離れすぎている点は 20 評価を丸ごと飛ばす
    if (sdSeg(p.xz - A.xy, uDir * t0, uDir * t1) > Rb + wmax + 2e-3) continue;

    float lo = t0, hi = t1;
    for (int it = 0; it < ${TERN}; it++) {
      float m1 = lo + (hi - lo) / 3.0;
      float m2 = hi - (hi - lo) / 3.0;
      if (footprint(A, p.xz - uDir * m1) < footprint(A, p.xz - uDir * m2)) hi = m2; else lo = m1;
    }
    float tm = 0.5 * (lo + hi);
    float sd = footprint(A, p.xz - uDir * tm);
    float dh = tm / max(uCot, 1e-4);          // その点に影を落とした高さ
    float w  = max(uPen * dh / uSin, 3.0e-4); // 半影はその高さでだけ決まる
    s = max(s, smoothstep(0.5 * w, -0.5 * w, sd));
    if (s > 0.998) return 1.0;
  }
  return s;
}

void main(){
  vec3 N = normalize(vWNrm);
  vec3 P = vWPos + N * 3.0e-4;

  float sh  = shadowAt(P);
  float ndl = max(dot(N, uL), 0.0);

  vec3 alb = uAlbedo;
  if (uGround > 0.5) {
    // ホリゾントの落ち。入隅を作らずに面の端を沈ませる唯一の手。
    float r = length(vWPos.xz * vec2(0.62, 1.0));
    alb *= 1.0 - 0.135 * r * r;
  }

  vec3 col = alb * (uAmb + uSunCol * ndl * (1.0 - sh));
  col = col / (1.0 + max(col - 0.88, 0.0));   // 肩

  // 紙目。ベタ面を印画紙の側に引き戻すための、ごく薄い粒子。
  float g = ign(gl_FragCoord.xy + vec2(uTime * 37.0, uTime * 19.0)) - 0.5;
  col += g * 0.0125;

  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`

const VERT = /* glsl */ `
varying vec3 vWPos;
varying vec3 vWNrm;
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWPos = wp.xyz;
  vWNrm = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`

// 🔴 `new THREE.Color('#…')` は ColorManagement が有効なら**その場でリニアにする**。
// ここでさらに convertSRGBToLinear() を呼ぶと二重に落ちる。1枚撮って
// 「白い展示台が灰色・地の青が沈む」で気づいた。構築するだけでいい。
const lin = (hex) => new THREE.Color(hex)

function buildUniforms(albedo, isGround) {
  const A = Array.from({ length: MAXP }, () => new THREE.Vector4(0, 0, 0, 0))
  const B = Array.from({ length: MAXP }, () => new THREE.Vector4(0, 0, 0, 0))
  PRISMS.forEach((p, i) => {
    if (p.kind === 'box') A[i].set(p.x, p.z, p.ex, p.ez)
    else A[i].set(p.x, p.z, p.r, -1)
    B[i].set(p.y0, p.y1, 0, 0)
  })
  return {
    uA: { value: A },
    uB: { value: B },
    uCount: { value: PRISMS.length },
    uDir: { value: new THREE.Vector2(1, 0) },
    uL: { value: new THREE.Vector3(0, 1, 0) },
    uCot: { value: 1 },
    uSin: { value: 1 },
    uPen: { value: 2 * Math.tan((SUN.alpha * Math.PI) / 180) },
    uAlbedo: { value: lin(albedo) },
    uAmb: {
      value: new THREE.Color(1, 1, 1).lerp(lin(PALETTE.ground), 0.55).multiplyScalar(AMB_I),
    },
    uSunCol: { value: new THREE.Color(1.04, 1.02, 0.985).multiplyScalar(SUN_I) },
    uGround: { value: isGround ? 1 : 0 },
    uTime: { value: 0 },
  }
}

function Fit() {
  const { camera, size } = useThree()
  useLayoutEffect(() => {
    camera.zoom = size.width / FRAME_W
    camera.up.set(0, 0, -1)
    camera.position.set(0, 3, 0)
    camera.lookAt(0, 0, 0)
    camera.updateProjectionMatrix()
  }, [camera, size])
  return null
}

export default function Scene({ readout }) {
  const groundMat = useMemo(() => {
    const u = buildUniforms(PALETTE.ground, true)
    return new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: u })
  }, [])

  const riserMat = useMemo(() => {
    const u = buildUniforms(PALETTE.riser, false)
    return new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: u })
  }, [])

  const frozen = useRef(null)
  if (frozen.current === null) {
    const q = new URLSearchParams(window.location.search).get('t')
    frozen.current = q === null ? NaN : Number(q)
  }

  useFrame((state) => {
    const t = Number.isNaN(frozen.current) ? state.clock.elapsedTime : frozen.current
    const s = sunAt(t)
    for (const m of [groundMat, riserMat]) {
      const u = m.uniforms
      u.uDir.value.set(s.dir[0], s.dir[1])
      u.uL.value.set(s.L[0], s.L[1], s.L[2])
      u.uCot.value = s.cot
      u.uSin.value = s.sin
      u.uTime.value = t
    }
    readout.current?.(s)
  })

  return (
    <>
      <Fit />
      <mesh position={[0, -0.0012, 0]} rotation={[-Math.PI / 2, 0, 0]} material={groundMat}>
        <planeGeometry args={[4, 4]} />
      </mesh>
      {PRISMS.map((p) => {
        const h = p.y1 - p.y0
        const y = (p.y0 + p.y1) / 2
        return p.kind === 'box' ? (
          <mesh key={p.id} position={[p.x, y, p.z]} material={riserMat}>
            <boxGeometry args={[p.ex * 2, h, p.ez * 2]} />
          </mesh>
        ) : (
          <mesh key={p.id} position={[p.x, y, p.z]} material={riserMat}>
            <cylinderGeometry args={[p.r, p.r, h, 96]} />
          </mesh>
        )
      })}
    </>
  )
}
