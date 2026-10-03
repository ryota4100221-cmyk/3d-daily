import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import Scene from './Scene.jsx'
import { SEASONS, SITE, T0, T1, DT, sunDir, altAz, survey, blocked, insideFootprint } from './rig.js'

const q = new URLSearchParams(location.search)
const fixedT = q.has('t') ? Number(q.get('t')) : null
const startSeason = Math.max(0, SEASONS.findIndex((s) => s.key === (q.get('s') || 'winter')))

const fmtT = (h) => {
  const m = Math.round(h * 60)
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}
const fmtA = (n) => Math.round(n).toLocaleString('en-US')

// Instant shaded area on a 2 m grid — cheap enough to follow the pointer.
function instantArea(dir) {
  let n = 0
  for (let z = -179; z < 180; z += 2)
    for (let x = -179; x < 180; x += 2) if (!insideFootprint(x, z) && blocked(x, z, dir)) n += 4
  return n
}

export default function App() {
  const [season, setSeason] = useState(startSeason)
  const [hour, setHour] = useState(fixedT ?? 10.5)
  const [show, setShow] = useState(true)
  const [stats, setStats] = useState({})
  const dragging = useRef(false)
  const idle = useRef(fixedT === null)

  const decl = SEASONS[season].decl
  const nowDir = useMemo(() => sunDir(decl, hour), [decl, hour])
  const { alt, az } = altAz(nowDir)

  // the counted survey: once per season, off the first frame
  useEffect(() => {
    const key = SEASONS[season].key
    if (stats[key]) return
    const id = setTimeout(() => setStats((s) => ({ ...s, [key]: survey(decl) })), 60)
    return () => clearTimeout(id)
  }, [season])
  const sv = stats[SEASONS[season].key]
  const now = useMemo(() => (nowDir[1] > 0 ? instantArea(nowDir) : null), [nowDir])

  // idle: the sun walks the counted window on its own
  useEffect(() => {
    if (fixedT !== null) return
    let raf
    let last = performance.now()
    const tick = (t) => {
      const dt = (t - last) / 1000
      last = t
      if (idle.current) setHour((h) => (h + dt * 0.35 > T1 ? T0 : h + dt * 0.35))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  const onMove = (e) => {
    if (fixedT !== null) return
    idle.current = false
    const f = Math.min(1, Math.max(0, e.clientX / window.innerWidth))
    setHour(T0 + f * (T1 - T0))
  }

  useEffect(() => {
    const k = (e) => {
      if (e.key === ' ') setShow((v) => !v)
      if (e.key === '1' || e.key === '2' || e.key === '3') setSeason(Number(e.key) - 1)
    }
    addEventListener('keydown', k)
    return () => removeEventListener('keydown', k)
  }, [])

  const frac = (hour - T0) / (T1 - T0)

  return (
    <div className="stage" onPointerMove={onMove} onPointerLeave={() => (idle.current = fixedT === null)}>
      <Canvas
        shadows
        dpr={[1, 2]}
        camera={{ position: [-92, 118, 96], fov: 52, near: 1, far: 1200 }}
        onCreated={({ camera }) => camera.lookAt(-4, 0, -38)}
        gl={{ antialias: true }}
      >
        <Scene decl={decl} nowDir={nowDir} dt={DT} show={show} />
      </Canvas>

      <header className="head">
        <div className="mark">KononenkoArchitecturalBureau</div>
        <div className="kicker">E Q U A L — H O U R &nbsp; S H A D O W &nbsp; L I N E S</div>
        <h1>
          The Hours
          <br />a Building Lends
        </h1>
        <p className="lede">
          Every point of the ground is asked one question, sixty-five times between {fmtT(T0)} and {fmtT(T1)}: can you
          see the sun past the building? The lines are drawn nowhere. They appear where the count of “no” crosses a whole
          hour.
        </p>
      </header>

      <nav className="seasons">
        {SEASONS.map((s, i) => (
          <button key={s.key} className={i === season ? 'on' : ''} onClick={() => setSeason(i)}>
            <span>{String(i + 1).padStart(2, '0')}</span>
            {s.label}
          </button>
        ))}
        <button className={show ? 'on' : ''} onClick={() => setShow((v) => !v)}>
          <span>␣</span>
          {show ? 'Counted hours' : 'Instant only'}
        </button>
      </nav>

      <aside className="readout">
        <div className="row head2">
          <span>{SITE.name} {SITE.lat.toFixed(2)}°N</span>
          <span>{SEASONS[season].label}</span>
        </div>
        <div className="row big">
          <span>{fmtT(hour)}</span>
          <span className="unit">solar</span>
        </div>
        <div className="row">
          <span>Sun</span>
          <span>
            alt {alt.toFixed(1)}° · az {az.toFixed(1)}°
          </span>
        </div>
        <div className="row">
          <span>Shade now</span>
          <span>{now === null ? 'sun below horizon' : `${fmtA(now)} m²`}</span>
        </div>
        <div className="rule" />
        {sv
          ? sv.ks.map((k, i) => (
              <div className={'row' + (k === 4 ? ' strong' : '')} key={k}>
                <span>≥ {k} h</span>
                <span>{fmtA(sv.area[i])} m²</span>
              </div>
            ))
          : <div className="row"><span>counting…</span><span>65 suns</span></div>}
        {sv && (
          <div className="row dim">
            <span>Longest lent</span>
            <span>{sv.longest.toFixed(2)} h</span>
          </div>
        )}
      </aside>

      <footer className="clock">
        <div className="track">
          {Array.from({ length: 9 }, (_, i) => (
            <span key={i} className="tick" style={{ left: `${(i / 8) * 100}%` }}>
              <i>{String(T0 + i).padStart(2, '0')}</i>
            </span>
          ))}
          <span className="cursor" style={{ left: `${frac * 100}%` }} />
        </div>
        <div className="hint">Move across the page to set the hour · 1 2 3 season · space toggles the count</div>
      </footer>
    </div>
  )
}
