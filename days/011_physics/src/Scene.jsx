import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { Environment, Lightformer, RoundedBox } from '@react-three/drei'
import {
  Physics,
  RigidBody,
  CuboidCollider,
  BallCollider,
} from '@react-three/rapier'

// ── Day 011 · Week II — Motion & Interaction — "Repose" ──────────────────────
// The curriculum's physics day (@react-three/rapier). Rather than a one-off
// "drop a stack and watch it fall", this is an *eternal still-life*: a shallow
// paper dish that a pool of rounded forms rains into, one at a time, tumbling
// and STACKING under real collision. Each piece settles, rests a breath, then
// quietly fades and is recycled to the top — so the cairn keeps a roughly
// constant, ever-rearranging shape. Click anywhere over the dish to STIR it:
// a proximity-weighted impulse burst lifts the nearby pile and lets it resettle.
//
// The three techniques that are new today (physics is the headline), building
// on the instanced fields + damped pointer input of Days 005–010:
//   1. <Physics> + RigidBody — a Rapier world (WASM, base64-inlined compat build
//      → no runtime fetch, offline-safe). Dynamic bodies fall & collide onto a
//      fixed dish floor and a ring of fixed containment walls; real stacking.
//   2. AN IMPERATIVE RECYCLING POOL — N bodies are driven through the Rapier
//      API (setTranslation / setLinvel / setGravityScale / sleep) in one central
//      useFrame: spawn the oldest-parked, retire the oldest-live once LIVE is
//      reached, so the simulation stays bounded and endless. The visual mesh
//      scales in/out (damp) to hide the teleport while the collider stays fixed.
//   3. POINTER → IMPULSE — the Day 009 raycast-to-plane is repurposed: a click's
//      world point seeds a Gaussian exp(-d²/2σ²) impulse over the resting bodies,
//      turning pointer input into forces the solver resolves (not a transform).

const N = 40 // rigid bodies in the recycling pool
const LIVE = 22 // how many are active at once → steady-state cairn size
const SPAWN_DT = 0.5 // seconds between drops
const DISH_R = 2.3 // inner radius of the containing dish
const WALLS = 24 // fixed wall segments forming the ring
const REST_HOLD = 2.1 // seconds a body must rest before it's eligible to retire

const PARK_Y = -40 // where retired bodies wait, gravity off, out of frame

// Curated monaka palette — mostly bone, a scatter of terracotta, a little
// graphite. Shared across bodies by index so materials stay few.
const TONES = [
  { color: '#ece7dd', roughness: 0.62, metalness: 0.0, weight: 0.62 }, // bone
  { color: '#e6ddce', roughness: 0.7, metalness: 0.0, weight: 0.16 }, // sand
  { color: '#c1673f', roughness: 0.42, metalness: 0.04, weight: 0.15 }, // terracotta
  { color: '#3a3a3e', roughness: 0.5, metalness: 0.12, weight: 0.07 }, // graphite
]

const hash = (n) => {
  const s = Math.sin(n * 127.1) * 43758.5453123
  return s - Math.floor(s)
}
const damp = THREE.MathUtils.damp

function pickTone(r) {
  let acc = 0
  for (let k = 0; k < TONES.length; k++) {
    acc += TONES[k].weight
    if (r <= acc) return k
  }
  return 0
}

// Static per-body recipe: shape (rounded box vs sphere), size, tone. Colliders
// are built to match and never rescale — only the visual mesh eases in/out.
function makeBodies() {
  const arr = new Array(N)
  for (let i = 0; i < N; i++) {
    const isBall = hash(i * 2.3 + 0.7) > 0.62
    const s = 0.34 + hash(i * 4.1 + 1.9) * 0.2 // half-extent / radius
    const tone = pickTone(hash(i * 7.7 + 3.3))
    arr[i] = { i, isBall, s, tone }
  }
  return arr
}

