import { useMemo, useRef, useEffect } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { ContactShadows } from '@react-three/drei'
import * as THREE from 'three'
import { NX, NY, DX, L, D, HEAD, CAPILLARY, createPillow, step, measure, settle } from './rig.js'

// rig (x, y, height)  →  world (x, height, y)

const fabricVert = /* glsl */ `
  attribute float aLoad;
  attribute float aPress;
  attribute float aContact;
  varying vec3 vN;
  varying vec3 vW;
  varying vec2 vUv;
  varying float vLoad;
  varying float vPress;
  varying float vContact;
  void main() {
    vN = normalize(normal);
    vW = position;
    vUv = uv;
    vLoad = aLoad;
    vPress = aPress;
    vContact = aContact;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const fabricFrag = /* glsl */ `
  uniform vec3 uCloth;
  uniform vec3 uShade;
  uniform vec3 uInk;
  uniform vec3 uGold;
  uniform vec3 uLight;
  uniform float uCap;
  uniform float uStep;
  uniform vec3 uSkull;
  uniform vec3 uAxes;
  varying vec3 vN;
  varying vec3 vW;
  varying vec2 vUv;
  varying float vLoad;
  varying float vPress;
  varying float vContact;

  float iso(float f) {
    float g = abs(fract(f - 0.5) - 0.5);
    return 1.0 - smoothstep(0.0, max(fwidth(f), 1e-4) * 1.1, g);
  }

  void main() {
    vec3 n = normalize(vN);
    float lam = dot(n, normalize(uLight)) * 0.5 + 0.5;
    lam = pow(lam, 1.6);
    // Plain weave: two crossing sinusoids at ~1.6 mm, barely there.
    float fw = fwidth(vW.x * 3900.0);
    float weave = 0.5 + 0.5 * sin(vW.x * 3900.0) * sin(vW.z * 3900.0) * (1.0 - smoothstep(0.2, 0.9, fw));
    vec3 col = mix(uShade, uCloth, lam) * (0.985 + 0.03 * weave);

    // Foam load k·w, in kPa: where the cover hands the head to the springs.
    float q = vLoad / uStep;
    float line = iso(q) * smoothstep(0.02, 0.12, q);
    float major = iso(q * 0.25) * smoothstep(0.02, 0.12, q);
    col = mix(col, uInk, max(line * 0.38, major * 0.8));

    // Gap between the cloth and the skull above it, evaluated per fragment
    // so the edge of the contact patch is not the 5 mm grid's staircase.
    vec2 e = (vW.xz - uSkull.xz) / uAxes.xz;
    float r = 1.0 - dot(e, e);
    float gap = r > 0.0 ? (uSkull.y - uAxes.y * sqrt(r)) - vW.y : 1.0;
    float inside = 1.0 - smoothstep(0.0006, 0.0016, gap);

    // Above capillary closing pressure, on the skull only.
    float hot = smoothstep(uCap * 0.97, uCap * 1.03, vPress) * inside;
    col = mix(col, uGold, hot * 0.38);

    // The edge of the contact patch.
    float c = inside - 0.5;
    float edge = 1.0 - smoothstep(0.0, max(fwidth(c), 1e-4) * 1.4, abs(c));
    col = mix(col, uInk, edge * 0.9);

    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`

function buildPillowGeometry(pillow) {
  const n = NX * NY
  const geo = new THREE.BufferGeometry()
  const pos = new Float32Array(n * 3)
  const uv = new Float32Array(n * 2)
  for (let j = 0; j < NY; j++)
    for (let i = 0; i < NX; i++) {
      const id = j * NX + i
      pos[id * 3] = -L / 2 + i * DX
      pos[id * 3 + 1] = pillow.h0[id]
      pos[id * 3 + 2] = -D / 2 + j * DX
      uv[id * 2] = i / (NX - 1)
      uv[id * 2 + 1] = j / (NY - 1)
    }
  const idx = []
  for (let j = 0; j < NY - 1; j++)
    for (let i = 0; i < NX - 1; i++) {
      const a = j * NX + i
      idx.push(a, a + NX, a + 1, a + 1, a + NX, a + NX + 1)
    }
  geo.setIndex(idx)
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  geo.setAttribute('aLoad', new THREE.BufferAttribute(new Float32Array(n), 1))
  geo.setAttribute('aPress', new THREE.BufferAttribute(new Float32Array(n), 1))
  geo.setAttribute('aContact', new THREE.BufferAttribute(new Float32Array(n), 1))
  geo.computeVertexNormals()
  return geo
}

// The skull, drawn as the lines a pattern-cutter would chalk on it.
function buildSkullLines() {
  const { a, b, c } = HEAD
  const pts = []
  const seg = 96
  for (let k = -6; k <= 0; k++) {
    const z = (k / 7) * c
    const r = Math.sqrt(1 - (z * z) / (c * c))
    for (let s = 0; s < seg; s++) {
      const t0 = (s / seg) * Math.PI * 2
      const t1 = ((s + 1) / seg) * Math.PI * 2
      pts.push(a * r * Math.cos(t0), z, b * r * Math.sin(t0))
      pts.push(a * r * Math.cos(t1), z, b * r * Math.sin(t1))
    }
  }
  for (let m = 0; m < 12; m++) {
    const ph = (m / 12) * Math.PI * 2
    for (let s = 0; s < seg / 2; s++) {
      const t0 = (s / (seg / 2)) * (Math.PI / 2) - Math.PI / 2
      const t1 = ((s + 1) / (seg / 2)) * (Math.PI / 2) - Math.PI / 2
      pts.push(a * Math.cos(t0) * Math.cos(ph), c * Math.sin(t0), b * Math.cos(t0) * Math.sin(ph))
      pts.push(a * Math.cos(t1) * Math.cos(ph), c * Math.sin(t1), b * Math.cos(t1) * Math.sin(ph))
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
  return g
}

// Copy the solver's state into the mesh. Called once at build time as well:
// headless capture can reach the screenshot before the first useFrame.
function writeGeometry(geo, pillow) {
  const pos = geo.attributes.position.array
  const load = geo.attributes.aLoad.array
  const press = geo.attributes.aPress.array
  const cont = geo.attributes.aContact.array
  const { h0, w, k, p, contact } = pillow
  for (let id = 0; id < h0.length; id++) {
    pos[id * 3 + 1] = h0[id] - w[id]
    load[id] = (k[id] * w[id]) / 1e3
    press[id] = p[id] / 1e3
    cont[id] = contact[id]
  }
  // Carry the rim pressure two nodes outward, so the gold fill can be clipped
  // by the per-fragment contact test instead of fading over a grid cell.
  for (let pass = 0; pass < 2; pass++) {
    const src = press.slice()
    for (let id = NX; id < h0.length - NX; id++) {
      if (contact[id]) continue
      const m = Math.max(src[id - 1], src[id + 1], src[id - NX], src[id + NX])
      if (m > press[id]) press[id] = m
    }
  }
  geo.attributes.position.needsUpdate = true
  geo.attributes.aLoad.needsUpdate = true
  geo.attributes.aPress.needsUpdate = true
  geo.attributes.aContact.needsUpdate = true
  geo.computeVertexNormals()
}

export default function Scene({ tensionRef, statsRef, view }) {
  // Settle before the first frame: headless capture only gets a handful of
  // frames, and a pillow that is still sinking reads as an undented one.
  const pillow = useMemo(() => {
    const s = createPillow()
    s.T = tensionRef.current
    settle(s, 400)
    return s
  }, [])
  const geo = useMemo(() => {
    const g = buildPillowGeometry(pillow)
    writeGeometry(g, pillow)
    return g
  }, [pillow])
  const skullGeo = useMemo(() => buildSkullLines(), [])
  const skull = useRef()
  const target = useRef({ x: pillow.hx, y: pillow.hy })
  const frame = useRef(0)
  const { camera } = useThree()

  const uniforms = useMemo(
    () => ({
      uCloth: { value: new THREE.Color('#FBFAF6') },
      uShade: { value: new THREE.Color('#C9C5BB') },
      uInk: { value: new THREE.Color('#141414') },
      uGold: { value: new THREE.Color('#8C7B4E') },
      uLight: { value: new THREE.Vector3(-0.45, 1.0, 0.55) },
      uCap: { value: CAPILLARY / 1e3 },
      uStep: { value: 0.25 },
      uSkull: { value: new THREE.Vector3(pillow.hx, pillow.zc, pillow.hy) },
      uAxes: { value: new THREE.Vector3(HEAD.a, HEAD.c, HEAD.b) },
    }),
    [pillow]
  )

  useEffect(() => {
    camera.position.set(...view.pos)
    camera.lookAt(...view.look)
  }, [camera, view])

  useFrame((_, dt) => {
    pillow.T = tensionRef.current
    const lerp = 1 - Math.exp(-Math.min(dt, 0.05) * 6)
    pillow.hx += (target.current.x - pillow.hx) * lerp
    pillow.hy += (target.current.y - pillow.hy) * lerp
    // Twice per frame for the first second so a cold start settles fast.
    const reps = frame.current < 60 ? 3 : 1
    for (let r = 0; r < reps; r++) step(pillow, 24)
    frame.current++

    writeGeometry(geo, pillow)

    if (skull.current) skull.current.position.set(pillow.hx, pillow.zc, pillow.hy)
    uniforms.uSkull.value.set(pillow.hx, pillow.zc, pillow.hy)
    if (frame.current % 6 === 0) statsRef.current = measure(pillow)
  })

  const onMove = (e) => {
    target.current.x = THREE.MathUtils.clamp(e.point.x, -0.19, 0.19)
    target.current.y = THREE.MathUtils.clamp(e.point.z, -0.1, 0.1)
  }

  return (
    <>
      <mesh geometry={geo} onPointerMove={onMove}>
        <shaderMaterial
          vertexShader={fabricVert}
          fragmentShader={fabricFrag}
          uniforms={uniforms}
          extensions={{ derivatives: true }}
        />
      </mesh>
      <group ref={skull} position={[pillow.hx, pillow.zc, pillow.hy]}>
        <lineSegments geometry={skullGeo}>
          <lineBasicMaterial color="#8C7B4E" transparent opacity={0.85} />
        </lineSegments>
        <mesh scale={[HEAD.a, HEAD.c, HEAD.b]}>
          <sphereGeometry args={[1, 48, 16, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2]} />
          <meshBasicMaterial color="#8C7B4E" transparent opacity={0.05} depthWrite={false} />
        </mesh>
      </group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.0005, 0]}>
        <planeGeometry args={[8, 8]} />
        <meshBasicMaterial color="#B8B1A3" toneMapped={false} />
      </mesh>
      <ContactShadows position={[0, 0, 0]} scale={1.1} blur={2.6} far={0.12} opacity={0.5} resolution={512} color="#2a251c" />
    </>
  )
}
