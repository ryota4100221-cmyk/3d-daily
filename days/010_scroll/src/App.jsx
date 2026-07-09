import { Suspense } from 'react'
import { Canvas } from '@react-three/fiber'
import { ScrollControls, Scroll } from '@react-three/drei'
import Scene from './Scene.jsx'

// The four chapters that scroll past the spire. Kept to one big word + a line —
// monaka-style restraint, English editorial typography.
const CHAPTERS = [
  { side: 'left', eyebrow: 'Week II · Interaction — scroll journey', big: ['Ascend', '.'], lede: 'Scroll, and a spire winds itself out of the ground — one page, one continuous gesture.' },
  { side: 'right', eyebrow: 'I · Origin', big: ['Wind', '.'], lede: 'Eleven hundred radial bars, wound in a single helix and drawn in one call.' },
  { side: 'left', eyebrow: 'II · Front', big: ['Bloom', '.'], lede: 'A warm wavefront rides the scroll upward — settling what it passes, waking what it reaches.' },
  { side: 'right', eyebrow: 'III · Summit', big: ['Arrive', '.'], lede: 'Scroll back and it un-builds, exactly. The scrollbar is a transport, not a trigger.' },
]

export default function App() {
  return (
    <div className="canvas-wrap">
      <Canvas
        shadows
        dpr={[1, 2]}
        gl={{ antialias: true, preserveDrawingBuffer: true }}
        onCreated={({ gl }) => (gl.toneMappingExposure = 1.12)}
        camera={{ position: [6.6, 5.55, 4.5], fov: 38 }}
      >
        <color attach="background" args={['#eceae5']} />
        {/* far turns of the spire dissolve into paper — depth without a horizon */}
        <fog attach="fog" args={['#eceae5', 13, 42]} />

        <Suspense fallback={null}>
          <ScrollControls pages={4} damping={0.28}>
            {/* 3D lives in world space; the camera (Rig) is what scroll moves */}
            <Scene />

            {/* DOM chapters scroll *with* the page, portaled over the canvas */}
            <Scroll html style={{ width: '100%' }}>
              {CHAPTERS.map((c, i) => (
                <section key={i} className={`chapter ${c.side}`}>
                  <div className="eyebrow">{c.eyebrow}</div>
                  <h2 className="big">
                    {c.big[0]}
                    <em>{c.big[1]}</em>
                  </h2>
                  <p className="lede">{c.lede}</p>
                </section>
              ))}
            </Scroll>
          </ScrollControls>
        </Suspense>
      </Canvas>

      {/* fixed editorial furniture, outside the scroll flow */}
      <div className="frame" />

      <div className="hud">
        <div className="row">
          <span className="brand">3D&nbsp;Daily</span>
          <span className="index">010 / ★★★</span>
        </div>
        <div className="scroll-cue" id="scroll-cue">
          <span>scroll</span>
          <span className="bar" />
        </div>
      </div>

      <div className="progress">
        <span id="progress-fill" />
      </div>
    </div>
  )
}
