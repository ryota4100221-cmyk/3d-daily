import React, { useEffect, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import Scene from './Scene.jsx'
import {
  R,
  L,
  COLS,
  GAP,
  UNSTABLE,
  NM,
  PEAK,
  LAMBDA_STAR,
  WINNER,
  RUNNERUP,
  MARGIN,
  RUNNERUP_LEFT,
  PREDICTED,
  SPACING_IN_R,
  columns,
} from './rig.js'

const FOV = 9
const DIST = 42

// 下の目盛りは糸の実際の投影位置に合わせる。CSS の勘で置くと、アスペクトが
// 変わった瞬間に「どの糸の数字か」が静かにずれる
function useFrac() {
  const [aspect, setAspect] = useState(
    typeof window === 'undefined' ? 1.6 : window.innerWidth / window.innerHeight
  )
  useEffect(() => {
    const on = () => setAspect(window.innerWidth / window.innerHeight)
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  const halfW = Math.tan((FOV / 2) * (Math.PI / 180)) * DIST * aspect
  return (x) => 50 + (x / (2 * halfW)) * 100
}

export default function App() {
  const frac = useFrac()
  const left = frac(-((COLS - 1) / 2) * GAP)
  const right = frac(((COLS - 1) / 2) * GAP)

  return (
    <>
      <div className="stage">
        <Canvas
          dpr={[1, 2]}
          gl={{ antialias: true, preserveDrawingBuffer: true }}
          camera={{ fov: FOV, position: [0, 0.16, DIST], near: 1, far: 120 }}
        >
          <Scene />
        </Canvas>
      </div>

      <div className="overlay">
        <div className="tl">
          <div className="title">The Wavelength That Wins</div>
          <div className="sub">Rayleigh–Plateau selection on a thread of syrup</div>
        </div>

        <div className="tr">
          <div className="title">Day 079</div>
          <div className="sub">after 元祖大阪みたらしだんご — ganso.osaka</div>
        </div>

        <div
          className="rule"
          style={{ left: `${frac(-4.36)}%`, width: `${frac(4.36) - frac(-4.36)}%` }}
        />

        <div className="ticks">
          <div className="caption">peaks →</div>
          {columns.map((c) => (
            <div
              key={c.j}
              className={'tick' + (c.j === COLS - 1 ? ' win' : '')}
              style={{ left: `${frac(c.x)}%` }}
            >
              <div className="t">t {c.t.toFixed(0)}</div>
              <div className="n">{c.beads}</div>
            </div>
          ))}
        </div>

        <div className="bl mono">
          <div>
            NOISE IN: <b>{NM}</b> WAVES, EQUAL AMPLITUDE — <b>{UNSTABLE}</b> OF THEM CAN GROW
          </div>
          <div style={{ marginTop: 5 }}>
            x* = <b>{PEAK.x.toFixed(4)}</b> &nbsp; λ* = 2πR / x* = <b>{(LAMBDA_STAR / R).toFixed(3)} R</b>
          </div>
        </div>

        <div className="br mono">
          <div>
            WINNER n={WINNER.n} BEATS n={RUNNERUP.n} BY <b>{((MARGIN - 1) * 100).toFixed(2)}%</b> —
            AFTER {columns[COLS - 1].t.toFixed(0)} THE LOSER IS STILL AT{' '}
            <b className="hit">{(RUNNERUP_LEFT * 100).toFixed(0)}%</b>
          </div>
          <div style={{ marginTop: 5 }}>
            COUNTED <b>{SPACING_IN_R.toFixed(2)} R</b> &nbsp;/&nbsp; PREDICTED{' '}
            <b>{(LAMBDA_STAR / R).toFixed(3)} R</b> &nbsp;·&nbsp; BEADS {columns[COLS - 1].beads} / {PREDICTED.toFixed(2)}
          </div>
        </div>
      </div>
    </>
  )
}
