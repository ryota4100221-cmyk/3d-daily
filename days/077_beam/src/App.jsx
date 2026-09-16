import React, { useEffect, useMemo, useRef } from 'react'
import { Canvas } from '@react-three/fiber'
import Scene, { CAM } from './Scene.jsx'
import { makeFleet, preroll, stripLength, B_CRIT, DRAFT, H, RHO, gmOf } from './rig.js'

const DEG = 180 / Math.PI

export default function App() {
  const sim = useRef(null)
  if (!sim.current) {
    const fleet = makeFleet()
    const len = stripLength(fleet)
    const params = new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search)
    const q = parseFloat(params.get('p'))
    // Opening position: the eighth hull, because that is where the answer stops
    // being obvious. Everything before it is settled; everything after is
    // waiting. The page is pre-rolled to here rather than animated into it, so
    // the same page always opens on the same sentence.
    const home = fleet[8].x + CAM.lead + CAM.lag
    const front0 = Number.isFinite(q) ? 2 + q * (len - 4) : home
    preroll(fleet, front0)
    sim.current = { fleet, front: front0, targetFront: front0, len, min: 2, max: len - 2 }
  }

  const readout = useRef({})
  const drag = useRef(null)

  useEffect(() => {
    const s = sim.current
    const nudge = (dx) => {
      s.targetFront = Math.max(s.min, Math.min(s.max, s.targetFront + dx))
    }
    const onWheel = (e) => {
      e.preventDefault()
      nudge((Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) * 0.012)
    }
    const onDown = (e) => (drag.current = e.clientX)
    const onMove = (e) => {
      if (drag.current === null) return
      nudge((drag.current - e.clientX) * 0.02)
      drag.current = e.clientX
    }
    const onUp = () => (drag.current = null)
    const onKey = (e) => {
      if (e.key === 'ArrowRight') nudge(0.9)
      if (e.key === 'ArrowLeft') nudge(-0.9)
    }
    window.addEventListener('wheel', onWheel, { passive: false })
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('wheel', onWheel)
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  // The numbers are written straight into the DOM every frame rather than
  // through state, so a still frame can never catch them at their initial value.
  useEffect(() => {
    let raf
    const tick = () => {
      const s = sim.current
      const cx = s.front - CAM.lead - CAM.lag
      let near = s.fleet[0]
      for (const b of s.fleet) if (Math.abs(b.x - cx) < Math.abs(near.x - cx)) near = b
      const el = readout.current
      if (el.beam) el.beam.textContent = near.b.toFixed(3)
      if (el.gm) el.gm.textContent = (near.gm >= 0 ? '+' : '') + near.gm.toFixed(4)
      if (el.heel) el.heel.textContent = Math.abs(near.phi * DEG).toFixed(1) + '°'
      if (el.verdict) el.verdict.textContent = near.b > B_CRIT ? 'STANDS' : 'LOLLS'
      if (el.hull) el.hull.textContent = String(near.i + 1).padStart(2, '0')
      if (el.pos) {
        const p = (s.front - s.min) / (s.max - s.min)
        el.pos.style.transform = `scaleX(${Math.max(0, Math.min(1, p)).toFixed(4)})`
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  const dpr = useMemo(() => [1, 2], [])

  return (
    <div className="page">
      <Canvas
        dpr={dpr}
        gl={{ antialias: true, alpha: false }}
        camera={{ fov: CAM.fov, near: 0.1, far: 200, position: [0, 9, 17] }}
      >
        <Scene sim={sim} />
      </Canvas>

      <header className="hd">
        <div className="mark">uki — buoyancy</div>
        <h1>
          The waterline
          <br />
          that tells you nothing
        </h1>
        <p className="sub">
          Twenty-seven hulls. One height, one density, one draft. The line is the same
          line on all of them.
        </p>
      </header>

      <div className="consts">
        <div><span>ρ</span><b>{RHO.toFixed(3)}</b></div>
        <div><span>H</span><b>{H.toFixed(3)}</b></div>
        <div><span>T = ρH</span><b>{DRAFT.toFixed(3)}</b></div>
        <div className="crit"><span>b<i>c</i> = √(6T(H−T))</span><b>{B_CRIT.toFixed(3)}</b></div>
      </div>

      <div className="live">
        <div className="row"><span>hull</span><b ref={(n) => (readout.current.hull = n)}>—</b></div>
        <div className="row"><span>beam b</span><b ref={(n) => (readout.current.beam = n)}>—</b></div>
        <div className="row"><span>GM</span><b ref={(n) => (readout.current.gm = n)}>—</b></div>
        <div className="row"><span>heel</span><b ref={(n) => (readout.current.heel = n)}>—</b></div>
        <div className="row verdict"><span /><b ref={(n) => (readout.current.verdict = n)}>—</b></div>
      </div>

      <footer className="ft">
        <div className="scrub"><i ref={(n) => (readout.current.pos = n)} /></div>
        <div className="ftrow">
          <span>Day 077 — after uki by non Editions</span>
          <span>scroll / drag →  move the swell</span>
        </div>
      </footer>
    </div>
  )
}
