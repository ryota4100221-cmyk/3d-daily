// App.jsx — Day 051 / Ribbon
//
// 構図の借り方: Penguin Capital のFVは、画面下端でベースラインを切った巨大な
// イタリック1語の上に、白い帯を1本だけ浮かせている。借りるのはその「切り取り方」
// だけで、文言・カード・ナビは持ってこない（あれはあのサイトの中身であって装置ではない）。
//
// 数字は React の state に置かない。1回目の実描画で ROLL φ と EDGE-ON が
// 初期値のまま焼き付いた（virtual time 下では setState → 再描画 → 合成 が
// 最後のフレームに間に合わないことがある）。useFrame から textContent を
// 直接書けば、その1本のパスしか通らないので必ず出る。

import { useEffect, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { PerspectiveCamera } from '@react-three/drei'
import Scene from './Scene.jsx'

const PRESETS = [2, 3, 5]

export default function App() {
  const [turns, setTurns] = useState(3)
  const [mobius, setMobius] = useState(false)

  const phiEl = useRef(null)
  const edgeEl = useRef(null)
  const holoEl = useRef(null)
  const barEl = useRef(null)

  const onRead = (r) => {
    if (phiEl.current) phiEl.current.textContent = `${r.phi.toFixed(0)}°`
    if (edgeEl.current) edgeEl.current.textContent = `${r.edgeOn}/${r.samples}`
    if (holoEl.current) holoEl.current.textContent = `${r.holonomy.toFixed(1)}°`
    if (barEl.current) {
      barEl.current.style.width = `${Math.min(100, (r.edgeOn / r.samples) * 900).toFixed(1)}%`
    }
  }

  useEffect(() => {
    const onKey = (e) => {
      const i = ['1', '2', '3'].indexOf(e.key)
      if (i >= 0) setTurns(PRESETS[i])
      if (e.key === 'm' || e.key === 'M') setMobius((v) => !v)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const total = turns + (mobius ? 0.5 : 0)

  return (
    <div className="stage">
      <Canvas
        flat
        dpr={[1, 1.75]}
        gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
      >
        <PerspectiveCamera makeDefault fov={24} position={[0, 0.16, 12.4]} near={0.5} far={60} />
        <Scene turns={turns} mobius={mobius} onRead={onRead} />
      </Canvas>

      <div className="crop" aria-hidden="true">
        <span>Roll</span>
      </div>

      <div className="ui">
        <header>
          <div>
            <h1>RIBBON</h1>
            <p className="sub">3D DAILY · DAY 051</p>
          </div>
          <div className="right">
            <p>AFTER PENGUIN-CAPITAL.CO.JP</p>
            <p className="dim">ONE STRIP, NO ACCENT COLOUR</p>
          </div>
        </header>

        <footer>
          <div className="claim">
            <p>A STRIP IS A CURVE PLUS A ROLL.</p>
            <p className="dim">
              THE WIDTH NEVER CHANGES — ONLY <i>φ(s)</i> DECIDES WHERE IT GOES DARK.
            </p>
          </div>
          <div className="meter">
            <div className="row">
              <span>TURNS</span>
              <b>{total.toFixed(1)}</b>
            </div>
            <div className="row">
              <span>ROLL φ</span>
              <b ref={phiEl}>0°</b>
            </div>
            <div className="row">
              <span>HOLONOMY</span>
              <b ref={holoEl}>—</b>
            </div>
            <div className="row">
              <span>EDGE-ON</span>
              <b ref={edgeEl}>0/500</b>
            </div>
            <div className="bar">
              <i ref={barEl} style={{ width: '0%' }} />
            </div>
            <p className="hint">
              {mobius ? 'MÖBIUS · THE BAND NO LONGER CLOSES' : 'CLOSED · INTEGER TURNS'}
              {' · '}PRESS 1 2 3 · M
            </p>
          </div>
        </footer>
      </div>
    </div>
  )
}
