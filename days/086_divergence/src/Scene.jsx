import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { LADDER } from './rig.js'

// World units are CSS pixels (R3F's default orthographic frustum), and the
// camera looks straight down −Y, so the sphere's "up" axis points at the viewer.

const INK = new THREE.Color('#0a0907')
const GRAIN_LIMB = new THREE.Color('#3a2a0e')
const GOLD = new THREE.Color('#d4af37')
const GRAIN = new THREE.Color('#0d0a05')
const LIT = new THREE.Color('#fff6dc')

const vert = /* glsl */ `
  attribute float aIndex;
  uniform float uN;
  uniform float uF;
  uniform float uFam;
  uniform float uR;
  uniform float uPx;
  uniform float uSpin;
  varying float vH;
  varying float vLit;
  void main() {
    float i = aIndex;
    float z = 1.0 - (2.0 * i + 1.0) / uN;
    float r = sqrt(max(0.0, 1.0 - z * z));
    // i·f in two halves so the fractional turn keeps its precision at i ~ 3000
    float hi = floor(i / 64.0) * 64.0;
    float turn = fract(fract(hi * uF) + fract((i - hi) * uF));
    float a = 6.28318530718 * turn + uSpin;
    vec3 p = vec3(r * cos(a), z, r * sin(a)) * uR;
    vH = z;
    vLit = (uFam > 1.5 && mod(i + 0.5, uFam) < 1.0) ? 1.0 : 0.0;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    // dots shrink toward the limb the way discs on a sphere foreshorten
    gl_PointSize = uPx * mix(0.55, 1.0, max(z, 0.0)) * (1.0 + 0.2 * vLit);
  }
`

const frag = /* glsl */ `
  uniform vec3 uLo;
  uniform vec3 uMid;
  uniform vec3 uHi;
  uniform float uLitMix;
  varying float vH;
  varying float vLit;
  void main() {
    vec2 c = gl_PointCoord * 2.0 - 1.0;
    float d = dot(c, c);
    float aa = fwidth(d) * 1.2;
    float alpha = 1.0 - smoothstep(1.0 - aa, 1.0, d);
    if (alpha < 0.01) discard;
    float h = clamp(vH, 0.0, 1.0);
    vec3 col = mix(uLo, uMid, smoothstep(0.0, 0.55, h));
    col = mix(col, uHi, vLit * uLitMix);
    // a small specular bead so each dot reads as a grain, not a pixel
    col += 0.05 * uHi * smoothstep(0.55, 0.0, length(c - vec2(-0.3, 0.3)));
    // linear → sRGB by hand: a raw ShaderMaterial gets no colorspace chunk
    col = pow(col, vec3(1.0 / 2.2));
    gl_FragColor = vec4(col, alpha);
  }
`

// Gilt body. Shaded only by how squarely it faces the camera (n·up), with a
// soft key from the upper left — the ink shows only past the limb.
const bodyVert = /* glsl */ `
  varying vec3 vN;
  void main() {
    vN = normalize(normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`
const bodyFrag = /* glsl */ `
  varying vec3 vN;
  void main() {
    float face = max(vN.y, 0.0);
    float key = max(dot(vN, normalize(vec3(-0.45, 0.8, -0.4))), 0.0);
    // gold leaf, written straight as sRGB (no conversion on this material)
    vec3 limb = vec3(0.20, 0.15, 0.06);
    vec3 mid = vec3(0.69, 0.54, 0.18);
    vec3 top = vec3(0.91, 0.78, 0.44);
    vec3 col = mix(limb, mid, smoothstep(0.0, 0.7, face));
    col = mix(col, top, pow(key, 3.0) * 0.8);
    gl_FragColor = vec4(col, 1.0);
  }
`

