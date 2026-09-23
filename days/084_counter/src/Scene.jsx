import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { R, ASC, WEIGHTS, layout, breath } from './rig.js'

// One plane per weight. The fragment shader evaluates the distance to the same
// single-line skeleton and inks everything within r of it. Nothing else differs
// between rows — no per-weight outlines, no hand-drawn counters.
const MAX_SEG = 4
const MAX_CIR = 4

const vert = /* glsl */ `
varying vec2 vP;
uniform vec2 uOrigin;
uniform vec2 uSize;
void main() {
  vP = uOrigin + uv * uSize;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const frag = /* glsl */ `
precision highp float;
varying vec2 vP;
uniform float uR;          // half stroke
uniform float uRbowl;
uniform vec4  uSeg[${MAX_SEG}];
uniform vec2  uCir[${MAX_CIR}];
uniform int   uNSeg;
uniform int   uNCir;
uniform vec3  uInk;
uniform vec3  uBone;       // skeleton line colour
uniform float uSkel;       // skeleton visibility
uniform float uRing;       // largest-empty-circle ring visibility
uniform float uFade;

float dSeg(vec2 p, vec4 s) {
  vec2 a = s.xy, b = s.zw;
  vec2 v = b - a;
  float t = clamp(dot(p - a, v) / dot(v, v), 0.0, 1.0);
  return length(p - a - t * v);
}

