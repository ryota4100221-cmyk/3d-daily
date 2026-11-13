import React, { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { EffectComposer, Bloom, Noise, Vignette } from '@react-three/postprocessing'

// ---------------------------------------------------------------- 共通
const rand = (() => { let s = 118; return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646 } })()
const FOG = '#3E2256'

// 水の形（池の円＋手前へ続く水路＋左の小さな溜まり）。GLSL と JS で同じ式
const WATER_GLSL = /* glsl */`
float waterMask(vec2 p){
  float d = length(p) - 3.2;
  float ch = max(abs(p.x) - (1.25 + 0.05 * p.y), max(-p.y, p.y - 16.0));
  float lp = length((p - vec2(-2.4, 3.3)) * vec2(1.0, 1.25)) - 1.1;
  return min(min(d, ch), lp);
}`
function waterMask(x, z) {
  const d = Math.hypot(x, z) - 3.2
  const ch = Math.max(Math.abs(x) - (1.25 + 0.05 * z), Math.max(-z, z - 16))
  const lp = Math.hypot(x + 2.4, (z - 3.3) * 1.25) - 1.1
  return Math.min(d, ch, lp)
}

// ---------------------------------------------------------------- 粒の球と、その水面の反射
const MOTE_VS = /* glsl */`
  attribute vec3 aColor; attribute float aSize; attribute float aSeed;
  uniform float uTime; uniform float uScale; uniform float uMirror; uniform vec3 uCenter; uniform float uSpin; uniform vec3 uTint;
  varying vec3 vColor; varying float vAlpha; varying float vSeed;
  ${WATER_GLSL}
  void main(){
    vec3 p = position;
    float a = uTime * uSpin;
    p.xz = mat2(cos(a), -sin(a), sin(a), cos(a)) * p.xz;
    p *= 1.0 + 0.015 * sin(uTime * 0.8 + aSeed * 6.28);
    p += 0.02 * vec3(sin(uTime * 0.7 + aSeed * 40.0), cos(uTime * 0.6 + aSeed * 31.0), sin(uTime * 0.5 + aSeed * 17.0));
    vec3 w = uCenter + p;
    vAlpha = 0.65 + 0.35 * sin(uTime * 1.3 + aSeed * 50.0);
    float size = aSize;
    if (uMirror > 0.5) {
      w.y = -w.y;
      vec3 cam = cameraPosition;
      float t = cam.y / (cam.y - w.y);
      vec3 hit = cam + t * (w - cam);
      float m = waterMask(hit.xz);
      // 水面の揺れ：交点の奥行きで横にずらす
      float rip = sin(hit.z * 7.0 + uTime * 1.6) * 0.6 + sin(hit.z * 15.0 - uTime * 2.3 + hit.x * 2.0) * 0.4;
      w.x += rip * 0.09 * (t * 1.0);
      vAlpha *= (m < 0.0 ? 1.0 : 0.0) * smoothstep(0.0, -0.25, m) * 0.9;
      size *= 1.7;
    }
    vec4 mv = modelViewMatrix * vec4(w, 1.0);
    gl_Position = projectionMatrix * mv;
    if (uMirror > 0.5) {
      vec3 cam = cameraPosition;
      vec3 hit = cam + (cam.y / (cam.y - w.y)) * (w - cam);
      vec4 ch = projectionMatrix * viewMatrix * vec4(hit, 1.0);
      gl_Position.z = (ch.z / ch.w) * gl_Position.w;
    }
    gl_PointSize = size * uScale / -mv.z;
    vColor = aColor; vSeed = aSeed;
  }`
const MOTE_FS = /* glsl */`
  uniform float uMirror; uniform vec3 uTint;
  varying vec3 vColor; varying float vAlpha; varying float vSeed;
  void main(){
    vec2 c = gl_PointCoord - 0.5;
    float a;
    if (uMirror > 0.5) {
      if (abs(c.y) > 0.11) discard;
      a = smoothstep(0.5, 0.25, abs(c.x));
    } else {
      float an = vSeed * 6.2831;
      vec2 q = mat2(cos(an), -sin(an), sin(an), cos(an)) * c;
      float d = length(q / vec2(0.5, 0.33));
      a = exp(-d * d * 3.5) * 1.6;
    }
    vec3 col = uMirror > 0.5 ? vColor * uTint : vColor;
    gl_FragColor = vec4(col * a * vAlpha, 1.0);
  }`

