import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { solveFrame } from './rig.js'

// ── palette ─────────────────────────────────────────────────────────────────
// Space Capital's measured tonality: dark navy -> charcoal ground, white type,
// one blue accent. The amber is mine — it marks the two lengths the piece is
// about, and nothing else in the frame is allowed to be warm.
export const BG = '#070b14'

const SKY_WIRE = new THREE.Color('#243c62')
const GHOST_WIRE = new THREE.Color('#131b2b')
const SAT_ON = new THREE.Color('#67d0ff')
const SAT_OFF = new THREE.Color('#0d1320')
const RAY = new THREE.Color('#2a5f89')
const AMBER = new THREE.Color('#ffb454')

const DOME = 3.25
export const MASK_DEG = 5

// ── geometry helpers ────────────────────────────────────────────────────────
// Rings of constant elevation and spokes of constant azimuth — the skyplot a
// GNSS engineer would actually draw, mirrored downward for the half that is
// never served.
function domeWire(radius, sign, rings, spokes) {
  const pts = []
  const at = (elev, az) => {
    const ce = Math.cos(elev)
    return [radius * ce * Math.sin(az), sign * radius * Math.sin(elev), radius * ce * Math.cos(az)]
  }
  const push = (a, b) => pts.push(a[0], a[1], a[2], b[0], b[1], b[2])
  for (const e of rings) {
    const el = (e * Math.PI) / 180
    const N = 72
    for (let i = 0; i < N; i++) push(at(el, (2 * Math.PI * i) / N), at(el, (2 * Math.PI * (i + 1)) / N))
  }
  for (let s = 0; s < spokes; s++) {
    const az = (2 * Math.PI * s) / spokes
    const N = 18
    for (let i = 0; i < N; i++) {
      push(at((Math.PI / 2) * (i / N), az), at((Math.PI / 2) * ((i + 1) / N), az))
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
  return g
}

function ring(radius, y, N = 192) {
  const pts = []
  for (let i = 0; i < N; i++) {
    const a = (2 * Math.PI * i) / N
    const b = (2 * Math.PI * (i + 1)) / N
    pts.push(radius * Math.sin(a), y, radius * Math.cos(a), radius * Math.sin(b), y, radius * Math.cos(b))
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
  return g
}

// ENU -> three (x east, y up, z south)
const toWorld = (u, r) => [r * u[0], r * u[2], -r * u[1]]

// The ground, as a surface with weight rather than an absence.
// It was a void for the first four captures, and that was the wrong call twice
// over: the frame read as "dark field with a bright blob" (0.079 from Day 074
// on the change gate), and — worse — the argument of the piece is that THE
// GROUND DID THIS. Drawing the culprit as nothing undersells it.
const GROUND_R = 10.0
function Ground() {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uNear: { value: new THREE.Color('#222e47') },
          uFar: { value: new THREE.Color('#070b14') },
          uLine: { value: new THREE.Color('#46587c') },
          uR: { value: GROUND_R },
        },
        vertexShader: `
          varying vec2 vP;
          void main() {
            vP = position.xy;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform vec3 uNear, uFar, uLine;
          uniform float uR;
          varying vec2 vP;
          void main() {
            float d = length(vP);
            float fade = 1.0 - smoothstep(0.16, 0.74, d / uR);
            vec3 col = mix(uFar, uNear, fade);
            // survey rings every 1.5 units — the plane needs a scale or it
            // reads as fog rather than as floor
            float ph = fract(d / 1.6);
            float line = smoothstep(0.035, 0.0, min(ph, 1.0 - ph));
            col += uLine * line * fade * 0.40;
            gl_FragColor = vec4(col, 1.0);
            // A raw ShaderMaterial does not get the linear -> sRGB encode that
            // the built-in materials compile in. Without this the slate floor
            // was written as a linear value straight into an sRGB buffer and
            // came out near-black — which is exactly what it looked like.
            #include <colorspace_fragment>
          }
        `,
      }),
    []
  )
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} material={mat} renderOrder={1}>
      <circleGeometry args={[GROUND_R, 128]} />
    </mesh>
  )
}

