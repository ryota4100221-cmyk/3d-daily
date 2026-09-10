import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import * as THREE from 'three'

import Scene from './Scene.jsx'
import { CAM, MD, pathAt, SPOKE_R, K_STRING, T_STATIC, C_TOR, WELL } from './rig.js'

// The camera never moves, so every label in the overlay can be projected once
// with a throwaway copy of it. Day 070 learned this the hard way: projecting
// inside useFrame let headless capture a frame where the rod had drawn and the
// scale had not.
function project(world, w, h) {
  const cam = new THREE.PerspectiveCamera(CAM.fov, w / h, CAM.near, CAM.far)
  cam.position.set(...CAM.pos)
  cam.lookAt(...CAM.target)
  cam.updateMatrixWorld()
  cam.updateProjectionMatrix()
  const v = new THREE.Vector3()
  return world.map(([x, y, z = 0]) => {
    v.set(x, y, z).project(cam)
    return [((v.x + 1) / 2) * w, ((1 - v.y) / 2) * h]
  })
}

const DEPTHS = [0, 500, 1000, 1500, 2000, 2500, 3000]

export default function App() {
  const [frs, setFrs] = useState(false)
  const [vp, setVp] = useState(() => [window.innerWidth, window.innerHeight])

  useEffect(() => {
    const onResize = () => setVp([window.innerWidth, window.innerHeight])
    const onKey = (e) => {
      if (e.key === 'f' || e.key === 'F') setFrs((v) => !v)
    }
    window.addEventListener('resize', onResize)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  const labels = useMemo(() => {
    const [w, h] = vp
    const pts = DEPTHS.map((s) => {
      const p = pathAt(Math.min(s, MD - 0.001))
      const o = SPOKE_R + 150
      // the 0 m mark would otherwise sit on top of the ground line
      return [p.x + o * p.nx, p.y + o * p.ny - (s === 0 ? 128 : 0), 0]
    })
    const extra = [
      [620, -760 - 196, 0],
      [1060, -760 - 196, 0],
    ]
    const xy = project([...pts, ...extra], w, h)
    return {
      depth: DEPTHS.map((s, i) => ({ s, xy: xy[i] })),
      dialTop: xy[DEPTHS.length],
      dialBit: xy[DEPTHS.length + 1],
    }
  }, [vp])

  const rpmRef = useRef()
  const turnRef = useRef()
  const tqRef = useRef()
  const dssiRef = useRef()
  const barRef = useRef()
  const traceRef = useRef()
  const stateRef = useRef()

  const onFrame = useCallback((r, trace) => {
    if (rpmRef.current) rpmRef.current.textContent = r.bitRpm.toFixed(1)
    if (turnRef.current) turnRef.current.textContent = r.turns.toFixed(2)
    if (tqRef.current) tqRef.current.textContent = (r.topTorque / 1000).toFixed(2)
    if (dssiRef.current) dssiRef.current.textContent = r.dssi.toFixed(2)
    if (barRef.current) {
      const u = Math.min(1, Math.max(0, r.bitRpm / 420))
      barRef.current.style.width = (u * 100).toFixed(1) + '%'
    }
    if (stateRef.current)
      stateRef.current.textContent =
        (Math.round(r.rpmMin) || 0) + ' … ' + Math.round(r.rpmMax) + ' rpm over 20 s'
    if (traceRef.current) {
      const m = trace.length
      let d = ''
      for (let i = 0; i < m; i++) {
        const x = (i / (m - 1)) * 100
        const y = 88 - Math.min(1, Math.max(0, trace[i] / 440)) * 84
        d += (i ? ' ' : '') + x.toFixed(2) + ',' + y.toFixed(2)
      }
      traceRef.current.setAttribute('points', d)
    }
  }, [])

  return (
    <div className="root">
      <Canvas
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
        camera={{ fov: CAM.fov, position: CAM.pos, near: CAM.near, far: CAM.far }}
        onCreated={({ camera }) => camera.lookAt(...CAM.target)}
      >
        <Scene onFrame={onFrame} frs={frs} />
      </Canvas>

      {/* depth scale — projected once, because the camera is nailed down */}
      <div className="marks">
        {labels.depth.map(({ s, xy }) => (
          <span key={s} style={{ left: xy[0], top: xy[1] }}>
            {s === 0 ? '0 m MD' : s.toLocaleString('en-US')}
          </span>
        ))}
        <span className="dial" style={{ left: labels.dialTop[0], top: labels.dialTop[1] }}>
          TOP DRIVE — Ω constant
        </span>
        <span className="dial hot" style={{ left: labels.dialBit[0], top: labels.dialBit[1] }}>
          BIT — ω(t)
        </span>
      </div>

      <div className="col">
        <div className="eyebrow">
          DAY 071 · AFTER SSTR.TECH — FRICTION REDUCTION SYSTEMS
        </div>
        <h1>
          The
          <br />
          Stored Turn
        </h1>
        <p className="lede">
          Three kilometres of 5-inch drill pipe, turned at the surface at a rate that never
          varies by so much as a tenth of an rpm. The bit at the far end stops dead for two
          seconds at a time, then spins at three times the speed of the thing driving it.
        </p>
        <p className="lede">
          Nothing is lost while it is stopped. The rod is a spring — {K_STRING.toFixed(0)} N·m
          per radian, {(T_STATIC / K_STRING / (2 * Math.PI)).toFixed(1)} turns of wind-up before
          it breaks away — and every turn the surface makes that the bit does not is held in the
          steel until the bit lets go.
        </p>

        <div className="table">
          <Row k="surface rpm" v="120.0" unit="constant" />
          <Row k="bit rpm" v={<b ref={rpmRef}>—</b>} unit="live" hot />
          <Row k="wind-up" v={<b ref={turnRef}>—</b>} unit="turns" />
          <Row k="torque at surface" v={<b ref={tqRef}>—</b>} unit="kN·m" />
          <Row k="stick-slip index" v={<b ref={dssiRef}>—</b>} unit="(max−min)/2·avg" />
        </div>

        <div className="bar">
          <i ref={barRef} />
        </div>

        <div className="chart">
          <div className="chead">
            <span>BIT RPM · LAST 20 S</span>
            <span ref={stateRef}>—</span>
          </div>
          <svg viewBox="0 0 100 88" preserveAspectRatio="none">
            <line x1="0" y1={(88 - (120 / 440) * 84).toFixed(2)} x2="100" y2={(88 - (120 / 440) * 84).toFixed(2)} />
            <polyline ref={traceRef} points="" />
          </svg>
        </div>

        <div className="foot">
          <div>
            <span className="key">[ F ]</span> friction-reduction tool{' '}
            <em className={frs ? 'on' : ''}>{frs ? 'ENGAGED' : 'OFF'}</em>
          </div>
          <div className="fine">
            Torsional wave equation on 241 nodes, dz = 12.5 m, c = {C_TOR.toFixed(0)} m/s.
            Velocity-weakening friction at the bit only. The word “stick” appears nowhere
            in the model. Stripe radius exaggerated ×1350. Reference: ССТР / sstr.tech —
            case Гор 90°, Западная Сибирь. Well: {WELL.VERT} m vertical,
            {' '}{WELL.R_BUILD} m build, {WELL.LAT.toFixed(0)} m lateral.
          </div>
        </div>
      </div>
    </div>
  )
}

function Row({ k, v, unit, hot }) {
  return (
    <div className={'row' + (hot ? ' hot' : '')}>
      <span className="k">{k}</span>
      <span className="v">{v}</span>
      <span className="u">{unit}</span>
    </div>
  )
}
