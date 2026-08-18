import { useCallback, useRef } from 'react'
import Scene from './Scene.jsx'
import { K_PRESETS, K_DEFAULT } from './rig.js'

// 再現元 Podium の FV は「中央に文字を1つも置かず、四隅にだけ言葉を配る」。
// 借りたのはこの置き方で、語は自分のものにした。
// 実測値: 左余白 23px ／ 本文 16px ／ 行間 120% ／ 見出しは 62px まで ／ Futura。
//
// HUD は React の state を経由しない。最初 setState で毎フレーム書いたら、
// Canvas の木ごと再レンダリングされたうえに headless の1枚では初期値のまま
// 固まった（k 0.260 / GAP +0.000 / NECKS 0/21 が刷り込まれた PNG が撮れた）。
// 数字は DOM に直接書く。

const SPAN = [-0.3, 0.6] // メーターの物差し（gap も k も同じ尺度に乗せる）

const pct = (v) => `${Math.max(0, Math.min(1, (v - SPAN[0]) / (SPAN[1] - SPAN[0]))) * 100}%`

export default function App() {
  const gapBar = useRef(null)
  const kMark = useRef(null)
  const kNum = useRef(null)
  const gapNum = useRef(null)
  const neckNum = useRef(null)
  const hint = useRef(null)

  const onReport = useCallback((r) => {
    if (gapBar.current) gapBar.current.style.width = pct(r.nearest)
    if (kMark.current) kMark.current.style.left = pct(r.k)
    if (kNum.current) kNum.current.textContent = `k ${r.k.toFixed(3)}`
    if (gapNum.current) {
      gapNum.current.textContent = `GAP ${r.nearest >= 0 ? '+' : '−'}${Math.abs(r.nearest).toFixed(3)}`
    }
    if (neckNum.current) neckNum.current.textContent = `NECKS ${r.fused}/${r.pairs}`
    if (hint.current) {
      hint.current.textContent =
        `${r.held ? 'POINTER HELD' : 'MOVE POINTER'} · PRESS 1 2 3 FOR k`
    }
  }, [])

  return (
    <div className="page">
      <Scene onReport={onReport} />

      <header className="tl">
        <div className="mark">FUSION</div>
        <div className="sub">3D DAILY · DAY 050</div>
      </header>

      <div className="tr">
        <div className="sub">AFTER PODIUM.GLOBAL</div>
        <div className="sub dim">STUDY OF ONE THRESHOLD</div>
      </div>

      <div className="bl">
        <p>
          SEVEN DROPLETS ARE ONE BODY
          <br />
          WHEN THE GAP FALLS BELOW <em>k</em>.
        </p>
      </div>

      <div className="br">
        <div className="meter">
          <div className="bar">
            <span className="gap" ref={gapBar} style={{ width: pct(0) }} />
            <span className="k" ref={kMark} style={{ left: pct(K_PRESETS[K_DEFAULT]) }} />
          </div>
          <div className="nums">
            <span ref={kNum}>k {K_PRESETS[K_DEFAULT].toFixed(3)}</span>
            <span ref={gapNum}>GAP +0.000</span>
            <span ref={neckNum}>NECKS 0/21</span>
          </div>
        </div>
        <div className="sub dim" ref={hint}>MOVE POINTER · PRESS 1 2 3 FOR k</div>
      </div>
    </div>
  )
}
