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
        // Raised a touch and looking slightly down, so the ground — and the
        // shadows painted on it — become an equal partner in the frame.
        camera={{ position: [0.4, 2.4, 9.2], fov: 32 }}
      >
        {/* First-paint clear colour matches the paper so there's no black flash. */}
        <color attach="background" args={['#e8e5df']} />
        <fog attach="fog" args={['#e8e5df', 15, 34]} />

        <Suspense fallback={null}>
          <Scene />
        </Suspense>

        <OrbitControls
          target={[0, 0.55, 0]}
          enablePan={false}
          minPolarAngle={Math.PI / 3.6}
          maxPolarAngle={Math.PI / 2.02}
          minDistance={6}
          maxDistance={13}
          enableDamping
          dampingFactor={0.06}
          autoRotate
          autoRotateSpeed={0.28}
        />
      </Canvas>

      <div className="frame" />

      <div className="overlay">
        <div className="row">
          <span className="brand">3D&nbsp;Daily</span>
          <span className="index">004 / ★★</span>
        </div>

        <div className="lower">
          <div>
            <div className="eyebrow">Studies in shadow &amp; ground</div>
            <h1 className="title">
              Cast&nbsp;<em>Shadows</em>
            </h1>
          </div>
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <div className="meta">
              <div>
                <div className="label">Shadow</div>
                <div className="value">Accumulative</div>
              </div>
              <div>
                <div className="label">Light</div>
                <div className="value">Randomized · 8</div>
              </div>
              <div>
                <div className="label">Surface</div>
                <div className="value">Matte plaster</div>
              </div>
            </div>
            <span className="hint">drag to orbit</span>
          </div>
        </div>
      </div>
    </div>
  )
}
