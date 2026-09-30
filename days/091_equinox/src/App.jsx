import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import * as THREE from 'three'
import Scene from './Scene.jsx'
import {
  sunElevation, ringTau, slabLit, slabUnlit, OBLIQ, CAM_EL, YEAR_S, EQUINOX,
} from './rig.js'

const params = new URLSearchParams(location.search)
const FIXED = params.has('y') ? Number(params.get('y')) : null
const START = 2029.0
const YEARS_PER_SEC = YEAR_S / 48 // one Saturn year in 48 seconds

function makeClock() {
  const c = {
    year: FIXED ?? START,
    drag: 0,
    tick(dt) {
      if (FIXED === null && !c.dragging) c.year += dt * YEARS_PER_SEC
      if (c.year > EQUINOX + YEAR_S * 1.5) c.year -= YEAR_S
    },
  }
  return c
}

// Mean I/F of the B ring as the camera sees it, from the same functions the
// shader uses. Normalised to the northern solstice.
const MU = Math.sin(CAM_EL)
function ringLight(B) {
  const mu0 = Math.abs(Math.sin(B))
  const lit = B > 0 // camera sits north of the ring plane
  let s = 0
  let n = 0
  for (let r = 1.53; r <= 1.95; r += 0.0005) {
    const t = ringTau(r)
    s += lit ? slabLit(t, mu0, MU) : slabUnlit(t, mu0, MU)
    n++
  }
  return s / n
}
const SOLSTICE = ringLight(OBLIQ)

const fmt = (v, d = 2) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(d)

function Timeline({ year }) {
  const W = 260
  const H = 44
  const y0 = EQUINOX - YEAR_S * 0.5
  const path = useMemo(() => {
    let p = ''
    for (let i = 0; i <= 120; i++) {
      const yr = y0 + (i / 120) * YEAR_S * 1.5
      const x = 22 + (i / 120) * (W - 44)
      const y = H / 2 - (sunElevation(yr) / OBLIQ) * (H / 2 - 4)
      p += (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1)
    }
    return p
  }, [])
  const wrap = ((year - y0) % (YEAR_S * 1.5) + YEAR_S * 1.5) % (YEAR_S * 1.5)
  const cx = 22 + (wrap / (YEAR_S * 1.5)) * (W - 44)
  const cy = H / 2 - (sunElevation(year) / OBLIQ) * (H / 2 - 4)
  const eqx = [EQUINOX - YEAR_S / 2, EQUINOX, EQUINOX + YEAR_S / 2].map(
    (e) => 22 + ((e - y0) / (YEAR_S * 1.5)) * (W - 44)
  )
  return (
    <svg className="timeline" width={W} height={H + 14} viewBox={`0 0 ${W} ${H + 14}`}>
      <line x1="0" x2={W} y1={H / 2} y2={H / 2} className="axis" />
      <path d={path} className="curve" />
      {eqx.map((x, i) => (
        <g key={i}>
          <line x1={x} x2={x} y1={H / 2 - 5} y2={H / 2 + 5} className="tick" />
          <text x={x} y={H + 12} className="tlabel">
            {(EQUINOX + (i - 1) * YEAR_S / 2).toFixed(1)}
          </text>
        </g>
      ))}
      <circle cx={cx} cy={cy} r="3.2" className="dot" />
    </svg>
  )
}

export default function App() {
  const clock = useMemo(makeClock, [])
  const [year, setYear] = useState(clock.year)
  const drag = useRef(null)

  useEffect(() => {
    let raf
    let last = 0
    const loop = (t) => {
      if (t - last > 90) {
        setYear(clock.year)
        last = t
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [clock])

  const onDown = (e) => {
    drag.current = { x: e.clientX, y0: clock.year }
    clock.dragging = true
  }
  const onMove = (e) => {
    if (!drag.current) return
    clock.year = drag.current.y0 + (e.clientX - drag.current.x) * 0.035
  }
  const onUp = () => {
    drag.current = null
    clock.dragging = false
  }

  const B = sunElevation(year)
  const Bdeg = (B * 180) / Math.PI
  const light = ringLight(B) / SOLSTICE
  const face = Math.abs(Bdeg) < 0.05 ? 'edge-on' : B > 0 ? 'lit face' : 'unlit face'
  const near = Math.abs(Bdeg) < 1.2

  return (
    <div className="stage" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp}>
      <Canvas
        dpr={[1, 2]}
        camera={{ fov: 6.5, near: 1, far: 1000, position: [0, 8, 33] }}
        gl={{ antialias: true, toneMapping: THREE.NoToneMapping }}
        onCreated={({ gl }) => gl.setClearColor('#04060c')}
      >
        <Scene clock={clock} />
      </Canvas>

      <header className="top">
        <span className="mark">Árstraumur</span>
        <nav>
          <span>The Moon</span>
          <span className="on">Saturn</span>
          <span>Neptune</span>
        </nav>
      </header>

      <section className="title">
        <p className="kicker">Relayed transmission — 091</p>
        <h1>Saturn</h1>
        <h2>The night the rings go out.</h2>
        <p className="body">
          Once every fifteen years the Sun slides into the plane of the rings.
          Nothing is switched off. Light simply stops arriving at an angle the
          ice can return — and the brightest thing past Jupiter goes dark,
          all but the shadow it draws across the planet.
        </p>
      </section>

      <section className={'read' + (near ? ' near' : '')}>
        <div className="row"><span>Year</span><b>{year.toFixed(2)}</b></div>
        <div className="row"><span>Sun above ring plane</span><b>{fmt(Bdeg)}°</b></div>
        <div className="row"><span>μ₀ = sin|B|</span><b>{Math.abs(Math.sin(B)).toFixed(3)}</b></div>
        <div className="row"><span>Ring light · {face}</span><b>{(light * 100).toFixed(1)}%</b></div>
        <Timeline year={year} />
        <p className="hint">{FIXED === null ? 'Drag sideways to move through the Saturn year.' : 'Frozen at y=' + FIXED}</p>
      </section>

      <footer className="coords">
        <span>Received at 64.1466° N, 21.9426° W — Earth</span>
        <span>1 Saturn year = 29.457 yr</span>
      </footer>
    </div>
  )
}
