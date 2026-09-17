import React, { useCallback, useEffect, useRef, useState } from 'react'
import Scene, { RECT_WIDE } from './Scene.jsx'
import { CONST, VEHICLES, lineRate, stretch } from './rig.js'

const n = (x, d = 1) => x.toFixed(d)

// 帯の縦は秒で目盛る。ここが今日の全部なので、目盛だけは数字で外に出す。
const TICKS = [0, 1, 2, 3, 4, 5, 6, 7, 8]

export default function App() {
  const ctl = useRef({ gs: CONST.GS_MS })
  const [gs, setGs] = useState(CONST.GS_MS)
  const drag = useRef(null)

  const onTick = useCallback((v) => setGs(v), [])

  useEffect(() => {
    const down = (e) => {
      drag.current = { x: e.clientX, gs: ctl.current.gs }
    }
    const move = (e) => {
      if (!drag.current) return
      const k = (e.clientX - drag.current.x) / window.innerWidth
      const v = drag.current.gs + k * 56
      ctl.current.gs = Math.min(CONST.GS_MAX, Math.max(CONST.GS_MIN, v))
    }
    const up = () => {
      drag.current = null
    }
    window.addEventListener('pointerdown', down)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointerdown', down)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [])

  const fL = lineRate(gs)
  const alongM = gs * CONST.SPAN_S

  return (
    <div className="page">
      <Scene ctl={ctl} onTick={onTick} />

      <header className="hd">
        <div className="mark">3D Daily — Day 078 / after USAvionix</div>
        <h1>
          The Axis That
          <br />
          Became a Clock
        </h1>
        <p className="sub">
          A line scanner owns one row of pixels. At no instant does it hold a picture. The image
          exists only because the aircraft moves — row n is the world at time n. So the vertical
          axis is not space. It is seconds.
        </p>
      </header>

      <section className="consts">
        <div className="lbl">Sensor</div>
        <ul>
          <li>
            <span>ALT</span>
            <b>{CONST.ALT_M.toLocaleString()} m</b>
          </li>
          <li>
            <span>FOV</span>
            <b>{n(CONST.FOV_DEG)}°</b>
          </li>
          <li>
            <span>SWATH</span>
            <b>{n(CONST.SWATH_M, 0)} m</b>
          </li>
          <li>
            <span>GSD</span>
            <b>{n(CONST.GSD_M, 2)} m</b>
          </li>
          <li className="live">
            <span>GS</span>
            <b>{n(gs)} m/s</b>
          </li>
          <li className="live">
            <span>LINE RATE</span>
            <b>{n(fL)} Hz</b>
          </li>
          <li>
            <span>FRAME</span>
            <b>
              {n(CONST.SPAN_S, 2)} s = {n(alongM, 0)} m
            </b>
          </li>
        </ul>
        <div className="hint">drag ⇄ ground speed</div>
      </section>

      <section className="tally">
        <div className="lbl">Stretch — V / |V − v|</div>
        <table>
          <tbody>
            {VEHICLES.map((v) => {
              const k = stretch(v.v, gs)
              const inf = !isFinite(k) || k > 400
              return (
                <tr key={v.id} className={inf ? 'inf' : ''}>
                  <td>{v.id}</td>
                  <td className="num">{n(v.v * 3.6, 0)} km/h</td>
                  <td className="num">{n(v.len, 1)} m</td>
                  <td className="num arrow">→</td>
                  <td className="num big">{inf ? '∞' : n(v.len * k, 1) + ' m'}</td>
                  <td className="num k">{inf ? '—' : '×' + n(k, 2)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>

      <div className="ruler">
        {TICKS.map((t) => {
          const f = t / CONST.SPAN_S
          if (f > 1) return null
          const top = (1 - RECT_WIDE[3] + f * (RECT_WIDE[3] - RECT_WIDE[1])) * 100
          return (
            <div className="tk" key={t} style={{ top: `${top}%` }}>
              {t === 0 ? 'T' : `−${t}s`}
            </div>
          )
        })}
      </div>

      <footer className="ft">
        <span>THERMAL · NO ILLUMINANT IN SCENE</span>
        <span>N 47°26.1′ E 012°48.4′</span>
      </footer>
    </div>
  )
}
