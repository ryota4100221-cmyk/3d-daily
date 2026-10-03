import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Edges } from '@react-three/drei'
import * as THREE from 'three'
import { BOXES, STEPS, BISECT, T0, DT, SITE } from './rig.js'

const NB = BOXES.length

// The ground asks the rig.js question per pixel. The only thing it draws on
// purpose is a tone; the lines appear wherever floor(hours) changes value.
const groundVert = /* glsl */ `
  varying vec3 vW;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`

const groundFrag = /* glsl */ `
  #define NB ${NB}
  #define STEPS ${STEPS}
  uniform vec3 uMin[NB];
  uniform vec3 uMax[NB];
  #define BISECT ${BISECT}
  uniform float uDecl;     // radians
  uniform float uLat;      // radians
  uniform float uT0;
  uniform float uDt;
  uniform vec3 uNow;
  uniform float uShow;     // 0 = only the instant, 1 = the counted hours
  uniform vec3 uPaper;
  uniform vec3 uInk;
  varying vec3 vW;

  bool blocked(vec3 o, vec3 s) {
    if (s.y <= 0.0) return false;
    vec3 inv = 1.0 / s;
    for (int i = 0; i < NB; i++) {
      vec3 ta = (uMin[i] - o) * inv;
      vec3 tb = (uMax[i] - o) * inv;
      vec3 lo = min(ta, tb);
      vec3 hi = max(ta, tb);
      float t0 = max(max(lo.x, lo.y), max(lo.z, 1e-4));
      float t1 = min(min(hi.x, hi.y), hi.z);
      if (t0 <= t1) return true;
    }
    return false;
  }

  vec3 sunAt(float hour) {
    float H = radians((hour - 12.0) * 15.0);
    float east = -cos(uDecl) * sin(H);
    float north = cos(uLat) * sin(uDecl) - sin(uLat) * cos(uDecl) * cos(H);
    float up = sin(uLat) * sin(uDecl) + cos(uLat) * cos(uDecl) * cos(H);
    return vec3(east, up, -north);
  }

  // continuous hours of shadow — rig.js shadowHours(), line for line
  float shadowHours(vec3 o) {
    float h = 0.0;
    float tPrev = uT0;
    bool bPrev = blocked(o, sunAt(uT0));
    for (int i = 1; i < STEPS; i++) {
      float t = uT0 + float(i) * uDt;
      bool b = blocked(o, sunAt(t));
      if (b && bPrev) h += uDt;
      else if (b != bPrev) {
        float lo = tPrev, hi = t;
        for (int k = 0; k < BISECT; k++) {
          float m = 0.5 * (lo + hi);
          if (blocked(o, sunAt(m)) == bPrev) lo = m; else hi = m;
        }
        float tc = 0.5 * (lo + hi);
        h += bPrev ? tc - tPrev : t - tc;
      }
      tPrev = t;
      bPrev = b;
    }
    return h;
  }

  bool footprint(vec2 p) {
    for (int i = 0; i < NB; i++) {
      if (uMin[i].y == 0.0 && p.x >= uMin[i].x && p.x <= uMax[i].x && p.y >= uMin[i].z && p.y <= uMax[i].z) return true;
    }
    return false;
  }

  float gridLine(vec2 p, float step) {
    vec2 g = abs(fract(p / step - 0.5) - 0.5) / fwidth(p / step);
    return 1.0 - min(min(g.x, g.y), 1.0);
  }

  void main() {
    vec3 o = vec3(vW.x, 0.0, vW.z);
    // only the plot around the massing can be shaded in the counted window
    float h = length(o.xz - vec2(0.0, -40.0)) < 175.0 ? shadowHours(o) : 0.0;
    bool inFoot = footprint(o.xz);
    bool now = blocked(o, uNow);

    vec3 col = uPaper;
    // a 10 m site grid, the only furniture
    col = mix(col, uInk, 0.045 * gridLine(o.xz, 10.0));

    // counted hours as a quiet tone
    float tone = clamp(h / 8.0, 0.0, 1.0);
    col = mix(col, uInk, uShow * (0.03 + 0.20 * tone) * step(0.001, h));

    // equal-hour lines: where the count crosses a whole hour
    float fw = max(fwidth(h), 1e-5);
    float d = abs(fract(h + 0.5) - 0.5) / fw;          // pixels to the nearest whole hour
    float near = floor(h + 0.5);
    float major = step(3.5, near) * step(near, 4.5);    // the 4 h line, drawn heavier
    float line = (1.0 - smoothstep(0.0, mix(0.9, 1.7, major), d)) * step(0.5, near) * step(fw, 0.6);
    col = mix(col, uInk, uShow * line * mix(0.7, 1.0, major));

    // the instant: the one shadow that actually falls
    if (now) col = mix(col, uInk, 0.16);
    if (inFoot) col = mix(uPaper, uInk, 0.08);

    // fade to paper with distance so the site floats
    float r = length(o.xz - vec2(-10.0, -30.0));
    col = mix(col, uPaper, smoothstep(150.0, 210.0, r));

    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`