export default function Scene({ sink, speed = 0.62, fixedHours = null }) {
  const { clock } = useThree()

  const skyG = useMemo(() => domeWire(DOME, 1, [15, 35, 55, 75], 12), [])
  const ghostG = useMemo(() => domeWire(DOME, -1, [15, 35, 55, 75], 12), [])
  const horizonG = useMemo(() => ring(DOME, 0), [])
  const innerG = useMemo(() => ring(DOME * 0.5, 0, 128), [])

  const N = 24
  const satRef = useRef()
  const ghostSatRef = useRef()
  const haloRef = useRef()
  const ellipRef = useRef()
  const ellipWireRef = useRef()
  const ghostBallRef = useRef()
  const colRef = useRef()
  const dscRef = useRef()

  const rayGeom = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(N * 6), 3))
    g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(N * 6), 3))
    return g
  }, [])

  const dummy = useMemo(() => new THREE.Object3D(), [])
  const held = useRef(null)

  useFrame(() => {
    const hours = fixedHours != null ? fixedHours : clock.elapsedTime * speed
    const f = solveFrame(hours, MASK_DEG)
    const real = f.real || held.current?.real
    const full = f.full || held.current?.full
    if (f.real && f.full) held.current = { real: f.real, full: f.full }

    // ── satellites ──────────────────────────────────────────────────────────
    const pos = rayGeom.attributes.position.array
    const col = rayGeom.attributes.color.array
    const maskRad = (MASK_DEG * Math.PI) / 180
    f.all.forEach((s, i) => {
      const lit = s.elev >= maskRad
      // drawn on the dome, not at true range: this is a skyplot, and the solve
      // only ever uses the direction anyway.
      const p = toWorld(s.dir, DOME)
      dummy.position.set(p[0], p[1], p[2])
      // the two populations are separate meshes only so that the buried ones
      // can ignore the depth test and stay visible through the ground
      dummy.scale.setScalar(lit ? 0.055 : 0.0001)
      dummy.updateMatrix()
      satRef.current.setMatrixAt(i, dummy.matrix)
      dummy.scale.setScalar(lit ? 0.0001 : 0.032)
      dummy.updateMatrix()
      ghostSatRef.current.setMatrixAt(i, dummy.matrix)

      dummy.scale.setScalar(lit ? 0.105 : 0.0001)
      dummy.updateMatrix()
      haloRef.current.setMatrixAt(i, dummy.matrix)

      // the ray exists only if the satellite is in the solve. That is the whole
      // point: the ones underfoot contribute nothing, so they get no line.
      const o = i * 6
      pos[o] = 0
      pos[o + 1] = 0
      pos[o + 2] = 0
      pos[o + 3] = lit ? p[0] : 0
      pos[o + 4] = lit ? p[1] : 0
      pos[o + 5] = lit ? p[2] : 0
      // fade the ray in as the satellite clears the mask, so rise and set read
      // as events rather than as pops
      const a = lit ? Math.min(1, (s.elev - maskRad) * 6) : 0
      for (let j = 0; j < 2; j++) {
        const t = j === 0 ? 0.25 : 1 // dim at the receiver, bright at the sky
        col[o + j * 3] = RAY.r * a * t
        col[o + j * 3 + 1] = RAY.g * a * t
        col[o + j * 3 + 2] = RAY.b * a * t
      }
    })
    satRef.current.instanceMatrix.needsUpdate = true
    ghostSatRef.current.instanceMatrix.needsUpdate = true
    haloRef.current.instanceMatrix.needsUpdate = true
    rayGeom.attributes.position.needsUpdate = true
    rayGeom.attributes.color.needsUpdate = true

    // ── the two ellipsoids ──────────────────────────────────────────────────
    // Both in the same units: semi-axes = K * sigma / sigma_x(full sky). So the
    // ghost is a ball of radius K by construction, and every bit of departure
    // from that ball is the ground's doing.
    if (real && full) {
      const K = 0.35
      const ref = full.sx
      const ex = (K * real.sx) / ref
      const ey = (K * real.sy) / ref
      const ez = (K * real.sz) / ref
      ellipRef.current.scale.set(ex, ez, ey)
      ellipWireRef.current.scale.set(ex, ez, ey)
      ghostBallRef.current.scale.set((K * full.sx) / ref, (K * full.sz) / ref, (K * full.sy) / ref)
      // the two lengths, on the axes they measure, so the factor of two is
      // something the eye can check against the table
      colRef.current.scale.set(1, ez, 1)
      dscRef.current.scale.set(ex, ey, 1)
    }

    // ── readout ─────────────────────────────────────────────────────────────
    // Written straight into the DOM. React state here re-renders at 60 Hz for
    // no reason, and under a virtual-time capture the scheduled update can miss
    // the final composite entirely — which is how a previous day shipped a
    // screenshot whose whole table still read "—" (Day 050).
    if (sink?.current) {
      const s = sink.current
      const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : '—')
      const f3 = (x) => (Number.isFinite(x) ? x.toFixed(3) : '—')
      s.H && (s.H.textContent = f2(real?.H))
      s.V && (s.V.textContent = f2(real?.V))
      s.T && (s.T.textContent = f2(real?.T))
      s.ratio && (s.ratio.textContent = f3(real?.perAxis))
      s.rho && (s.rho.textContent = f3(real?.rho))
      s.fratio && (s.fratio.textContent = f3(full?.perAxis))
      s.frho && (s.frho.textContent = f3(full?.rho))
      s.count && (s.count.textContent = `${f.visible.length} of ${f.all.length}`)
      s.epoch && (s.epoch.textContent = `t+${hours.toFixed(2)} h`)
    }
  })

  return (
    <group>
      {/* the ground: a surface, and the thing the piece is accusing */}
      <Ground />

      {/* the half you stand on. Drawn after the ground and with the depth test
          off, so it shows faintly THROUGH the floor — because the problem is
          not that those satellites are gone. They are there. The solve is
          simply not allowed to have them. */}
      <lineSegments geometry={ghostG} renderOrder={2}>
        <lineBasicMaterial
          color={GHOST_WIRE}
          transparent
          opacity={0.62}
          depthTest={false}
          depthWrite={false}
        />
      </lineSegments>

      {/* the cut itself */}
      <lineSegments geometry={innerG} renderOrder={2}>
        <lineBasicMaterial color={'#1b2740'} transparent opacity={0.9} depthWrite={false} />
      </lineSegments>
      <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={3}>
        <ringGeometry args={[DOME - 0.012, DOME + 0.012, 192]} />
        <meshBasicMaterial
          color={'#6d9ad8'}
          side={THREE.DoubleSide}
          transparent
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

      {/* the half that answers */}
      <lineSegments geometry={skyG} renderOrder={4}>
        <lineBasicMaterial color={SKY_WIRE} transparent opacity={0.85} />
      </lineSegments>

      <lineSegments geometry={rayGeom}>
        <lineBasicMaterial vertexColors transparent opacity={0.85} />
      </lineSegments>

      <instancedMesh ref={ghostSatRef} args={[null, null, N]} renderOrder={2}>
        <sphereGeometry args={[1, 10, 8]} />
        <meshBasicMaterial
          color={SAT_OFF}
          transparent
          opacity={0.75}
          depthTest={false}
          depthWrite={false}
          toneMapped={false}
        />
      </instancedMesh>
      <instancedMesh ref={satRef} args={[null, null, N]} renderOrder={5}>
        <sphereGeometry args={[1, 12, 10]} />
        <meshBasicMaterial color={SAT_ON} toneMapped={false} />
      </instancedMesh>
      <instancedMesh ref={haloRef} args={[null, null, N]}>
        <sphereGeometry args={[1, 10, 8]} />
        <meshBasicMaterial
          color={SAT_ON}
          transparent
          opacity={0.16}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </instancedMesh>

      {/* what the solve would give you on the whole sphere: a ball */}
      <mesh ref={ghostBallRef} renderOrder={5}>
        <sphereGeometry args={[1, 32, 22]} />
        <meshBasicMaterial
          color={'#3d536f'}
          wireframe
          transparent
          opacity={0.32}
          depthTest={false}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

      {/* what it actually gives you: a spindle, twice as tall as it is wide */}
      <mesh ref={ellipRef} renderOrder={5}>
        <sphereGeometry args={[1, 48, 32]} />
        <meshBasicMaterial
          color={'#1b6ba6'}
          transparent
          opacity={0.2}
          blending={THREE.AdditiveBlending}
          depthTest={false}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <mesh ref={ellipWireRef} renderOrder={5}>
        <sphereGeometry args={[1, 18, 12]} />
        <meshBasicMaterial
          color={'#7ad4ff'}
          wireframe
          transparent
          opacity={0.5}
          depthTest={false}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

      {/* the two lengths, in amber */}
      <mesh ref={colRef} renderOrder={6}>
        <cylinderGeometry args={[0.009, 0.009, 2, 8]} />
        <meshBasicMaterial color={AMBER} toneMapped={false} depthWrite={false} depthTest={false} />
      </mesh>
      <mesh ref={dscRef} rotation={[-Math.PI / 2, 0, 0]} renderOrder={6}>
        <ringGeometry args={[0.99, 1.0, 96]} />
        <meshBasicMaterial color={AMBER} side={THREE.DoubleSide} toneMapped={false} depthWrite={false} depthTest={false} />
      </mesh>

      {/* the receiver */}
      <mesh renderOrder={7}>
        <sphereGeometry args={[0.038, 16, 12]} />
        <meshBasicMaterial color={'#ffffff'} toneMapped={false} depthTest={false} />
      </mesh>
    </group>
  )
}