function Motes({ count, center, radius, pow, palette, size, spin = 0.04, halo = 0.0, squash = [1, 1, 1], tilt = 0, tint = [0.75, 0.38, 1.25] }) {
  const { gl, size: vp } = useThree()
  const geo = useMemo(() => {
    const pos = new Float32Array(count * 3), col = new Float32Array(count * 3), sz = new Float32Array(count), sd = new Float32Array(count)
    const pal = palette.map(([hex, w, k]) => [new THREE.Color(hex), w, k ?? 1])
    const tot = pal.reduce((s, p) => s + p[1], 0)
    for (let i = 0; i < count; i++) {
      const u = rand(), v = rand()
      const th = 2 * Math.PI * u, ph = Math.acos(2 * v - 1)
      let r = radius * Math.pow(rand(), pow)
      if (rand() < halo) r = radius * (0.95 + Math.pow(rand(), 1.6) * 0.5)
      pos[i * 3] = r * Math.sin(ph) * Math.cos(th) * squash[0]
      pos[i * 3 + 1] = r * Math.cos(ph) * squash[1]
      pos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th) * squash[2]
      if (tilt) { const x = pos[i * 3], y = pos[i * 3 + 1]; pos[i * 3] = x * Math.cos(tilt) - y * Math.sin(tilt); pos[i * 3 + 1] = x * Math.sin(tilt) + y * Math.cos(tilt) }
      let q = rand() * tot, pick = pal[0]
      for (const p of pal) { if ((q -= p[1]) <= 0) { pick = p; break } }
      const br = (0.15 + 0.21 * rand()) * pick[2]
      col[i * 3] = pick[0].r * br; col[i * 3 + 1] = pick[0].g * br; col[i * 3 + 2] = pick[0].b * br
      sz[i] = size * (0.5 + rand() * 1.0)
      sd[i] = rand()
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('aColor', new THREE.BufferAttribute(col, 3))
    g.setAttribute('aSize', new THREE.BufferAttribute(sz, 1))
    g.setAttribute('aSeed', new THREE.BufferAttribute(sd, 1))
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1000)
    return g
  }, [count, radius, pow, size, halo])
  const mats = useMemo(() => [0, 1].map(m => new THREE.ShaderMaterial({
    vertexShader: MOTE_VS, fragmentShader: MOTE_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uScale: { value: 1 }, uMirror: { value: m }, uCenter: { value: new THREE.Vector3(...center) }, uSpin: { value: spin }, uTint: { value: new THREE.Vector3(...tint) } },
  })), [])
  useFrame(({ clock }) => {
    const s = vp.height * gl.getPixelRatio() / (2 * Math.tan(THREE.MathUtils.degToRad(45) / 2))
    for (const m of mats) { m.uniforms.uTime.value = clock.elapsedTime + 20; m.uniforms.uScale.value = s }
  })
  return <>
    <points geometry={geo} material={mats[0]} frustumCulled={false} />
    <points geometry={geo} material={mats[1]} frustumCulled={false} renderOrder={3} />
  </>
}

