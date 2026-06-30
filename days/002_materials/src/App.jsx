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
        camera={{ position: [0, 1.5, 14.5], fov: 32 }}
      >
        <color attach="background" args={['#f4f2ee']} />
        <fog attach="fog" args={['#f4f2ee', 22, 42]} />
        <Scene />
        <OrbitControls
          target={[0, 1.4, 0]}
          enablePan={false}
          minPolarAngle={Math.PI / 3.4}
          maxPolarAngle={Math.PI / 1.9}
          minDistance={9}
          maxDistance={18}
          enableDamping
          dampingFactor={0.06}
        />
      </Canvas>

      <div className="overlay">
        <div className="row">
          <span className="brand">3D&nbsp;Daily</span>
          <span className="day-tag">Day 002 · ★1</span>
        </div>

        <div className="lower">
          <h1 className="title">
            Material&nbsp;<em>Studies</em>
          </h1>
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <div className="meta">
              <div>
                <div className="label">Models</div>
                <div className="value">Standard · Physical · Toon</div>
              </div>
              <div>
                <div className="label">Study</div>
                <div className="value">Metalness × Roughness</div>
              </div>
              <div>
                <div className="label">Lighting</div>
                <div className="value">Procedural studio IBL</div>
              </div>
            </div>
            <span className="hint">drag to orbit</span>
          </div>
        </div>
      </div>
    </div>
  )
}
