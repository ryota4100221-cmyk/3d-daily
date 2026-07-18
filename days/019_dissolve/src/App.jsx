import { useState } from 'react'
import { Canvas } from '@react-three/fiber'
import Scene from './Scene.jsx'

export default function App() {
  const [state, setState] = useState('forming')

  return (
    <>
      <Canvas
        flat
        dpr={[1, 2]}
        camera={{ position: [0, 0.2, 5.2], fov: 42 }}
        gl={{ antialias: true, alpha: false }}
      >
        <color attach="background" args={['#ece7dd']} />
        <Scene onState={setState} />
      </Canvas>

      <div className="overlay">
        <div className="hud-top">
          <div className="mark">3D&nbsp;Daily</div>
          <div className="day">Day&nbsp;019 · ★★★★</div>
        </div>

        <div className="legend">
          <div className="row"><b>dissolve</b> — noise alpha-clip</div>
          <div className="row"><b>edge</b> — hot burn front</div>
          <div className="row"><b>holo</b> — fresnel · scanlines</div>
        </div>

        <div className="hud-title">
          <div className="eyebrow">Week 3 · Shaders</div>
          <h1>
            Dissolve<em>.</em>
          </h1>
          <p>
            The form is never fully here. A 3-D noise field is compared
            against a breathing threshold, and everything above it is thrown
            away — <em>discard</em> — so the surface eats itself into paper and
            re-condenses out of it. A thin terracotta band burns along the cut,
            and a hologram of fresnel rim and scanlines rides whatever remains.
            Move to steer the wipe: the cursor decides which face materialises
            first.
          </p>
        </div>

        <div className="hud-hint">
          <span className="now">
            <span className="k">{state}</span>
          </span>
          <span>Move — <span className="k">steer the wipe</span></span>
        </div>
      </div>
    </>
  )
}
