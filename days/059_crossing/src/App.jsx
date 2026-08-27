import React, { useCallback, useRef } from 'react'
import { Canvas } from '@react-three/fiber'
import * as THREE from 'three'
import Scene from './Scene.jsx'
import { COUNT, TRACES, SAMPLES, jstSeconds } from './rig.js'

// 数字は毎フレーム DOM に直接書く。React の再描画に乗せると、
// 「カウンターが流れる」の流れ方がフレームレートではなく差分検出の都合になる。
function useDigits() {
  const refs = useRef({})
  const bind = (k) => (el) => {
    refs.current[k] = el
  }
  const put = (k, s) => {
    const el = refs.current[k]
    if (el && el.textContent !== s) el.textContent = s
  }
  return { bind, put }
}

const pad = (n, w) => String(n).padStart(w, '0')
const sign = (v, d = 3) => (v < 0 ? '−' : '+') + Math.abs(v).toFixed(d)

export default function App() {
  const { bind, put } = useDigits()

  const onStats = useCallback(
    (s) => {
      const j = Math.floor(jstSeconds())
      put(
        'clock',
        `${pad(Math.floor(j / 3600), 2)}:${pad(Math.floor(j / 60) % 60, 2)}:${pad(j % 60, 2)}`
      )
      put('phase', s.phase.toFixed(5))
      put('cross', sign(s.crossX))
      put('ortho', pad(s.ortho, 4))
      put('persp', pad(s.persp, 4))
      put('orthoPct', ((s.ortho / COUNT) * 100).toFixed(1) + '%')
      put('perspPct', ((s.persp / COUNT) * 100).toFixed(1) + '%')
      put('mean', s.mean.toFixed(4))
      put('peak', s.peak.toFixed(4))
    },
    [put]
  )

  return (
    <div className="stage">
      <Canvas
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: false }}
        camera={{ fov: 32, near: 0.1, far: 60, position: [0.92, 1.02, 4.95] }}
        onCreated={({ gl }) => {
          gl.setClearColor(new THREE.Color('#0d1219'), 1)
          gl.toneMapping = THREE.NoToneMapping
          gl.outputColorSpace = THREE.SRGBColorSpace
        }}
      >
        <Scene onStats={onStats} />
      </Canvas>

      <div className="veil" />

      <header className="head">
        <div className="idx">Nº 059</div>
        <h1>
          CROSSING
          <br />
          PROJECTION
        </h1>
        <p className="lede">
          One point set. Two cameras. The seam between
          <br />
          data and body is a gradient, not a line.
        </p>
      </header>

      <div className="src">
        <div className="lbl">AFTER</div>
        <div className="dom">sdb.chuo-u.ac.jp</div>
        <div className="ja">中央大学 スポーツ情報学部（仮称）</div>
        <div className="ja dim">「データから立ち上がる幾何学」</div>
      </div>

      <div className="axis left">
        <span className="tag">ORTHOGRAPHIC</span>
        <span className="tag dim">DATA / MEASURED</span>
      </div>
      <div className="axis right">
        <span className="tag">PERSPECTIVE</span>
        <span className="tag dim">SPORT / SEEN</span>
      </div>

      <footer className="read">
        <div className="col">
          <div className="row">
            <b>TRACES</b>
            <i>{pad(TRACES, 3)}</i>
          </div>
          <div className="row">
            <b>SAMPLES</b>
            <i>{pad(SAMPLES, 3)}</i>
          </div>
          <div className="row">
            <b>VERTICES</b>
            <i>{pad(COUNT, 4)}</i>
          </div>
        </div>
        <div className="col">
          <div className="row">
            <b>ORTHO</b>
            <i ref={bind('ortho')}>0000</i>
            <em ref={bind('orthoPct')}>0.0%</em>
          </div>
          <div className="row">
            <b>PERSP</b>
            <i ref={bind('persp')}>0000</i>
            <em ref={bind('perspPct')}>0.0%</em>
          </div>
          <div className="row">
            <b>CROSS X</b>
            <i ref={bind('cross')}>+0.000</i>
          </div>
        </div>
        <div className="col">
          <div className="row">
            <b>JST</b>
            <i ref={bind('clock')}>00:00:00</i>
          </div>
          <div className="row">
            <b>DAY PHASE</b>
            <i ref={bind('phase')}>0.00000</i>
          </div>
          <div className="row">
            <b>MEAN / PEAK</b>
            <i ref={bind('mean')}>0.0000</i>
            <em ref={bind('peak')}>0.0000</em>
          </div>
        </div>
      </footer>
    </div>
  )
}
