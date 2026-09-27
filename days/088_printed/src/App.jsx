import { useEffect, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import Scene from './Scene.jsx'
import { NX, NY, RINGS, GATHER } from './rig.js'

const params = new URLSearchParams(location.search)
const START_PROJECTED = params.get('print') === '0'

function Hud({ stats, printRef, els }) {
  // writes numbers straight into the DOM — no React re-render per frame
  useFrame(() => {
    const s = stats.current
    if (!s) return
    const e = els.current
    if (e.strain) e.strain.textContent = (s.strainMax * 100).toFixed(2) + '%'
    if (e.mean) e.mean.textContent = (s.strainMean * 100).toFixed(3) + '%'
    if (e.wind) e.wind.textContent = s.wind.toFixed(2)
    if (e.mode) e.mode.textContent = printRef.current ? 'printed — on the thread' : 'projected — on the screen'
  })
  return null
}

export default function App() {
  const printRef = useRef(!START_PROJECTED)
  const stats = useRef(null)
  const pointer = useRef({ ndcX: 0, ndcY: 0, active: false })
  const els = useRef({})
  const bind = (k) => (el) => (els.current[k] = el)

  useEffect(() => {
    const move = (e) => {
      const p = pointer.current
      p.ndcX = (e.clientX / innerWidth) * 2 - 1
      p.ndcY = -(e.clientY / innerHeight) * 2 + 1
      p.active = true
    }
    const leave = () => (pointer.current.active = false)
    const down = (e) => {
      move(e)
      printRef.current = START_PROJECTED
      document.body.classList.add('holding')
    }
    const up = () => {
      printRef.current = !START_PROJECTED
      document.body.classList.remove('holding')
    }
    addEventListener('pointermove', move)
    addEventListener('pointerdown', down)
    addEventListener('pointerup', up)
    addEventListener('pointercancel', up)
    document.addEventListener('pointerleave', leave)
    return () => {
      removeEventListener('pointermove', move)
      removeEventListener('pointerdown', down)
      removeEventListener('pointerup', up)
      removeEventListener('pointercancel', up)
      document.removeEventListener('pointerleave', leave)
    }
  }, [])

  return (
    <>
      <Canvas
        className="stage"
        flat
        dpr={[1, 2]}
        camera={{ position: [0, 0, 11], fov: 32 }}
        gl={{ antialias: true, toneMapping: THREE.NoToneMapping }}
      >
        <Scene printRef={printRef} stats={stats} pointer={pointer} />
        <Hud stats={stats} printRef={printRef} els={els} />
      </Canvas>

      <header className="top">
        <span className="mark">
          <i className="dot" />
          3D Daily <b>088</b>
        </span>
        <span className="after">after Wpc. Patterns — wpc-patterns.jp</span>
      </header>

      <main className="copy">
        <nav className="index" aria-label="threads">
          <span><i className="dot" />Warp</span>
          <span>Weft</span>
          <span>Rings</span>
          <span>Wind</span>
        </nav>
        <h1>
          The print
          <br />
          follows
          <br />
          the thread.
        </h1>
        <p className="ja">柄は、いつも、糸についていく。</p>
        <p className="body">
          {NX} × {NY} points, three kinds of thread, {RINGS} rings gathered to {Math.round(GATHER * 100)}%.
          Nothing here draws a fold. The pattern is indexed by the cloth, so wherever the wind takes a
          thread, its dots go with it.
        </p>
      </main>

      <footer className="hud">
        <div>
          <em>thread strain, max</em>
          <strong ref={bind('strain')}>—</strong>
        </div>
        <div>
          <em>mean</em>
          <strong ref={bind('mean')}>—</strong>
        </div>
        <div>
          <em>wind</em>
          <strong ref={bind('wind')}>—</strong>
        </div>
        <div className="mode">
          <em>pattern</em>
          <strong ref={bind('mode')}>printed — on the thread</strong>
        </div>
      </footer>
      <p className="hint">Hold anywhere — project the pattern instead of printing it.</p>
    </>
  )
}
