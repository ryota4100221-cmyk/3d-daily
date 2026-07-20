import { useState } from 'react'
import { Canvas } from '@react-three/fiber'
import Scene from './Scene.jsx'

export default function App() {
  const [state, setState] = useState('drift')

  return (
    <>
      <Canvas
        flat
        dpr={[1, 1.75]}
        gl={{ antialias: false, alpha: false }}
      >
        <color attach="background" args={['#ece7dd']} />
        <Scene onState={setState} />
      </Canvas>

      <div className="overlay">
        <div className="hud-top">
          <div className="mark">3D&nbsp;Daily</div>
          <div className="day">Day&nbsp;021 · ★★★★</div>
        </div>

        <div className="legend">
          <div className="row"><b>raymarch</b> — SDF scene</div>
          <div className="row"><b>smin</b> — smooth union</div>
          <div className="row"><b>soft shadow</b> — iq</div>
          <div className="row"><b>fresnel</b> — terracotta rim</div>
        </div>

        <div className="hud-title">
          <div className="eyebrow">Week 3 · Capstone</div>
          <h1>
            Cairn<em>.</em>
          </h1>
          <p>
            No geometry, no lights — the whole scene is one fragment shader.
            Rays are marched through a field of signed distances; porcelain
            forms melt into one another by smooth-minimum, cast soft
            self-shadows, and catch a terracotta rim where they turn from the
            eye. The week&rsquo;s shaders, folded into a single still life.
            Move the cursor to carry the light.
          </p>
        </div>

        <div className="hud-hint">
          <span className="now">
            <span className="k">{state}</span>
          </span>
          <span>Move — <span className="k">light</span></span>
        </div>
      </div>
    </>
  )
}
