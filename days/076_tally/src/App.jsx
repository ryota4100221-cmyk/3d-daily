import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Scene from './Scene.jsx'
import {
  RIG,
  SUN_MIN,
  SUN_MAX,
  sunAltitudeAt,
  measureBulk,
  measureWhole,
  stripePitch,
  RHO,
  TAU,
} from './rig.js'

const DEG = 180 / Math.PI

// ?still=<秒>  仮想時間下でも同じ1枚が撮れるように、時刻を外から止める
// ?alt=<度>    太陽高度を直接指定する
function readParams() {
  if (typeof window === 'undefined') return {}
  const q = new URLSearchParams(window.location.search)
  return {
    still: q.has('still') ? Number(q.get('still')) : null,
    alt: q.has('alt') ? Number(q.get('alt')) / DEG : null,
  }
}

export default function App() {
  const P = useMemo(readParams, [])
  const frozen = P.still != null || P.alt != null

  const pointerAlt = useRef(null)
  const t0 = useRef(typeof performance !== 'undefined' ? performance.now() : 0)

  // 画も数字も、必ずこの1つの関数から時刻をもらう。
  // （オーバーレイだけ初期値のまま焼き付く事故が Day 050 で出ている）
  const getAlt = useCallback(() => {
    if (P.alt != null) return P.alt
    if (pointerAlt.current != null) return pointerAlt.current
    const t = P.still != null ? P.still : (performance.now() - t0.current) / 1000
    return sunAltitudeAt(t)
  }, [P])

  const [alt, setAlt] = useState(() => getAlt())

  useEffect(() => {
    if (frozen) {
      setAlt(getAlt())
      return
    }
    const id = setInterval(() => setAlt(getAlt()), 90)
    return () => clearInterval(id)
  }, [frozen, getAlt])

  // ポインタで太陽高度を掴む（Son Daven の hold-to-compare を、季節ではなく太陽に当てた）
  useEffect(() => {
    if (frozen) return
    const onMove = (e) => {
      const ny = 1 - e.clientY / window.innerHeight
      pointerAlt.current = SUN_MIN + (SUN_MAX - SUN_MIN) * Math.max(0, Math.min(1, ny))
    }
    const onLeave = () => {
      pointerAlt.current = null
      t0.current = performance.now()
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerleave', onLeave)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerleave', onLeave)
    }
  }, [frozen])

  const tanA = Math.tan(alt)

  const rows = useMemo(
    () =>
      RIG.map((p) => {
        const bulk = measureBulk(p, tanA, 32768)
        const whole = measureWhole(p, tanA, 32768)
        return {
          id: p.id,
          n: p.n,
          rho: p.rho,
          pitch: p.s,
          bulk,
          whole,
          edgeN: (whole - bulk) * p.n,
          stripe: stripePitch(p, tanA),
        }
      }),
    [tanA]
  )

  const abc = rows.slice(0, 3)
  const spread = Math.max(...abc.map((r) => r.bulk)) - Math.min(...abc.map((r) => r.bulk))

  return (
    <div className="page">
      <Scene getAlt={getAlt} />

      <header className="masthead">
        <p className="eyebrow">After Son Daven — Yaremche, Carpathians</p>
        <h1>
          The count that never
          <br />
          reaches the light
        </h1>
        <p className="standfirst">
          Four louvred screens, one low sun. Three are the same shape at three
          scales.
        </p>
      </header>

      <section className="instrument">
        <div className="sun">
          <span className="lbl">Sun altitude</span>
          <span className="val">{(alt * DEG).toFixed(1)}°</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>Screen</th>
              <th>Blades</th>
              <th>Pitch</th>
              <th>Stripe</th>
              <th>Bulk T</th>
              <th>Whole T</th>
              <th>Edge×n</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={r.id === 'D' ? 'ctl' : ''}>
                <td>{r.id}</td>
                <td>{r.n}</td>
                <td>{r.pitch.toFixed(3)}</td>
                <td>{r.stripe.toFixed(3)}</td>
                <td className="key">{r.bulk.toFixed(5)}</td>
                <td>{r.whole.toFixed(5)}</td>
                <td>{r.edgeN.toFixed(4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="foot">
          A B C are similar (ρ={RHO}, τ={TAU}); pitch differs 2× and 4×.
          Bulk T spread {spread.toExponential(1)}. D (ρ={RIG[3].rho.toFixed(2)}) is not.
          <br />
          The count survives in one place only — the top rail — and leaves as 1/n.
        </p>
      </section>
    </div>
  )
}
