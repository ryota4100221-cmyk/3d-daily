import { Suspense } from 'react'
import { Canvas } from '@react-three/fiber'
import Scene from './Scene.jsx'

export default function App() {
  return (
    <div className="canvas-wrap">
      <Canvas
        shadows
        dpr={[1, 2]}
        gl={{ antialias: true, preserveDrawingBuffer: true }}
        onCreated={({ gl }) => (gl.toneMappingExposure = 1.1)}
        camera={{ position: [7.4, 5.2, 4.5], fov: 34 }}
      >
        <color attach="background" args={['#eceae5']} />
        {/* the far paper dissolves into fog — depth without a horizon line */}
        <fog attach="fog" args={['#eceae5', 14, 44]} />

        {/* Rapier's WASM suspends on first load; the Suspense keeps the canvas
            from flashing an error overlay while it initialises. */}
        <Suspense fallback={null}>
          <Scene />
        </Suspense>
      </Canvas>

      {/* fixed editorial furniture, over the canvas */}
      <div className="frame" />

      <div className="hud">
        <div className="row">
          <span className="brand">3D&nbsp;Daily</span>
          <span className="index">011 / ★★★</span>
        </div>

        <div className="titleblock">
          <h1 className="big">
            Repose<em>.</em>
          </h1>
          <p className="lede">
            A paper dish that never stops filling. Rounded forms rain in, tumble,
            and stack under real physics — then quietly fade and return.
          </p>
        </div>

        <div className="cue">
          <span>click the dish to stir the pile</span>
          <span className="bar" />
        </div>
      </div>

      <div className="footline">
        <span>Week II · Motion &amp; Interaction</span>
        <span>Physics — @react-three/rapier</span>
      </div>
    </div>
  )
}