// ---------------------------------------------------------------- 空・星・雲
function Sky() {
  const mat = useMemo(() => new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {},
    vertexShader: `varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `varying vec3 vD; void main(){
      float y = vD.y;
      vec3 top = vec3(0.075, 0.035, 0.2);
      vec3 mid = vec3(0.1, 0.05, 0.21);
      vec3 hor = vec3(0.22, 0.12, 0.30);
      vec3 c = mix(hor, mid, smoothstep(0.0, 0.12, y));
      c = mix(c, top, smoothstep(0.1, 0.45, y));
      c += vec3(0.1, 0.04, 0.1) * smoothstep(0.2, -0.9, vD.x) * smoothstep(0.6, 0.1, y);
      gl_FragColor = vec4(pow(c, vec3(2.2)), 1.0);
    }`,
  }), [])
  const stars = useMemo(() => {
    const n = 900, p = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      const th = (rand() - 0.5) * Math.PI * 1.2 - Math.PI / 2, y = 0.08 + rand() * 0.9
      const r = Math.sqrt(1 - y * y)
      p[i * 3] = Math.cos(th) * r * 180; p[i * 3 + 1] = y * 180; p[i * 3 + 2] = Math.sin(th) * r * 180
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3)); return g
  }, [])
  return <>
    <mesh material={mat} renderOrder={-10}><sphereGeometry args={[200, 32, 16]} /></mesh>
    <points geometry={stars}><pointsMaterial size={1.3} sizeAttenuation={false} color="#B9A6D8" transparent opacity={0.55} fog={false} depthWrite={false} /></points>
  </>
}

function cloudTexture(seed) {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 256
  const g = c.getContext('2d')
  let s = seed; const r = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646 }
  for (let i = 0; i < 140; i++) {
    const x = 60 + r() * 904, y = 120 + (r() - 0.5) * 90 * (1 - Math.abs(x - 512) / 600), rad = 25 + r() * 60
    g.save(); g.translate(x, y); g.scale(2.6, 0.32)
    const gr = g.createRadialGradient(0, -rad * 0.3, 0, 0, 0, rad)
    gr.addColorStop(0, `rgba(255,255,255,${0.16 + r() * 0.2})`); gr.addColorStop(0.6, `rgba(255,255,255,${0.05 + r() * 0.06})`); gr.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = gr; g.fillRect(-rad, -rad, rad * 2, rad * 2); g.restore()
  }
  g.globalCompositeOperation = 'destination-in'
  const m = g.createLinearGradient(0, 0, 1024, 0)
  m.addColorStop(0, 'rgba(0,0,0,0)'); m.addColorStop(0.22, 'rgba(0,0,0,1)'); m.addColorStop(0.78, 'rgba(0,0,0,1)'); m.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = m; g.fillRect(0, 0, 1024, 256)
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t
}
function Clouds() {
  const items = useMemo(() => [
    [-38, 10, -90, 70, 1, '#6E4E8C', 0.75], [30, 9, -95, 80, 2, '#6A4A86', 0.7], [-5, 14, -110, 70, 3, '#4E3470', 0.5],
    [55, 13, -100, 50, 4, '#5A3C78', 0.5], [-70, 7, -80, 60, 5, '#6E4E8C', 0.6],
  ].map(([x, y, z, w, s, col, op]) => ({ x, y, z, w, tex: cloudTexture(s * 977 + 3), col, op })), [])
  return items.map((c, i) => (
    <mesh key={i} position={[c.x, c.y, c.z]} renderOrder={-5}>
      <planeGeometry args={[c.w, c.w / 4]} />
      <meshBasicMaterial map={c.tex} color={c.col} transparent opacity={c.op * 0.75} depthWrite={false} fog={false} />
    </mesh>
  ))
}

// ---------------------------------------------------------------- 山・岩
// 稜線の桃色のリム：法線が上を向くほど、また高い所ほど桃を足す
const rimTop = (sh) => {
  sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vH;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvH = position.y;')
  sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vH;').replace('#include <dithering_fragment>', '#include <dithering_fragment>\ngl_FragColor.rgb += vec3(0.14, 0.035, 0.1) * smoothstep(1.5, 5.0, vH);')
}
function Mountains() {
  const list = useMemo(() => {
    const out = []
    for (let i = 0; i < 26; i++) {
      const ang = -Math.PI / 2 + (i / 25 - 0.5) * 2.6 + (rand() - 0.5) * 0.08
      const d = 55 + rand() * 30
      out.push({ p: [Math.cos(ang) * d, -1, Math.sin(ang) * d], r: 10 + rand() * 16, h: 4 + rand() * 11, seg: 6 + Math.floor(rand() * 2), rot: rand() * 6, col: '#3E2858' })
    }
    for (let i = 0; i < 16; i++) {
      const ang = -Math.PI / 2 + (i / 15 - 0.5) * 2.4 + (rand() - 0.5) * 0.1
      const d = 32 + rand() * 12
      out.push({ p: [Math.cos(ang) * d, -1, Math.sin(ang) * d], r: 4 + rand() * 6, h: 3 + rand() * 6, seg: 4 + Math.floor(rand() * 2), rot: rand() * 6, col: '#33204A' })
    }
    out.push({ p: [16, -1, -70], r: 16, h: 24, seg: 5, rot: 0.3, col: '#7A4A92' })
    for (let i = 0; i < 14; i++) {
      const ang = -Math.PI / 2 + (i / 13 - 0.5) * 2.4
      const d = 110 + rand() * 20
      out.push({ p: [Math.cos(ang) * d, -1, Math.sin(ang) * d], r: 20 + rand() * 14, h: 14 + rand() * 10, seg: 6, rot: rand() * 6, col: '#4A3466' })
    }
    return out
  }, [])
  return list.map((m, i) => (
    <mesh key={i} position={m.p} rotation={[0, m.rot, 0]}>
      <coneGeometry args={[m.r, m.h, m.seg, 1]} />
      <meshStandardMaterial color={m.col} flatShading roughness={1} onBeforeCompile={rimTop} />
    </mesh>
  ))
}

// ---------------------------------------------------------------- 地面・草・水
function Ground() {
  const mat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: { uFog: { value: new THREE.Color(FOG) } },
    vertexShader: `varying vec3 vW; varying float vD; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; vec4 mv = viewMatrix * w; vD = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 uFog; varying vec3 vW; varying float vD;
      float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
      void main(){
        vec3 c = vec3(0.13, 0.06, 0.19);
        float glow = exp(-length(vW.xz) * 0.45);
        c += vec3(0.10, 0.04, 0.18) * glow;
        c *= 0.85 + 0.3 * h(floor(vW.xz * 6.0));
        c = mix(c, vec3(0.11, 0.06, 0.17), smoothstep(25.0, 80.0, vD));
        gl_FragColor = vec4(pow(c, vec3(2.2)), 1.0);
      }`,
  }), [])
  return <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} material={mat}><planeGeometry args={[300, 300]} /></mesh>
}

function Grass() {
  const { geo, mat, count, matrices } = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.009, 0, 0, 0.009, 0, 0, 0, 1, 0]), 3))
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array([0.016, 0.006, 0.03, 0.016, 0.006, 0.03, 0.07, 0.026, 0.12]), 3))
    const mats = []
    for (let i = 0; i < 26000; i++) {
      const x = (rand() - 0.5) * 50, z = -22 + rand() * 33
      if (waterMask(x, z) < 0.15) continue
      const h = 0.25 + rand() * 0.45
      const m = new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromEuler(new THREE.Euler((rand() - 0.5) * 0.5, rand() * 6.28, (rand() - 0.5) * 0.5)), new THREE.Vector3(1, h, 1))
      mats.push(m)
    }
    const mt = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, fog: true })
    return { geo: g, mat: mt, count: mats.length, matrices: mats }
  }, [])
  const ref = useRef()
  React.useLayoutEffect(() => { matrices.forEach((m, i) => ref.current.setMatrixAt(i, m)); ref.current.instanceMatrix.needsUpdate = true }, [])
  return <instancedMesh ref={ref} args={[geo, mat, count]} frustumCulled={false} />
}

function Water() {
  const mat = useMemo(() => new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uTime: { value: 0 } },
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform float uTime; varying vec3 vW; ${WATER_GLSL}
      void main(){
        float m = waterMask(vW.xz);
        if (m > 0.0) discard;
        vec3 c = vec3(0.075, 0.035, 0.12);
        c += vec3(0.08, 0.03, 0.16) * exp(-length(vW.xz) * 0.3);
        float rip = sin(vW.z * 9.0 + uTime * 1.5 + sin(vW.x * 3.0)) * 0.5 + 0.5;
        c += vec3(0.03, 0.01, 0.05) * rip;
        gl_FragColor = vec4(pow(c, vec3(2.2)), smoothstep(0.0, -0.12, m));
      }`,
  }), [])
  useFrame(({ clock }) => { mat.uniforms.uTime.value = clock.elapsedTime })
  return <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.0, 0]} material={mat} renderOrder={1}><planeGeometry args={[40, 40]} /></mesh>
}

