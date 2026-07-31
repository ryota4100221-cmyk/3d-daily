import { useState, useEffect, useMemo } from 'react'
import { Canvas } from '@react-three/fiber'
import Scene from './Scene.jsx'
import Pipeline from './Pipeline.jsx'
import { buildRig } from './rig.js'

const PASSES = [
  { key: 'Composite', note: 'volume · glass · TAA' },
  { key: 'Beauty', note: 'opaque surfaces, dry air' },
  { key: 'Normals', note: 'G-buffer, attachment 0' },
  { key: 'Velocity', note: 'G-buffer, attachment 1' },
  { key: 'In-scatter', note: 'volume, read at depth' },
  { key: 'Transmittance', note: 'what the air kept' },
  { key: 'Froxel atlas', note: '64 slices, 256×144' },
  { key: 'Light depth', note: 'our own shadow map' },
  { key: 'TAA off', note: 'the same frame, alone' },
]

// Debug handles, in the tradition of Day 023's ?grade, 025's ?t, 030's ?phase
// and 031's ?pass.
//
//   ?t=12.5    pins the scene clock. Velocities go to zero, so TAA converges to
//              a perfectly clean still and the motion blur disappears with the
//              motion — right for reading buffers, wrong for judging blur.
//   ?phase=40  keeps the piece running but starts it 40 seconds in.
//   ?pass=7    selects a render pass without a keyboard, which is the only way a
//              headless capture can check that the froxel atlas holds a room.
function readNum(key) {
  if (typeof window === 'undefined') return null
  const v = new URLSearchParams(window.location.search).get(key)
  if (v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export default function App() {
  const [mode, setMode] = useState(() => {
    const p = readNum('pass')
    return p != null && p >= 1 && p <= PASSES.length ? p - 1 : 0
  })
  const rig = useMemo(() => buildRig(), [])
  const freeze = useMemo(() => readNum('t'), [])
  const phase = useMemo(() => readNum('phase') ?? 0, [])

  useEffect(() => {
    const onKey = (e) => {
      const i = Number(e.key)
      if (i >= 1 && i <= PASSES.length) setMode(i - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="app">
      <Canvas
        flat
        shadows
        dpr={[1, 2]}
        gl={{ antialias: false, alpha: false, powerPreference: 'high-performance' }}
        camera={{ position: [0.30, 2.05, 13.8], fov: 30, near: 0.1, far: 80 }}
      >
        <Scene rig={rig} />
        <Pipeline rig={rig} mode={mode} freeze={freeze} phase={phase} />
      </Canvas>

      <div className="ui">
        <div className="top">
          <div className="mark">3D&nbsp;Daily</div>
          <div className="day">Day&nbsp;032 · ★★★★★</div>
        </div>

        <div className="lead">
          <div className="eyebrow">Loop 05 · Volume</div>
          <h1>
            Lantern<em>.</em>
            <span className="ghost">a&nbsp;room&nbsp;in&nbsp;64&nbsp;slices</span>
          </h1>
          <p className="sub">
            Yesterday the air was marched, per pixel, and thrown away. Today it
            is a grid — 256×144×64 cells filled in one draw, integrated by six
            prefix-scan passes because the scattering operator turns out to be
            associative. What comes out is not a picture of fog but a thing that
            can be read: the composite reads it, and so does the glass, at its
            own depth.
          </p>
        </div>

        <div className="bottom">
          <div className="meta">
            <span>Froxel volume · 2.36M cells · one atlas of 64 tiles</span>
            <span>Integration by parallel prefix scan · log₂64 = 6 passes</span>
            <span>Temporal reprojection in 3D · jittered slice centres</span>
            <span>Forward transparency · fog resolved at the glass</span>
          </div>

          <div className="passes">
            <div className="passes-label">Render pass</div>
            <ul>
              {PASSES.map((p, i) => (
                <li
                  key={p.key}
                  className={i === mode ? 'on' : ''}
                  onClick={() => setMode(i)}
                >
                  <span className="idx">{i + 1}</span>
                  <span className="name">{p.key}</span>
                  <span className="note">{p.note}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
