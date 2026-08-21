// App.jsx — 幕を送る装置と、その上に置く活字
//
// 入力はスクロール1本。ホイール／ドラッグ／矢印キーが同じ1つの量 actPos ∈ [0,2] を
// 動かし、しばらく触らないと最寄りの幕へ吸い寄せられる。幕は「状態」ではなく
// 連続量で、その途中では2つの幕が同時に立っている（体は両方の profile の和で挽かれる）。

import React, { useEffect, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import Scene from './Scene.jsx'
import { ACTS } from './rig.js'

const INK = ['#171208', '#2A1014', '#EFE6D2'] // 幕ごとの活字の色

function lerpHex(a, b, t) {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16))
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16))
  return (
    '#' +
    pa
      .map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, '0'))
      .join('')
  )
}

// ?act=0|1|2 で幕を指定して開ける（撮影と確認のため。既定は第1幕）
function initialAct() {
  const q = Number(new URLSearchParams(window.location.search).get('act'))
  return Number.isFinite(q) ? Math.max(0, Math.min(2, q)) : 0
}

export default function App() {
  const start = initialAct()
  const actPos = useRef(start)
  const target = useRef(start)
  const lastInput = useRef(-9999)
  const [act, setAct] = useState(start)
  const rootRef = useRef(null)
  const barRef = useRef(null)

  useEffect(() => {
    let raf = 0
    let prev = performance.now()

    const tick = (now) => {
      const dt = Math.min(0.05, (now - prev) / 1000)
      prev = now

      // 触っていない時間が続いたら、最寄りの幕へ寄せる。幕は途中で止まらない。
      if (now - lastInput.current > 620) {
        const snap = Math.round(target.current)
        target.current += (snap - target.current) * Math.min(1, dt * 2.4)
      }
      actPos.current += (target.current - actPos.current) * Math.min(1, dt * 3.1)

      const p = actPos.current
      const i = Math.max(0, Math.min(2, Math.round(p)))
      setAct((cur) => (cur === i ? cur : i))

      const k = Math.min(ACTS.length - 2, Math.max(0, Math.floor(p)))
      const u = Math.min(1, Math.max(0, p - k))
      if (rootRef.current) {
        rootRef.current.style.setProperty('--ink', lerpHex(INK[k], INK[k + 1], u))
      }
      if (barRef.current) barRef.current.style.transform = `scaleX(${p / 2})`

      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)

    const push = (d) => {
      target.current = Math.max(0, Math.min(2, target.current + d))
      lastInput.current = performance.now()
    }
    const onWheel = (e) => push(e.deltaY * 0.0024)
    const onKey = (e) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') push(0.34)
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') push(-0.34)
    }
    let dragging = false
    let lastY = 0
    const down = (e) => {
      dragging = true
      lastY = e.clientY
    }
    const move = (e) => {
      if (!dragging) return
      push((lastY - e.clientY) * 0.0055)
      lastY = e.clientY
    }
    const up = () => {
      dragging = false
    }

    window.addEventListener('wheel', onWheel, { passive: true })
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', down)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('wheel', onWheel)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', down)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [])

  return (
    <div className="stage" ref={rootRef}>
      <Canvas
        dpr={[1, 2]}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        camera={{ position: [0, 1.05, 11.9], fov: 28, near: 0.1, far: 200 }}
        onCreated={({ camera }) => camera.lookAt(0, 2.0, 0)}
      >
        <Scene actPos={actPos} />
      </Canvas>

      <div className="type">
        <div className="banner">
          THREE ACTS<span className="dot">.</span> THREE COLOURS
          <span className="dot">.</span> THREE FIGURES<span className="dot">.</span>
        </div>

        <div className="numeral">
          <span className="kicker">ACT</span>
          <span className="roman">{ACTS[act].roman}</span>
        </div>

        <div className="credit">
          <div>THE&nbsp;TRIADIC&nbsp;BALLET</div>
          <div className="fine">A REPRODUCTION STUDY — R3F</div>
        </div>

        <div className="foot">
          <div className="name">{ACTS[act].name}</div>
          <div className="rule">
            <span ref={barRef} />
          </div>
          <div className="fine">SCROLL OR DRAG TO TURN THE ACT</div>
        </div>

        <div className="cast">
          <span>THE BELL</span>
          <span>THE SPINDLE</span>
          <span>THE DISC</span>
        </div>

        <div className="source">AFTER OSKAR SCHLEMMER, 1922</div>
      </div>
    </div>
  )
}
