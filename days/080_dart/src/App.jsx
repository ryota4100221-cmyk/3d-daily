import { useCallback, useRef } from 'react'
import { Canvas } from '@react-three/fiber'
import Scene from './Scene.jsx'
import { A_SPACING, SHEAR_LOCK } from './rig.js'

const LOCK_DEG = ((SHEAR_LOCK * 180) / Math.PI).toFixed(0)

export default function App() {
  // 数字は毎フレーム変わるので React の state には載せない（再描画で
  // 布のソルバが巻き添えになる）。DOM に直接書く。
  const m = useRef({})
  const put = (k) => (el) => { m.current[k] = el }

  const onStats = useCallback((s) => {
    const set = (k, v) => { const el = m.current[k]; if (el) el.textContent = v }
    set('u0', s.u0.toFixed(3))
    set('cells', `${s.covered} / ${s.okCount}`)
    set('shear', `${s.maxShear.toFixed(2)}° (lock ${LOCK_DEG}°)`)
    set('err', `${s.edgeErr.toExponential(1)} × a`)
    set('gb', s.gb
      ? `${s.gb.lhs.toFixed(3)}  vs  ${s.gb.rhs.toFixed(3)}   Δ ${Math.abs(s.gb.lhs - s.gb.rhs).toFixed(3)}`
      : '—')
    set('win', s.gb ? `${s.gb.M} × ${s.gb.N}` : '—')
  }, [])

  return (
    <div className="stage">
      <Canvas
        orthographic
        dpr={[1, 2]}
        camera={{ position: [2.523, 0.956, 5.358], near: -20, far: 40, zoom: 620 }}
        gl={{ antialias: true, alpha: true }}
      >
        <Scene onStats={onStats} />
      </Canvas>

      <div className="overlay">
        <div className="col">
          <div className="eyebrow">
            <span className="rule" />
            3D Daily — Day 080
            <br />
            After キヤスク / Kiyasuku
          </div>

          <h1 className="claim">
            A flat cloth
            <br />
            cannot fit
            <br />
            a curved <em>body</em>.
          </h1>

          <p className="body">
            A woven cloth is two families of threads that will not stretch.
            The only freedom it has is the angle between them. Lay it on a body
            and every crossing is already decided — <b>each knot is fixed by its two
            neighbours and nothing else.</b> Where the body curves too fast the
            weave runs out of that angle, jams, and stops. Nothing here knows
            about gravity, stiffness or collision. The cloth contributes exactly
            one number — how far it will shear before it jams.
            <b> Where that happens is the body’s decision, not the cloth’s.</b>
          </p>

          <div className="device">
            Device — The angle the weave runs out of
            <br />
            <span>Tchebyshev net · the tailor’s compass method</span>
          </div>
        </div>

        <div className="corner">
          Orthographic elevation
          <br />
          Thread pitch a = {A_SPACING}
          <br />
          One pinned point, sliding
        </div>

        <div className="meter">
          <span className="k">Grain origin u₀</span><span className="v" ref={put('u0')}>—</span><br />
          <span className="k">Cells reached / solved</span><span className="v" ref={put('cells')}>—</span><br />
          <span className="k">Max shear |ω − 90°|</span><span className="v" ref={put('shear')}>—</span><br />
          <span className="k">Edge-length error</span><span className="v" ref={put('err')}>—</span><br />
          <span className="k">∫∫K dA vs four corners</span><span className="v" ref={put('gb')}>—</span><br />
          <span className="k">…over window</span><span className="v" ref={put('win')}>—</span>
        </div>

        <div className="legend">
          <span className="dot" />
          Where the cloth runs out
          <br />
          — a dart goes here
        </div>
      </div>
    </div>
  )
}
