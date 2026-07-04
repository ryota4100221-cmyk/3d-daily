import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useLoader } from '@react-three/fiber'
import { FontLoader } from 'three/examples/jsm/loaders/FontLoader.js'
import { Text3D, Environment, Lightformer, ContactShadows } from '@react-three/drei'

// Day 006 — the letterform IS the object. Where earlier days used flat troika
// <Text> only for labels, today the hero is REAL extruded typography: a short
// word built from beveled Text3D glyphs (three's TextGeometry). The step-up is
// laying the glyphs out by hand from the typeface's own metrics and floating
// each one on its own phase — an editorial kinetic wordmark, monaka-minimal.

// Local typeface JSON (never a CDN fetch — that stalls the Canvas Suspense and
// blanks the scene, per the RUN.md trap). Copied from three's bundled fonts.
const FONT_URL = import.meta.env.BASE_URL + 'helvetiker_regular.typeface.json'

const WORD = 'TYPE'
const SIZE = 1.7 // cap size of each glyph
const DEPTH = 0.42 // extrusion depth
const TRACKING = 0.14 // extra space between glyphs, in world units

// Warm bone ceramic. Almost white, a whisper of clearcoat so the bevels catch a
// soft studio rim while the flat faces stay matte — the form reads through light
// on the edges, not through colour.
const BONE = '#efe9df'

function Wordmark() {
  const groupRef = useRef()
  const glyphRefs = useRef([])

  // Load the font once (drei's Text3D loads the same URL from cache, so this is
  // deduped). We reach into font.data to read each glyph's horizontal advance —
  // that lets us position letters exactly the way the type designer intended,
  // instead of eyeballing spacing.
  const font = useLoader(FontLoader, FONT_URL)

  const layout = useMemo(() => {
    const res = font.data.resolution
    const scale = SIZE / res
    const advance = (ch) => {
      const g = font.data.glyphs[ch]
      return g ? g.ha * scale : SIZE * 0.5
    }

    // Cumulative x for each glyph's left edge, plus tracking between them.
    const widths = WORD.split('').map(advance)
    const total =
      widths.reduce((a, w) => a + w, 0) + TRACKING * (WORD.length - 1)

    let cursor = -total / 2
    const glyphs = WORD.split('').map((ch, i) => {
      const x = cursor
      cursor += widths[i] + TRACKING
      return { ch, x, i }
    })
    return { glyphs }
  }, [font])

  useFrame((state) => {
    const t = state.clock.elapsedTime

    // Whole word: a slow yaw sway (never a full spin — editorial restraint) and
    // a gentle rise/settle so the group breathes as one.
    if (groupRef.current) {
      groupRef.current.rotation.y = Math.sin(t * 0.18) * 0.16
      groupRef.current.position.y = 0.9 + Math.sin(t * 0.5) * 0.04
    }

    // Per-glyph float on staggered phases — the letters bob independently while
    // their x stays fixed, so kerning holds but the wordmark feels alive.
    glyphRefs.current.forEach((g, i) => {
      if (!g) return
      const phase = t * 1.05 + i * 0.7
      g.position.y = Math.sin(phase) * 0.11
      g.rotation.x = Math.sin(phase) * 0.04
    })
  })

  return (
    // Nudge the baseline down so the cap-height sits centred on the group origin.
    <group ref={groupRef} position={[0, 0.9, 0]}>
      <group position={[0, -SIZE * 0.36, 0]}>
        {layout.glyphs.map(({ ch, x, i }) => (
          <group key={i} position={[x, 0, 0]}>
            <group ref={(el) => (glyphRefs.current[i] = el)}>
              <Text3D
                font={FONT_URL}
                size={SIZE}
                height={DEPTH}
                curveSegments={10}
                bevelEnabled
                bevelThickness={0.035}
                bevelSize={0.024}
                bevelSegments={5}
                castShadow
              >
                {ch}
                <meshPhysicalMaterial
                  color={BONE}
                  roughness={0.42}
                  metalness={0}
                  clearcoat={0.55}
                  clearcoatRoughness={0.4}
                  envMapIntensity={0.85}
                />
              </Text3D>
            </group>
          </group>
        ))}
      </group>
    </group>
  )
}

// Procedural, offline-safe studio IBL (the Day 003 lesson): a broad soft key
// overhead plus cool/warm side fills so the beveled edges pick up a quiet
// gradient rather than a hard glare.
function SoftStudio() {
  return (
    <Environment resolution={256}>
      <color attach="background" args={['#e9e6df']} />
      <Lightformer form="rect" intensity={1.6} position={[0, 7, 4]} rotation={[Math.PI / 2, 0, 0]} scale={[14, 14, 1]} color="#fffaf2" />
      <Lightformer form="rect" intensity={0.9} position={[-8, 3, 6]} rotation={[0, Math.PI / 2.2, 0]} scale={[9, 9, 1]} color="#eef2f8" />
      <Lightformer form="rect" intensity={0.7} position={[8, 2, 5]} rotation={[0, -Math.PI / 2.2, 0]} scale={[9, 9, 1]} color="#fff1e2" />
    </Environment>
  )
}

export default function Scene() {
  return (
    <>
      <SoftStudio />
      <ambientLight intensity={0.28} />
      {/* Low raking key to model the extrusion sides and drop a soft shadow. */}
      <directionalLight position={[5, 8, 5]} intensity={0.95} castShadow>
        <orthographicCamera attach="shadow-camera" args={[-8, 8, 8, -8, 0.1, 30]} />
      </directionalLight>

      <Wordmark />

      {/* Screen-space contact shadow grounds the floating word to the paper
          plane without a heavy shadow map. */}
      <ContactShadows
        position={[0, -0.9, 0]}
        scale={16}
        resolution={1024}
        blur={2.6}
        far={5}
        opacity={0.34}
        color="#2b2a24"
      />
    </>
  )
}
