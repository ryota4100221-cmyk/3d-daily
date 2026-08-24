// App.jsx — Day 056 / Blade Phase
//
// Dgrees の FV は、特大の全大文字を画面上半分に5行で敷き、その上に3Dのリングを
// 重ねる。四隅と下端に等幅の小さいラベルを配る。ここでもその置き方だけを借りる
// （コピーの内容は今日の装置の説明に差し替える）。

import { useCallback, useEffect, useRef } from 'react'
import { Canvas } from '@react-three/fiber'
import * as THREE from 'three'
import Scene from './Scene.jsx'
import { PAL, RING } from './rig.js'

const HEADLINE = [
  'THE RING IS NOT',
  'IN THE POSITIONS —',
  'EVERY ROOT STAYS',
  'ON THE CIRCLE. ONLY',
  'THE AGREEMENT MOVES.',
]

export default function App() {
  const degRef = useRef(null)
  const last = useRef(-1)

  // 継ぎ目の角度は 3D 側の唯一の状態なので、数字にして下端に出しておく。
  // 🔴 setState にしないのは Day 050 の教訓。virtual time の下では React の
  //    スケジューラが最後まで回りきらず、DOM の数字が初期値のまま焼き付く。
  //    ここは ref で直接 textContent を書く。
  const onSeam = useCallback((rad) => {
    const d = Math.round((rad * 180) / Math.PI) % 360
    if (d !== last.current) {
      last.current = d
      if (degRef.current) degRef.current.textContent = `θ ${String(d).padStart(3, '0')}°`
    }
  }, [])

  // 橙の矩形はカーソルにだけ乗る差し色。ポインタが無い環境でも1つは見えるよう、
  // 初期位置を画面の右下寄りに置いておく（headless の1枚に写らないと意味がない）。
  const cursor = useRef(null)
  useEffect(() => {
    const el = cursor.current
    if (!el) return
    const move = (e) => {
      el.style.transform = `translate3d(${e.clientX - 13}px, ${e.clientY - 13}px, 0)`
    }
    window.addEventListener('pointermove', move)
    return () => window.removeEventListener('pointermove', move)
  }, [])

  return (
    <div className="page">
      <Canvas
        dpr={[1, 2]}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        onCreated={({ gl }) => {
          gl.setClearColor(PAL.deep)
          gl.toneMapping = THREE.NoToneMapping
          gl.outputColorSpace = THREE.SRGBColorSpace
        }}
      >
        <Scene onSeam={onSeam} />
      </Canvas>

      <div className="overlay">
        <h1 className="headline">
          {HEADLINE.map((line, i) => (
            <span key={i} style={{ '--i': i }}>
              {line}
            </span>
          ))}
        </h1>

        <div className="label tl">
          DAY 056
          <br />
          BLADE PHASE
        </div>
        <div className="label tr">
          AFTER
          <br />
          DGREES.STUDIO
        </div>
        <div className="label bl">
          {RING.blades} BLADES
          <br />
          ONE LAW
        </div>
        <div className="label br">
          SEAM
          <br />
          <span className="num" ref={degRef}>θ 000°</span>
        </div>
        <div className="foot">
          <span className="dot" /> COHERENCE TRAVELS — IT IS NOT SWITCHED
        </div>
      </div>

      <div className="cursor" ref={cursor} />
    </div>
  )
}
