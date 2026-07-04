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
        // Eye-level, slightly low so the extruded letters read as sculpture and
        // their beveled sides catch the raking key.
        camera={{ position: [0, 1.5, 11], fov: 30 }}
      >
        <color attach="background" args={['#eceae5']} />
        <fog attach="fog" args={['#eceae5', 14, 34]} />

        <Suspense fallback={null}>
          <Scene />
        </Suspense>

        <OrbitControls
          target={[0, 0.9, 0]}
          enablePan={false}
          minPolarAngle={Math.PI / 3}
          maxPolarAngle={Math.PI / 1.9}
          minDistance={6.5}
          maxDistance={16}
          enableDamping
          dampingFactor={0.06}
        />
      </Canvas>

      <div className="frame" />

      <div className="overlay">
        <div className="row">
          <span className="brand">3D&nbsp;Daily</span>
          <span className="index">006 / ★★</span>
        </div>

        <div className="lower">
          <div>
            <div className="eyebrow">Extruded letterforms · beveled</div>
            <h1 className="title">
              Letter&nbsp;<em>form</em>
            </h1>
          </div>
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <div className="meta">
              <div>
                <div className="label">Technique</div>
                <div className="value">Text3D</div>
              </div>
              <div>
                <div className="label">Geometry</div>
                <div className="value">Extrude + bevel</div>
              </div>
              <div>
                <div className="label">Motion</div>
                <div className="value">Per-glyph float</div>
              </div>
            </div>
            <span className="hint">drag to orbit</span>
          </div>
        </div>
      </div>
    </div>
  )
}