// ---------------------------------------------------------------- 魔法陣
function circleTexture() {
  const S = 1024, c = document.createElement('canvas'); c.width = c.height = S
  const g = c.getContext('2d'); g.translate(S / 2, S / 2)
  g.strokeStyle = 'rgba(235,195,120,0.95)'; g.lineWidth = 3
  const ring = r => { g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.stroke() }
  ring(500); ring(470); ring(330); ring(310); ring(180); ring(120)
  g.lineWidth = 2.5
  const star = (r, n, k) => { g.beginPath(); for (let i = 0; i <= n; i++) { const a = -Math.PI / 2 + i * k * 2 * Math.PI / n; const x = Math.cos(a) * r, y = Math.sin(a) * r; i ? g.lineTo(x, y) : g.moveTo(x, y) } g.stroke() }
  star(470, 5, 2); star(310, 6, 1)
  for (let i = 0; i < 72; i++) { const a = i * Math.PI * 2 / 72; g.beginPath(); g.moveTo(Math.cos(a) * 470, Math.sin(a) * 470); g.lineTo(Math.cos(a) * (i % 6 ? 488 : 500), Math.sin(a) * (i % 6 ? 488 : 500)); g.stroke() }
  g.fillStyle = 'rgba(255,215,140,1)'
  for (let i = 0; i < 5; i++) { const a = -Math.PI / 2 + i * 2 * Math.PI / 5; g.beginPath(); g.arc(Math.cos(a) * 470, Math.sin(a) * 470, 9, 0, 7); g.fill() }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t
}
function MagicCircle() {
  const tex = useMemo(circleTexture, [])
  return <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]} renderOrder={2}>
    <planeGeometry args={[5.0, 5.0]} />
    <meshBasicMaterial map={tex} transparent opacity={0.75} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
  </mesh>
}
function GoldRing({ center, radius, rot = [0, 0, 0], op = 0.42 }) {
  const geo = useMemo(() => {
    const pts = []
    for (let i = 0; i <= 160; i++) { const a = i / 160 * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a) * radius, Math.sin(a) * radius, 0)) }
    return new THREE.BufferGeometry().setFromPoints(pts)
  }, [radius])
  return <line geometry={geo} position={center} rotation={rot}>
    <lineBasicMaterial color="#C9A060" transparent opacity={op} blending={THREE.AdditiveBlending} depthWrite={false} />
  </line>
}

