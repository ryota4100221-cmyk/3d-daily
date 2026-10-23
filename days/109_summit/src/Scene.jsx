import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { SimplexNoise } from 'three/examples/jsm/math/SimplexNoise.js'

// ── 高さ場 ───────────────────────────────────────────────
// 角錐に近い峰（稜線＝角度方向の cos で張り出させる）＋ リッジ fBm の侵食筋。
// CPU で1回だけ頂点に焼く（法線も頂点から取るので、稜線の向きが絵と一致する）
function mulberry(a) {
  return { random: () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }
}
const SN = new SimplexNoise(mulberry(109))
let GUL = 0 // 直前に評価した点の溝の深さ（0〜1）。頂点属性に焼いて岩を溝に出す
// 色は sRGB のまま uniform に渡す（ShaderMaterial は出力で変換しないので、入口でも変換させない）。
// ColorManagement を切っても R3F の Canvas が作成時に入れ直すので、色ごとに「線形として」16進を置く
const C = (hex) => new THREE.Color().setHex(parseInt(hex.slice(1), 16), THREE.LinearSRGBColorSpace)

function ridged(x, z, oct) {
  let a = 0.5, f = 1, s = 0, w = 1
  for (let i = 0; i < oct; i++) {
    let n = 1 - Math.abs(SN.noise(x * f, z * f))
    n *= n
    n *= w
    w = Math.min(1, Math.max(0, n * 1.6))
    s += n * a
    a *= 0.5
    f *= 2.07
  }
  return s
}

// 1つの峰＝角錐。面ごとに向きと勾配を持たせ、面同士の境目（滑らかな max）が尾根＝アレートになる。
// 面の上には「その面の落ちる向き」に沿った溝を刻む（傘の骨のような放射状にしない）
function peak(x, z, p) {
  // 座標を低周波で歪ませる＝面が折れ、輪郭がまっすぐな三角にならない
  const w = p.warp ?? 0.06
  const wx = SN.noise(x * 0.09 + 31, z * 0.09) * w * p.h
  const wz = SN.noise(x * 0.09, z * 0.09 + 47) * w * p.h
  const dx = x - p.x + wx, dz = z - p.z + wz
  const K = (p.soft || 0.45) * (0.12 + Math.min(1, Math.hypot(dx, dz) / (p.h * 0.6)))
  let sum = 0, best = -1e9, bi = 0
  const vals = p.faces.map(([deg, sl], i) => {
    const a = (deg * Math.PI) / 180
    const v = sl * (dx * Math.cos(a) + dz * Math.sin(a))
    if (v > best) { best = v; bi = i }
    return v
  })
  for (const v of vals) sum += Math.exp((v - best) / K)
  const drop = best + K * Math.log(sum)
  const u = Math.max(0, drop) / p.h
  if (u >= 1) return -2
  const base = p.h * Math.pow(1 - u, p.k)
  // 溝：主な面の落ちる向き（along）に長く、横（perp）に細かい
  const a = (p.faces[bi][0] * Math.PI) / 180
  const along = dx * Math.cos(a) + dz * Math.sin(a)
  const perp = -dx * Math.sin(a) + dz * Math.cos(a)
  const s = p.seed || 0
  const gs = p.gscale || 1
  const g1 = Math.abs(SN.noise(perp * 0.55 * gs + s, along * 0.12 * gs + s))
  const g2 = Math.abs(SN.noise(perp * 1.5 * gs - s, along * 0.3 * gs + 2 * s))
  const g3 = Math.abs(SN.noise(perp * 4.0 * gs + 3 * s, along * 0.7 * gs - s))
  const gul = (1 - Math.min(1, g1 * 3.0)) * 0.75 + (1 - Math.min(1, g2 * 3.0)) * 0.2 + (1 - Math.min(1, g3 * 3.0)) * 0.08
  const fade = Math.min(1, u * 12.0) * Math.pow(1 - u, 2.2)
  // 溝は面の一部に集まる（全面に均一に刻まない）
  const mask = Math.min(1, Math.max(0, SN.noise(perp * 0.12 + 11 + s, along * 0.05) * 1.4 + 0.35))
  // 手前の峰：細かい岩の起伏（稜線を欠けさせる）
  const rough = p.rough ? (ridged(x * 0.75 + s, z * 0.75, 4) - 0.55) * p.rough * Math.pow(1 - u, 0.6) : 0
  const gd = gul * fade * (0.25 + 0.75 * mask)
  if (base > -1) GUL = Math.max(GUL, gd)
  return base - gd * (p.gully || 1.1) + rough
}

