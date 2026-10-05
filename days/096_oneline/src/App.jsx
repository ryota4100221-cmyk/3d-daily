import { useRef, useState, useCallback } from 'react'
import { Canvas } from '@react-three/fiber'
import Scene from './Scene.jsx'

const fmt = (v, d = 0) => (v == null ? '—' : v.toFixed(d))

export default function App() {
  const pointer = useRef({ x: 0, y: 0, active: false })
  const [s, setS] = useState(null)
  const onStats = useCallback((v) => setS(v), [])

  const move = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    pointer.current.x = ((e.clientX - r.left) / r.width) * 2 - 1
    pointer.current.y = 1 - ((e.clientY - r.top) / r.height) * 2
    pointer.current.active = true
  }
  const leave = () => { pointer.current.active = false }

  return (
    <div className="stage" onPointerMove={move} onPointerLeave={leave}>
      <Canvas
        orthographic
        camera={{ position: [0, 0, 10], zoom: 1, near: 0.1, far: 100 }}
        dpr={[1, 2]}
        gl={{ antialias: true }}
        onCreated={({ gl }) => gl.setClearColor('#005cce')}
      >
        <Scene pointer={pointer} onStats={onStats} />
      </Canvas>

      <header className="head">
        <p className="kicker">Day 096 — after CTC New Graduates</p>
        <h1>One line<br />holds a face.</h1>
        <p className="lede">
          A single stroke, laid down as straight rows. Underneath it, an unseen head
          is lit by your pointer; wherever that head falls into shadow, the line
          trembles. Nothing draws the profile. The line only answers the light.
        </p>
      </header>

      <dl className="spec">
        <div><dt>Strokes</dt><dd>1</dd></div>
        <div><dt>Rows</dt><dd>{s ? s.rows : '—'}</dd></div>
        <div><dt>Vertices</dt><dd>{s ? s.vertices.toLocaleString('en-US') : '—'}</dd></div>
        <div><dt>Length at rest</dt><dd>{s ? `${fmt(s.length / 1000, 1)} k px` : '—'}</dd></div>
        <div><dt>Head in field</dt><dd>{s ? `${fmt(s.cover * 100, 1)} %` : '—'}</dd></div>
        <div><dt>Mean tremble</dt><dd>{s ? fmt(s.meanTone, 2) : '—'}</dd></div>
        <div><dt>Light az / el</dt><dd>{s ? `${fmt(s.az)}° / ${fmt(s.el)}°` : '—'}</dd></div>
        <div><dt>Head yaw</dt><dd>{s ? `${fmt(s.yaw)}°` : '—'}</dd></div>
      </dl>

      <footer className="foot">
        <span>Move to relight</span>
        <span>Geometry · 1 path / Shader · 1 lookup / Light · you</span>
      </footer>
    </div>
  )
}
