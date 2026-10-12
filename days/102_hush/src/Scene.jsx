import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { MODES, envelopes, visHz, visK } from './rig.js'

const N = MODES.length
const FLOOR = -3.2
const BRONZE = new THREE.Color('#a89068')
const GROUND = '#212121'

// ── the modal sum, written once and pasted into both shaders ───────────────
const MODAL_GLSL = /* glsl */ `
  #define NM ${N}
  uniform vec4 uMode[NM];   // m, n, amplitude now, phase now
  uniform float uK[NM];     // floor wavenumber
  uniform float uBend;
  float plate(vec2 xz) {
    float r = length(xz);
    float th = atan(xz.y, xz.x);
    float rho = clamp((r - 0.22) / 0.78, 0.0, 1.0);
    float w = 0.0;
    for (int i = 0; i < NM; i++) {
      vec4 M = uMode[i];
      if (M.z < 1e-5) continue;
      float radial = sin((M.y + 0.5) * 3.14159265 * rho) * rho;
      w += M.z * radial * cos(M.x * th) * cos(M.w);
    }
    return w * uBend;
  }
`

function useModeUniforms() {
  return useMemo(
    () => ({
      uMode: { value: MODES.map((k) => new THREE.Vector4(k.m, k.n, 0, 0)) },
      uK: { value: MODES.map((k) => visK(k.f)) },
      uBend: { value: 0.038 },
      uTime: { value: 0 },
      uFront: { value: 0 },
    }),
    []
  )
}

// ── cymbal: lathe, bell + bow, 1 unit = 7" ─────────────────────────────────
function cymbalGeometry() {
  const h = (r) => 0.1 * THREE.MathUtils.smoothstep(0.3 - r, 0, 0.14) + 0.075 * (1 - r)
  const pts = []
  const S = 90
  for (let i = 0; i <= S; i++) {
    const r = 0.035 + (1 - 0.035) * (i / S)
    pts.push(new THREE.Vector2(r, h(r)))
  }
  for (let i = S; i >= 0; i--) {
    const r = 0.035 + (1 - 0.035) * (i / S)
    pts.push(new THREE.Vector2(r, h(r) - 0.012))
  }
  return new THREE.LatheGeometry(pts, 192)
}

function Cymbal({ uniforms, flip = false, y = 0 }) {
  const geo = useMemo(cymbalGeometry, [])
  const mat = useMemo(() => {
    const m = new THREE.MeshPhysicalMaterial({
      color: BRONZE,
      metalness: 1,
      roughness: 0.3,
      anisotropy: 0.85, // lathe grooves run around: uv.x is circumferential
      clearcoat: 0.25,
      clearcoatRoughness: 0.2,
      envMapIntensity: 1.1,
      side: THREE.DoubleSide,
    })
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, { uMode: uniforms.uMode, uK: uniforms.uK, uBend: uniforms.uBend })
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\n' + MODAL_GLSL)
        .replace(
          '#include <beginnormal_vertex>',
          `#include <beginnormal_vertex>
           float e = 0.02;
           float w0 = plate(position.xz);
           float wx = plate(position.xz + vec2(e, 0.0));
           float wz = plate(position.xz + vec2(0.0, e));
           objectNormal = normalize(objectNormal + vec3(-(wx - w0) / e, 0.0, -(wz - w0) / e) * sign(objectNormal.y + 1e-4));`
        )
        .replace('#include <begin_vertex>', `#include <begin_vertex>\n transformed.y += w0;`)
    }
    return m
  }, [uniforms])
  return <mesh geometry={geo} material={mat} position={[0, y, 0]} scale={[1, flip ? -1 : 1, 1]} />
}

// ── the air outside: a field of points on the floor ───────────────────────
function Field({ uniforms }) {
  const geo = useMemo(() => {
    const G = 230
    const span = 19
    const pos = []
    for (let i = 0; i < G; i++)
      for (let j = 0; j < G; j++) {
        const x = (i / (G - 1) - 0.5) * span
        const z = (j / (G - 1) - 0.5) * span
        const r = Math.hypot(x, z)
        if (r < 0.55 || r > span * 0.5) continue
        pos.push(x, FLOOR, z)
      }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    return g
  }, [])
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: { ...uniforms, uDpr: { value: 1 }, uBronze: { value: BRONZE }, uLit: { value: new THREE.Color('#f8c800') } },
        vertexShader: /* glsl */ `
          ${MODAL_GLSL}
          uniform float uFront;
          uniform float uDpr;
          varying float vP;
          varying float vFade;
          void main() {
            vec3 p = position;
            float r = length(p.xz);
            float s = 0.0;
            if (r < uFront) {
              for (int i = 0; i < NM; i++) {
                vec4 M = uMode[i];
                if (M.z < 1e-5) continue;
                s += M.z * cos(uK[i] * r - M.w);
              }
              s *= 1.0 / sqrt(max(r, 1.0)) * smoothstep(uFront, uFront - 1.2, r);
            }
            vP = s;
            vFade = smoothstep(9.5, 4.0, r);
            p.y += s * 0.22;
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            gl_Position = projectionMatrix * mv;
            float a = sqrt(abs(s) * 2.2);
            gl_PointSize = uDpr * (1.1 + 3.4 * clamp(a, 0.0, 1.0)) * (6.0 / -mv.z);
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uBronze;
          uniform vec3 uLit;
          varying float vP;
          varying float vFade;
          void main() {
            vec2 c = gl_PointCoord - 0.5;
            if (dot(c, c) > 0.25) discard;
            float a = clamp(sqrt(abs(vP) * 2.2), 0.0, 1.0);
            vec3 rest = vec3(0.30);
            vec3 col = mix(rest, vP > 0.0 ? uLit : uBronze, a);
            gl_FragColor = vec4(col, (0.35 + 0.65 * a) * vFade);
          }`,
      }),
    [uniforms]
  )
  const { gl } = useThree()
  mat.uniforms.uDpr.value = gl.getPixelRatio()
  return <points geometry={geo} material={mat} />
}

