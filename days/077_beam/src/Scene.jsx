import React, { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { SWELL_GLSL, H, B_CRIT, FRONT_SPEED, step } from './rig.js'

// uki's measured palette: 若草 #E2F4BE / 淡黄 #FFF8BE / 淡水色 #CFEFF8 / 近黒 #14151F.
// Three pastels and one near-black. Nothing else is allowed in, including grey.
const PAPER = '#FFFCEC'
const SEA = '#CFEFF8'
const SEA_DEEP = '#9CD3EA'
const DECK = '#E2F4BE'
const HULL = '#FFF8BE'
const SIDE = '#FDF9E8'
const WET = '#A8D8EA'
const INK = '#14151F'

const FRONT_Z = 1.25 // every hull is aligned by its near face, not its centre,
// so that the one straight line the piece is about is also one straight line on
// the screen. The lengths then run backwards, where they can be seen not to matter.

const CAM = { dist: 20, elev: (24 * Math.PI) / 180, fov: 30, lead: 2.0, lag: 0.4 }

const hexv = (h) => new THREE.Color(h)

// ── the sea ─────────────────────────────────────────────────────────────────
// A finite band of water on a cream page, not a world. It is drawn last and
// half transparent, because the thing this piece is about — where the line
// crosses each hull — is exactly the place an opaque sea hides.
function Water({ sim }) {
  const uniforms = useMemo(
    () => ({
      uFront: { value: 0 },
      uSea: { value: hexv(SEA) },
      uDeep: { value: hexv(SEA_DEEP) },
    }),
    []
  )
  useFrame(() => {
    uniforms.uFront.value = sim.current.front
  })
  const geo = useMemo(() => {
    const g = new THREE.PlaneGeometry(190, 62, 1100, 2)
    g.rotateX(-Math.PI / 2)
    g.translate(0, 0, 9)
    return g
  }, [])
  return (
    <mesh geometry={geo} frustumCulled={false} renderOrder={20}>
      <shaderMaterial
        transparent
        depthWrite={false}
        uniforms={uniforms}
        vertexShader={`
          uniform float uFront;
          varying vec3 vW;
          ${SWELL_GLSL}
          void main() {
            vec4 wp = modelMatrix * vec4(position, 1.0);
            wp.y += swell(wp.x, uFront);
            vW = wp.xyz;
            gl_Position = projectionMatrix * viewMatrix * wp;
          }
        `}
        fragmentShader={`
          uniform float uFront;
          uniform vec3 uSea, uDeep;
          varying vec3 vW;
          ${SWELL_GLSL}
          void main() {
            float h = swell(vW.x, uFront);
            vec3 c = mix(uSea, uDeep, smoothstep(0.045, 0.098, h) * 0.20);
            float a = 0.60;
            // The far edge of the band dissolves into the page instead of ending.
            a *= 1.0 - smoothstep(-6.0, -20.0, vW.z);
            gl_FragColor = vec4(c, a);
          }
        `}
      />
    </mesh>
  )
}

// ── hulls ───────────────────────────────────────────────────────────────────
// One material for all twenty-seven. They differ in beam, in length, and in
// what they did about it.
function Fleet({ sim }) {
  const uniforms = useMemo(
    () => ({
      uFront: { value: 0 },
      uDeck: { value: hexv(DECK) },
      uHull: { value: hexv(HULL) },
      uSide: { value: hexv(SIDE) },
      uWet: { value: hexv(WET) },
      uInk: { value: hexv(INK) },
      uLight: { value: new THREE.Vector3(-0.42, 0.80, 0.43).normalize() },
    }),
    []
  )
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms,
        vertexShader: `
          varying vec3 vW;
          varying vec3 vN;
          void main() {
            vec4 wp = modelMatrix * vec4(position, 1.0);
            vW = wp.xyz;
            vN = normalize(mat3(modelMatrix) * normal);
            gl_Position = projectionMatrix * viewMatrix * wp;
          }
        `,
        fragmentShader: `
          uniform float uFront;
          uniform vec3 uDeck, uHull, uSide, uWet, uInk, uLight;
          varying vec3 vW;
          varying vec3 vN;
          ${SWELL_GLSL}
          void main() {
            vec3 n = normalize(vN);
            float lam = max(dot(n, normalize(uLight)), 0.0);
            vec3 base = mix(uSide, uHull, smoothstep(0.35, 0.02, abs(n.z)));
            base = mix(base, uDeck, smoothstep(0.55, 0.88, n.y));
            vec3 c = base * (0.86 + 0.17 * lam);
            float wl = swell(vW.x, uFront);
            float d = vW.y - wl;
            // Under the surface every hull is the same colour, because under the
            // surface every hull is the same depth.
            if (d < 0.0) c = mix(c, uWet, 0.45);
            // The line itself is the subject, so it is drawn rather than implied
            // — and drawn just above the water so the water cannot cover it.
            c = mix(c, uInk, smoothstep(0.034, 0.008, d) * step(0.0, d) * 0.92);
            gl_FragColor = vec4(c, 1.0);
          }
        `,
      }),
    [uniforms]
  )

  const box = useMemo(() => new THREE.BoxGeometry(1, 1, 1), [])
  const edges = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), [])
  const edgeMat = useMemo(
    () => new THREE.LineBasicMaterial({ color: INK, transparent: true, opacity: 0.42 }),
    []
  )
  const group = useRef()

  useFrame((_, delta) => {
    const s = sim.current
    const dt = Math.min(delta, 1 / 30)
    // The swell is not allowed to teleport, however fast the page is scrolled.
    const diff = s.targetFront - s.front
    const mv = FRONT_SPEED * dt
    s.front += Math.abs(diff) <= mv ? diff : Math.sign(diff) * mv
    step(s.fleet, s.front, dt)
    uniforms.uFront.value = s.front

    const g = group.current
    const n = s.fleet.length
    for (let i = 0; i < n; i++) {
      const b = s.fleet[i]
      const m = g.children[i]
      m.position.set(b.x, b.y, FRONT_Z - b.len / 2)
      m.rotation.z = b.phi
      const e = g.children[n + i]
      e.position.copy(m.position)
      e.rotation.z = b.phi
    }
  })

  const fleet = sim.current.fleet
  return (
    <group ref={group}>
      {fleet.map((b) => (
        <mesh key={`h${b.i}`} geometry={box} material={mat} scale={[b.b, H, b.len]} />
      ))}
      {fleet.map((b) => (
        <lineSegments
          key={`e${b.i}`}
          geometry={edges}
          material={edgeMat}
          scale={[b.b, H, b.len]}
          renderOrder={4}
        />
      ))}
    </group>
  )
}

