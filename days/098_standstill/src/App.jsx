import { useEffect, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import Scene from './Scene.jsx'
import {
  GEOM,
  MATERIALS,
  measure,
  nFromPointer,
  pointerFromN,
  standstillIndex,
} from './rig.js'

const q = new URLSearchParams(location.search)
const N0 = q.has('n') ? Number(q.get('n')) : 1.523
const N_STAR = standstillIndex()

const sign = (v, d = 2) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(d)

export default function App() {
  const nRef = useRef(N0)
  const target = useRef(N0)
  const tilt = useRef({ x: 0, y: 0 })
  const [m, setM] = useState(() => measure(N0))

  useEffect(() => {
    const move = (e) => {
      const x = e.clientX / innerWidth
      target.current = nFromPointer((x - 0.08) / 0.84)
      tilt.current = { x: x * 2 - 1, y: (e.clientY / innerHeight) * 2 - 1 }
    }
    addEventListener('pointermove', move)
    let raf
    let last = 0
    const tick = (t) => {
      nRef.current += (target.current - nRef.current) * 0.06
      if (t - last > 90) {
        last = t
        setM(measure(nRef.current))
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      removeEventListener('pointermove', move)
      cancelAnimationFrame(raf)
    }
  }, [])

  const dir = Math.abs(m.m0) < 0.02 ? 'stands still' : m.m0 > 0 ? 'runs forward' : 'runs backward'

  return (
    <>
      <div className="stage">
        <Canvas
          flat
          dpr={[1, 1.5]}
          camera={{ position: [0, -0.32, 9], fov: 35, near: 0.1, far: 60 }}
          gl={{ antialias: true }}
        >
          <Scene nRef={nRef} tilt={tilt} />
        </Canvas>
      </div>

      <header className="top">
        <span>Day 098 — 3D Daily</span>
        <span>after Okamoto Optics · recruit</span>
        <span>tube r = {GEOM.r.toFixed(2)} · wall at D = 2r</span>
      </header>

      <div className="title">
        <p className="kicker">A glass ring is a lens bent into a circle</p>
        <h1>
          Where the Stripes
          <br />
          Stand Still
        </h1>
      </div>

      <p className="lede">
        The wall runs right. Through the ring it <em>{dir}</em>. Across its
        tube the ring is a cylinder lens; the wall sits two tube‑radii behind it.
        At <em>n = 4/3</em> — water — every ray through the middle lands on one
        point, and the stripes stop. Slide sideways to change what it is made of.
      </p>

      <div className="scale">
        <div className="track">
          <i className="star" style={{ left: `${pointerFromN(N_STAR) * 100}%` }} />
          <i className="now" style={{ left: `${pointerFromN(m.n) * 100}%` }} />
        </div>
        <div className="ticks">
          {MATERIALS.map((x) => (
            <span key={x.name} style={{ left: `${pointerFromN(x.n) * 100}%` }}>
              {x.name}
              <b>{x.n.toFixed(3)}</b>
            </span>
          ))}
        </div>
      </div>

      <dl className="spec">
        <div>
          <dt>Material</dt>
          <dd className="big">{m.material}</dd>
        </div>
        <div>
          <dt>Index n</dt>
          <dd>{m.n.toFixed(3)}</dd>
        </div>
        <div>
          <dt>Tube focal length f</dt>
          <dd>{isFinite(m.fOverR) ? `${m.fOverR.toFixed(2)} r` : '∞'}</dd>
        </div>
        <div>
          <dt>Stripe scale through the middle (traced)</dt>
          <dd className="big">×{sign(m.m0)}</dd>
        </div>
        <div>
          <dt>Tube width showing them reversed</dt>
          <dd>{(m.reversedFrac * 100).toFixed(1)} %</dd>
        </div>
        <div>
          <dt>Standstill index (bisected)</dt>
          <dd>{N_STAR.toFixed(4)}</dd>
        </div>
      </dl>
    </>
  )
}
