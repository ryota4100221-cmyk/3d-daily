import React, { useMemo, useEffect } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { makeAshtray } from './ashtray.js'

// 1回目：明るさだけを描く
const lumVert = /* glsl */ `
varying vec3 vN; varying vec3 vW; varying vec3 vL;
void main(){
  vN = normalize(mat3(modelMatrix) * normal);
  vL = position;
  vec4 w = modelMatrix * vec4(position,1.);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`
// 明るさを「面の役割」で決める：縁の天面＝1（点が融ける）、皿＝0.7、側面＝上から下へ痩せて底で少し戻る
const lumFrag = /* glsl */ `
uniform vec3 uKey; uniform vec3 uCam; uniform float uH; uniform float uB; uniform float uRi;
uniform vec2 uDimple; uniform float uTop; uniform float uDish; uniform float uSideHi; uniform float uSideLo; uniform float uFoot;
varying vec3 vN; varying vec3 vW; varying vec3 vL;
void main(){
  vec3 n = normalize(vN);
  if (!gl_FrontFacing) n = -n;
  float rr = length(vL.xz);
  float key = max(dot(n, normalize(uKey)), 0.);
  float upF = smoothstep(0.47, 0.56, n.y);          // 上を向く度合い
  float inDish = (1. - smoothstep(uRi + 0.02, uRi + 0.07, rr)) * step(uB + 0.06, vL.y);
  // 天面（縁）
  float top = uTop * mix(0.9, 1.05, key);
  // 皿：ほぼ一様、奥の壁（こちらを向く面）が少し明るく、中央の窪みは暗い
  float dish = uDish + 0.10*(key-0.6);
  dish *= mix(0.15, 1.0, smoothstep(0.035, 0.07, length(vL.xz - uDimple)));
  // 側面：高さで痩せる
  float hy = clamp((vL.y - uB) / (uH - uB), 0., 1.);  // 0=底 1=天面
  float side = mix(uSideLo, uSideHi, smoothstep(0.25, 0.95, hy));
  side += uFoot * (1. - smoothstep(0.0, 0.25, hy));
  side *= mix(0.75, 1.1, key);
  float floorF = smoothstep(0.88, 0.97, n.y) * (1. - smoothstep(uRi - 0.10, uRi - 0.02, rr));
  float L = mix(mix(side, top, upF), mix(top, dish, floorF), inDish);
  gl_FragColor = vec4(clamp(L,0.,1.), 0., 0., 1.);
}`

// 2回目：網点
const htVert = /* glsl */ `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`
const htFrag = /* glsl */ `
uniform sampler2D uLum; uniform vec2 uRes; uniform float uDpr; uniform float uPitch; uniform float uTime;
uniform vec3 uInk; uniform vec3 uPaper; uniform float uBlur;
varying vec2 vUv;
float hash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
float lumAt(vec2 px){ // px: CSS px（左下原点）
  vec2 wob = vec2(vnoise(px/38. + uTime*0.15), vnoise(px/38. + 17.3 - uTime*0.12)) - 0.5;
  px += wob * 14.;
  vec2 uv = px / uRes;
  float s = 0., w = 0.;
  for (int i=-2;i<=2;i++) for (int j=-2;j<=2;j++){
    vec2 o = vec2(float(i), float(j));
    float k = exp(-dot(o,o)/4.5);
    s += texture2D(uLum, uv + o*uBlur/uRes).r * k; w += k;
  }
  return s/w;
}
void main(){
  vec2 px = gl_FragCoord.xy / uDpr;
  vec2 p = px / uPitch;
  vec2 r = vec2(1., 1.7320508);
  vec2 h = r*0.5;
  vec2 a = mod(p, r) - h;
  vec2 b = mod(p - h, r) - h;
  vec2 g = dot(a,a) < dot(b,b) ? a : b;
  vec2 c = (p - g) * uPitch;      // 点の中心（CSS px）
  float L = lumAt(c);
  float rad = 0.62 * sqrt(clamp(L,0.,1.)) * uPitch;
  float d = length(g) * uPitch;
  float aa = 1.1;
  float ink = 1. - smoothstep(rad - aa, rad + aa, d);
  ink *= step(0.02, L);
  // 地：粒と周辺の減光
  vec2 q = vUv - 0.5;
  float vig = 1. - 0.25 * smoothstep(0.25, 0.85, length(q*vec2(1.3,1.)));
  float gr = hash(floor(gl_FragCoord.xy) + fract(uTime*7.)*91.) - 0.5;
  vec3 paper = uPaper * vig + vec3(0.018,0.034,0.012) * smoothstep(0.75, 0.0, length((vUv - vec2(0.82,0.9))*vec2(1.6,1.))) + gr * 0.05;
  vec3 inkc = uInk * (0.90 + 0.10*L) * (0.97 + 0.05*vnoise(px/40.)) + gr * 0.08;
  gl_FragColor = vec4(mix(paper, inkc, ink), 1.);
}`

