import { useRef, useCallback } from 'react'
import { Canvas } from '@react-three/fiber'
import Scene from './Scene.jsx'
import { READOUT, slide } from './rig.js'

export default function App() {
  const thetaEl = useRef(null)
  const cotEl = useRef(null)
  const rowEls = useRef([])
  const sink = useRef(null)

  // DOM の数字は state を経由しない。毎フレーム再描画すると
  // 「読み取った値」ではなく「React が追いつけた値」を見せることになる。
  sink.current = useCallback((s) => {
    if (thetaEl.current) thetaEl.current.textContent = s.theta.toFixed(1) + '°'
    if (cotEl.current) cotEl.current.textContent = s.cot.toFixed(3)
    READOUT.forEach((r, i) => {
      const el = rowEls.current[i]
      if (el) el.textContent = (slide(r.h / 1000, s.theta) * 1000).toFixed(1)
    })
  }, [])

  return (
    <div className="stage">
      <Canvas
        orthographic
        dpr={1}
        gl={{ antialias: true }}
        camera={{ position: [0, 3, 0], up: [0, 0, -1], near: 0.01, far: 20, zoom: 900 }}
      >
        <Scene readout={sink} />
      </Canvas>

      <header className="hd">
        <p className="eyebrow">3D Daily — Day 073</p>
        <h1>The Distance<br />the Shadow Slid</h1>
        <p className="sub">
          after <em>Yu-ten, Gallery and shop</em> — Tsukuba
        </p>
      </header>

      <aside className="tr">
        <p>Plan view · orthographic</p>
        <p>One source · no horizon</p>
        <p>Cyclorama #85AFD8</p>
      </aside>

      <section className="data">
        <p className="lead">
          Sun elevation <b ref={thetaEl}>—</b> &nbsp;·&nbsp; cot&#8202;θ <b ref={cotEl}>—</b>
        </p>
        <table>
          <tbody>
            {READOUT.map((r, i) => (
              <tr key={r.label}>
                <td className="k">{r.label}</td>
                <td className="h">
                  h {String(r.h).padStart(3, ' ')} mm
                </td>
                <td className="ar">→</td>
                <td className="s">
                  s <b ref={(el) => (rowEls.current[i] = el)}>—</b> mm
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <footer className="note">
        <p>
          From directly above, <em>D1</em> and <em>D2</em> are the same circle, lit to the same
          value. Thirteen times the height, and none of it is in the silhouette.
        </p>
        <p className="eq">s = h · cot&#8202;θ</p>
      </footer>
    </div>
  )
}