function Field({ n, fRef, fixedF, famRef, fixedFam, radius, x, y, px, litMix = 0.85, spin = 0 }) {
  const mat = useRef()
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry()
    const idx = new Float32Array(n)
    for (let i = 0; i < n; i++) idx[i] = i
    g.setAttribute('aIndex', new THREE.BufferAttribute(idx, 1))
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3))
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6)
    return g
  }, [n])
  const uniforms = useMemo(
    () => ({
      uN: { value: n },
      uF: { value: fixedF ?? 0.38 },
      uFam: { value: fixedFam ?? 1 },
      uR: { value: radius },
      uPx: { value: px },
      uSpin: { value: spin },
      uLo: { value: GRAIN_LIMB.clone().convertSRGBToLinear() },
      uMid: { value: GRAIN.clone().convertSRGBToLinear() },
      uHi: { value: LIT.clone().convertSRGBToLinear() },
      uLitMix: { value: litMix },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [n]
  )
  const dpr = useThree((s) => s.viewport.dpr)
  useFrame(() => {
    const u = mat.current.uniforms
    u.uR.value = radius
    u.uPx.value = px * dpr
    if (fRef) u.uF.value = fRef.current
    if (famRef) u.uFam.value = famRef.current
  })
  return (
    <group position={[x, 0, y]}>
      {/* the body: a gilt ground under the grains. It also occludes the far
          hemisphere, so grains behind the sphere never show through. */}
      <mesh renderOrder={0}>
        <sphereGeometry args={[radius * 0.995, 96, 48]} />
        <shaderMaterial vertexShader={bodyVert} fragmentShader={bodyFrag} />
      </mesh>
      <points geometry={geo} renderOrder={1}>
        <shaderMaterial
          ref={mat}
          vertexShader={vert}
          fragmentShader={frag}
          uniforms={uniforms}
          transparent
          depthWrite={false}
        />
      </points>
      <Hairline radius={radius * 1.035} opacity={0.22} />
    </group>
  )
}

function Hairline({ radius, opacity }) {
  const geo = useMemo(() => {
    const pts = []
    for (let k = 0; k <= 256; k++) {
      const a = (k / 256) * Math.PI * 2
      pts.push(new THREE.Vector3(Math.cos(a) * radius, 2000, Math.sin(a) * radius))
    }
    return new THREE.BufferGeometry().setFromPoints(pts)
  }, [radius])
  return (
    <line geometry={geo}>
      <lineBasicMaterial color={GOLD} transparent opacity={opacity} />
    </line>
  )
}

// Layout in CSS px, shared with the DOM overlay through App.jsx.
export function layout(w, h) {
  const narrow = w < 820
  if (narrow) {
    const R = Math.min(w * 0.4, h * 0.26)
    const cx = w / 2
    const cy = 24 + R + 18
    const r = Math.min(26, (w - 48 - 4 * 10) / 10)
    const ladderY = h - 70
    const ladder = LADDER.map((_, k) => ({ cx: 24 + r + k * (2 * r + 10), cy: ladderY, r }))
    return { narrow, R, cx, cy, ladder }
  }
  const R = Math.min(h * 0.4, w * 0.27)
  const cx = w * 0.655
  const cy = h * 0.5
  const col0 = Math.max(48, w * 0.06)
  const r = Math.min(40, (Math.min(w * 0.36, 520) - 4 * 16) / 10)
  const ladderY = h - 78 - r
  const ladder = LADDER.map((_, k) => ({ cx: col0 + r + k * (2 * r + 16), cy: ladderY, r }))
  return { narrow, R, cx, cy, ladder, col0 }
}

export default function Scene({ n, fRef, famRef }) {
  const { size } = useThree()
  const L = layout(size.width, size.height)
  // screen (css px, y down) → world (x right, z down on screen when looking along −Y)
  const toX = (sx) => sx - size.width / 2
  const toZ = (sy) => sy - size.height / 2
  const spot = Math.max(2.2, L.R * 0.03)
  return (
    <>
      <color attach="background" args={[INK]} />
      <Field n={n} fRef={fRef} famRef={famRef} radius={L.R} x={toX(L.cx)} y={toZ(L.cy)} px={spot} />
      {LADDER.map((s, k) => (
        <Field
          key={s.label}
          n={420}
          fixedF={s.f}
          fixedFam={1}
          radius={L.ladder[k].r}
          x={toX(L.ladder[k].cx)}
          y={toZ(L.ladder[k].cy)}
          px={Math.max(1.6, L.ladder[k].r * 0.085)}
        />
      ))}
    </>
  )
}