void main() {
  float d = 1e9;
  for (int i = 0; i < ${MAX_SEG}; i++) { if (i < uNSeg) d = min(d, dSeg(vP, uSeg[i])); }
  float dc = 1e9;   // distance to the nearest bowl centre
  for (int i = 0; i < ${MAX_CIR}; i++) {
    if (i < uNCir) {
      float q = length(vP - uCir[i]);
      d = min(d, abs(q - uRbowl));
      dc = min(dc, q);
    }
  }
  float aa = fwidth(d) * 0.9;
  float ink = 1.0 - smoothstep(uR - aa, uR + aa, d);

  // the skeleton itself: a hairline that is the same in every row
  float sk = (1.0 - smoothstep(0.0045, 0.0045 + aa, d)) * uSkel * smoothstep(0.012, 0.03, uR);

  // the counter that is left: circle of radius R − r around each bowl centre
  float rc = uRbowl - uR;
  float aac = fwidth(dc) * 0.9;
  // the counter is the largest empty circle, radius R − r: tint it faintly
  float fill = rc > 0.0 ? (1.0 - smoothstep(rc - aac, rc + aac, dc)) * uRing * (1.0 - ink) : 0.0;
  float dotc = rc > 0.0 ? (1.0 - smoothstep(0.014, 0.014 + aac, dc)) * uRing : 0.0;

  vec3 col = uInk;
  float a = ink;
  // skeleton drawn inside the ink as a darker hair, outside as nothing
  col = mix(col, uBone, sk * ink);
  // counter ring and centre
  col = mix(col, uInk, dotc);
  a = max(a, fill * 0.07 + dotc * 0.8);
  gl_FragColor = vec4(col, a * uFade);
  if (gl_FragColor.a < 0.004) discard;
}
`

function makeUniforms(r, L) {
  const seg = Array.from({ length: MAX_SEG }, (_, i) => (L.segs[i] ? new THREE.Vector4(...L.segs[i]) : new THREE.Vector4()))
  const cir = Array.from({ length: MAX_CIR }, (_, i) => (L.circles[i] ? new THREE.Vector2(...L.circles[i]) : new THREE.Vector2()))
  return {
    uR: { value: r },
    uRbowl: { value: R },
    uSeg: { value: seg },
    uCir: { value: cir },
    uNSeg: { value: L.segs.length },
    uNCir: { value: L.circles.length },
    uInk: { value: new THREE.Color('#ecebe6') },
    uBone: { value: new THREE.Color('#0b0b0c') },
    uSkel: { value: 1 },
    uRing: { value: 1 },
    uFade: { value: 1 },
    uOrigin: { value: new THREE.Vector2() },
    uSize: { value: new THREE.Vector2(1, 1) },
  }
}

// A row: plane sized to the word at this weight, anchored at its left baseline.
function Row({ r, y, scale = 1, live = false, index }) {
  const mat = useRef()
  const mesh = useRef()
  const PADX = 0.72, PADY = 0.72
  const maxW = layout(R * 1.12).width
  const uniforms = useMemo(() => {
    const L = layout(r)
    const u = makeUniforms(r, L)
    // the wall rows are small on screen; a sub-pixel hair there only aliases
    u.uSkel.value = live ? 1 : 0
    u.uOrigin.value.set(-PADX, -PADY)
    u.uSize.value.set(maxW + 2 * PADX, ASC + 2 * PADY)
    return u
  }, [r])

  useFrame(({ clock }) => {
    if (!live || !mat.current) return
    const rr = breath(clock.elapsedTime)
    const L = layout(rr)
    const u = mat.current.uniforms
    u.uR.value = rr
    L.segs.forEach((s, i) => u.uSeg.value[i].set(...s))
    L.circles.forEach((c, i) => u.uCir.value[i].set(...c))
    if (typeof window !== 'undefined') window.__weight = rr
  })

  const w = maxW + 2 * PADX
  const h = ASC + 2 * PADY
  return (
    <group position={[0, y, 0]} scale={scale}>
      <mesh ref={mesh} position={[-PADX + w / 2, -PADY + h / 2, 0]} renderOrder={index}>
        <planeGeometry args={[w, h]} />
        <shaderMaterial
          ref={mat}
          uniforms={uniforms}
          vertexShader={vert}
          fragmentShader={frag}
          transparent
          depthWrite={false}
          extensions={{ derivatives: true }}
        />
      </mesh>
    </group>
  )
}

// Baseline rules and x-height rules, the specimen's grid, drawn once per row.
function Rules({ ys, width }) {
  const geo = useMemo(() => {
    const pts = []
    for (const y of ys) {
      pts.push(-0.4, y, -0.001, width, y, -0.001)
      pts.push(-0.4, y + 1, -0.001, width, y + 1, -0.001)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    return g
  }, [ys, width])
  return (
    <lineSegments geometry={geo} renderOrder={-1}>
      <lineBasicMaterial color="#232325" />
    </lineSegments>
  )
}

export default function Scene() {
  const wall = useRef()
  const { size } = useThree()
  const narrow = size.width < size.height

  // Static ramp: Hairline at the top, Past Black at the bottom. Row pitch grows
  // with the stroke so heavy rows never touch the rows above them.
  const rows = useMemo(() => {
    let y = 0
    return WEIGHTS.map((w, i) => {
      const pitch = ASC + 2 * w.r + 0.62
      const row = { ...w, y: -y, index: i }
      y += pitch
      return row
    })
  }, [])
  const total = -rows[rows.length - 1].y
  const maxW = layout(R * 1.12).width

  useFrame(({ clock }) => {
    if (!wall.current) return
    const t = clock.elapsedTime
    wall.current.rotation.y = -0.52 + Math.sin(t * 0.13) * 0.035
    wall.current.rotation.x = 0.06
  })

  return (
    <>
      <color attach="background" args={['#0b0b0c']} />
      <fog attach="fog" args={['#0b0b0c', 18, 40]} />
      {/* the wall: the ramp, turned away from us into depth */}
      <group ref={wall} position={narrow ? [-2.2, 6.4, -4] : [0.2, total * 0.27 - 0.1, -3]} scale={narrow ? 0.46 : 0.54}>
        <Rules ys={rows.map((r) => r.y)} width={maxW + 0.4} />
        {rows.map((w) => (
          <Row key={w.name} r={w.r} y={w.y} index={w.index} />
        ))}
      </group>
      {/* the live row: one skeleton, breathing through every weight */}
      <group position={narrow ? [-2.6, -5.8, 1] : [-9.95, -3.0, 0.6]} rotation={[0, 0.16, 0]}>
        <Row r={0.1} y={0} scale={narrow ? 0.8 : 1.04} live index={20} />
      </group>
    </>
  )
}
