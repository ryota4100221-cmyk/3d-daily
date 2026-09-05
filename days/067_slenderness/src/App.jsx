import React, { useEffect, useRef } from 'react'
import { Canvas } from '@react-three/fiber'
import Scene from './Scene.jsx'
import { FIELD } from './rig.js'

export default function App() {
  const deltaRef = useRef(0)
  const targetRef = useRef(0)
  const grabbed = useRef(false) // ポインタが一度でも動いたら自動送りをやめる

  const readout = {
    delta: useRef(null),
    count: useRef(null),
    lam: useRef(null),
  }

  useEffect(() => {
    const t0 = performance.now()
    let raf = 0

    const tick = () => {
      const t = (performance.now() - t0) / 1000
      if (!grabbed.current) {
        // 自動送り。板を静かに下ろして、そこで止める。
        // 揺らし続けると headless の1枚がどのコマに当たるかで δ が変わり、
        // 同じビルドから 0.0028 と 0.0355 の両方が出る（この日に実際に踏んだ）。
        // 撮影帯（2.5〜20 秒）は完全に一定にして、そのあとだけ静かに呼吸させる。
        const ease = Math.min(1, Math.max(0, (t - 0.3) / 1.7))
        const s = ease * ease * (3 - 2 * ease)
        const breathe = t > 20 ? 0.020 * Math.sin((2 * Math.PI * (t - 20)) / 16) : 0
        targetRef.current = 0.076 * s + breathe * s
        // 自動送りのときは遅延フィルタを通さない。1フレームあたり9%の追従は
        // フレーム数に依存するので、virtual time の下では rAF が何回回ったかで
        // 到達点が変わる（同じビルドから δ/L = 0.0050 と 0.0292 が出た）。
        // 補間は入力を受けているときだけに要る。
        deltaRef.current = targetRef.current
      } else {
        deltaRef.current += (targetRef.current - deltaRef.current) * 0.09
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  const onPointer = (e) => {
    grabbed.current = true
    const u = e.clientX / window.innerWidth
    targetRef.current = 0.004 + (FIELD.DELTA_MAX - 0.004) * Math.min(1, Math.max(0, u))
  }

  return (
    <div className="stage" onPointerMove={onPointer}>
      <Canvas
        flat
        orthographic
        dpr={[1, 2]}
        gl={{ antialias: true }}
        camera={{ position: [2.2, 4.6, 6.6], zoom: 128, near: -60, far: 80 }}
      >
        <Scene deltaRef={deltaRef} readout={readout} />
      </Canvas>

      <div className="ui">
        <header>
          <div className="rule">
            <span>3D Daily</span>
            <span>Day 067</span>
          </div>
          <h1>The Slenderness Threshold</h1>
          <p className="sub">
            One flat plate, and a field of rods that are all the same length.
          </p>
        </header>

        <div className="credit">
          <span className="lab">Reconstructed after</span>
          <span className="site">UNIPLEX</span>
          <span className="url">uniplex.jp</span>
        </div>

        <div className="meters">
          <div className="m">
            <span className="k">End shortening &nbsp;δ / L</span>
            <span className="v" ref={readout.delta}>
              0.0000
            </span>
          </div>
          <div className="m">
            <span className="k">Buckled</span>
            <span className="v" ref={readout.count}>
              000 / 230
            </span>
          </div>
          <div className="m">
            <span className="k">Front slenderness &nbsp;λ</span>
            <span className="v" ref={readout.lam}>
              0.0
            </span>
          </div>
        </div>

        <div className="claim">
          <p>
            Same length. Same plate. Same load.
            <br />
            Only thickness decides which of them lies down.
          </p>
          <span className="hint">Move the pointer to drive the plate</span>
        </div>
      </div>
    </div>
  )
}
