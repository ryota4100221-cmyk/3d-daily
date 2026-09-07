import React, { useEffect, useMemo, useRef, useState } from 'react'
import Scene from './Scene.jsx'
import { buildPopulation, simulate, rFromT, N_MALES } from './rig.js'

const clamp01 = (v) => Math.min(1, Math.max(0, v))

// 撮影と検証のために t は URL でも与えられる。スクロールで補間せず、
// 与えられた t をそのまま使う——headless の virtual time では rAF が何回
// 回るか決まらないので、補間を挟むと同じビルドから違う絵が出る（Day 067）。
function initialT() {
  const q = new URLSearchParams(window.location.search)
  if (!q.has('t')) return 1
  const v = parseFloat(q.get('t'))
  return Number.isFinite(v) ? clamp01(v) : 1
}

export default function App() {
  const [t, setT] = useState(initialT)
  const scroller = useRef(null)

  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const span = el.scrollHeight - el.clientHeight
    if (span > 0) el.scrollTop = t * span
    const onScroll = () => {
      const s = el.scrollHeight - el.clientHeight
      if (s > 0) setT(clamp01(el.scrollTop / s))
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
    // 初回だけ。t が変わるたびに張り直すと自分のスクロールを追いかけ続ける。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const pop = useMemo(() => buildPopulation(), [])
  const r = useMemo(() => Math.round(rFromT(t) * 10) / 10, [t])
  const stats = useMemo(() => simulate(pop, r).stats, [pop, r])

  return (
    <div className="wrap">
      <div className="stage">
        <Scene t={t} />
      </div>
      <div className="vignette" />

      <header className="masthead">
        <div className="rule" />
        <h1>The Vanishing&nbsp;Song</h1>
        <p className="sub">
          Regent Honeyeater <i>Anthochaera phrygia</i> — 150 males left in the wild
        </p>
        <p className="after">after honeyeater.org · Day 069</p>
      </header>

      <div className="count">
        <div className="huge">{stats.normSingers}</div>
        <div className="caption">
          males still singing
          <br />
          the regional song
        </div>
      </div>

      <div className="readout">
        <Row k="hearing radius" v={r.toFixed(1)} unit="" />
        <Row k="audible pairs" v={stats.edges} unit="" />
        <Row k="song cultures" v={stats.components} unit="" />
        <Row k="atypical song" v={stats.atypicalPct.toFixed(1)} unit="%" hot />
        <Row k="no species song" v={stats.mutePct.toFixed(1)} unit="%" hot />
      </div>

      <div className="hint">
        Scroll. <span>The birds do not move — only who can hear whom.</span>
      </div>

      {/* スクロールの受け皿。3Dは背後に固定で、動くのは r ひとつだけ。 */}
      <div className="scroller" ref={scroller}>
        <div className="spacer" />
      </div>
    </div>
  )
}

function Row({ k, v, unit, hot }) {
  return (
    <div className={'row' + (hot ? ' hot' : '')}>
      <span className="k">{k}</span>
      <span className="v">
        {v}
        {unit}
      </span>
    </div>
  )
}
