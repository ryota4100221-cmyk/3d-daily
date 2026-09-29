import { useRef, useState, useCallback } from 'react'
import { Canvas } from '@react-three/fiber'
import Scene from './Scene.jsx'

const q = new URLSearchParams(location.search)
const deg = (r) => ((((r * 180) / Math.PI) % 360) + 360) % 360

export default function App() {
  const state = useRef({
    px: 0,
    idle: 0.4,
    down: false,
    iso: q.get('iso') === '1' ? 1 : 0,
    forceIso: q.has('iso') ? Number(q.get('iso')) : null,
    fixedAz: q.has('az') ? (Number(q.get('az')) * Math.PI) / 180 : null,
    frozen: q.has('az'),
  })
  const [r, setR] = useState(null)
  const onReadout = useCallback((v) => setR(v), [])

  const move = (e) => {
    state.current.px = (e.clientX / innerWidth) * 2 - 1
  }

  return (
    <main
      onPointerMove={move}
      onPointerDown={() => (state.current.down = true)}
      onPointerUp={() => (state.current.down = false)}
      onPointerLeave={() => (state.current.down = false)}
    >
      <Canvas
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true }}
        camera={{ position: [0, 5.4, 6.2], fov: 30, near: 0.1, far: 60 }}
        onCreated={({ camera }) => camera.lookAt(0, 0.1, 0)}
      >
        <Scene state={state} onReadout={onReadout} />
      </Canvas>

      <header className="head">
        <p className="kicker">Day 090 — after Miyazaki Seisakusho, Tsubame</p>
        <h1>
          The Star in
          <br />
          the Spun Steel
        </h1>
        <p className="lede">
          A lathe scratches stainless in circles. One direction per point, nothing more —
          and every lamp is folded into a single bar through the centre.
        </p>
      </header>

      <aside className="read">
        <dl>
          <dt>lamp azimuth</dt>
          <dd>{r ? deg(r.az).toFixed(1) : '—'}°</dd>
          <dt>bar found on the lid</dt>
          <dd>{r ? deg(r.peak).toFixed(1) : '—'}°</dd>
          <dt>diameter along H</dt>
          <dd>{r ? deg(r.phiH).toFixed(1) : '—'}°</dd>
          <dt>Δ</dt>
          <dd className="accent">
            {r ? Math.abs((r.delta * 180) / Math.PI).toFixed(2) : '—'}° <small>(ring r 0.9 · 3600 steps)</small>
          </dd>
        </dl>
      </aside>

      <footer className="foot">
        <span>
          {r && r.iso > 0.5 ? 'Polished round — the same lamp is a dot.' : 'Move to turn the lamp · hold to polish it round'}
        </span>
        <span className="tag">α∥ 0.035 · α⊥ 0.75 · Ward</span>
      </footer>
    </main>
  )
}