// The pool + its bookkeeping. A single controller reads/writes every Rapier API
// each frame: it spawns, retires, and eases each visual mesh's scale so the
// teleport-to-park is never seen.
function Repose({ stirRef }) {
  const recipes = useMemo(makeBodies, [])
  const apis = useRef([]) // Rapier RigidBody handles
  const meshes = useRef([]) // inner mesh (scaled for fade in/out)

  // Per-body runtime state, mirrored from the recipes.
  const st = useRef(
    recipes.map(() => ({
      state: 'park', // 'park' | 'live' | 'retire'
      vis: 0, // eased 0..1 → visual scale multiplier
      rest: 0, // seconds spent nearly still
      age: 0, // seconds since spawned (retire oldest first)
    }))
  )
  const clock = useRef({ nextSpawn: 0, started: false, order: [] })

  const spawnAt = (i, x, z, y) => {
    const api = apis.current[i]
    if (!api) return
    const s = st.current[i]
    api.setGravityScale(1, true)
    api.setTranslation({ x, y, z }, true)
    api.setLinvel({ x: 0, y: -1.2, z: 0 }, true)
    api.setAngvel(
      { x: (hash(i + y) - 0.5) * 6, y: (hash(i * 3.1) - 0.5) * 6, z: (hash(i * 5.7) - 0.5) * 6 },
      true
    )
    api.wakeUp()
    s.state = 'live'
    s.vis = 0.001
    s.rest = 0
    s.age = 0
    clock.current.order.push(i)
  }

  const park = (i) => {
    const api = apis.current[i]
    if (!api) return
    api.setLinvel({ x: 0, y: 0, z: 0 }, true)
    api.setAngvel({ x: 0, y: 0, z: 0 }, true)
    api.setTranslation({ x: (hash(i) - 0.5) * 6, y: PARK_Y, z: (hash(i * 9) - 0.5) * 6 }, true)
    api.setGravityScale(0, false)
    api.sleep()
    st.current[i].state = 'park'
    st.current[i].vis = 0
  }

  // A random drop point over the dish — biased toward centre so the cairn builds.
  const dropPoint = (seed) => {
    const a = hash(seed) * Math.PI * 2
    const r = Math.sqrt(hash(seed * 1.7 + 4)) * DISH_R * 0.5
    return [Math.cos(a) * r, Math.sin(a) * r]
  }

  useFrame((state, delta) => {
    const dt = Math.min(delta, 1 / 30) // clamp so a stalled tab can't explode logic
    const S = st.current
    const C = clock.current

    // One-time: send everything to park (gravity off, below frame).
    if (!C.started) {
      for (let i = 0; i < N; i++) park(i)
      C.started = true
      C.nextSpawn = state.clock.elapsedTime + 0.4
    }

    // Retire the oldest live body once we're at capacity and it's been resting.
    const liveCount = C.order.length
    if (liveCount >= LIVE) {
      const oldest = C.order[0]
      if (oldest != null && S[oldest].state === 'live' && S[oldest].rest > REST_HOLD) {
        S[oldest].state = 'retire' // begins fade-out; still collides until gone
      }
    }

    // Spawn cadence — activate the next parked body over the dish. Scheduled on
    // the wall clock (not the frame accumulator) so drops stay on time even if
    // the frame rate dips — one dropped frame must not skip a dozen drops.
    const now = state.clock.elapsedTime
    if (now >= C.nextSpawn) {
      C.nextSpawn = now + SPAWN_DT
      const idle = []
      for (let i = 0; i < N; i++) if (S[i].state === 'park') idle.push(i)
      if (idle.length && C.order.length < LIVE + 2) {
        const i = idle[Math.floor(hash(now * 13.7) * idle.length) % idle.length]
        const [x, z] = dropPoint(now * 7.3 + i)
        spawnAt(i, x, z, 5.4 + hash(i * 1.1) * 1.0)
      }
    }

    // Per-body update: rest detection, fade easing, retire → park handoff.
    const nextOrder = []
    for (let idx = 0; idx < C.order.length; idx++) {
      const i = C.order[idx]
      const s = S[i]
      const api = apis.current[i]
      const mesh = meshes.current[i]
      if (!api) continue
      s.age += dt

      if (s.state === 'live') {
        // "At rest" = velocity below a small threshold (Rapier keeps the body
        // awake while supporting the pile, so we time stillness ourselves).
        const v = api.linvel()
        const speed2 = v.x * v.x + v.y * v.y + v.z * v.z
        s.rest = speed2 < 0.05 ? s.rest + dt : 0
        s.vis = damp(s.vis, 1, 7, dt) // ease the drop's fade-in
        nextOrder.push(i)
      } else if (s.state === 'retire') {
        s.vis = damp(s.vis, 0, 9, dt) // quiet fade-out
        if (s.vis < 0.02) park(i) // gone → recycle; else keep it in nextOrder
        else nextOrder.push(i)
      }

      if (mesh) mesh.scale.setScalar(recipes[i].s * 2 * s.vis)
    }
    C.order = nextOrder

    // Publish a stir handler that reads a world point and applies a radial,
    // proximity-weighted upward impulse — pointer input becomes force.
    stirRef.current = (px, pz) => {
      for (let i = 0; i < N; i++) {
        if (S[i].state === 'park') continue
        const api = apis.current[i]
        if (!api) continue
        const t = api.translation()
        const dx = t.x - px
        const dz = t.z - pz
        const d2 = dx * dx + dz * dz
        const g = Math.exp(-d2 / (2 * 0.9 * 0.9)) // Gaussian falloff (Day 009)
        if (g < 0.02) continue
        api.applyImpulse(
          { x: dx * g * 0.9, y: (1.1 + hash(i * 2.7) * 0.8) * g, z: dz * g * 0.9 },
          true
        )
        api.wakeUp()
      }
    }
  })

  // Three shared materials keyed by tone (bodies reference by index).
  const mats = useMemo(
    () =>
      TONES.map(
        (t) =>
          new THREE.MeshStandardMaterial({
            color: new THREE.Color(t.color),
            roughness: t.roughness,
            metalness: t.metalness,
          })
      ),
    []
  )

  return (
    <group>
      {recipes.map((b) => (
        <RigidBody
          key={b.i}
          ref={(el) => (apis.current[b.i] = el)}
          colliders={false}
          position={[(hash(b.i) - 0.5) * 6, PARK_Y, (hash(b.i * 9) - 0.5) * 6]}
          restitution={0.14}
          friction={0.85}
          linearDamping={0.15}
          angularDamping={0.35}
          ccd
          canSleep
        >
          {b.isBall ? (
            <BallCollider args={[b.s]} />
          ) : (
            <CuboidCollider args={[b.s, b.s, b.s]} />
          )}
          {b.isBall ? (
            <mesh
              ref={(el) => (meshes.current[b.i] = el)}
              castShadow
              receiveShadow
              material={mats[b.tone]}
              scale={0.001}
            >
              <sphereGeometry args={[0.5, 24, 24]} />
            </mesh>
          ) : (
            <RoundedBox
              ref={(el) => (meshes.current[b.i] = el)}
              args={[1, 1, 1]}
              radius={0.14}
              smoothness={3}
              castShadow
              receiveShadow
              material={mats[b.tone]}
              scale={0.001}
            />
          )}
        </RigidBody>
      ))}
    </group>
  )
}

