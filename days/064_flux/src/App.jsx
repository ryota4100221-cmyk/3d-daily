import { useMemo, useRef, useEffect } from 'react'
import { Canvas } from '@react-three/fiber'
import Scene from './Scene.jsx'
import { BAND_HEX, NBANDS, N, NX, NZ, SPAN } from './rig.js'

export default function App() {
  const stats = useMemo(
    () => ({ peak: 0, defl: 0, residual: 0, lx: 0, lz: 0, exagg: 1 }),
    []
  )
  const out = useRef({})

  // HUD は React の再描画を通さず DOM に直接書く。毎フレーム setState すると
  // ヘッドレスの合成が最後の1枚に間に合わず、初期値のまま焼き付く（Day 050）。
  useEffect(() => {
    let raf
    const tick = () => {
      const o = out.current
      if (o.peak) o.peak.textContent = stats.peak.toFixed(2)
      if (o.defl)
        o.defl.textContent = `${stats.defl.toFixed(3)}  ·  span/${Math.round(
          SPAN / Math.max(1e-4, stats.defl)
        )}`
      if (o.res) o.res.textContent = stats.residual.toExponential(1)
      if (o.load)
        o.load.textContent = `${stats.lx >= 0 ? '+' : ''}${stats.lx.toFixed(
          2
        )} , ${stats.lz >= 0 ? '+' : ''}${stats.lz.toFixed(2)}`
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [stats])

  return (
    <div className="wrap">
      {/* 真上に近いカメラで up=(0,1,0) のまま lookAt すると視線と up がほぼ平行になり、
          基底が縮退してロールが 45° 入る（実測）。up を −Z に倒して平面図の向きに固定する。 */}
      <Canvas
        shadows
        dpr={[1, 1.5]}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        camera={{ position: [2.98, 29.25, 4.19], fov: 34, near: 1, far: 110 }}
        onCreated={({ camera }) => {
          camera.up.set(0, 0, -1)
          camera.lookAt(0, -0.3, 0)
        }}
      >
        <Scene stats={stats} />
      </Canvas>

      <div className="hud">
        <header className="tl">
          <div className="eyebrow">3D Daily · Day 064</div>
          <h1>
            The Frame
            <br />
            Gradient
          </h1>
          <p className="lede">
            One field, read twice.
            <br />
            The shape is φ. The colour is ∇φ.
          </p>
          <p className="after">
            after ANDO Imagineering Group — aig-japan.jp
          </p>
        </header>

        <div className="tr">
          <div className="row">
            <span>Plan</span>
            <b>
              {N} × {N} grillage
            </b>
          </div>
          <div className="row">
            <span>Members</span>
            <b>{(NX + NZ).toLocaleString('en-US')}</b>
          </div>
          <div className="row">
            <span>Columns</span>
            <b>4 · asymmetric</b>
          </div>
          <div className="row">
            <span>Field</span>
            <b>∇²φ = −q ⁄ T</b>
          </div>
          <div className="row">
            <span>Solver</span>
            <b>SOR ω 1.90 · 150 sweeps</b>
          </div>
          <div className="row">
            <span>Edges</span>
            <b>free (Neumann)</b>
          </div>
        </div>

        <div className="bl">
          <div className="legend-label">
            Axial flux |T∇φ| — the ten bands are the deciles of the reference
            solve. No colour is chosen; each one is looked up.
          </div>
          <div className="strip">
            {BAND_HEX.map((h, i) => (
              <i key={h} style={{ background: h }} title={`band ${i}`} />
            ))}
          </div>
          <div className="strip-ends">
            <span>0 · carries nothing</span>
            <span>peak · lands on a column</span>
          </div>
        </div>

        <div className="br">
          <div className="row">
            <span>Peak flux</span>
            <b ref={(e) => (out.current.peak = e)}>—</b>
          </div>
          <div className="row">
            <span>δ max</span>
            <b ref={(e) => (out.current.defl = e)}>—</b>
          </div>
          <div className="row">
            <span>Load x , z</span>
            <b ref={(e) => (out.current.load = e)}>—</b>
          </div>
          <div className="row">
            <span>Residual</span>
            <b ref={(e) => (out.current.res = e)}>—</b>
          </div>
          <div className="note">
            deflection exaggerated · move the pointer to walk the load
          </div>
        </div>
      </div>
    </div>
  )
}