export const PEAKS = [
  // 主峰：右寄り。手前左の面はゆるく広く（光が当たる）、手前右の面は急で影
  { x: 7.4, z: 0, h: 17.2, k: 1.6, seed: 2.3, gully: 1.7, warp: 0.09, faces: [[175, 0.6], [135, 0.78], [72, 1.05], [5, 0.95], [-60, 0.9], [-130, 0.85]] },
  // 頂のすぐ左下の肩（輪郭の段）
  { x: 1.2, z: 1.5, h: 13.6, k: 1.4, seed: 6.2, gully: 1.3, warp: 0.12, faces: [[175, 0.75], [120, 0.9], [60, 1.2], [-40, 1.0], [-140, 0.9]] },
  // 主峰の左肩（頂から左下へ落ちる長い尾根の途中のこぶ）
  { x: -4.5, z: 3, h: 7.5, k: 1.3, seed: 3.3, gully: 0.9, faces: [[150, 0.7], [60, 1.0], [-40, 0.9], [-160, 0.8]] },
  // 主峰の右の副峰（奥）
  { x: 18.5, z: -7, h: 12.4, k: 1.4, seed: 4.4, gully: 1.4, warp: 0.13, faces: [[120, 1.0], [20, 0.8], [-80, 0.9], [-170, 0.9]] },
  // 左奥の第2峰（霞む）
  { x: -30, z: -95, h: 23, k: 1.7, seed: 5.1, gully: 1.6, faces: [[165, 1.0], [40, 1.1], [-90, 0.9]] },
  // 左中段の低い稜線
  { x: -24, z: -14, h: 6.4, k: 1.2, seed: 7.7, gully: 0.7, faces: [[100, 0.75], [-80, 0.75], [10, 0.35], [175, 0.45]] },
  // 右下の手前岩峰
  { x: 10.6, z: 31, h: 5.6, k: 1.3, seed: 9.4, gully: 1.5, gscale: 3.4, warp: 0.16, rough: 0.3, faces: [[165, 1.15], [110, 1.3], [35, 1.45], [-60, 1.0]] },
]

function heightAt(x, z, list) {
  let h = -2
  for (const p of list) {
    const ph = peak(x, z, p)
    // 滑らかな max（峰同士の谷を丸める）
    const k = 1.2, hh = Math.max(k - Math.abs(h - ph), 0) / k
    h = Math.max(h, ph) + hh * hh * k * 0.25
  }
  // 侵食：高いところほど筋が深い。斜面に沿った筋に見えるよう x を伸ばす
  const e = ridged(x * 0.12, z * 0.12, 3)
  const fine = ridged(x * 0.9 + 3.1, z * 0.9 - 7.7, 4)
  const t = Math.min(1, Math.max(0, (h + 1) / 8))
  return h - (1 - e) * 0.35 * t - (1 - fine) * 0.06 * t
}

function makeTerrain(x0, x1, z0, z1, nx, nz, list) {
  const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0, nx, nz)
  g.rotateX(-Math.PI / 2)
  g.translate((x0 + x1) / 2, 0, (z0 + z1) / 2)
  const pos = g.attributes.position
  const gul = new Float32Array(pos.count)
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i)
    // 縁で高さを落とす（切れ端の壁を見せない）
    const ex = Math.min(x - x0, x1 - x) / (x1 - x0), ez = Math.min(z - z0, z1 - z) / (z1 - z0)
    const wgt = Math.min(1, Math.min(ex, ez) / 0.08)
    GUL = 0
    const hgt = heightAt(x, z, list)
    gul[i] = GUL
    pos.setY(i, -6 + (hgt + 6) * wgt * wgt * (3 - 2 * wgt))
  }
  g.setAttribute('aGul', new THREE.BufferAttribute(gul, 1))
  g.computeVertexNormals()
  return g
}

const NOISE = /* glsl */ `
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857; vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z); vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0; vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0); m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
float fbm(vec3 p){ float a=0.5,s=0.0; for(int i=0;i<5;i++){ s+=a*snoise(p); p=p*2.02+vec3(1.7,9.2,3.1); a*=0.5;} return s; }
`

// 霧：雲海の上面（cloudTop）より下は雲の色へ、遠いほど空の色へ。色は sRGB のまま書く（ShaderMaterial は変換しない）
const FOG = /* glsl */ `
uniform float uCloudTop;
uniform vec3 uHaze;
uniform vec3 uCloud;
vec3 applyFog(vec3 col, vec3 wp, float dist){
  float top = uCloudTop - max(0.0, wp.z - 8.0) * 0.26;
  float hf = smoothstep(top + 2.2, top - 3.0, wp.y);
  float df = 1.0 - exp(-max(0.0, dist - 40.0) * 0.024);
  col = mix(col, uHaze, df);
  col = mix(col, uCloud, hf);
  return col;
}
`

function terrainMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uCloudTop: { value: 7.0 },
      uHaze: { value: C('#dde4ea') },
      uCloud: { value: C('#edf6fa') },
    },
    vertexShader: /* glsl */ `
      attribute float aGul;
      varying vec3 vW; varying vec3 vN; varying float vGul;
      void main(){
        vGul = aGul;
        vec4 w = modelMatrix * vec4(position,1.0);
        vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      ${NOISE}
      ${FOG}
      varying vec3 vW; varying vec3 vN; varying float vGul;
      void main(){
        vec3 N = normalize(vN);
        // 細かい雪面の凹凸：法線をノイズの勾配で少しだけ揺らす
        float e = 0.06;
        vec3 q = vW * 2.4;
        float n0 = snoise(q), nx = snoise(q + vec3(e,0,0)), nz = snoise(q + vec3(0,0,e));
        float near = smoothstep(18.0, 30.0, vW.z);
        N = normalize(N + vec3(n0 - nx, 0.0, n0 - nz) * mix(0.25, 0.5, near));
        float slope = 1.0 - N.y;
        // 岩が見えるのは急な面だけ。縦の筋になるよう y を詰めたノイズで切る
        float rockN = snoise(vec3(vW.x * 1.3, vW.y * 4.0, vW.z * 1.3)) * 0.5 + 0.5;
        float rth = mix(0.46, 0.2, smoothstep(14.0, 28.0, vW.z));
        float rock = smoothstep(rth - 0.22, rth, slope + (rockN - 0.5) * 0.12) * smoothstep(0.03, 0.15, vGul + (rockN - 0.5) * 0.06);
        vec3 L = normalize(vec3(-0.9, 0.42, 0.35));
        float d = dot(N, L) * 1.0 + 0.32;          // 曇天の回り込み（少なめ＝面の差を出す）
        d = smoothstep(0.0, 1.0, clamp(d, 0.0, 1.0));
        vec3 snowLit = vec3(0.95, 0.985, 1.0);
        vec3 snowSh  = vec3(0.52, 0.64, 0.73);
        vec3 col = mix(snowSh, snowLit, d);
        vec3 rockC = mix(vec3(0.40, 0.48, 0.54), vec3(0.58, 0.65, 0.70), d);
        col = mix(col, rockC, rock * 0.75);
        // 手前の岩峰：青灰に沈め、細かい粒の明暗
        float grain = snoise(vW * 14.0) * 0.5 + snoise(vW * 31.0) * 0.5;
        col = mix(col, col * vec3(0.8, 0.86, 0.9) * (1.0 + grain * 0.08), near * 0.85);
        float dist = length(vW - cameraPosition);
        col = applyFog(col, vW, dist);
        gl_FragColor = vec4(col, 1.0);
      }`,
  })
}

// 雲の板：奥行き方向に重ねる。上の縁は fBm で千切れ、下は詰まる
function cloudMaterial(seed, top, soft, tint, alpha) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uT: { value: 0 }, uSeed: { value: seed }, uTop: { value: top }, uSoft: { value: soft }, uTint: { value: C(tint) }, uA: { value: alpha } },
    vertexShader: /* glsl */ `
      varying vec3 vW; varying vec2 vUv;
      void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
      ${NOISE}
      uniform float uT, uSeed, uTop, uSoft, uA; uniform vec3 uTint;
      varying vec3 vW; varying vec2 vUv;
      void main(){
        vec3 p = vec3(vW.x * 0.045 + uT * 0.012 + uSeed, vW.y * 0.085, uSeed * 1.7 + uT * 0.006);
        float n = fbm(p) * 0.5 + 0.5;
        float m = fbm(p * 2.3 + 4.0) * 0.5 + 0.5;
        float edge = uTop + (n - 0.5) * 8.0;
        // 塊：高さの勾配に 2D の fBm を足して、縁を丸い瘤にする
        vec2 q = vec2(vW.x * 0.042 + uT * 0.02 + uSeed * 3.0, vW.y * 0.065);
        float puff = fbm(vec3(q, uSeed)) ;
        float dens = (edge - vW.y) / uSoft + puff * 2.2 + (m - 0.5) * 1.2;
        float a = smoothstep(-0.3, 0.9, dens);
        a *= smoothstep(0.0, 0.12, vUv.x) * smoothstep(1.0, 0.88, vUv.x);
        // 陰影：瘤の上側は明るく、密度が増す内側と下側を青灰に
        float up = fbm(vec3(q + vec2(0.0, 0.06), uSeed)) - puff;
        float shade = clamp(0.55 + up * 6.0 + smoothstep(-2.0, 2.0, (vW.y - edge) / uSoft) * 0.35, 0.0, 1.0);
        vec3 col = mix(uTint * vec3(0.915, 0.94, 0.955), min(vec3(1.0), uTint * 1.03), shade);
        gl_FragColor = vec4(col, a * uA);
      }`,
  })
}

