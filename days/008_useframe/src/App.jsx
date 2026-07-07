import { Suspense } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import Scene from './Scene.jsx'

export default function App() {
  return (
    <div className="canvas-wrap">
      <Canvas
        shadows
        dpr={[1, 2]}
        gl={{ antialias: true, preserveDrawingBuffer: true }}
        // ACES pulls the bone midtones a touch dark against the paper; nudge
        // exposure up so the suite stays luminous and high-key.
        onCreated={({ gl }) => (gl.toneMappingExposure = 1.12)}
        // Eye-level, slightly raised: the row of primitives reads as a line of
        // objects suspended in negative space, their soft contact shadows just
        // grazing the paper below.
        camera={{ position: [0, 1.6, 9.5], fov: 32 }}
      >
        <color attach="background" args={['#eceae5']} />
        <fog attach="fog" args={['#eceae5', 14, 30]} />

        <Suspense fallback={null}>
          <Scene />
        </Suspense>

        <OrbitControls
          target={[0, 0.35, 0]}
          enablePan={false}
          minPolarAngle={Math.PI / 3.4}
          maxPolarAngle={Math.PI / 1.9}
          minDistance={6}
          maxDistance={14}
          enableDamping
          dampingFactor={0.06}
        />
      </Canvas>

      <div className="frame" />

      <div className="overlay">
        <div className="row">
          <span className="brand">3D&nbsp;Daily</span>
          <span className="index">008 / ★★</span>
        </div>

        <div className="lower">
          <div>
            <div className="eyebrow">Week II · Motion — useFrame, three channels</div>
            <h1 className="title">
              Breathe<em>.</em>
            </h1>
          </div>
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <div className="meta">
              <div>
                <div className="label">Channels</div>
                <div className="value">Rotate · Float · Breathe</div>
              </div>
              <div>
                <div className="label">Timing</div>
                <div className="value">Delta-accumulated</div>
              </div>
              <div>
                <div className="label">Choreography</div>
                <div className="value">Travelling phase wave</div>
              </div>
            </div>
            <span className="hint">drag to orbit</span>
          </div>
        </div>
      </div>
    </div>
  )
}
