// App.jsx — Day 068
//
// 再現元: PIXEL × PIXEL 2026 （3DCG・モーション・VFXのフェス）https://pixelpixel.jp/
//
// 再現したのはFVの1つだけ——**濃紫の地に、色を持たないCGが1枚**という状態。
// スワイプファイルDBの実測では FVの設計色% が 0（全編でも 4.17%）で、
// あのサイトは第一画面で蛍光ピンクを1ドットも使っていない。だから今日も、
// 有彩色はタイルの数%にしか出さない。色は「足すもの」ではなく
// 「どこに出るかが決まっているもの」として扱う。
//
// 捨てたもの: サイト全体・マーキー・動画・スクロールリビール・登壇者や
// タイムテーブルの中身・Funnel Display（外部フォントはこの環境から403）。
// 借りたのは組みの数値だけ（見出し字間 2%・本文行間 185%）。

import { Suspense, useEffect, useMemo, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import Scene from './Scene.jsx'
import { PAL, READOUT } from './rig.js'

const q = new URLSearchParams(window.location.search)
const PINNED = q.has('t') ? Number(q.get('t')) : null

export default function App() {
  const [filtered, setFiltered] = useState(q.get('filter') === '1')

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'f' || e.key === 'F') setFiltered((v) => !v)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const rows = useMemo(
    () => [
      ['sampler', `${READOUT.tiles.toLocaleString()} · pitch ${READOUT.pitch.toFixed(4)}`],
      ['signal', `chirp ${READOUT.chirp.toFixed(3)} · rings ∝ r²`],
      ['nyquist', `±${READOUT.nyquist.toFixed(2)} · a square`],
      ['centres', `${READOUT.centres} · ${READOUT.centres - 1} are not there`],
      ['drift', 'rate |m + 0.618n|'],
      ['reading', filtered ? 'box-filtered' : '1 point per tile'],
    ],
    [filtered]
  )

  return (
    <div className="wrap">
      <Canvas
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true }}
        camera={{ fov: 44, near: 0.1, far: 200, position: [0, 12.9, 15.4] }}
        // 🔴 clear color は色空間変換を通らない（three はリニア値をそのまま
        // gl.clearColor に渡す）ので、#18103F を渡すと画面には #02010d が出る。
        // 地はCSS側の1色に任せ、canvas は透明で抜く。霧の行き先の uGround は
        // シェーダ内で sRGB へ変換されるので、両者はぴったり同じ色になる。
        onCreated={({ gl }) => gl.setClearAlpha(0)}
      >
        <Suspense fallback={null}>
          <Scene time={PINNED} filtered={filtered} />
        </Suspense>
      </Canvas>

      <header className="head">
        <p className="kicker">Day 068 · after PIXEL × PIXEL 2026</p>
        <h1>
          The False
          <br />
          Centres
        </h1>
        <p className="lede">
          One signal, one lattice. Every place the lattice cannot keep up, it
          invents a centre that the signal does not have — and colours it
          exactly like the real one.
        </p>
      </header>

      <dl className="readout">
        {rows.map(([k, v]) => (
          <div className="row" key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>

      <p className="hint">
        Inside the wall the reading is true.
        <br />
        Outside it, every ring is invented.
        <span>[ F ] filter on / off</span>
      </p>
    </div>
  )
}
