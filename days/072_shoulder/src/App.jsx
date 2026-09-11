import React, { useCallback, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import * as THREE from 'three'
import Scene from './Scene.jsx'

// 版面は実測した中田工芸（NAKATA HANGER）の組みから取っている：白地、設計の色
// ゼロ、EB Garamond の欧文見出し、游明朝46px を1文字ずつ空けた1行、それを
// イタリックの欧文が小さく受ける中央揃え、本文13px/行間185%、左余白207・
// 版面幅1092（1440 フレーム）。茶は写真の中にしか無いので、ここでも茶が出る
// のは木のハンガーそのものだけにした。
const TINT = {
  cloth: '#EDE9E2',
  wood: '#8A7150',
  metal: '#A9ADB0',
  rule: '#B9B2A7',
}

const mm = (v, d = 1) => (v * 1000).toFixed(d)

function Panel({ side, name, jp, m }) {
  return (
    <div className={`panel ${side}`}>
      <div className="panel-name">{name}</div>
      <div className="panel-jp">{jp}</div>
      <dl>
        <div>
          <dt>cloth on the line</dt>
          <dd>{m ? mm(m.pinnedArc) : '—'} mm</dd>
        </div>
        <div>
          <dt>span it occupies</dt>
          <dd>{m ? mm(m.seamSpan) : '—'} mm</dd>
        </div>
        <div className="hot">
          <dt>taken by the shoulder</dt>
          <dd>{m ? mm(m.taken) : '—'} mm</dd>
        </div>
        <div>
          <dt>folds · hem depth</dt>
          <dd>
            {m ? m.folds : '—'} · {m ? mm(m.hemAmp) : '—'} mm
          </dd>
        </div>
      </dl>
    </div>
  )
}

export default function App() {
  const [stats, setStats] = useState(null)
  const onStats = useCallback((s) => setStats(s), [])
  const wood = stats?.wood
  const wire = stats?.wire
  const ratio = wood && wire ? (wire.taken / wood.taken).toFixed(2) : '—'
  const depth = wood && wire ? (wire.hemAmp / wood.hemAmp).toFixed(2) : '—'

  return (
    <div className="root">
      <Canvas
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true }}
        shadows
        camera={{ fov: 26, position: [0, -0.16, 2.42], near: 0.1, far: 20 }}
        onCreated={({ gl, camera }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping
          gl.toneMappingExposure = 1.02
          camera.lookAt(0, -0.16, 0)
        }}
      >
        <Scene onStats={onStats} tint={TINT} />
      </Canvas>

      <div className="marks">
        <div className="tl">3D DAILY — DAY 072 · REPRODUCTION STUDY</div>
        <div className="tr">
          after 中田工芸 NAKATA HANGER
          <br />
          <span className="dim">nakatahanger.com</span>
        </div>

        <header>
          <h1>
            {'肩が奪う長さ'.split('').map((ch, i) => (
              <span key={i}>{ch}</span>
            ))}
          </h1>
          <p className="sub">The length the shoulder takes</p>
          <p className="claim">
            One cloth. One gravity. One seed. Only the shoulder line differs.
          </p>
        </header>

        <div className="gutter left">
          <p>
            木のハンガーが売っているのは肩の曲線だけである。ここでは曲線を1本と、
            そこに縫い目を沿わせた一枚の平織りだけを残し、襟・袖・前立て・
            針金の下桟を捨てた。
          </p>
          <p>
            肩線は斜めに落ちているので、そこに沿わされた 420 mm の布は、
            それより狭い差し渡しに押し込まれる。伸びない布から余った長さは、
            平面の外へ出るしか行き場が無い。
          </p>
          <p className="dim">
            rig.js に「折る」「ひだ」に当たる式は一行も無い。書いてあるのは
            辺ごとの |xᵢ − xⱼ| = l₀ と、重力と、曲げに抗う弱いばね。
          </p>
        </div>

        <div className="gutter right">
          <div className="kv">
            <span>cloth</span>
            <b>420 × 383 mm</b>
          </div>
          <div className="kv">
            <span>grid</span>
            <b>57 × 52 · l₀ 7.50 mm</b>
          </div>
          <div className="kv">
            <span>stretch</span>
            <b>
              {wood ? (Math.max(wood.stretch, wire.stretch) * 100).toFixed(1) : '—'} max ·{' '}
              {wood ? (((wood.stretchMean + wire.stretchMean) / 2) * 100).toFixed(2) : '—'} mean %
            </b>
          </div>
          <div className="kv">
            <span>seed</span>
            <b>20720912 · both</b>
          </div>
          <div className="rule" />
          <div className="kv big">
            <span>wire takes</span>
            <b>× {ratio}</b>
          </div>
          <div className="kv big">
            <span>hem folds deepen</span>
            <b>× {depth}</b>
          </div>
        </div>

        <Panel side="l" name="WOODEN SHOULDER" jp="曲線・中央 23 mm / 先 12 mm" m={wood} />
        <Panel side="r" name="WIRE" jp="直線・φ2.3 mm・角は角のまま" m={wire} />

        <footer>
          <span>
            the straight hairline across each shoulder is the chord — the line the cloth
            would need if the shoulder were flat
          </span>
          <span className="dim">
            R3F · inextensible mass–spring cloth · long-range attachment · PMREM studio
          </span>
        </footer>
      </div>
    </div>
  )
}
