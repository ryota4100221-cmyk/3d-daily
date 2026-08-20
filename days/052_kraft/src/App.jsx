import { Canvas } from '@react-three/fiber'
import Scene from './Scene.jsx'
import { PALETTE } from './rig.js'

// オーバーレイは上下の帯だけに置く。版面の中央は 2行の見出しが横断していて、
// そこに文字を重ねると 3D の字と DOM の字が同じ高さで喧嘩する（Day 027 の再演になる）。
export default function App() {
  return (
    <div className="stage" style={{ background: PALETTE.kraft }}>
      <Canvas
        orthographic
        dpr={1}
        gl={{ antialias: false, alpha: false }}
        camera={{ position: [0, 0, 40], near: 0.1, far: 200, zoom: 100 }}
      >
        <color attach="background" args={[PALETTE.kraft]} />
        <Scene />
      </Canvas>

      <div className="hud">
        <div className="row top">
          <span>3D DAILY — DAY 052</span>
          <span className="dim">KRAFT / HALFTONE RELIEF</span>
        </div>

        <div className="row bottom">
          <span>
            THRESHOLD TIDE
            <span className="dim"> — the relief never moves. only the step does.</span>
          </span>
          <span className="dim">AFTER MEESVERBERNE.COM</span>
        </div>
      </div>
    </div>
  )
}
