import { useMemo, useRef, useState, useCallback } from 'react'
import { Canvas } from '@react-three/fiber'
import Scene from './Scene.jsx'
import { N, ESCAPE, CRUISE, LATENCY, SEE, createSchool, step, knock, densest } from './rig.js'

// ?shot=<seconds after the knock> runs the school forward synchronously and
// freezes it there — headless capture gets the same frame every time.
function usePresim() {
  return useMemo(() => {
    const q = new URLSearchParams(location.search)
    const shot = q.get('shot')
    const s = createSchool()
    if (shot == null) return { school: s, presim: false }
    for (let k = 0; k < 60 * 12; k++) step(s, 1 / 60)
    const [x, y] = densest(s)
    knock(s, x, y)
    const after = Number(shot) || 1.1
    for (let k = 0; k < Math.round(60 * after); k++) step(s, 1 / 60)
    return { school: s, presim: true }
  }, [])
}

const fmt = (v, d = 1) => (v == null || !isFinite(v) ? '—' : v.toFixed(d))

export default function App() {
  const { school, presim } = usePresim()
  const read = () => {
    const c = school.cascade
    return { c: c?.c ?? null, reached: c?.reached ?? 0, n: school.history.length }
  }
  // initialised from the school itself so a frozen capture never shows the placeholder
  const [hud, setHud] = useState(read)
  const last = useRef(-1)
  const onTick = useCallback(() => {
    const now = performance.now()
    if (now - last.current < 120 && last.current > 0) return
    last.current = now
    setHud(read())
  }, [school])

  const ratio = hud.c != null ? hud.c / ESCAPE : null

  return (
    <>
      <div className="stage">
        <Canvas flat orthographic dpr={[1, 2]} gl={{ antialias: true }} camera={{ position: [0, 0, 50], near: 0.1, far: 200 }}>
          <color attach="background" args={['#FFFFFF']} />
          <Scene school={school} onTick={onTick} presim={presim} />
        </Canvas>
      </div>

      <header className="top">
        <span>Kawasui Aqua &amp; Animal School — after</span>
        <span>Day 097 · Study of a school</span>
        <span>{N.toLocaleString('en')} fish · seen from above</span>
      </header>

      <section className="title">
        <p className="kicker">The Trafalgar effect</p>
        <h1>
          The turn that
          <br />
          outruns the fish.
        </h1>
      </section>

      <dl className="spec">
        <div>
          <dt>Fastest fish (escape)</dt>
          <dd>{fmt(ESCAPE)} BL/s</dd>
        </div>
        <div>
          <dt>Startle front, fitted</dt>
          <dd className="big">{fmt(hud.c)} BL/s</dd>
        </div>
        <div>
          <dt>Front ÷ fastest fish</dt>
          <dd>× {fmt(ratio, 2)}</dd>
        </div>
        <div>
          <dt>Glance {fmt(SEE)} BL ÷ react {Math.round(LATENCY * 1000)} ms</dt>
          <dd>{fmt(SEE / LATENCY)} BL/s</dd>
        </div>
        <div>
          <dt>Fish reached · knock {hud.n}</dt>
          <dd>{hud.reached.toLocaleString('en')} / {N.toLocaleString('en')}</dd>
        </div>
      </dl>

      <p className="lede">
        No fish here swims faster than {fmt(ESCAPE)} body lengths a second, cruising at {fmt(CRUISE)}. Yet the turn crosses the
        shoal three times faster — because it is not carried by any fish. It is the order in which they see each other.
        <br />
        <em>Tap the water to knock on the glass.</em>
      </p>
    </>
  )
}