const CLOUDS = [
  // z, 上面の高さ, 柔らかさ, 色, 不透明度
  [-110, 11.5, 3.0, '#e6ecf0', 0.75],
  [-60, 9.0, 2.6, '#edf2f6', 0.8],
  [-30, 9.5, 2.4, '#f0f6f9', 0.75],
  [-12, 9.0, 2.2, '#f3f9fc', 0.8],
  [-3, 9.0, 2.0, '#f2faff', 0.95],
  [4, 7.6, 2.0, '#f2faff', 0.95],
  [12, 5.6, 2.0, '#f2f8fb', 0.75],
  [26, 3.2, 2.2, '#eef4f7', 0.85],
  [36, 1.2, 2.0, '#e6eef2', 0.9],
]

// 空の上の重い雲：灰のむらを上ほど濃く（再現元の上端 #9CA7B0）
function skyMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uT: { value: 0 }, uTint: { value: C('#9aa6b0') } },
    vertexShader: /* glsl */ `
      varying vec3 vW;
      void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
      ${NOISE}
      uniform float uT; uniform vec3 uTint;
      varying vec3 vW;
      void main(){
        vec3 p = vec3(vW.x * 0.012 + uT * 0.004, vW.y * 0.02, 3.0 + uT * 0.002);
        float n = fbm(p) * 0.5 + 0.5;
        float m = fbm(p * 2.7 + 9.0) * 0.5 + 0.5;
        float a = smoothstep(0.35, 0.8, n * 0.8 + m * 0.35) * smoothstep(20.0, 62.0, vW.y);
        vec3 col = mix(uTint * 0.92, min(vec3(1.0), uTint * 1.35), smoothstep(0.3, 0.8, m));
        gl_FragColor = vec4(col, a * 0.45);
      }`,
  })
}

export default function Scene() {
  const { camera } = useThree()
  const mats = useRef([])
  const terrain = useMemo(() => {
    const main = makeTerrain(-14, 30, -22, 18, 720, 660, [PEAKS[0], PEAKS[1], PEAKS[2], PEAKS[3], PEAKS[5]])
    const right = makeTerrain(4, 26, 22, 42, 440, 400, [PEAKS[6]])
    const far = makeTerrain(-75, 10, -135, -55, 480, 420, [PEAKS[4]])
    const left = makeTerrain(-50, -14, -34, 4, 380, 400, [PEAKS[5]])
    return { main, right, far, left, mat: terrainMaterial() }
  }, [])
  const sky = useMemo(() => skyMaterial(), [])
  const clouds = useMemo(() => CLOUDS.map(([z, top, soft, tint, a], i) => ({ z, mat: cloudMaterial(i * 3.7 + 1.3, top, soft, tint, a) })), [])

  useMemo(() => {
    camera.position.set(0, 6.0, 62)
    camera.lookAt(0, 8.6, 0)
    camera.updateProjectionMatrix()
  }, [camera])

  useFrame((_, dt) => {
    for (const c of clouds) c.mat.uniforms.uT.value += dt
    sky.uniforms.uT.value += dt
  })

  return (
    <group>
      <mesh position={[0, 40, -220]} material={sky} renderOrder={-1}>
        <planeGeometry args={[600, 90, 1, 1]} />
      </mesh>
      <mesh geometry={terrain.far} material={terrain.mat} />
      <mesh geometry={terrain.left} material={terrain.mat} />
      <mesh geometry={terrain.main} material={terrain.mat} />
      <mesh geometry={terrain.right} material={terrain.mat} />
      {!location.search.includes('noclouds') && clouds.map((c, i) => (
        <mesh key={i} position={[0, -6, c.z]} material={c.mat} renderOrder={i}>
          <planeGeometry args={[220, 40, 1, 1]} />
        </mesh>
      ))}
    </group>
  )
}
