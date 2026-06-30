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
        camera={{ position: [0, 1.9, 9], fov: 34 }}
      >
        <color attach="background" args={['#f4f2ee']} />
        <fog attach="fog" args={['#f4f2ee', 13, 26]} />
        <Scene />
        <OrbitControls
          target={[0, 0.95, 0]}
          enablePan={false}
          minPolarAngle={Math.PI / 3.2}
          maxPolarAngle={Math.PI / 1.95}
          minDistance={6}
          maxDistance={12}
          enableDamping
          dampingFactor={0.06}
        />
      </Canvas>

      <div className="overlay">
        <div className="row">
          <span className="brand">3D&nbsp;Daily</span>
          <span className="day-tag">Day 001 · ★1</span>
        </div>

        <div className="lower">
          <h1 className="title">
            Primitive&nbsp;<em>Forms</em>
          </h1>
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <div className="meta">
              <div>
                <div className="label">Geometry</div>
                <div className="value">Box · Sphere · Torus · Icosahedron</div>
              </div>
              <div>
                <div className="label">Lighting</div>
                <div className="value">Three-point setup</div>
              </div>
            </div>
            <span className="hint">drag to orbit</span>
          </div>
        </div>
      </div>
    </div>
  )
}
