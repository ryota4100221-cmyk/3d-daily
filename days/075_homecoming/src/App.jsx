import { useCallback, useRef } from 'react'
import { Canvas } from '@react-three/fiber'
import Scene from './Scene.jsx'
import { census } from './rig.js'

// 版面はすべて Pelata Pieces の実測値：左余白 430/1440 ≈ 30vw、版面幅 890、
// 見出し 129.6px / 行間 100%、本文 18px / 行間 133%、文字色 #646450。
const CEN = census(20000)

export default function App() {
  const nRoutes = useRef()
  const nTips = useRef()

  const onReadout = useCallback((routes, tips) => {
    if (nRoutes.current) nRoutes.current.textContent = String(routes).padStart(3, '0')
    if (nTips.current) nTips.current.textContent = String(tips).padStart(4, '0')
  }, [])

  return (
    <div className="page">
      <Canvas
        shadows="soft"
        orthographic
        flat /* ACES を切る。切らないと生成りの紙がただの灰色になる（試作1枚目） */
        dpr={[1, 2]}
        camera={{ near: -120, far: 260, zoom: 90 }}
        gl={{ antialias: true, preserveDrawingBuffer: true }}
        style={{ position: 'absolute', inset: 0 }}
      >
        <Scene onReadout={onReadout} />
      </Canvas>

      <div className="rail-left">
        <h1>
          THE HALF<br />
          THAT NEVER<br />
          COMES HOME
        </h1>

        <p className="lede">
          A die has twenty-four ways to sit on a square. Walk it anywhere you
          like — any closed route, any length, crossing itself as often as it
          wants — and it can only ever come back in twelve of them.
        </p>

        <p className="lede dim">
          The other twelve are not hard to reach. They are unreachable. Nothing
          in the code forbids them; the counting does. A closed route spends as
          many tips going out as coming back, so it always takes an even number
          of them — and one tip is an odd swap of the die&rsquo;s four body
          diagonals.
        </p>

        <div className="legend">
          <span className="lk">the four body diagonals</span>
          <ul>
            <li><i style={{ background: '#FF7711' }} />a</li>
            <li><i style={{ background: '#00A8E5' }} />b</li>
            <li><i style={{ background: '#109848' }} />c</li>
            <li><i style={{ background: '#E0B848' }} />d</li>
          </ul>
          <span className="lk dim">
            each corner of the piece is painted by the diagonal it belongs to,
            and one tip swaps two of them. The twelve that come home are exactly
            the orientations an <b>even</b> number of tips from the start —
            layers of 1, 10 and 1. The twelve that never do are the odd layers,
            4 and 8.
          </span>
        </div>

        <dl className="meter">
          <div>
            <dt>routes walked here</dt>
            <dd><span ref={nRoutes}>000</span></dd>
          </div>
          <div>
            <dt>tips</dt>
            <dd><span ref={nTips}>0000</span></dd>
          </div>
          <div>
            <dt>routes counted first</dt>
            <dd>{CEN.routes.toLocaleString('en-US')}</dd>
          </div>
          <div>
            <dt>came home / never</dt>
            <dd className="split">{CEN.reached}<i>/</i>{CEN.never}</dd>
          </div>
        </dl>

        <p className="foot">
          Day 075 · after <b>Pelata Pieces</b>, Finnish Design Shop
          <span>the device: the tetrahedral half</span>
        </p>
      </div>
    </div>
  )
}
