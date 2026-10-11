import { useEffect, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import * as THREE from 'three'
import Scene from './Scene.jsx'
import { COVERS, CAPILLARY, E, measure, createPillow, settle } from './rig.js'

const T_MIN = 1
const T_MAX = 4000
const toSlider = (T) => Math.log(T / T_MIN) / Math.log(T_MAX / T_MIN)
const fromSlider = (s) => T_MIN * Math.pow(T_MAX / T_MIN, s)

const VIEW = { pos: [-0.02, 1.02, 0.6], look: [-0.115, 0.0, 0.03] }

function initialCover() {
  const q = new URLSearchParams(window.location.search).get('cover')
  return COVERS.find((c) => c.key === q) || COVERS.find((c) => c.key === 'knit')
}

// The HUD starts from a settled pillow, not from dashes (Day 097's lesson).
function initialStats(T) {
  const s = createPillow()
  s.T = T
  settle(s, 400)
  return measure(s)
}

const fmt = (v, d = 1) => v.toFixed(d)

export default function App() {
  const start = initialCover()
  const [T, setT] = useState(start.T)
  const tensionRef = useRef(start.T)
  const statsRef = useRef(null)
  const [stats, setStats] = useState(() => initialStats(start.T))

  useEffect(() => {
    tensionRef.current = T
  }, [T])

  useEffect(() => {
    const id = setInterval(() => {
      if (statsRef.current) setStats(statsRef.current)
    }, 160)
    return () => clearInterval(id)
  }, [])

  const active = COVERS.reduce((best, c) =>
    Math.abs(Math.log(c.T / T)) < Math.abs(Math.log(best.T / T)) ? c : best
  )
  const lent = Math.round(stats.lent * 100)
  const peak = stats.peak / 1e3
  const overCap = stats.peak > CAPILLARY

  return (
    <div className="stage">
      <Canvas
        dpr={[1, 2]}
        camera={{ fov: 30, near: 0.01, far: 20, position: VIEW.pos }}
        gl={{ antialias: true, toneMapping: THREE.NoToneMapping }}
        onCreated={({ gl }) => gl.setClearColor('#B8B1A3')}
      >
        <Scene tensionRef={tensionRef} statsRef={statsRef} view={VIEW} />
      </Canvas>

      <header className="top">
        <div className="mark">Day 101 · after THE PILLOW — pillow.jp</div>
        <h1>
          The foam you are
          <br />
          not lying on.
        </h1>
      </header>

      <section className="figure">
        <div className="big">
          {lent}
          <span>%</span>
        </div>
        <p className="cap">
          of the head is held by foam
          <br />
          the head is not touching.
        </p>
        <dl className="read">
          <div>
            <dt>Cover tension</dt>
            <dd>{T < 10 ? fmt(T, 1) : Math.round(T)} N/m</dd>
          </div>
          <div>
            <dt>Spread √(T/k)</dt>
            <dd>{fmt(stats.spread * 100)} cm</dd>
          </div>
          <div>
            <dt>Sink</dt>
            <dd>{fmt(stats.sink * 100, 2)} cm</dd>
          </div>
          <div>
            <dt>Contact</dt>
            <dd>{Math.round(stats.area * 1e4)} cm²</dd>
          </div>
          <div className={overCap ? 'warn' : ''}>
            <dt>Peak pressure</dt>
            <dd>{fmt(peak, 2)} kPa</dd>
          </div>
        </dl>
      </section>

      <footer className="bottom">
        <div className="covers">
          {COVERS.map((c) => (
            <button key={c.key} className={c === active ? 'on' : ''} onClick={() => setT(c.T)}>
              {c.name}
              <i>{c.T}</i>
            </button>
          ))}
        </div>
        <input
          className="slider"
          type="range"
          min="0"
          max="1"
          step="0.001"
          value={toSlider(T)}
          onChange={(e) => setT(fromSlider(Number(e.target.value)))}
          aria-label="cover tension"
        />
        <p className="note">
          Foam: springs, k = E/h, E = {E / 1e3} kPa. Cover: a membrane at tension T. The head (45 N) settles
          where −T∇²w + kw adds up to its weight. Lines: the load the foam carries, every 0.25 kPa (dark: every 1 kPa). Gold: above capillary closing,
          4.27 kPa. Move over the pillow to move the head.
        </p>
      </footer>
    </div>
  )
}