// The shallow dish: a fixed floor plus a ring of thin fixed walls that keep the
// cairn from rolling off. Walls are near-invisible; only a soft rim reads.
function Dish() {
  const walls = useMemo(() => {
    const arr = []
    for (let k = 0; k < WALLS; k++) {
      const a = (k / WALLS) * Math.PI * 2
      arr.push({
        pos: [Math.cos(a) * (DISH_R + 0.12), 0.5, Math.sin(a) * (DISH_R + 0.12)],
        rot: [0, -a, 0],
      })
    }
    return arr
  }, [])

  return (
    <group>
      {/* floor — fixed, matte paper, catches shadows */}
      <RigidBody type="fixed" colliders={false} friction={0.9}>
        {/* thick slab (top at y=0) so a fast body can't tunnel through in one step */}
        <CuboidCollider args={[30, 3, 30]} position={[0, -3, 0]} />
        <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[120, 120]} />
          <meshStandardMaterial color="#e7e2d9" roughness={0.98} metalness={0} />
        </mesh>
      </RigidBody>

      {/* containment ring — fixed thin walls (physics), no visible mesh */}
      <RigidBody type="fixed" colliders={false} restitution={0.05} friction={0.6}>
        {walls.map((w, k) => (
          <CuboidCollider key={k} args={[0.32, 0.8, 0.06]} position={w.pos} rotation={w.rot} />
        ))}
      </RigidBody>

      {/* a low ceramic rim — visual only — to seat the dish in the paper */}
      <mesh position={[0, 0.02, 0]} receiveShadow>
        <cylinderGeometry args={[DISH_R + 0.34, DISH_R + 0.46, 0.16, 96, 1, true]} />
        <meshStandardMaterial color="#ddd6c8" roughness={0.85} metalness={0} side={THREE.DoubleSide} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.015, 0]} receiveShadow>
        <ringGeometry args={[DISH_R + 0.02, DISH_R + 0.46, 96]} />
        <meshStandardMaterial color="#e2dccf" roughness={0.95} metalness={0} />
      </mesh>
    </group>
  )
}

