// App.jsx — Day 070
//
// 組みは再現元の実測値をそのまま使う: 見出し 72px / 行間 100% / W400 / 字間 -7.5%、
// 本文 14px / 行間 171%、色は #FFFFFF・#000000・罫 #CCCCCC の3値だけ。
// Neue Haas Grotesk 本体は外部フォントなので読めない（403）。数値だけ借りている。
import React, { useEffect, useMemo, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import * as THREE from 'three'
import Scene, { CAM } from './Scene.jsx'
import { LADDER, SPECIMENS, PANEL, GAP, T0, tau, fmtTau, survival, MATERIAL } from './rig.js'

// 目盛りは3Dの投影から出すが、描画ループは使わない。カメラは固定なので
// 同じカメラを1つ立てて射影するだけで足りる。useFrame 経由にすると
// headless の virtual time で「板は出たが目盛りが出ない」フレームが撮れる。
function layoutFor(w, h) {
  const cam = new THREE.PerspectiveCamera(CAM.fov, w / h, 0.05, 60)
  cam.position.set(...CAM.pos)
  cam.lookAt(...CAM.look)
  cam.updateMatrixWorld(true)
  cam.updateProjectionMatrix()
  const v = new THREE.Vector3()
  const proj = (x, y, z) => {
    v.set(x, y, z).project(cam)
    return [((v.x + 1) / 2) * w, ((1 - v.y) / 2) * h]
  }
  const cols = SPECIMENS.length
  const pitch = PANEL.w + GAP.x
  const colX = []
  for (let c = 0; c < cols; c++) colX.push(proj((c - (cols - 1) / 2) * pitch, 0, 0)[0])
  const rowY = [(PANEL.h + GAP.y) / 2, -(PANEL.h + GAP.y) / 2]
  const rows = rowY.map((y) => ({
    mid: proj(0, y, 0)[1],
    top: proj(0, y + PANEL.h / 2, 0)[1],
    bot: proj(0, y - PANEL.h / 2, 0)[1],
  }))
  return { colX, rows, half: (colX[1] - colX[0]) / 2 }
}

const q = new URLSearchParams(location.search)
const STILL = q.has('still')
const T_INIT = q.has('t') ? Number(q.get('t')) : T0

const LO = Math.log(0.5)
const HI = Math.log(20000)
const toSlider = (t) => (Math.log(t) - LO) / (HI - LO)
const fromSlider = (u) => Math.exp(LO + u * (HI - LO))

const fmtT = (s) => {
  if (s < 90) return `${s.toFixed(s < 10 ? 1 : 0)} s`
  if (s < 5400) return `${(s / 60).toFixed(1)} min`
  if (s < 172800) return `${(s / 3600).toFixed(1)} h`
  return `${(s / 86400).toFixed(1)} d`
}

const frac = (v) => (v < 0.005 ? '—' : v.toFixed(2).replace(/^0/, '.'))

export default function App() {
  const [t, setT] = useState(T_INIT)
  const [vp, setVp] = useState(() => [window.innerWidth, window.innerHeight])
  useEffect(() => {
    const on = () => setVp([window.innerWidth, window.innerHeight])
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  const L = useMemo(() => layoutFor(vp[0], vp[1]), [vp])

  // 「まだ波打っている一番細い板」＝境目。閾値ではなく、ただの読み取り。
  const edgeIndex = (tt) => {
    for (let i = 0; i < SPECIMENS.length; i++) if (survival(SPECIMENS[i], tt) > 0.5) return i
    return SPECIMENS.length
  }
  const e0 = edgeIndex(t)
  const e1 = edgeIndex(t * 16)

  const rows = useMemo(() => [t, t * 16], [t])

  return (
    <div className="page">
      <Canvas
        className="stage"
        dpr={1}
        gl={{ antialias: true, alpha: true }}
        camera={{ fov: 24, position: [0, 0.03, 3.05], near: 0.05, far: 60 }}
      >
        <Scene t={t} still={STILL} />
      </Canvas>

      <div className="overlay">
        <header>
          <div className="eyebrow">3D DAILY — DAY 070 · REPRODUCTION STUDY</div>
          <h1>THE FOURTH&nbsp;POWER</h1>
          <div className="after">
            after ニシザキ工芸 塗装部
            <br />
            <span className="mono">tosou.nishizaki.co.jp</span>
          </div>
          <div className="tagline">
            <span className="mono">τ = 3μλ⁴ / 16π⁴γh̄³</span> — six specimen panels, one lacquer,
            one instant. Only the spacing differs.
          </div>
        </header>

        {L && (
          <div className="marks">
            {rows.map((tt, r) => (
              <div
                key={`row-${r}`}
                className="rowlabel"
                style={{
                  left: 0,
                  width: L.colX[0] - L.half - 20,
                  top: L.rows[r].mid - 26,
                }}
              >
                <div className="rl-k">{r === 0 ? 't₀' : '16 t₀'}</div>
                <div className="rl-v mono">{fmtT(tt)}</div>
                <div className="rl-n">
                  flat up to {LADDER[Math.max(0, (r === 0 ? e0 : e1) - 1)] * 1000} mm
                </div>
              </div>
            ))}

            {rows.map((tt, r) =>
              SPECIMENS.map((s, c) => (
                <div
                  key={`v-${r}-${c}`}
                  className="cellval mono"
                  style={{ left: L.colX[c] - 40, top: L.rows[r].bot + 5, width: 80 }}
                >
                  {frac(survival(s, tt))}
                </div>
              ))
            )}

            {LADDER.map((lam, c) => (
              <div
                key={`c-${c}`}
                className="collabel"
                style={{ left: L.colX[c] - 60, top: L.rows[1].bot + 30, width: 120 }}
              >
                <div className="cl-k">λ {lam * 1000} mm</div>
                <div className="cl-v mono">τ {fmtTau(tau(lam))}</div>
              </div>
            ))}
          </div>
        )}

        <footer>
          <div className="col">
            <p>
              A brushed lacquer film flattens itself. Surface tension drives the ridges down and
              the lubrication equation says each spacing decays on its own clock,
              <span className="mono"> τ ∝ λ⁴</span>. Nothing in the film knows about a critical
              spacing; there is no threshold in the equation. Double the spacing and the ridge
              lives sixteen times longer.
            </p>
          </div>
          <div className="col">
            <p>
              What you see is not the height — the ridges are 0.22 to 7.1 micrometres on a 260 mm
              panel. You see the striped board reflected in the gloss, bent by the slope. That is
              how a coating shop reads waviness, and it is the only instrument here: there are no
              lights in this scene.
            </p>
          </div>
          <div className="col">
            <p className="mono spec">
              nitrocellulose lacquer
              <br />μ {MATERIAL.MU} Pa·s · γ {MATERIAL.GAMMA} N/m
              <br />h̄ {MATERIAL.HBAR * 1e6} µm wet film
              <br />
              initial slope 0.04° on every panel
            </p>
          </div>
        </footer>

        <div className="control">
          <label htmlFor="t">elapsed t</label>
          <input
            id="t"
            type="range"
            min={0}
            max={1}
            step={0.001}
            value={toSlider(t)}
            onChange={(e) => setT(fromSlider(Number(e.target.value)))}
          />
          <div className="readout mono">
            top {fmtT(t)} · bottom {fmtT(t * 16)} — wait 16× and the edge moves one rung
          </div>
        </div>
      </div>
    </div>
  )
}
