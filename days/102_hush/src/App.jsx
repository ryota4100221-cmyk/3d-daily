import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import Scene from './Scene.jsx'
import { MODES, MS, KICK_HZ, bleedDb, gainOf, massLawTL, renderBuffer } from './rig.js'

const PERIOD = 2.4 // s between auto strikes — a slow quarter note on the hats
const FIRST = 0.4

const forced = (() => {
  const q = new URLSearchParams(location.search).get('hush')
  return q === null ? null : q === '1'
})()

// The conductor owns time, the strike list and whether the box is down.
// Auto: three hushed strikes, three open, repeat — so the page argues both sides.
class Conductor {
  constructor() {
    this.t0 = performance.now()
    this.manual = forced
    this.extra = [] // [time, hush] from clicks
    this.listeners = new Set()
  }
  now() {
    return (performance.now() - this.t0) / 1000
  }
  autoHush(i) {
    return this.manual !== null ? this.manual : Math.floor(i / 3) % 2 === 0
  }
  last(t) {
    let best = null
    if (t >= FIRST) {
      const i = Math.floor((t - FIRST) / PERIOD)
      best = [FIRST + i * PERIOD, this.autoHush(i)]
    }
    for (const e of this.extra) if (e[0] <= t && (!best || e[0] > best[0])) best = e
    return best
  }
  since(t) {
    const l = this.last(t)
    return l ? t - l[0] : -1
  }
  hushAt(t) {
    const l = this.last(t)
    return l ? l[1] : this.autoHush(0)
  }
  // the box moves a beat early, so it is in place when the stick lands
  boxAt(t) {
    const next = t < FIRST ? 0 : Math.floor((t - FIRST) / PERIOD) + 1
    const tn = FIRST + next * PERIOD
    return tn - t < 0.9 ? this.autoHush(next) : this.hushAt(t)
  }
  strike(hush) {
    const t = this.now()
    this.extra.push([t, hush])
    if (this.extra.length > 8) this.extra.shift()
  }
}

function useAudio() {
  const ref = useRef(null)
  const enable = () => {
    if (ref.current) return ref.current
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (!Ctx) return null
    const ctx = new Ctx()
    const open = renderBuffer(ctx, false)
    const hushed = renderBuffer(ctx, true)
    const out = ctx.createGain()
    out.gain.value = 0.55 / open.peak // one scale for both: the hush is heard as quieter
    out.connect(ctx.destination)
    ref.current = {
      ctx,
      play(hush) {
        const s = ctx.createBufferSource()
        s.buffer = hush ? hushed.buf : open.buf
        s.connect(out)
        s.start()
      },
    }
    return ref.current
  }
  return { ref, enable }
}

// ── spectrum: every mode as a tick, open vs. what leaves the box ─────────────
function Spectrum({ hush }) {
  const W = 330
  const H = 128
  const x = (f) => ((Math.log10(f) - Math.log10(40)) / (Math.log10(20000) - Math.log10(40))) * W
  const y = (db) => (Math.min(0, Math.max(-60, db)) / -60) * H
  const curve = []
  for (let i = 0; i <= 60; i++) {
    const f = 40 * Math.pow(500, i / 60)
    curve.push(`${x(f).toFixed(1)},${y(-massLawTL(f)).toFixed(1)}`)
  }
  return (
    <svg className="spec" viewBox={`-8 -14 ${W + 16} ${H + 34}`} width={W + 16} height={H + 34}>
      {[0, -20, -40, -60].map((d) => (
        <g key={d}>
          <line x1={0} x2={W} y1={y(d)} y2={y(d)} className="grid" />
          <text x={W + 4} y={y(d) + 3} className="ax">{d}</text>
        </g>
      ))}
      {MODES.map((k, i) => {
        const a = 20 * Math.log10(k.a)
        const b = a + 20 * Math.log10(gainOf(k.f, true))
        return (
          <g key={i}>
            <line x1={x(k.f)} x2={x(k.f)} y1={H} y2={y(a)} className={hush ? 'ghost' : 'open'} />
            {hush && <line x1={x(k.f)} x2={x(k.f)} y1={H} y2={y(b)} className="hushed" />}
          </g>
        )
      })}
      <polyline points={curve.join(' ')} className="law" />
      <line x1={x(KICK_HZ)} x2={x(KICK_HZ)} y1={y(-massLawTL(KICK_HZ))} y2={H} className="kick" />
      <text x={x(KICK_HZ) + 4} y={H - 4} className="ax">kick</text>
      {[100, 1000, 10000].map((f) => (
        <text key={f} x={x(f)} y={H + 14} className="ax" textAnchor="middle">
          {f >= 1000 ? `${f / 1000}k` : f}
        </text>
      ))}
      <text x={0} y={-4} className="ax">dB per mode · {MODES.length} modes · mass law −TL(f)</text>
    </svg>
  )
}

