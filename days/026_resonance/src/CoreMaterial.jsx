import * as THREE from 'three'
import { shaderMaterial } from '@react-three/drei'
import { extend } from '@react-three/fiber'

// The central resonating body. A high-poly sphere is displaced in the vertex
// shader by fBm + the music's bass, and re-rippled on every beat. The surface
// normal is rebuilt per-fragment from screen-space derivatives of world position
// (dFdx/dFdy) so displacement genuinely re-lights the form — ridges catch the key,
// valleys fall to ink. Fresnel (Day 018 lineage) draws a terracotta rim; a beat
// pushes an emissive flush through the silhouette. Self-lit, no scene lights,
// `<Canvas flat>` + a single sRGB OETF at the end. Offline-safe (noise inlined).

const CoreMaterial = shaderMaterial(
  {
    uTime: 0,
    uBass: 0,
    uMid: 0,
    uTreble: 0,
    uBeat: 0,
    uPaper: new THREE.Color('#e9e3d6'),
    uInk: new THREE.Color('#20222a'),
    uBone: new THREE.Color('#d8d2c4'),
    uTerra: new THREE.Color('#c8603a'),
  },
  // vertex
  /* glsl */ `
  uniform float uTime, uBass, uBeat, uMid;
  varying vec3 vWorld;
  varying vec3 vObj;
  varying float vDisp;

  // --- inexpensive 3D value-noise fBm (integer hash + quintic) ---
  vec3 hash3(vec3 p){
    p = vec3(dot(p,vec3(127.1,311.7,74.7)),
             dot(p,vec3(269.5,183.3,246.1)),
             dot(p,vec3(113.5,271.9,124.6)));
    return fract(sin(p)*43758.5453123);
  }
  float vnoise(vec3 p){
    vec3 i = floor(p); vec3 f = fract(p);
    vec3 u = f*f*f*(f*(f*6.0-15.0)+10.0);
    float n000=hash3(i+vec3(0,0,0)).x, n100=hash3(i+vec3(1,0,0)).x;
    float n010=hash3(i+vec3(0,1,0)).x, n110=hash3(i+vec3(1,1,0)).x;
    float n001=hash3(i+vec3(0,0,1)).x, n101=hash3(i+vec3(1,0,1)).x;
    float n011=hash3(i+vec3(0,1,1)).x, n111=hash3(i+vec3(1,1,1)).x;
    float nx00=mix(n000,n100,u.x), nx10=mix(n010,n110,u.x);
    float nx01=mix(n001,n101,u.x), nx11=mix(n011,n111,u.x);
    return mix(mix(nx00,nx10,u.y), mix(nx01,nx11,u.y), u.z);
  }
  float fbm(vec3 p){
    float a=0.5, s=0.0;
    for(int i=0;i<4;i++){ s+=a*vnoise(p); p*=2.02; a*=0.5; }
    return s;
  }

  void main(){
    vObj = position;
    vec3 nrm = normalize(position);
    float n = fbm(nrm*2.2 + vec3(0.0,0.0,uTime*0.25));
    // beat ripple travelling from the top
    float ripple = sin(nrm.y*9.0 - uTime*4.0);
    float disp = n*(0.08 + uBass*0.42) + uBeat*0.10*ripple + uMid*0.05;
    vDisp = disp;
    vec3 p = position + nrm * disp;
    vec4 wp = modelMatrix * vec4(p,1.0);
    vWorld = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
  `,
  // fragment
  /* glsl */ `
  precision highp float;
  uniform float uBeat, uBass, uMid, uTreble, uTime;
  uniform vec3 uPaper, uInk, uBone, uTerra;
  varying vec3 vWorld;
  varying vec3 vObj;
  varying float vDisp;

  vec3 toLin(vec3 c){ return pow(c, vec3(2.2)); }

  void main(){
    // geometric normal of the DISPLACED surface, from screen-space derivatives
    vec3 N = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
    vec3 V = normalize(cameraPosition - vWorld);
    if(dot(N,V) < 0.0) N = -N;

    // hemispheric self-lighting (no scene lights)
    float up = clamp(N.y*0.5 + 0.5, 0.0, 1.0);
    vec3 sky  = toLin(uPaper) * 1.15;
    vec3 grnd = toLin(uInk) * 0.55;
    vec3 amb = mix(grnd, sky, up);

    // a warm key from upper-right
    vec3 keyDir = normalize(vec3(0.6, 0.8, 0.4));
    float key = clamp(dot(N, keyDir), 0.0, 1.0);
    vec3 keyCol = toLin(vec3(1.0, 0.93, 0.82)) * pow(key, 1.4) * (0.7 + uMid*0.5);

    vec3 base = toLin(uBone);
    vec3 col = base * (amb*0.9 + keyCol*0.7);

    // fresnel terracotta rim (Day 018)
    float fres = pow(1.0 - max(dot(N,V), 0.0), 3.2);
    col += toLin(uTerra) * fres * (0.5 + uTreble*0.8);

    // ridges (high displacement) warm & glow; valleys sink to ink
    float ridge = smoothstep(0.05, 0.28, vDisp);
    col = mix(col, toLin(uInk)*0.8, smoothstep(0.0, -0.12, vDisp)*0.6);
    col += toLin(uTerra) * ridge * (0.15 + uBass*0.5);

    // beat flush through the silhouette
    col += toLin(uTerra) * uBeat * fres * 0.9;
    col += toLin(uTerra) * uBeat * 0.06;

    // faint grain
    float g = fract(sin(dot(gl_FragCoord.xy, vec2(12.99,78.23)))*43758.5) - 0.5;
    col += g * 0.012;

    // sRGB OETF
    col = pow(max(col, 0.0), vec3(1.0/2.2));
    gl_FragColor = vec4(col, 1.0);
  }
  `,
)

extend({ CoreMaterial })
export default CoreMaterial
