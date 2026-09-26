import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import * as THREE from 'three'
import Scene from './Scene.jsx'
import { buildWaves, budgetAt, coxMunk, CAM_H, FOV, RESOLVED_SHARE } from './rig.js'

const q = new URLSearchParams(location.search)
const FIXED_U = q.has('u') ? Number(q.get('u')) : null
const FIXED_T = q.has('t') ? Number(q.get('t')) : null
const FORCE_HOLD = q.get('hold') === '1'

const DISTANCES = [120, 1200, 9000]

export default function App() {
  const state = useRef({ U: FIXED_U ?? 7, target: FIXED_U ?? 7, time: FIXED_T ?? 0, hold: FORCE_HOLD ? 1 : 0, touched: false })
  const [read, setRead] = useState({ U: 7, h: 800 })
  const waves = useMemo(() => buildWaves(), [])

  useEffect(() => {
    const s = state.current
    const move = (e) => {
      if (FIXED_U != null) return
      s.touched = true
      s.target = 2 + 12 * (e.clientX / innerWidth)
    }
    const down = () => (s.hold = 1)
    const up = () => (s.hold = FORCE_HOLD ? 1 : 0)
    addEventListener('pointermove', move)
    addEventListener('pointerdown', down)
    addEventListener('pointerup', up)
    let last = performance.now()
    let raf
    const tick = (now) => {
      const dt = Math.min((now - last) / 1000, 0.1)
      last = now
      if (FIXED_T == null) s.time += dt
      if (!s.touched && FIXED_U == null) s.target = 7 + 2.2 * Math.sin(s.time * 0.11)
      s.U += (s.target - s.U) * Math.min(1, dt * 2.5)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    const iv = setInterval(() => setRead({ U: s.U, h: innerHeight }), 160)
    return () => {
      removeEventListener('pointermove', move)
      removeEventListener('pointerdown', down)
      removeEventListener('pointerup', up)
      cancelAnimationFrame(raf)
      clearInterval(iv)
    }
  }, [])

  const mss = coxMunk(read.U)
  const rows = DISTANCES.map((d) => ({ d, ...budgetAt(waves, d, CAM_H, (FOV * Math.PI) / 180, read.h) }))

  return (
    <>
      <Canvas
        dpr={[1, 2]}
        camera={{ fov: FOV, near: 0.5, far: 120000 }}
        gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.05 }}
      >
        <Scene state={state} />
      </Canvas>

      <header className="title">
        <h1>
          <span className="t1">The Road</span>
          <span className="t2">on the</span>
          <span className="t3">WATER</span>
        </h1>
      </header>

      <section className="budget">
        <p className="sub">
          No one paints the road. Each pixel only asks how many facets lean exactly halfway between your eye and the sun.
        </p>
        <div className="lab">Slope budget — Cox &amp; Munk</div>
        <div className="big">
          U <b>{read.U.toFixed(1)}</b> m/s <span className="sep">·</span> ⟨s²⟩ <b>{mss.toFixed(4)}</b>
        </div>
        <table>
          <thead>
            <tr>
              <th>at</th>
              <th>pixel</th>
              <th>drawn</th>
              <th>counted</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.d}>
                <td>{r.d >= 1000 ? `${(r.d / 1000).toFixed(1)} km` : `${r.d} m`}</td>
                <td>{r.fp >= 1 ? `${r.fp.toFixed(1)} m` : `${(r.fp * 100).toFixed(0)} cm`}</td>
                <td>
                  <i className="bar" style={{ width: `${(r.resolved * 100).toFixed(1)}%` }} />
                  {(r.resolved * 100).toFixed(1)}%
                </td>
                <td>{(r.unresolved * 100).toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="note">
          drawn + counted = 100% at every distance. Capillary floor {(100 - RESOLVED_SHARE * 100).toFixed(0)}% is never drawn.
        </p>
      </section>

      <footer className="caption">
        <span className="rule" />
        <div>
          Ōsaki Park, Zushi — 42 m above the bay
          <br />
          <em>after “Moments of HAYAMA”</em>
        </div>
      </footer>

      <div className="hint">move — wind &nbsp;·&nbsp; hold — sparkles only</div>
    </>
  )
}
