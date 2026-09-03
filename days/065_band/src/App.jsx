import { useEffect, useMemo, useRef } from 'react'
import { Canvas } from '@react-three/fiber'
import Scene from './Scene.jsx'
import { M, SPAN, SPEED, BANDS } from './rig.js'

export default function App() {
  const stats = useMemo(() => ({ arc: 0, kg: 0, lat: 0, steps: 0 }), [])
  const out = useRef({})

  // HUD は React を通さず DOM に直に書く。毎フレーム setState すると
  // ヘッドレスの合成が最後の1枚に間に合わず、初期値のまま焼き付く（Day 050）。
  useEffect(() => {
    let raf
    const tick = () => {
      const o = out.current
      if (o.arc) o.arc.textContent = stats.arc.toFixed(1)
      if (o.turns) o.turns.textContent = (stats.arc / (Math.PI * 2)).toFixed(2)
      if (o.kg)
        o.kg.textContent = `${stats.kg >= 0 ? '+' : ''}${stats.kg.toFixed(3)}`
      if (o.lat)
        o.lat.textContent = `${stats.lat >= 0 ? '+' : ''}${stats.lat.toFixed(1)}°`
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [stats])

  return (
    <div className="wrap">
      <Canvas
        dpr={[1, 2]}
        gl={{ antialias: true }}
        camera={{ fov: 17, position: [0, 0, 11.2], near: 0.1, far: 60 }}
      >
        <Scene stats={stats} out={out} />
      </Canvas>

      <div className="ui">
        <div className="rail rail-tl">
          <span className="tick">3D DAILY</span>
          <span className="tick dim">DAY 065</span>
        </div>
        <div className="rail rail-tr">
          <span className="tick dim">AFTER</span>
          <span className="tick">MARUNOUCHI INNOVATION PARTNERS</span>
        </div>

        <div className="lede">
          <p className="kicker">The Sphere Frame</p>
          <h1>
            A band is
            <br />
            never told
            <br />
            which way is up.
          </h1>
        </div>

        <div className="note">
          <p>
            Three ribbons, one constraint. Nothing here says how a band should be
            oriented — only that every point of it satisfies <em>|p| = 1</em>. The
            width runs along <em>p × T</em>, because on a sphere that direction is
            not a choice. The sphere itself is never drawn.
          </p>
        </div>

        <div className="hud">
          <div className="row">
            <span className="k">ARC</span>
            <span className="v" ref={(el) => (out.current.arc = el)}>
              0.0
            </span>
            <span className="u">rad</span>
          </div>
          <div className="row">
            <span className="k">TURNS</span>
            <span className="v" ref={(el) => (out.current.turns = el)}>
              0.00
            </span>
            <span className="u">×2π</span>
          </div>
          <div className="row">
            <span className="k">k_g</span>
            <span className="v" ref={(el) => (out.current.kg = el)}>
              +0.000
            </span>
            <span className="u">geodesic</span>
          </div>
          <div className="row">
            <span className="k">LAT</span>
            <span className="v" ref={(el) => (out.current.lat = el)}>
              +0.0°
            </span>
            <span className="u">head</span>
          </div>
          <div className="rule" />
          <div className="row small">
            <span className="k">WINDOW</span>
            <span className="v">{SPAN.toFixed(1)}</span>
            <span className="u">rad · {M} samples</span>
          </div>
          <div className="row small">
            <span className="k">SPEED</span>
            <span className="v">{SPEED.toFixed(2)}</span>
            <span className="u">rad/s</span>
          </div>
        </div>

        <div className="legend">
          {BANDS.map((b) => (
            <span className="chip" key={b.name}>
              <i style={{ background: b.front }} />
              {b.name}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
