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
        camera={{ position: [0, 1.1, 8.6], fov: 34 }}
      >
        {/* Base clear colour matches the paper so first paint never flashes black
            before the environment resolves. */}
        <color attach="background" args={['#e7e4de']} />
        <fog attach="fog" args={['#e7e4de', 16, 34]} />

        <Suspense fallback={null}>
          <Scene />
        </Suspense>

        <OrbitControls
          target={[0, 0.7, 0]}
          enablePan={false}
          minPolarAngle={Math.PI / 3.2}
          maxPolarAngle={Math.PI / 2.05}
          minDistance={5.5}
          maxDistance={12}
          enableDamping
          dampingFactor={0.06}
          autoRotate
          autoRotateSpeed={0.35}
        />
      </Canvas>

      <div className="frame" />

      <div className="overlay">
        <div className="row">
          <span className="brand">3D&nbsp;Daily</span>
          <span className="index">003 / ★★</span>
        </div>

        <div className="lower">
          <div>
            <div className="eyebrow">Image-based lighting · studio</div>
            <h1 className="title">
              Environment&nbsp;<em>Reflections</em>
            </h1>
          </div>
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <div className="meta">
              <div>
                <div className="label">Lighting</div>
                <div className="value">HDRI · IBL</div>
              </div>
              <div>
                <div className="label">Surface</div>
                <div className="value">Polished chrome</div>
              </div>
              <div>
                <div className="label">Ground</div>
                <div className="value">Reflective floor</div>
              </div>
            </div>
            <span className="hint">drag to orbit</span>
          </div>
        </div>
      </div>
    </div>
  )
}
