import { useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import Scene from './Scene.jsx'
import {
  areaAbove, ISLAND_KM2, UNIT_M, section, summit,
  lidHeight, sunElevationDeg, peakShadowKm,
} from './rig.js'

const q = new URLSearchParams(location.search)
const FIXED_T = q.has('t') ? Number(q.get('t')) : null
const FIXED_H = q.has('h') ? Number(q.get('h')) / UNIT_M : null
const H_MIN = 2.0, H_MAX = 7.6

// Drives time + the lid, and writes the HUD straight into the DOM.
function Clock({ state, hud }) {
  useFrame((_, dt) => {
    const s = state.current
    s.t = FIXED_T ?? s.t + Math.min(dt, 0.1)
    const goal = FIXED_H ?? (s.pointer == null ? lidHeight(s.t) : H_MIN + (H_MAX - H_MIN) * s.pointer)
    s.H += (goal - s.H) * (FIXED_H != null ? 1 : Math.min(1, dt * 2.5))
    const a = areaAbove(s.H)
    const h = hud.current
    if (!h.lid) return
    h.lid.textContent = Math.round(s.H * UNIT_M)
    h.area.textContent = a.toFixed(2)
    h.share.textContent = ((a / ISLAND_KM2) * 100).toFixed(1)
    h.sun.textContent = sunElevationDeg(s.t).toFixed(1)
    h.shadow.textContent = peakShadowKm(s.H, s.t).toFixed(1)
    const y = 60 - (s.H / 9) * 56
    h.line.setAttribute('y1', y)
    h.line.setAttribute('y2', y)
    h.tag.setAttribute('y', y - 4)
  })
  return null
}

export default function App() {
  const state = useRef({ t: FIXED_T ?? 14, H: FIXED_H ?? lidHeight(FIXED_T ?? 14), pointer: null })
  const hud = useRef({})
  const reg = (k) => (el) => { hud.current[k] = el }

  const prof = useMemo(() => {
    const s = section(160)
    const pts = s.map((h, i) => `${(i / 159) * 240},${60 - (Math.max(h, 0) / 9) * 56}`)
    return `M0,60 L${pts.join(' L')} L240,60 Z`
  }, [])

  useEffect(() => {
    const move = (e) => {
      const y = e.touches ? e.touches[0].clientY : e.clientY
      state.current.pointer = 1 - Math.min(1, Math.max(0, y / innerHeight))
    }
    const leave = () => { state.current.pointer = null }
    addEventListener('pointermove', move)
    addEventListener('touchmove', move, { passive: true })
    document.addEventListener('pointerleave', leave)
    return () => {
      removeEventListener('pointermove', move)
      removeEventListener('touchmove', move)
      document.removeEventListener('pointerleave', leave)
    }
  }, [])

  return (
    <>
      <Canvas
        flat
        dpr={[1, 1.75]}
        camera={{ fov: 30, near: 0.5, far: 2000, position: [34, 24, 77] }}
        gl={{ antialias: true }}
      >
        <Clock state={state} hud={hud} />
        <Scene state={state} />
      </Canvas>

      <header className="top">
        <span className="mark">Day 093</span>
        <span className="rule" />
        <span>After mikurasima-portal.jp</span>
      </header>

      <section className="lede">
        <p className="kicker">Mikura-jima · Izu Islands · Tokyo</p>
        <h1>
          The Shore
          <br />
          <em>in the Sky</em>
        </h1>
        <p className="body">
          Three hundred people can live here, and it is still Tokyo. At dawn the sea goes
          under an inversion and the island gets a second coastline — wherever the
          ground is taller than the cloud.
        </p>
      </section>

      <aside className="read">
        <svg viewBox="0 0 240 64" className="prof" aria-hidden>
          <path d={prof} />
          <line ref={reg('line')} x1="0" x2="240" y1="30" y2="30" />
          <text ref={reg('tag')} x="240" y="26" textAnchor="end">lid</text>
        </svg>
        <dl>
          <div><dt>Inversion top</dt><dd><b ref={reg('lid')}>—</b> m</dd></div>
          <div><dt>Island above cloud</dt><dd><b ref={reg('area')}>—</b> km² · <b ref={reg('share')}>—</b>%</dd></div>
          <div><dt>Sun</dt><dd><b ref={reg('sun')}>—</b>°</dd></div>
          <div><dt>Shadow of Oyama</dt><dd><b ref={reg('shadow')}>—</b> km</dd></div>
        </dl>
        <p className="hint">
          Pointer height = lid · {ISLAND_KM2.toFixed(1)} km² · {Math.round(summit.h * UNIT_M)} m
        </p>
      </aside>
    </>
  )
}