export default function Scene() {
  const { gl, size, viewport } = useThree()
  const dpr = gl.getPixelRatio()

  const { lumScene, lumCam, mesh, rt, quadScene, quadCam, htMat } = useMemo(() => {
    const lumScene = new THREE.Scene()
    lumScene.background = new THREE.Color(0, 0, 0)
    const lumCam = new THREE.PerspectiveCamera(24, 1440 / 900, 0.1, 50)
    const geo = makeAshtray({ H: 0.20, B: -0.34, Ri: 0.66, D: 0.10, oct: 0.6 })
    const mat = new THREE.ShaderMaterial({
      vertexShader: lumVert, fragmentShader: lumFrag, side: THREE.DoubleSide,
      uniforms: { uKey: { value: new THREE.Vector3(-0.35, 1.0, 0.45) }, uCam: { value: new THREE.Vector3() }, uH: { value: 0.20 }, uB: { value: -0.34 }, uRi: { value: 0.66 }, uDimple: { value: new THREE.Vector2(0.16, 0.14) },
        uTop: { value: 1.0 }, uDish: { value: 0.46 }, uSideHi: { value: 0.32 }, uSideLo: { value: 0.15 }, uFoot: { value: 0.24 } },
    })
    const mesh = new THREE.Mesh(geo, mat)
    lumScene.add(mesh)
    const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: true, samples: 4 })
    const htMat = new THREE.ShaderMaterial({
      vertexShader: htVert, fragmentShader: htFrag, depthTest: false, depthWrite: false,
      uniforms: {
        uLum: { value: rt.texture }, uRes: { value: new THREE.Vector2(1440, 900) }, uDpr: { value: 1 },
        uPitch: { value: 8.0 }, uTime: { value: 0 }, uBlur: { value: 3.4 },
        uInk: { value: new THREE.Vector3(245 / 255, 107 / 255, 8 / 255) },
        uPaper: { value: new THREE.Vector3(14 / 255, 14 / 255, 12 / 255) },
      },
    })
    const quadScene = new THREE.Scene()
    quadScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), htMat))
    const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
    return { lumScene, lumCam, mesh, rt, quadScene, quadCam, htMat }
  }, [])

  useEffect(() => {
    rt.setSize(Math.round(size.width * 0.5), Math.round(size.height * 0.5))
    htMat.uniforms.uRes.value.set(size.width, size.height)
    htMat.uniforms.uDpr.value = dpr
    lumCam.aspect = size.width / size.height
    // 画面 1440 幅のとき、灰皿の中心が x≈1062 に来るよう横にずらす
    lumCam.setViewOffset(size.width, size.height, -(size.width * 0.2375), size.height * 0.012, size.width, size.height)
    lumCam.updateProjectionMatrix()
  }, [size, dpr])

  useFrame((state) => {
    const t = state.clock.elapsedTime
    const el = 0.50
    const dist = 6.95
    lumCam.position.set(0, Math.sin(el) * dist, Math.cos(el) * dist)
    lumCam.lookAt(0, -0.06, 0)
    mesh.material.uniforms.uCam.value.copy(lumCam.position)
    mesh.rotation.y = 0.39 + t * 0.12
    mesh.rotation.z = Math.sin(t * 0.5) * 0.03
    mesh.rotation.x = Math.sin(t * 0.37) * 0.025
    mesh.position.y = Math.sin(t * 0.8) * 0.02
    mesh.scale.set(1, 1.22, 1)
    htMat.uniforms.uTime.value = t
    gl.setRenderTarget(rt)
    gl.render(lumScene, lumCam)
    gl.setRenderTarget(null)
    gl.render(quadScene, quadCam)
  }, 1)

  return null
}