// ---------------------------------------------------------------- 池の縁：蓮・蓮の葉・蝋燭
function PondLife() {
  const { lotus, pads, candles } = useMemo(() => {
    const lotus = [], pads = [], candles = []
    for (let i = 0; i < 26; i++) {
      const a = rand() * Math.PI * 2, r = 1.6 + rand() * 1.2
      const x = Math.cos(a) * r, z = Math.sin(a) * r
      if (waterMask(x, z) > -0.1) continue
      lotus.push([x, 0.05, z, 0.07 + rand() * 0.05])
    }
    for (let i = 0; i < 40; i++) {
      const a = rand() * Math.PI * 2, r = 1.0 + rand() * 1.8
      const x = Math.cos(a) * r, z = Math.sin(a) * r
      if (waterMask(x, z) > -0.1) continue
      pads.push([x, 0.02, z, 0.12 + rand() * 0.1])
    }
    for (let i = 0; i < 24; i++) {
      const a = rand() * Math.PI * 2, r = 1.0 + rand() * 1.8
      const x = Math.cos(a) * r, z = Math.sin(a) * r
      if (waterMask(x, z) > -0.05) continue
      candles.push([x, 0.05, z])
    }
    return { lotus, pads, candles }
  }, [])
  return <>
    {pads.map((p, i) => <mesh key={'p' + i} position={[p[0], p[1], p[2]]} rotation={[-Math.PI / 2, 0, 0]}><circleGeometry args={[p[3], 10, 0.4, 5.6]} /><meshBasicMaterial color="#1D3B3A" /></mesh>)}
    {lotus.map((p, i) => <mesh key={'l' + i} position={[p[0], p[1], p[2]]} scale={[1, 0.55, 1]}><sphereGeometry args={[p[3] * 0.7, 10, 6]} /><meshBasicMaterial color="#FF8ED8" toneMapped={false} /></mesh>)}
    {candles.map((p, i) => <group key={'c' + i} position={p}>
      <mesh position={[0, 0.04, 0]}><cylinderGeometry args={[0.016, 0.016, 0.06, 6]} /><meshBasicMaterial color="#B8A890" /></mesh>
      <mesh position={[0, 0.1, 0]}><sphereGeometry args={[0.02, 6, 4]} /><meshBasicMaterial color="#FFB050" toneMapped={false} /></mesh>
    </group>)}
  </>
}

// ---------------------------------------------------------------- 石の門・カード・木・結晶・東屋・蛍
const stoneTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d')
  g.fillStyle = '#b8b0c0'; g.fillRect(0, 0, 256, 256)
  for (let i = 0; i < 2600; i++) { const v = 120 + Math.floor(rand() * 135); g.fillStyle = `rgba(${v},${v - 10},${v + 10},0.5)`; const r = 1 + rand() * 6; g.beginPath(); g.arc(rand() * 256, rand() * 256, r, 0, 7); g.fill() }
  for (let i = 0; i < 40; i++) { g.strokeStyle = 'rgba(40,30,50,0.5)'; g.lineWidth = 1 + rand() * 2; g.beginPath(); let x = rand() * 256, y = rand() * 256; g.moveTo(x, y); for (let k = 0; k < 5; k++) { x += (rand() - 0.5) * 50; y += (rand() - 0.5) * 50; g.lineTo(x, y) } g.stroke() }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t
})()
const stoneMat = new THREE.MeshStandardMaterial({ color: '#4A3466', map: stoneTex, flatShading: true, roughness: 0.95 })
const stoneTop = new THREE.MeshStandardMaterial({ color: '#6A5090', map: stoneTex, flatShading: true, roughness: 0.9 })
function Dolmen({ position, rotation = 0, w = 2.6, h = 1.5 }) {
  return <group position={position} rotation={[0, rotation, 0]}>
    <mesh position={[-w / 2 + 0.25, h / 2, 0]} material={stoneMat}><boxGeometry args={[0.42, h, 0.4]} /></mesh>
    <mesh position={[w / 2 - 0.25, h / 2, 0]} material={stoneMat}><boxGeometry args={[0.42, h, 0.4]} /></mesh>
    <mesh position={[0, h + 0.16, 0]} rotation={[0, 0, 0.03]} material={stoneTop}><boxGeometry args={[w, 0.34, 0.62]} /></mesh>
  </group>
}