// ── the number, standing in the water ───────────────────────────────────────
// A rule laid across the sea at the place where b crosses 1.200. It marks a
// value, not an object: there is no hull there, and nothing happens at it.
function Threshold({ sim }) {
  const fleet = sim.current.fleet
  const x = useMemo(() => {
    for (let i = 1; i < fleet.length; i++) {
      if (fleet[i].b >= B_CRIT) {
        const t = (B_CRIT - fleet[i - 1].b) / (fleet[i].b - fleet[i - 1].b)
        return fleet[i - 1].x + t * (fleet[i].x - fleet[i - 1].x)
      }
    }
    return 0
  }, [fleet])
  return (
    <group position={[x, 0, -2.8]}>
      <mesh position={[0, 0.85, 0]}>
        <boxGeometry args={[0.032, 1.7, 0.032]} />
        <meshBasicMaterial color={INK} />
      </mesh>
      <mesh position={[0.27, 1.58, 0]}>
        <boxGeometry args={[0.52, 0.3, 0.02]} />
        <meshBasicMaterial color={DECK} />
      </mesh>
      <mesh position={[0.27, 1.58, -0.012]}>
        <boxGeometry args={[0.56, 0.34, 0.008]} />
        <meshBasicMaterial color={INK} />
      </mesh>
    </group>
  )
}

function Rig({ sim }) {
  const { camera } = useThree()
  useFrame(() => {
    const cx = sim.current.front - CAM.lead - CAM.lag
    camera.position.set(cx, CAM.dist * Math.sin(CAM.elev), CAM.dist * Math.cos(CAM.elev))
    camera.lookAt(cx, 1.85, 0)
    camera.updateProjectionMatrix()
  })
  return null
}

export default function Scene({ sim }) {
  return (
    <>
      <color attach="background" args={[PAPER]} />
      <fog attach="fog" args={[PAPER, 20, 44]} />
      <Rig sim={sim} />
      <Threshold sim={sim} />
      <Fleet sim={sim} />
      <Water sim={sim} />
    </>
  )
}

export { CAM, PAPER, INK }
