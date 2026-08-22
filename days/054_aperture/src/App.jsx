import React, { useState, useEffect } from 'react'
import { Canvas } from '@react-three/fiber'
import * as THREE from 'three'
import Scene from './Scene.jsx'
import { RIG, PERIOD } from './rig.js'

// ?gain=0|1|2 ／ ?d=1（depthTest を戻す）／ ?u=<起点>
const Q = new URLSearchParams(window.location.search)
const qInt = (k, d) => (Q.get(k) === null ? d : Number(Q.get(k)))

// オーバーレイに出す数字は全部この定数から引く＝時間に依らない。
// Day 050/051 で、virtual time の下では時間駆動の DOM が初期値のまま焼き付いた。
// 直し方は保険を積むことではなく「数字を時間に依らなくする」ことだった。
const FACTS = {
  apertures: RIG.count,
  period: PERIOD.toFixed(1),
  spacing: RIG.spacing.toFixed(2),
  seg: RIG.seg,
  throat: '0.52 R',
  hall: '1.38 R',
}

export default function App() {
  const [gainIdx, setGainIdx] = useState(Math.max(0, Math.min(2, qInt('gain', 1))))
  const [opaque, setOpaque] = useState(qInt('d', 0) === 1)
  const u0 = qInt('u', 0)

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === '1') setGainIdx(0)
      if (e.key === '2') setGainIdx(1)
      if (e.key === '3') setGainIdx(2)
      if (e.key.toLowerCase() === 'd') setOpaque((v) => !v)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="stage">
      <Canvas
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: false }}
        camera={{ fov: 68, near: 0.08, far: 900, position: [0, 0, 0] }}
        onCreated={({ gl }) => {
          gl.setClearColor(new THREE.Color(0x000000), 1)
          gl.toneMapping = THREE.ACESFilmicToneMapping
          gl.toneMappingExposure = 1.46
        }}
      >
        <Scene gainIdx={gainIdx} opaque={opaque} u0={u0} />
      </Canvas>

      <div className="grain" />

      <div className="ui">
        <div className="tl">
          <div className="rule" />
          <div className="k">Day 054</div>
          <div className="t">Accumulated Aperture</div>
        </div>

        <div className="tr">
          <div className="k">after</div>
          <div className="t2">60fps.fr</div>
        </div>

        <div className="rd">
          <Row k="apertures" v={FACTS.apertures} />
          <Row k="crossings / ray" v={FACTS.apertures} />
          <Row k="light sources" v="zero" gold />
          <Row k="depth test" v={opaque ? 'on' : 'off'} />
          <Row k="blend" v={opaque ? 'src alpha' : 'one · one'} />
          <Row k="gain / face" v={RIG.gains[gainIdx].toFixed(4)} />
          <Row k="loop length" v={FACTS.period} />
          <Row k="throat" v={FACTS.throat} />
          <Row k="hall" v={FACTS.hall} />
        </div>

        <div className="bl">
          <div className="huge">APERTURE</div>
          <p className="lede">
            Nothing here is lit. Brightness is the number of faces a ray crosses —
            the core is bright because distant openings fold into the centre,
            not because a light was put there.
          </p>
        </div>

        <div className="br">
          <span>1 / 2 / 3</span> gain
          <span>D</span> depth test
          <span>move</span> look around
        </div>
      </div>
    </div>
  )
}

function Row({ k, v, gold }) {
  return (
    <div className="row">
      <span className="rk">{k}</span>
      <span className={gold ? 'rv gold' : 'rv'}>{v}</span>
    </div>
  )
}
