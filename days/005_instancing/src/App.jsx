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
        // Low, near-grazing camera so the field reads as a landscape of light —
        // the wave crests catch the eye against the deep greige troughs.
        camera={{ position: [10.5, 6.2, 12], fov: 30 }}
      >
        <color attach="background" args={['#eceae5']} />
        <fog attach="fog" args={['#eceae5', 20, 46]} />

        <Suspense fallback={null}>
          <Scene />
        </Suspense>

        <OrbitControls
          target={[0, 0.6, 0]}
          enablePan={false}
          minPolarAngle={Math.PI / 4}
          maxPolarAngle={Math.PI / 2.05}
          minDistance={9}
          maxDistance={22}
          enableDamping
          dampingFactor={0.06}
          autoRotate
          autoRotateSpeed={0.22}
        />
      </Canvas>

      <div className="frame" />

      <div className="overlay">
        <div className="row">
          <span className="brand">3D&nbsp;Daily</span>
          <span className="index">005 / ★★</span>
        </div>

        <div className="lower">
          <div>
            <div className="eyebrow">One draw call, two thousand forms</div>
            <h1 className="title">
              Kinetic&nbsp;<em>Field</em>
            </h1>
          </div>
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <div className="meta">
              <div>
                <div className="label">Technique</div>
                <div className="value">InstancedMesh</div>
              </div>
              <div>
                <div className="label">Instances</div>
                <div className="value">2,304</div>
              </div>
              <div>
                <div className="label">Motion</div>
                <div className="value">Radial wave</div>
              </div>
            </div>
            <span className="hint">drag to orbit</span>
          </div>
        </div>
      </div>
    </div>
  )
}
