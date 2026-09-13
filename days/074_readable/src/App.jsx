import { useEffect, useRef } from 'react'
import { Canvas } from '@react-three/fiber'
import Scene from './Scene.jsx'
import { COLOR, DEPTH, STROKE_PLANE, WORD, rodLength, smear } from './rig.js'

// 計器は DOM 側。3D のほうは字を出しているだけで、厚みがいくつかを一度も
// 計算していない——rig.js に「胴」という変数は無い。同じ式をここで書き直して、
// 画面に出ているものが何の数字なのかだけ示す。
function Instrument({ readout }) {
  const rows = useRef([])

  useEffect(() => {
    let raf
    const tick = () => {
      const b = readout.current ?? 0
      rows.current.forEach((r, k) => {
        if (!r) return
        const ratio = smear(b, DEPTH[k]) / STROKE_PLANE
        r.ratio.textContent = ratio.toFixed(2)
        r.bar.style.transform = `scaleX(${Math.min(1, ratio / 5)})`
      })
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [readout])

  return (
    <div className="instrument">
      <div className="i-head">
        <span>LETTER</span>
        <span>DEPTH d</span>
        <span>LENGTH L</span>
        <span>BODY s／T</span>
        <span />
      </div>
      {WORD.map((ch, k) => (
        <div
          className="i-row"
          key={ch}
          ref={(el) => {
            if (!el) return
            rows.current[k] = {
              ratio: el.querySelector('.i-ratio'),
              bar: el.querySelector('.i-fill'),
            }
          }}
        >
          <span className="i-ch" style={{ color: COLOR[k] }}>
            {ch}
          </span>
          <span>{DEPTH[k].toFixed(1)}</span>
          <span>{rodLength(DEPTH[k]).toFixed(1)}</span>
          <span className="i-ratio">—</span>
          <span className="i-bar">
            <i className="i-fill" style={{ background: COLOR[k] }} />
          </span>
        </div>
      ))}
      <div className="i-foot">AT b = 0 EVERY BODY IS EXACTLY ZERO</div>
    </div>
  )
}

// 基線だけを毎フレーム書き換える小さな端末。React は再描画しない。
function Baseline({ readout }) {
  const el = useRef()
  useEffect(() => {
    let raf
    const tick = () => {
      if (el.current) el.current.textContent = (readout.current ?? 0).toFixed(3)
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [readout])
  return <span ref={el}>0.000</span>
}

export default function App() {
  const readout = useRef(0)

  return (
    <div className="wrap">
      <Canvas
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: false }}
        camera={{ fov: 50, near: 0.1, far: 400, position: [1.9, 0, 0] }}
        onCreated={({ gl }) => gl.setClearColor('#000000')}
      >
        <Scene readout={readout} />
      </Canvas>

      <div className="ui">
        <div className="tl">
          <div className="title">THE ONLY ANGLE THAT READS</div>
          <div className="sub">Day 074 — after「読めない、GUNZE。」GUNZE 130th</div>
        </div>

        <div className="tr">
          <div className="k">BASELINE</div>
          <div className="v">
            b = <Baseline readout={readout} />
          </div>
        </div>

        <Instrument readout={readout} />

        <div className="br">MOVE THE CURSOR — THE CENTRE OF THE SCREEN IS THE EYE POINT</div>
      </div>
    </div>
  )
}