function cardTexture() {
  const W = 256, H = 420, c = document.createElement('canvas'); c.width = W; c.height = H
  const g = c.getContext('2d')
  g.fillStyle = '#1A1A3C'; g.fillRect(0, 0, W, H)
  g.strokeStyle = '#D6A75A'; g.lineWidth = 6; g.strokeRect(8, 8, W - 16, H - 16)
  g.lineWidth = 2; g.strokeRect(20, 20, W - 40, H - 40)
  g.translate(W / 2, H / 2)
  const ring = r => { g.beginPath(); g.arc(0, 0, r, 0, 7); g.stroke() }
  g.lineWidth = 3; ring(78); ring(64); g.lineWidth = 2; ring(40); ring(18)
  for (let i = 0; i < 16; i++) { const a = i * Math.PI / 8; g.beginPath(); g.moveTo(Math.cos(a) * 18, Math.sin(a) * 18); g.lineTo(Math.cos(a) * 64, Math.sin(a) * 64); g.stroke() }
  for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; g.beginPath(); g.arc(Math.cos(a) * 88, Math.sin(a) * 88, 7, 0, 7); g.stroke() }
  g.fillStyle = '#D6A75A'; g.beginPath(); g.arc(0, 0, 9, 0, 7); g.fill()
  for (const y of [-170, 160]) { g.fillRect(-50, y, 100, 6); g.fillRect(-30, y + 10, 60, 3) }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t
}
function Cards() {
  const tex = useMemo(cardTexture, [])
  const list = [
    { p: [-3.3, 2.47, 2.0], r: [0, 0.35, -0.08], s: 1 },
    { p: [-2.38, 1.71, 3.6], r: [0, 0.25, 0.0], s: 0.85 },
    { p: [-2.17, 1.8, 3.0], r: [0, 0.2, 0.02], s: 0.75 },
    { p: [2.43, 2.11, 2.4], r: [0, -0.25, 0.02], s: 0.75 },
  ]
  const g = useRef()
  useFrame(({ clock }) => { g.current.children.forEach((m, i) => { m.position.y = list[i].p[1] + Math.sin(clock.elapsedTime * 0.8 + i * 1.7) * 0.06 }) })
  return <group ref={g}>{list.map((c, i) => <mesh key={i} position={c.p} rotation={c.r} scale={c.s}>
    <planeGeometry args={[0.62, 1.02]} /><meshBasicMaterial map={tex} side={THREE.DoubleSide} toneMapped={false} color="#C8C0D8" />
  </mesh>)}</group>
}

function Tree() {
  return <group>
    <mesh position={[-4.95, 1.2, -3.0]} rotation={[0, 0, -0.18]}><cylinderGeometry args={[0.07, 0.15, 2.5, 5]} /><meshStandardMaterial color="#3A2236" flatShading /></mesh>
    <mesh position={[-4.5, 2.45, -3.0]} rotation={[0, 0, -0.95]}><cylinderGeometry args={[0.035, 0.06, 1.3, 5]} /><meshStandardMaterial color="#3A2236" flatShading /></mesh>
    <mesh position={[-5.05, 2.6, -3.0]} rotation={[0, 0, 0.35]}><cylinderGeometry args={[0.03, 0.05, 0.9, 5]} /><meshStandardMaterial color="#3A2236" flatShading /></mesh>
    <Motes tilt={0.3} tint={[3.0, 1.2, 2.4]} count={9000} center={[-4.5, 2.95, -3.0]} radius={1.3} pow={0.55} size={0.03} spin={0.0} squash={[1.25, 0.5, 0.8]}
      palette={[['#FF6AD2', 7], ['#FFB0E8', 2], ['#E060FF', 2]]} />
  </group>
}

function Crystal({ position, scale = 1 }) {
  const g = useRef()
  useFrame(({ clock }) => { g.current.position.y = position[1] + Math.sin(clock.elapsedTime * 0.6 + position[0]) * 0.15; g.current.rotation.y = clock.elapsedTime * 0.2 })
  return <group ref={g} position={position} scale={scale}>
    <mesh scale={[0.5, 0.75, 0.42]} position={[0, 0.65, 0]} rotation={[0, 0, 0.15]}><octahedronGeometry args={[1, 0]} /><meshBasicMaterial color="#B98CFF" toneMapped={false} /></mesh>
    <mesh position={[0, -0.35, 0]} scale={[0.75, 0.5, 0.75]}><dodecahedronGeometry args={[0.9, 0]} /><meshStandardMaterial color="#2E1C3E" flatShading /></mesh>
    {[[-0.25, -0.85, 0.1, 0.4], [0.25, -0.95, 0.05, 0.32], [-0.05, -1.35, 0.15, 0.3], [0.1, -1.0, -0.2, 0.25]].map(([x, y, z, s], i) =>
      <mesh key={i} position={[x, y, z]} scale={[s * 0.7, s * 1.2, s * 0.7]} rotation={[0, 0, Math.PI]}><octahedronGeometry args={[1, 0]} /><meshBasicMaterial color="#9C6CF0" toneMapped={false} /></mesh>)}
  </group>
}