export default function App() {
  const clock = useRef(new Conductor())
  const [hush, setHush] = useState(() => clock.current.hushAt(0))
  const audio = useAudio()
  const lastPlayed = useRef(-1)

  // follow the conductor for the readout, and fire audio on auto strikes
  useEffect(() => {
    let raf
    const tick = () => {
      const c = clock.current
      const t = c.now()
      const h = c.hushAt(t)
      setHush((p) => (p === h ? p : h))
      const l = c.last(t)
      if (l && l[0] !== lastPlayed.current) {
        lastPlayed.current = l[0]
        if (audio.ref.current && t - l[0] < 0.1) audio.ref.current.play(l[1])
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  const strike = () => {
    const a = audio.enable()
    if (a && a.ctx.state === 'suspended') a.ctx.resume()
    clock.current.strike(clock.current.hushAt(clock.current.now()))
  }
  const toggle = (e) => {
    e.stopPropagation()
    audio.enable()
    const c = clock.current
    c.manual = !c.hushAt(c.now())
    c.strike(c.manual)
  }

  const nums = useMemo(() => {
    const hi = MODES.filter((k) => k.f > 2000)
    const e = (list, h) => list.reduce((s, k) => s + k.a * k.a * k.tau * gainOf(k.f, h) ** 2, 0)
    return {
      all: bleedDb(true),
      hi: 10 * Math.log10(e(hi, true) / e(hi, false)),
      kick: -massLawTL(KICK_HZ),
      share: (100 * e(hi, false)) / e(MODES, false),
    }
  }, [])

  return (
    <div className="stage" onPointerDown={strike}>
      <Canvas camera={{ position: [2.9, 0.75, 4.3], fov: 56, near: 0.05, far: 80 }} dpr={[1, 1.5]} gl={{ antialias: true }}>
        <Scene clock={clock} />
      </Canvas>

      <header className="top">
        <span>3D Daily — 102</span>
        <span className="dim">after HHHusher · hhhusher.com</span>
      </header>

      <section className="hero">
        <h1>Eliminate</h1>
        <p className="sub">Hi-hat bleed, as a list of {MODES.length} modes and one line of physics.</p>
        <p className="body">
          The box cannot tell a cymbal from a kick drum. It only hears frequency — a wall of {MS} kg/m²
          gives back 6 dB more every octave. A cymbal is {nums.share.toFixed(0)}% high modes.
        </p>
      </section>

      <aside className="read">
        <div className={`state ${hush ? 'on' : ''}`}>{hush ? 'HUSHED' : 'OPEN'}</div>
        <dl>
          <dt>bleed, whole ring</dt>
          <dd>{hush ? nums.all.toFixed(1) : '0.0'} dB</dd>
          <dt>bleed above 2 kHz</dt>
          <dd>{hush ? nums.hi.toFixed(1) : '0.0'} dB</dd>
          <dt>kick at {KICK_HZ} Hz, same wall</dt>
          <dd>{nums.kick.toFixed(1)} dB</dd>
        </dl>
        <code>TL(f) = 20·log₁₀(m·f) − 47</code>
        <Spectrum hush={hush} />
        <button className={`hush ${hush ? 'on' : ''}`} onPointerDown={toggle}>
          {hush ? 'Lift the box' : 'Lower the box'}
        </button>
      </aside>

      <footer className="foot">
        <span>click anywhere to strike — sound on</span>
        <span className="dim">the floor is the air outside the box · same modes, slowed ×8</span>
      </footer>
    </div>
  )
}
