import { useEffect, useMemo, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import Scene from './Scene.jsx'
import { RC_PRESETS, PARAMS, vTheta } from './rig.js'

// 再現元: 株式会社OASIZ (https://oasiz.org/)
// 白に近い地に蛍光グリーンの渦が1つだけ。極大の欧文をベースラインで切って上へ逃がし、
// 小さな和文を渦に半分隠させる、という文字の置き方までを含めて借りている。
// 借りていないもの: ロゴ・コンテンツ・スクロール尺・全ページの配色反転。

// vθ(r) を小さく引く。今日の装置は式1本なので、式そのものを画面に置く。
function Profile({ rc }) {
  const { d, peakX, w, h } = useMemo(() => {
    const w = 268
    const h = 74
    const R = 3.2
    let vmax = 0
    for (let i = 0; i <= 200; i++) vmax = Math.max(vmax, vTheta((i / 200) * R, rc))
    const pts = []
    let peakX = 0
    for (let i = 0; i <= 200; i++) {
      const r = (i / 200) * R
      const v = vTheta(r, rc)
      if (v >= vmax - 1e-9) peakX = (r / R) * w
      pts.push(`${((r / R) * w).toFixed(1)},${(h - (v / (vmax || 1)) * (h - 6)).toFixed(1)}`)
    }
    return { d: `M ${pts.join(' L ')}`, peakX, w, h }
  }, [rc])

  return (
    <svg className="plot" width={w} height={h + 16} viewBox={`0 0 ${w} ${h + 16}`}>
      <line x1="0" y1={h} x2={w} y2={h} stroke="#dfe2df" />
      <line x1={peakX} y1="0" x2={peakX} y2={h} stroke="#c9cdc9" strokeDasharray="2 3" />
      <path d={d} fill="none" stroke="#00c840" strokeWidth="1.4" />
      <text x={peakX + 5} y="12" fontSize="9" letterSpacing="1.6" fill="#8b918b">
        r = rc
      </text>
      <text x="0" y={h + 13} fontSize="9" letterSpacing="1.6" fill="#a8ada8">
        0
      </text>
      <text x={w - 26} y={h + 13} fontSize="9" letterSpacing="1.6" fill="#a8ada8">
        3.2
      </text>
    </svg>
  )
}

export default function App() {
  const [rc, setRc] = useState(RC_PRESETS[1])
  const [paused, setPaused] = useState(false)

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === '1') setRc(RC_PRESETS[0])
      if (e.key === '2') setRc(RC_PRESETS[1])
      if (e.key === '3') setRc(RC_PRESETS[2])
      if (e.code === 'Space') {
        e.preventDefault()
        setPaused((p) => !p)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const vmax = (PARAMS.gamma / (2 * Math.PI * rc)) * (1 - Math.exp(-1))

  return (
    <div className="app">
      <Canvas
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: false }}
        camera={{ fov: 30, near: 0.1, far: 60, position: [0, 6.1, 5.4] }}
      >
        <Scene rc={rc} paused={paused} />
      </Canvas>

      <div className="ui">
        {/* 極大の欧文をベースラインで切って上へ逃がす（再現元の文字の置き方） */}
        <h1 className="giant">VORTEX</h1>
        <p className="jp">渦は、芯で折り返す</p>

        <div className="col">
          <p className="kicker">Reproduced from OASIZ — the single green spiral</p>
          <p>
            One vortex on a ground that owns no colour. What makes it read as a vortex is not the
            rotation; it is that the tangential speed <em>turns back</em> at a radius.
          </p>
          <p className="mono">
            v<span className="sub">θ</span>(r) = (Γ / 2πr) · (1 − e
            <span className="sup">−r²/rc²</span>)
          </p>
          <p>
            Inside r<span className="sub">c</span> the flow is solid body — nothing appears to move.
            Outside it falls off as 1/r, and that difference is what winds the arms. The grey circle
            in the scene is r<span className="sub">c</span>: the tails are longest exactly on it.
          </p>
          <Profile rc={rc} />
        </div>

        <div className="legend">
          <div className="row">
            <span>Core radius</span>
            <b>
              rc = {rc.toFixed(2)}
              <span className="dim"> · keys 1 / 2 / 3</span>
            </b>
          </div>
          <div className="row">
            <span>Peak tangential speed</span>
            <b>{vmax.toFixed(2)} /s at r = rc</b>
          </div>
          <div className="row">
            <span>Circulation Γ · inflow</span>
            <b>
              {PARAMS.gamma.toFixed(1)} · {PARAMS.inflow.toFixed(2)}
            </b>
          </div>
          <div className="row">
            <span>Particles · tail</span>
            <b>3000 × 26 pts</b>
          </div>
        </div>

        <footer className="foot">
          <span className="mark">3D Daily — Day 049</span>
          <span>Lamb–Oseen vortex · tangential field, radial inflow, core updraft</span>
          <span className="dim">
            {paused ? 'paused' : 'running'} · space to hold · pointer moves the core
          </span>
        </footer>
      </div>
    </div>
  )
}
