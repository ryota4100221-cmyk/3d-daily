import { useState, useEffect, useMemo } from 'react'
import { Canvas } from '@react-three/fiber'
import Scene from './Scene.jsx'
import Pipeline from './Pipeline.jsx'
import { buildRig } from './rig.js'

const PASSES = [
  { key: 'Composite', note: 'medium · TAA · grade' },
  { key: 'Beauty', note: 'surfaces only, no medium' },
  { key: 'Normals', note: 'G-buffer, attachment 0' },
  { key: 'Velocity', note: 'G-buffer, attachment 1' },
  { key: 'In-scatter', note: 'half res, 48 steps' },
  { key: 'Transmittance', note: 'what the air kept' },
  { key: 'Light depth', note: 'our own shadow map' },
  { key: 'TAA off', note: 'the same frame, alone' },
]

// Debug handles, in the tradition of Day 023's ?grade, 025's ?t, 027's ?speed
// and 030's ?phase / ?pass.
//
//   ?t=12.5    pins the scene clock. Velocities go to zero, so TAA converges to
//              a perfectly clean still and the motion blur disappears with the
//              motion — right for reading buffers, wrong for judging blur.
//   ?phase=40  keeps the piece running but starts it 40 seconds in. The louvre
//              turns at 0.062 rad/s, so *which* moment gets captured is a design
//              decision rather than something a screenshot is handed.
//   ?pass=5    selects a render pass without a keyboard, which is the only way a
//              headless capture can check the in-scatter buffer actually holds
//              what this page claims it holds.
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
        camera={{ position: [0.35, 2.1, 13.6], fov: 30, near: 0.1, far: 80 }}
      >
        <Scene rig={rig} />
        <Pipeline rig={rig} mode={mode} freeze={freeze} phase={phase} />
      </Canvas>

      <div className="ui">
        <div className="top">
          <div className="mark">3D&nbsp;Daily</div>
          <div className="day">Day&nbsp;031 · ★★★★★</div>
        </div>

        <div className="lead">
          <div className="eyebrow">Loop 04 · Light</div>
          <h1>
            Aperture<em>.</em>
            <span className="ghost">the&nbsp;air&nbsp;between</span>
          </h1>
          <p className="sub">
            Thirty days of this project happened on the surface of something.
            Here the subject is the space in front of them: a ray marched from
            the eye through the haze, asking forty-eight times whether the light
            can see this point, and answering with the one thing a surface can
            never show — a beam you can look straight down.
          </p>
        </div>

        <div className="bottom">
          <div className="meta">
            <span>Ray&#8209;marched single scattering · Henyey&#8209;Greenstein</span>
            <span>Our own linear light&#8209;space depth map · 2048²</span>
            <span>Half res · Bayer dither · reprojected by scattering centroid</span>
            <span>Depth&#8209;aware upsample · TAA · shutter 1/30s</span>
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
