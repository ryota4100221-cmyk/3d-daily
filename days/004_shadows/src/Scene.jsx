import {
  Environment,
  Lightformer,
  AccumulativeShadows,
  RandomizedLight,
} from '@react-three/drei'

// White-on-white plaster still-life. The palette is almost monochrome on
// purpose — the composition lives on the *shadow*, not on colour. One graphite
// accent and one warm greige keep it from going clinical.
const PALETTE = {
  bone: '#f2efe9', // hero plaster — a hair warmer than the paper ground
  greige: '#d9d3c8', // the arch — warm neutral
  graphite: '#33343a', // the single dark accent cube
  ground: '#eae7e1', // matte paper floor
}

// A matte plaster material — high roughness, no metalness. This is what makes
// the objects read as cast plaster / ceramic rather than plastic, so the soft
// accumulated shadow underneath feels physically earned.
function Plaster({ color, roughness = 0.92 }) {
  return <meshStandardMaterial color={color} roughness={roughness} metalness={0} envMapIntensity={0.6} />
}

// --- Purely procedural, offline-safe IBL. No external HDRI fetch this time
// (Day 003 proved that path is a breakage point), so no error boundary needed:
// a soft overhead softbox + two low side fills give the plaster gentle,
// wrap-around shading without ever risking a blank canvas.
function SoftStudio() {
  return (
    <Environment resolution={256}>
      <color attach="background" args={['#e8e5df']} />
      {/* large, soft overhead key */}
      <Lightformer
        form="rect"
        intensity={1.6}
        position={[0, 7, 2]}
        rotation={[Math.PI / 2, 0, 0]}
        scale={[14, 14, 1]}
        color="#fffaf2"
      />
      {/* cool side fill (left) + warm side fill (right) for subtle form */}
      <Lightformer form="rect" intensity={0.9} position={[-8, 3, 4]} rotation={[0, Math.PI / 2.2, 0]} scale={[8, 8, 1]} color="#eef2f8" />
      <Lightformer form="rect" intensity={0.7} position={[8, 2, 3]} rotation={[0, -Math.PI / 2.2, 0]} scale={[8, 8, 1]} color="#fff2e6" />
    </Environment>
  )
}

// --- The still-life: three plaster forms placed with deliberate negative
// space. Everything rests exactly on the ground plane (y sized so each object
// touches y = 0) so the shadows anchor cleanly. Objects are STATIC — the
// accumulated shadow is razor-sharp only when nothing moves, and that stillness
// is the aesthetic. The life in the shot comes from the slow orbiting camera.
function StillLife() {
  return (
    <group>
      {/* hero — a large plaster sphere, offset left of centre */}
      <mesh position={[-1.7, 1.2, 0]} castShadow>
        <sphereGeometry args={[1.2, 96, 96]} />
        <Plaster color={PALETTE.bone} roughness={0.95} />
      </mesh>

      {/* an arch — half-torus standing on its two legs. Casts a long curved
          shadow that is the real showpiece of a shadow study. */}
      <mesh position={[2.3, 0, -0.5]} rotation={[0, -0.15, 0]} castShadow>
        <torusGeometry args={[1.15, 0.17, 40, 96, Math.PI]} />
        <Plaster color={PALETTE.greige} roughness={0.88} />
      </mesh>

      {/* the single dark note — a small graphite cube, turned off-axis */}
      <mesh position={[0.55, 0.38, 1.75]} rotation={[0, 0.5, 0]} castShadow>
        <boxGeometry args={[0.76, 0.76, 0.76]} />
        <Plaster color={PALETTE.graphite} roughness={0.6} />
      </mesh>
    </group>
  )
}

export default function Scene() {
  return (
    <>
      <SoftStudio />
      {/* Very low ambient just to lift the deepest shadow cores off pure black. */}
      <ambientLight intensity={0.25} />

      <StillLife />

      {/* Matte paper floor — the surface the shadows are painted onto. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[80, 80]} />
        <meshStandardMaterial color={PALETTE.ground} roughness={1} metalness={0} />
      </mesh>

      {/* ★ Today's new technique — AccumulativeShadows.
          Instead of one hard directional shadow (Day 001) or a screen-space
          ContactShadows blur (Day 003), this bakes the shadow over many frames
          from a *cloud* of randomized light positions. The result is a soft,
          physically-plausible penumbra that gets crisper near contact and
          fuzzier far away — the way real diffuse-sky shadows behave. It sits a
          hair above the floor so it composites onto the paper without z-fight. */}
      <AccumulativeShadows
        temporal
        frames={120}
        alphaTest={0.78}
        scale={30}
        opacity={0.95}
        color="#26251f"
        position={[0, 0.002, 0]}
      >
        {/* A raking key set low and to the back-right so the shadows stretch
            long across the open foreground — the negative space becomes the
            canvas the shadows are drawn on. radius stays modest for a penumbra
            that is crisp at contact and softens with distance. */}
        <RandomizedLight
          amount={8}
          radius={3.5}
          ambient={0.4}
          intensity={1.6}
          position={[5, 4.5, -4]}
          bias={0.0009}
          mapSize={2048}
        />
      </AccumulativeShadows>
    </>
  )
}