// Slow orbit that keeps the dish centred and looks down into the cairn.
function Rig() {
  const { camera } = useThree()
  useFrame((state) => {
    const t = state.clock.elapsedTime
    const ang = 0.5 + Math.sin(t * 0.06) * 0.55 + t * 0.035
    const r = 7.4
    camera.position.set(Math.cos(ang) * r, 5.2 + Math.sin(t * 0.09) * 0.3, Math.sin(ang) * r)
    camera.lookAt(0, 0.7, 0)
  })
  return null
}

// Procedural, offline-safe studio IBL — never fetch an HDRI at runtime (a failed
// fetch suspends the Canvas and blanks the scene; the Day 003/007/008 lesson).
function SoftStudio() {
  return (
    <Environment resolution={256}>
      <color attach="background" args={['#e9e6df']} />
      <Lightformer form="rect" intensity={1.6} position={[0, 12, 4]} rotation={[Math.PI / 2, 0, 0]} scale={[24, 24, 1]} color="#fffaf2" />
      <Lightformer form="rect" intensity={0.9} position={[-12, 6, 8]} rotation={[0, Math.PI / 2.2, 0]} scale={[16, 24, 1]} color="#eef2f8" />
      <Lightformer form="rect" intensity={0.7} position={[12, 5, 8]} rotation={[0, -Math.PI / 2.2, 0]} scale={[16, 24, 1]} color="#fff2e6" />
    </Environment>
  )
}

export default function Scene() {
  const stirRef = useRef(() => {})

  return (
    <>
      <SoftStudio />
      <hemisphereLight args={['#fffdf8', '#e0d8c9', 0.9]} />
      <ambientLight intensity={0.32} />
      <directionalLight position={[5, 15, 6]} intensity={1.0} castShadow shadow-mapSize={[2048, 2048]}>
        <orthographicCamera attach="shadow-camera" args={[-8, 8, 8, -8, 0.1, 40]} />
      </directionalLight>
      <directionalLight position={[-6, 6, -8]} intensity={0.3} color="#eef1f6" />

      <Physics gravity={[0, -14, 0]} timeStep={1 / 60}>
        <Dish />
        <Repose stirRef={stirRef} />
      </Physics>

      {/* invisible catcher: a click over the dish stirs the pile (pointer→force).
          Sits just above the rim; e.point gives the world hit directly. */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.9, 0]}
        onPointerDown={(e) => {
          e.stopPropagation()
          stirRef.current(e.point.x, e.point.z)
        }}
      >
        <circleGeometry args={[DISH_R + 0.5, 48]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      <Rig />
    </>
  )
}
