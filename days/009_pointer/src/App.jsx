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
        // ACES pulls the bone midtones a touch dark against the paper; nudge
        // exposure up so the field stays luminous and high-key.
        onCreated={({ gl }) => (gl.toneMappingExposure = 1.12)}
        // Initial pose matches Rig's parallax base exactly, so the camera never
        // jumps on first frame — it just starts breathing with the pointer.
        camera={{ position: [2.4, 7.4, 10.6], fov: 36 }}
      >
        <color attach="background" args={['#eceae5']} />
        {/* Far rows dissolve into the paper — the "endless field" illusion. */}
        <fog attach="fog" args={['#eceae5', 15, 34]} />

        <Suspense fallback={null}>
          <Scene />
        </Suspense>
        {/* No OrbitControls today — the pointer *is* the control: it steers the
            camera parallax and the whole field leans to follow it. */}
      </Canvas>

      <div className="frame" />

      <div className="overlay">
        <div className="row">
          <span className="brand">3D&nbsp;Daily</span>
          <span className="index">009 / ★★★</span>
        </div>

        <div className="lower">
          <div>
            <div className="eyebrow">Week II · Interaction — pointer follow</div>
            <h1 className="title">
              Attend<em>.</em>
            </h1>
          </div>
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <div className="meta">
              <div>
                <div className="label">Field</div>
                <div className="value">1,564 rods · 1 draw</div>
              </div>
              <div>
                <div className="label">Steering</div>
                <div className="value">Raycast → ground · damped</div>
              </div>
              <div>
                <div className="label">Response</div>
                <div className="value">Lean · rise · warm</div>
              </div>
            </div>
            <span className="hint">move your cursor</span>
          </div>
        </div>
      </div>
    </div>
  )
}
