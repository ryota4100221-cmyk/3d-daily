import React, { useRef, useCallback } from 'react'
import { Canvas } from '@react-three/fiber'
import Scene from './Scene.jsx'
import { N, SIG_H, SIG_K } from './rig.js'

// 静止画は「たまたまその瞬間」を撮る。ヘッドレスでは第1フレームで止まることが
// あるので、時計に定数を足せるようにしておく（?t=17.2）。動きの検証は別カットで撮る。
const T0 = (() => {
  const q = Number(new URLSearchParams(location.search).get('t'))
  return Number.isFinite(q) && q !== 0 ? q : 6.4
})()

export default function App() {
  const cov = useRef()
  const frs = useRef()
  const age = useRef()
  const clk = useRef()

  // 読み値は毎フレーム DOM に直接書く。React の再描画を挟むと、
  // ヘッドレスの virtual time の下で数字だけ初期値のまま焼き付くことがある。
  const onReadout = useCallback((r) => {
    if (cov.current) cov.current.textContent = (r.coverage * 100).toFixed(1) + ' %'
    if (frs.current) frs.current.textContent = String(r.freshCount).padStart(2, '0') + ' / ' + N
    if (age.current) age.current.textContent = r.meanAge.toFixed(2) + ' s'
    if (clk.current) clk.current.textContent = r.t.toFixed(2) + ' s'
  }, [])

  return (
    <div className="root">
      <Canvas
        dpr={1}
        gl={{ antialias: true }}
        camera={{ fov: 30, near: 0.1, far: 120, position: [0.0, 17.6, 12.9] }}
        onCreated={({ camera }) => camera.lookAt(0, 0, 2.15)}
      >
        <color attach="background" args={['#0f1f10']} />
        <Scene onReadout={onReadout} t0={T0} />
      </Canvas>

      <div className="ui">
        <div className="tl">
          <span className="no">Nº 063</span>
          <span className="ttl">THE CONFIDENCE FIELD</span>
        </div>

        <div className="tr">
          <div className="after">AFTER</div>
          <div className="host">alethia.earth</div>
          <div className="sub">Alethia — Ecosystem-Level Accounting</div>
          <div className="sub">“Where Ecosystem Science and Enterprise Strategy Meet”</div>
        </div>

        <div className="lead">
          <h1>
            THE MAP IS NOT THE LAND.
            <br />
            <em>IT IS THE PART WE MEASURED RECENTLY.</em>
          </h1>
          <p>
            No terrain is modelled. {N} sample points exist; everything between them is
            inference, and inference is drawn only as far as it can be defended.
          </p>
        </div>

        <div className="bar">
          <div className="cell">
            <span className="k">SAMPLES</span>
            <span className="v">{N}</span>
          </div>
          <div className="cell">
            <span className="k">σ SHAPE</span>
            <span className="v">{SIG_H.toFixed(2)}</span>
          </div>
          <div className="cell">
            <span className="k">σ CLAIM</span>
            <span className="v lime">{SIG_K.toFixed(2)}</span>
          </div>
          <div className="cell">
            <span className="k">FRESH</span>
            <span className="v" ref={frs}>
              — / {N}
            </span>
          </div>
          <div className="cell">
            <span className="k">MEAN AGE</span>
            <span className="v" ref={age}>
              —
            </span>
          </div>
          <div className="cell wide">
            <span className="k">DEFENSIBLE AREA</span>
            <span className="v lime" ref={cov}>
              —
            </span>
          </div>
          <div className="cell right">
            <span className="k">SURVEY CLOCK</span>
            <span className="v" ref={clk}>
              —
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
