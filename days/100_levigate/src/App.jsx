import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import Scene from './Scene.jsx'
import { SIPHON, T_MAX, buildColumn, census, clearTime, cutDiameter } from './rig.js'

// スクロール＝時間。ただし対数で。1 s から 7 日まで、砂と粘土の時間は 5 桁違う。
const LOG_MAX = Math.log10(T_MAX)
const timeAt = (p) => (p <= 0 ? 0 : Math.pow(10, p * LOG_MAX))

function fmtTime(t) {
  if (t < 1) return '0 s'
  if (t < 60) return `${t.toFixed(0)} s`
  if (t < 3600) return `${(t / 60).toFixed(t < 600 ? 1 : 0)} min`
  if (t < 86400) return `${(t / 3600).toFixed(t < 36000 ? 1 : 0)} h`
  return `${(t / 86400).toFixed(1)} d`
}
const fmtD = (d) => (d >= 10 ? d.toFixed(0) : d >= 1 ? d.toFixed(1) : d.toFixed(2))

const MARKS = [
  { t: 60, label: '1 min' },
  { t: 3600, label: '1 h' },
  { t: 86400, label: '1 d' },
]
const CLAY_T = clearTime(2) // 2 µm が 10 cm を落ちきる時間（7.7 h）

export default function App() {
  const query = useMemo(() => new URLSearchParams(location.search), [])
  const fixedP = query.has('p') ? Number(query.get('p')) : null
  const col = useMemo(() => buildColumn(), [])
  const timeRef = useRef(0)
  const [hud, setHud] = useState(() => readout(col, fixedP != null ? timeAt(fixedP) : 0, fixedP ?? 0))

  useEffect(() => {
    if (fixedP != null) {
      timeRef.current = timeAt(fixedP)
      return
    }
    let raf
    let p = 0
    let last = -1
    const loop = () => {
      const max = document.documentElement.scrollHeight - innerHeight
      const target = max > 0 ? scrollY / max : 0
      p += (target - p) * 0.12
      timeRef.current = timeAt(p)
      if (Math.abs(p - last) > 0.0005) {
        last = p
        setHud(readout(col, timeRef.current, p))
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [col, fixedP])

  return (
    <>
      <div className="stage">
        <Canvas orthographic camera={{ position: [0, 0, 50], zoom: 1 }} dpr={[1, 2]} gl={{ antialias: true }}>
          <color attach="background" args={['#0A0B0D']} />
          <Scene col={col} timeRef={timeRef} />
        </Canvas>
      </div>

      <header className="top">
        <span>Day 100</span>
        <span>After Sedlecký Kaolin — Zettlitz, since 1892</span>
      </header>

      <section className="copy">
        <p className="eyebrow">Levigation · one stirred column, 30 cm of water</p>
        <h1>
          The sorting
          <br />
          the water does
        </h1>
        <p className="lede">
          Nothing here sorts the grains. Each one falls at its own terminal speed and lies down where it lands, in
          the order it arrives. Scroll is time — logarithmic, because sand and clay live five decades apart.
        </p>

        <dl className="read">
          <div>
            <dt>Time since stirring</dt>
            <dd className="big">{fmtTime(hud.t)}</dd>
          </div>
          <div>
            <dt>
              Coarsest grain above the <i>blue line</i> (−{SIPHON} cm)
            </dt>
            <dd className="big blue">{hud.dStar === Infinity ? '—' : `${fmtD(hud.dStar)} µm`}</dd>
          </div>
        </dl>

        <ul className="census">
          {hud.rows.map((r) => (
            <li key={r.name}>
              <span className={`dot k${r.k}`} />
              <span className="name">{r.name}</span>
              <span className="range">{r.range}</span>
              <span className="bar">
                <span style={{ transform: `scaleX(${r.v})` }} />
              </span>
              <span className="pct">{(r.v * 100).toFixed(0)}%</span>
            </li>
          ))}
        </ul>
        <p className="note">still in suspension</p>
      </section>

      <footer className="ruler">
        <div className="track">
          {MARKS.map((m) => (
            <span key={m.label} className="tick" style={{ left: `${(Math.log10(m.t) / LOG_MAX) * 100}%` }}>
              {m.label}
            </span>
          ))}
          <span className="tick clay" style={{ left: `${(Math.log10(CLAY_T) / LOG_MAX) * 100}%` }}>
            2 µm clears the line · {(CLAY_T / 3600).toFixed(1)} h
          </span>
          <span className="head" style={{ left: `${hud.p * 100}%` }} />
        </div>
        <div className="legend">
          <span>w = R g d² / (18ν + √(0.75 R g d³))</span>
          <span>Stokes 1851 · Ferguson &amp; Church 2004</span>
          <span>{hud.p < 0.02 ? 'Scroll to let it settle ↓' : '7 days →'}</span>
        </div>
      </footer>

      <div className="spacer" />
    </>
  )
}

function readout(col, t, p) {
  const c = census(col, t)
  const names = [
    ['Quartz sand', '63–400 µm'],
    ['Silt', '2–63 µm'],
    ['Kaolinite', '0.4–2 µm'],
  ]
  return {
    t,
    p,
    dStar: t > 0 ? cutDiameter(t) : Infinity,
    rows: names.map(([name, range], k) => ({ name, range, k, v: c.suspended[k] })),
  }
}
