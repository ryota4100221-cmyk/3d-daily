import { useState } from 'react'
import { Canvas } from '@react-three/fiber'
import Scene from './Scene.jsx'

export default function App() {
  const [state, setState] = useState('idle')

  return (
    <>
      <Canvas
        flat
        dpr={[1, 2]}
        camera={{ position: [0, 0.35, 5.4], fov: 42 }}
        gl={{ antialias: true, alpha: false }}
      >
        <color attach="background" args={['#ece7dd']} />
        <Scene onState={setState} />
      </Canvas>

      <div className="overlay">
        <div className="hud-top">
          <div className="mark">3D&nbsp;Daily</div>
          <div className="day">Day&nbsp;018 · ★★★★</div>
        </div>

        <div className="legend">
          <div className="row"><b>fresnel</b> — grazing reflectance</div>
          <div className="row"><b>env</b> — procedural studio</div>
          <div className="row"><b>rim</b> — emissive edge glow</div>
        </div>

        <div className="hud-title">
          <div className="eyebrow">Week 3 · Shaders</div>
          <h1>
            Fresnel<em>.</em>
          </h1>
          <p>
            Glass reflects most at its edges. One Fresnel term drives all of
            it — the silhouette turns mirror-bright, the centre stays
            see-through, and a terracotta rim traces every outline. Nothing
            is lit by a real lamp; the cursor is the studio key, so the glint
            and the warm reflection sweep across the beads as you move.
          </p>
        </div>

        <div className="hud-hint">
          <span className="now">
            <span className="k">{state}</span>
          </span>
          <span>Move — <span className="k">sweep the light</span></span>
        </div>
      </div>
    </>
  )
}