function StringLights() {
  const geo = useMemo(() => {
    const pts = []
    for (const [x1, z1] of [[1.6, 0.9], [-0.9, 1.2], [1.4, -0.6]]) {
      for (let i = 0; i <= 18; i++) { const t = i / 18; pts.push(x1 * t, 2.15 - 2.0 * t + Math.sin(t * Math.PI) * -0.18, z1 * t) }
    }
    for (const [ax, az, bx, bz] of [[-1.08, 0, 0, 1.08], [0, 1.08, 1.08, 0], [0, 0, -1.08, 0], [0, 0, 1.08, 0]]) {
      for (let i = 0; i <= 12; i++) { const t = i / 12; pts.push(ax + (bx - ax) * t, 0.99 + (ax === 0 && az === 0 ? 0.38 * (1 - t) : 0), az + (bz - az) * t) }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3)); return g
  }, [])
  return <points geometry={geo}><pointsMaterial size={2.6} sizeAttenuation={false} color="#FFC870" toneMapped={false} transparent opacity={0.95} /></points>
}

function Pavilion() {
  const wood = '#4A2E40', roof = '#5A3A66', gold = '#D8A050'
  const edges = (geo, pos, rot = [0, 0, 0]) => <lineSegments position={pos} rotation={rot}><edgesGeometry args={[geo]} /><lineBasicMaterial color={gold} transparent opacity={0.85} toneMapped={false} /></lineSegments>
  return <group position={[2.6, 0, -5.5]} scale={1.6}>
    <mesh position={[0, 0.08, 0]}><boxGeometry args={[1.5, 0.16, 1.3]} /><meshStandardMaterial color="#2A1A30" flatShading /></mesh>
    <mesh position={[0, 0.6, 0]}><boxGeometry args={[1.1, 0.88, 0.95]} /><meshStandardMaterial color={wood} flatShading /></mesh>
    {edges(new THREE.BoxGeometry(1.1, 0.88, 0.95), [0, 0.6, 0])}
    {[-0.3, 0, 0.3].map((x, i) => <mesh key={i} position={[x, 0.55, 0.48]}><planeGeometry args={[0.1, 0.2]} /><meshBasicMaterial color={i === 1 ? '#E89048' : '#A05C2C'} toneMapped={false} /></mesh>)}
    <mesh position={[0, 1.55, 0.3]}><planeGeometry args={[0.1, 0.16]} /><meshBasicMaterial color="#C07038" toneMapped={false} /></mesh>
    <mesh position={[0, 1.18, 0]} rotation={[0, Math.PI / 4, 0]}><coneGeometry args={[1.08, 0.38, 4]} /><meshStandardMaterial color={roof} flatShading /></mesh>
    {edges(new THREE.ConeGeometry(1.08, 0.38, 4), [0, 1.18, 0], [0, Math.PI / 4, 0])}
    <mesh position={[0, 1.55, 0]}><boxGeometry args={[0.66, 0.5, 0.58]} /><meshStandardMaterial color={wood} flatShading /></mesh>
    {edges(new THREE.BoxGeometry(0.66, 0.5, 0.58), [0, 1.55, 0])}
    <mesh position={[0, 2.0, 0]} rotation={[0, Math.PI / 4, 0]}><coneGeometry args={[0.72, 0.5, 4]} /><meshStandardMaterial color={roof} flatShading /></mesh>
    {edges(new THREE.ConeGeometry(0.72, 0.5, 4), [0, 2.0, 0], [0, Math.PI / 4, 0])}
    <mesh position={[0, 2.32, 0]}><sphereGeometry args={[0.06, 8, 6]} /><meshBasicMaterial color="#FFE6B0" toneMapped={false} /></mesh>
    <StringLights />
    <pointLight position={[0, 0.8, 1.0]} color="#FFA050" intensity={3} distance={4} />
    <pointLight position={[0, 1.45, 0.9]} color="#FF9040" intensity={4} distance={2.5} />
    <pointLight position={[0.8, 2.6, 1.6]} color="#C090FF" intensity={3} distance={4} />
  </group>
}

function Fireflies() {
  const geo = useMemo(() => {
    const n = 220, p = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) { p[i * 3] = (rand() - 0.5) * 30; p[i * 3 + 1] = 0.3 + rand() * 4; p[i * 3 + 2] = -14 + rand() * 22 }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3)); return g
  }, [])
  return <points geometry={geo}><pointsMaterial size={2.4} sizeAttenuation={false} color="#E6B060" transparent opacity={0.7} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} /></points>
}

function Haze({ center }) {
  const tex = useMemo(() => {
    const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d')
    const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128)
    gr.addColorStop(0, 'rgba(170,130,255,0.55)'); gr.addColorStop(0.55, 'rgba(120,80,220,0.28)'); gr.addColorStop(1, 'rgba(90,50,180,0)')
    g.fillStyle = gr; g.fillRect(0, 0, 256, 256)
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t
  }, [])
  return <mesh position={[center[0], center[1], center[2] - 0.5]}><planeGeometry args={[7, 7]} />
    <meshBasicMaterial map={tex} transparent opacity={0.6} blending={THREE.AdditiveBlending} depthWrite={false} /></mesh>
}

