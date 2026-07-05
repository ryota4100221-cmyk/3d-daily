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
        // Nudge exposure up a touch — ACES tone mapping pulls the plaster
        // midtones dark against the paper; this keeps the field luminous.
        onCreated={({ gl }) => (gl.toneMappingExposure = 1.15)}
        // Steep, near-top-down view: the lit capsule caps face the camera and
        // the sky fill, so the noise field reads as a luminous topographic
        // pattern — the height→tone gradient becomes the picture, not a wall of
        // shadowed sides.
        camera={{ position: [0, 15.5, 10], fov: 33 }}
      >
        <color attach="background" args={['#eceae5']} />
        <fog attach="fog" args={['#eceae5', 16, 42]} />

        <Suspense fallback={null}>
          <Scene />
        </Suspense>

        <OrbitControls
          target={[0, 0, 0]}
          enablePan={false}
          minPolarAngle={Math.PI / 7}
          maxPolarAngle={Math.PI / 2.3}
          minDistance={9}
          maxDistance={24}
          enableDamping
          dampingFactor={0.06}
        />
      </Canvas>

      <div className="frame" />

      <div className="overlay">
        <div className="row">
          <span className="brand">3D&nbsp;Daily</span>
          <span className="index">007 / ★★</span>
        </div>

        <div className="lower">
          <div>
            <div className="eyebrow">Week I · Reprise — instancing, refined</div>
            <h1 className="title">
              Flow&nbsp;<em>field</em>
            </h1>
          </div>
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <div className="meta">
              <div>
                <div className="label">Draw calls</div>
                <div className="value">One</div>
              </div>
              <div>
                <div className="label">Motion</div>
                <div className="value">fBm value-noise</div>
              </div>
              <div>
                <div className="label">Per-instance</div>
                <div className="value">Height · yaw · tone</div>
              </div>
            </div>
            <span className="hint">drag to orbit</span>
          </div>
        </div>
      </div>
    </div>
  )
}
