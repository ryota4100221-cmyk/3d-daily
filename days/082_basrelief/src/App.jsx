import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import Scene from './Scene.jsx'
import { LAMBDAS, HUES, layout, measure, BAR_Y, ROW_A_Y, ROW_B_Y } from './rig.js'

const AZ0 = 2.36
const EL0 = 0.56

export default function App() {
  const light = useRef({ az: AZ0, el: EL0 })
  const [vp, setVp] = useState(() => [window.innerWidth, window.innerHeight])

  // Measured once, on the CPU, from the same arithmetic the shader runs. The
  // headline claim is only worth the number printed beside it.
  const stats = useMemo(() => measure(AZ0, EL0), [])
  const worstA = Math.max(...stats.map((s) => s.dA))
  const worstB = Math.max(...stats.map((s) => s.dB))

  useEffect(() => {
    const onResize = () => setVp([window.innerWidth, window.innerHeight])
    // The lamp is the only thing the pointer touches. Nothing moves, ever:
    // the six quads are flat and they stay flat.
    const onMove = (e) => {
      const nx = (e.clientX / window.innerWidth) * 2 - 1
      const ny = (e.clientY / window.innerHeight) * 2 - 1
      light.current.az = AZ0 - nx * 1.05
      light.current.el = Math.min(1.35, Math.max(0.2, EL0 - ny * 0.34))
    }
    window.addEventListener('resize', onResize)
    window.addEventListener('pointermove', onMove)
    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('pointermove', onMove)
    }
  }, [])

  const L = useMemo(() => layout(vp[0], vp[1]), [vp[0], vp[1]])
  const at = (x, y) => {
    const [px, py] = L.toPx(x, y)
    return { left: `${px}px`, top: `${py}px` }
  }

  return (
    <>
      <Canvas
        flat
        orthographic
        dpr={[1, 2]}
        camera={{ position: [0, 0, 6], near: 0.1, far: 50 }}
        gl={{ antialias: true }}
      >
        <color attach="background" args={['#606060']} />
        <Scene light={light} />
      </Canvas>

      <div className="hud">
        <div className="mast">
          <div className="kick">3D Daily · Day 082 · bas-relief ambiguity</div>
          <h1>
            The depth that
            <br />
            never reaches the image
          </h1>
        </div>

        <div className="aside">
          <p className="lede">
            Six objects. The left one is the original; each one to its right is the same
            surface flattened, repainted, and given a lamp of its own. Under this camera no
            photograph can separate them — the flattening is not hidden, it is
            <em> unrecorded</em>.
          </p>
        </div>

        {/* row captions, in the gutter the columns leave empty */}
        <div className="rowcap" style={at(L.left - 0.16, ROW_A_Y)}>
          <b>Its own lamp</b>
          <span>b ↦ G⁻ᵀb, s ↦ Gs</span>
          <span className="num">Δ max {worstA.toExponential(1)}</span>
        </div>
        <div className="rowcap" style={at(L.left - 0.16, ROW_B_Y)}>
          <b>One lamp for all</b>
          <span>same paint, same s</span>
          <span className="num">Δ max {worstB.toFixed(3)}</span>
        </div>

        {/* per column: the number the picture refuses to carry */}
        {LAMBDAS.map((lam, i) => (
          <div key={i}>
            <div className="lam" style={at(L.cx[i] - L.tile / 2, BAR_Y + 0.088)}>
              <span style={{ color: HUES[i][0] }}>λ</span> {lam.toFixed(3)}
            </div>
            <div className="rho" style={at(L.cx[i] - L.tile / 2, BAR_Y - 0.135)}>
              paint ≥ {stats[i].rho.toFixed(2)} · Δ<sub>B</sub> {stats[i].dB.toFixed(3)}
            </div>
          </div>
        ))}

        <div className="foot">
          <span>
            after <b>Diffar</b> — diffar.jp — the ground is drained to one grey and the row of
            six carries every colour there is · the pointer moves the lamp, and nothing else
          </span>
          <span className="mono">
            Lambertian · orthographic · {stats[0].px.toLocaleString()} px sampled · top row
            agrees to {worstA.toExponential(1)} in float64 · bottom row parts by{' '}
            {worstB.toFixed(3)} · depth range {(1 / LAMBDAS[5]).toFixed(1)}×
          </span>
        </div>
      </div>
    </>
  )
}