// ── stand ──────────────────────────────────────────────────────────────────
function Stand() {
  const steel = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#8a8a8a', metalness: 1, roughness: 0.35 }),
    []
  )
  const legs = [0, 1, 2].map((i) => {
    const a = (i / 3) * Math.PI * 2 + 0.6
    const foot = new THREE.Vector3(Math.cos(a) * 0.95, FLOOR, Math.sin(a) * 0.95)
    const hip = new THREE.Vector3(0, FLOOR + 1.0, 0)
    const mid = foot.clone().add(hip).multiplyScalar(0.5)
    const len = foot.distanceTo(hip)
    const q = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      hip.clone().sub(foot).normalize()
    )
    return <mesh key={i} position={mid} quaternion={q} material={steel}>
      <cylinderGeometry args={[0.018, 0.018, len, 10]} />
    </mesh>
  })
  return (
    <group>
      <mesh position={[0, (FLOOR - 0.1) / 2, 0]} material={steel}>
        <cylinderGeometry args={[0.022, 0.026, -FLOOR - 0.1, 12]} />
      </mesh>
      <mesh position={[0, 0.16, 0]} material={steel}>
        <cylinderGeometry args={[0.01, 0.01, 0.4, 8]} />
      </mesh>
      {legs}
    </group>
  )
}

// ── the box: a clear dome that comes down when HUSH is on ──────────────────
function Box({ levelRef }) {
  const grp = useRef()
  const shell = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        color: '#e8e8e0',
        metalness: 0,
        roughness: 0.04,
        transparent: true,
        opacity: 0.1,
        envMapIntensity: 1.4,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    []
  )
  const line = useMemo(() => new THREE.LineBasicMaterial({ color: '#f0f0e0', transparent: true, opacity: 0.55 }), [])
  const rings = useMemo(() => {
    const mk = (y, r) => {
      const pts = []
      for (let i = 0; i <= 128; i++) {
        const a = (i / 128) * Math.PI * 2
        pts.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r))
      }
      return new THREE.BufferGeometry().setFromPoints(pts)
    }
    return [mk(-0.32, 1.22), mk(0.42, 1.22), mk(0.72, 0.67)]
  }, [])
  useFrame(() => {
    const g = grp.current
    // level is a function of the conductor's clock, not of frame count, so a
    // slow renderer shows the same box as a fast one at the same moment
    const vis = levelRef.current
    g.position.y = 2.6 * (1 - vis)
    shell.opacity = 0.1 * vis + 0.02
    line.opacity = 0.6 * vis + 0.08
  })
  return (
    <group ref={grp} position={[0, 2.6, 0]}>
      <mesh material={shell} position={[0, 0.05, 0]}>
        <cylinderGeometry args={[1.22, 1.22, 0.74, 96, 1, true]} />
      </mesh>
      <mesh material={shell} position={[0, 0.42 - 2.0 * Math.cos(Math.asin(1.22 / 2.0)), 0]}>
        <sphereGeometry args={[2.0, 96, 24, 0, Math.PI * 2, 0, Math.asin(1.22 / 2.0)]} />
      </mesh>
      {rings.map((g, i) => (
        <line key={i} geometry={g} material={line} />
      ))}
    </group>
  )
}

export default function Scene({ clock }) {
  const levelRef = useRef(0)
  const uniforms = useModeUniforms()
  const amps = useMemo(() => new Float32Array(N), [])
  const { scene, gl, camera } = useThree()

  useEffect(() => {
    const pm = new THREE.PMREMGenerator(gl)
    const env = pm.fromScene(new RoomEnvironment(), 0.04).texture
    scene.environment = env
    scene.background = new THREE.Color(GROUND)
    return () => env.dispose()
  }, [gl, scene])

  useEffect(() => {
    camera.lookAt(-1.0, -1.05, 0)
  }, [camera])

  const top = useRef()
  useFrame(() => {
    const t = clock.current.now()
    const since = clock.current.since(t)
    let lv = 0
    for (let k = 0; k < 6; k++) lv += clock.current.boxAt(t - k * 0.09) ? 1 : 0
    levelRef.current = THREE.MathUtils.smootherstep(lv / 6, 0, 1)
    envelopes(since, clock.current.hushAt(t), amps)
    const um = uniforms.uMode.value
    for (let i = 0; i < N; i++) {
      um[i].z = amps[i]
      um[i].w = 2 * Math.PI * visHz(MODES[i].f) * since + MODES[i].phase
    }
    uniforms.uFront.value = Math.max(0, since) * 4.5 + 0.6
    // the top cymbal comes down on the bottom one at the strike ("chick")
    if (top.current) top.current.position.y = 0.06 + 0.035 * Math.min(1, Math.max(0, 1 - since * 3))
  })

  return (
    <>
      <group position={[0, 0, 0]} rotation={[0.08, 0, -0.05]}>
        <group ref={top}>
          <Cymbal uniforms={uniforms} />
        </group>
        <Cymbal uniforms={uniforms} flip y={0.012} />
      </group>
      <Stand />
      <Box levelRef={levelRef} />
      <Field uniforms={uniforms} />
    </>
  )
}
