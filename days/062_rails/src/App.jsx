import { useCallback, useRef } from 'react'
import Scene from './Scene.jsx'
import { P, STEP_COUNT, track } from './rig.js'

// 版面は再現元の実測値に合わせる（東芝エレベータ 採用サイト・2026-08-11 実測）
//   左余白 136 / 版面幅 1147（1440基準）→ 9.44%
//   見出し DIN 2014 140px・行間 100%・字間 +5%
//   本文 14px・行間 100%（この採用群でいちばん詰まっている）
//   左揃え・多段グリッド ／ 情報密度 疎 ／ 地の反転 0回
//
// 機械が画面の対角（左下→右上）に乗るので、空くのは左上と右下。
// 見出しを左上、計器と脚注を右下に置いて、文字と3Dを一度も重ねない。

const f2 = (v) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2)

export default function App() {
  const tread = useRef()
  const gap = useRef()
  const step = useRef()
  const lift = useRef()
  const travel = useRef()

  // DOM へ直接書く。数字が画面に出ていれば、プレビューが自分で不合格を申告する
  // （角度が ---° のまま焼き付いていたら、それは1フレームも回っていない絵）
  const readout = useCallback((r) => {
    if (tread.current) tread.current.textContent = f2(r.tread) + '°'
    if (gap.current) gap.current.textContent = f2(r.gap / 10) + ' cm'
    if (step.current) step.current.textContent = String(r.step).padStart(3, '0') + ' / ' + STEP_COUNT
    if (lift.current) lift.current.textContent = r.lift.toFixed(2) + ' m'
    if (travel.current) travel.current.textContent = r.travel.toFixed(2) + ' m'
  }, [])

  return (
    <div className="page">
      <Scene readout={readout} />

      <div className="overlay">
        <header className="head">
          <p className="eyebrow">DAY 062 — GALLERY RECONSTRUCTION</p>
          <h1>
            TWO
            <br />
            RAILS
          </h1>
          <p className="deck">
            踏段が水平になる、と書いた行はどこにもない。
            <br />
            書いてあるのは2本の軌条のあいだの距離だけで、水平はその帰結として出てくる。
          </p>
        </header>

        <div className="panel">
          <dl className="spec">
            <div>
              <dt>TREAD ANGLE</dt>
              <dd ref={tread} className="live">
                ---
              </dd>
            </div>
            <div>
              <dt>RAIL GAP p</dt>
              <dd ref={gap} className="live">
                ---
              </dd>
            </div>
            <div>
              <dt>STEP</dt>
              <dd ref={step} className="live">
                ---
              </dd>
            </div>
            <div>
              <dt>LIFT</dt>
              <dd ref={lift} className="live">
                ---
              </dd>
            </div>
            <div>
              <dt>TRAVEL</dt>
              <dd ref={travel} className="live">
                ---
              </dd>
            </div>
          </dl>

          <footer className="foot">
            <div className="col">
              <span className="k">SOURCE</span>
              <span className="v">東芝エレベータ 採用サイト</span>
            </div>
            <div className="col">
              <span className="k">DEVICE</span>
              <span className="v">p(s) = D · sin θ(s)</span>
            </div>
            <div className="col">
              <span className="k">INCLINE</span>
              <span className="v">{((P.alpha * 180) / Math.PI).toFixed(1)}°</span>
            </div>
            <div className="col">
              <span className="k">AXLE BASE</span>
              <span className="v">{(P.D * 1000).toFixed(0)} mm</span>
            </div>
            <div className="col">
              <span className="k">CHAIN</span>
              <span className="v">
                {track.L.toFixed(1)} m / {STEP_COUNT} steps
              </span>
            </div>
          </footer>
        </div>
      </div>
    </div>
  )
}