function Ground({ decl, nowDir, dt, show }) {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: groundVert,
        fragmentShader: groundFrag,
        uniforms: {
          uMin: { value: BOXES.map((b) => new THREE.Vector3(b[0], b[1], b[2])) },
          uMax: { value: BOXES.map((b) => new THREE.Vector3(b[3], b[4], b[5])) },
          uDecl: { value: 0 },
          uLat: { value: (SITE.lat * Math.PI) / 180 },
          uT0: { value: T0 },
          uNow: { value: new THREE.Vector3(0, 1, 0) },
          uDt: { value: dt },
          uShow: { value: 1 },
          uPaper: { value: new THREE.Color('#f2f1ed') },
          uInk: { value: new THREE.Color('#16161a') },
        },
        extensions: { derivatives: true },
      }),
    [dt]
  )
  mat.uniforms.uDecl.value = (decl * Math.PI) / 180
  mat.uniforms.uNow.value.set(nowDir[0], nowDir[1], nowDir[2])
  useFrame(() => {
    const u = mat.uniforms.uShow
    u.value += ((show ? 1 : 0) - u.value) * 0.12
  })
  return (
    <mesh rotation-x={-Math.PI / 2} material={mat}>
      <planeGeometry args={[440, 440, 1, 1]} />
    </mesh>
  )
}

function Massing() {
  return BOXES.map((b, i) => {
    const size = [b[3] - b[0], b[4] - b[1], b[5] - b[2]]
    const pos = [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2]
    return (
      <mesh key={i} position={pos} castShadow receiveShadow>
        <boxGeometry args={size} />
        <meshStandardMaterial color="#f6f5f1" roughness={0.92} metalness={0} />
        <Edges color="#16161a" threshold={20} />
      </mesh>
    )
  })
}

function Sun({ dir }) {
  const light = useRef()
  const { scene } = useThree()
  useFrame(() => {
    const l = light.current
    if (!l) return
    l.position.set(dir[0] * 160, Math.max(dir[1], 0.02) * 160, dir[2] * 160)
    l.target.position.set(0, 0, 0)
    if (!l.target.parent) scene.add(l.target)
    l.intensity = dir[1] > 0 ? 2.4 : 0
  })
  return (
    <directionalLight
      ref={light}
      castShadow
      shadow-mapSize={[2048, 2048]}
      shadow-camera-left={-60}
      shadow-camera-right={60}
      shadow-camera-top={60}
      shadow-camera-bottom={-60}
      shadow-camera-near={1}
      shadow-camera-far={400}
      shadow-bias={-0.0004}
    />
  )
}

export default function Scene({ decl, nowDir, dt, show }) {
  return (
    <>
      <color attach="background" args={['#f2f1ed']} />
      <hemisphereLight args={['#ffffff', '#d8d6d0', 1.25]} />
      <Sun dir={nowDir} />
      <Ground decl={decl} nowDir={nowDir} dt={dt} show={show} />
      <Massing />
    </>
  )
}
