import { useRef } from 'react'
import { Canvas } from '@react-three/fiber'
import * as THREE from 'three'
import Scene, { GROUND } from './Scene.jsx'

// 再現元（SAKAZUKI）から借りたのは組み方だけ：
//   1書体・全大文字・1語を2行に割る（SAKA / ZUKI → MENI / SCUS）、
//   行間 80%・字間 -2%、左揃え・2カラム、左余白 7.2%（実測 104/1440）、
//   本文 17px / 行間 140%。文言と内容は借りない。
export default function App() {
  const readouts = {
    grid: useRef(null),
    drops: useRef(null),
    rise: useRef(null),
    clock: useRef(null),
  }

  return (
    <div className="page">
      <Canvas
        shadows
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: false }}
        camera={{ fov: 15, near: 0.5, far: 60 }}
        onCreated={({ gl }) => {
          gl.setClearColor(GROUND, 1)
          gl.toneMapping = THREE.NoToneMapping
          gl.shadowMap.type = THREE.PCFSoftShadowMap
        }}
      >
        <Scene readouts={readouts} />
      </Canvas>

      <div className="ui">
        <p className="kicker">
          Day 058 <span className="dot" /> Meniscus Rim <span className="dot" /> after SAKAZUKI
        </p>

        <div className="meta">
          <p>Vermilion lacquer, black lacquer, paper</p>
          <p>Move the pointer across the surface</p>
        </div>

        <div className="foot">
          <h1>
            MENI
            <br />
            SCUS
          </h1>

          <div className="col">
            <p className="lede">
              There is no liquid here — only a height field on a disc. What makes it read as
              something <em>poured into a vessel</em> is a boundary: waves turn back at the wall, and
              the surface climbs to meet it. Delete those two lines and the same field becomes a
              wobbling plate.
            </p>
            <dl className="read">
              <div>
                <dt>Field</dt>
                <dd ref={readouts.grid}>—</dd>
              </div>
              <div>
                <dt>Rim rise</dt>
                <dd ref={readouts.rise}>—</dd>
              </div>
              <div>
                <dt>Drops</dt>
                <dd ref={readouts.drops}>—</dd>
              </div>
              <div>
                <dt>Elapsed</dt>
                <dd ref={readouts.clock}>—</dd>
              </div>
            </dl>
          </div>
        </div>
      </div>
    </div>
  )
}