function HazeBand({ z, w, h, op }) {
  const tex = useMemo(() => {
    const c = document.createElement('canvas'); c.width = 4; c.height = 128; const g = c.getContext('2d')
    const gr = g.createLinearGradient(0, 0, 0, 128)
    gr.addColorStop(0, 'rgba(110,70,150,0)'); gr.addColorStop(0.6, 'rgba(110,70,150,0.8)'); gr.addColorStop(1, 'rgba(90,50,130,0.9)')
    g.fillStyle = gr; g.fillRect(0, 0, 4, 128)
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t
  }, [])
  return <mesh position={[0, h / 2 - 0.5, z]}><planeGeometry args={[w, h]} /><meshBasicMaterial map={tex} transparent opacity={op} depthWrite={false} fog={false} /></mesh>
}

function Crags() {
  const list = useMemo(() => [
    [-13, 0, -14, 1.7, 1.6], [-16, 0, -10, 1.5, 1.3], [-10, 0, -17, 1.4, 1.4], [12, 0, -13, 1.6, 1.5], [16, 0, -9, 1.4, 1.2], [9, 0, -18, 1.6, 1.4], [-6.5, 0, -20, 1.3, 1.0], [6.5, 0, -21, 1.3, 1.0],
  ].map(([x, y, z, r, h]) => ({ x, y, z, r, h, rot: rand() * 6 })), [])
  return list.map((c, i) => <mesh key={i} position={[c.x, c.h * 0.35, c.z]} rotation={[0, c.rot, 0]} scale={[c.r, c.h, c.r]}>
    <dodecahedronGeometry args={[1, 0]} /><meshStandardMaterial color="#3A2650" flatShading roughness={1} /></mesh>)
}

// ---------------------------------------------------------------- 視点
function Rig() {
  const { camera, pointer } = useThree()
  const look = useMemo(() => new THREE.Vector3(0, 2.16, 0), [])
  useFrame(() => {
    camera.position.x += (pointer.x * 0.5 - camera.position.x) * 0.04
    camera.position.y += (3.4 + pointer.y * 0.2 - camera.position.y) * 0.04
    camera.lookAt(look)
  })
  return null
}

export default function Scene() {
  const SC = [0, 2.5, 0]
  return <>
    <fog attach="fog" args={[FOG, 28, 115]} />
    <ambientLight intensity={0.5} color="#6A4C90" />
    <directionalLight position={[10, 40, 20]} intensity={2.6} color="#F0A8D8" />
    <Crags />
    <pointLight position={SC} intensity={8} distance={10} color="#A070FF" />
    <Rig />
    <Sky />
    <Clouds />
    <HazeBand z={-28} w={120} h={8} op={0.08} />
    <HazeBand z={-60} w={220} h={16} op={0.16} />
    <Mountains />
    <Ground />
    <Grass />
    <Water />
    <MagicCircle />
    <PondLife />
    <Dolmen position={[-3.2, 0, 3.5]} rotation={-0.45} w={2.4} h={0.95} />
    <Dolmen position={[3.25, 0, 3.1]} rotation={0.55} w={1.6} h={0.95} />
    <mesh position={[0.45, 0.35, 5.3]} material={stoneMat}><boxGeometry args={[0.3, 1.0, 0.25]} /></mesh>
    <Cards />
    <Tree />
    <Crystal position={[-5.5, 5.0, -6]} scale={0.6} />
    <Crystal position={[11.9, 4.6, -8]} scale={0.6} />
    <Pavilion />
    <Fireflies />
    <Haze center={SC} />
    <Motes count={32000} center={SC} radius={2.25} pow={0.36} size={0.05} halo={0.03}
      palette={[['#9A6ADE', 44], ['#C0A0F0', 18], ['#5030C0', 16], ['#FFFFFF', 6, 0.9], ['#F2B866', 12], ['#F08ACD', 6], ['#80E0F0', 2]]} />
    <GoldRing center={SC} radius={2.45} />
    <GoldRing center={SC} radius={2.3} rot={[1.25, 0.2, 0.15]} op={0.3} />
    <GoldRing center={SC} radius={2.15} rot={[0.3, 1.1, -0.4]} op={0.25} />
    <GoldRing center={SC} radius={0.9} rot={[0.5, 0.4, 0]} op={0.3} />
    <EffectComposer multisampling={0}>
      <Bloom mipmapBlur intensity={1.0} luminanceThreshold={0.28} luminanceSmoothing={0.3} />
      <Noise premultiply opacity={0.8} />
      <Vignette offset={0.3} darkness={0.5} />
    </EffectComposer>
  </>
}
