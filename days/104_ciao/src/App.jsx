import { useEffect, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import * as THREE from 'three'
import Scene from './Scene.jsx'
import { FLAVORS, grad } from './flavors.js'

const N = FLAVORS.length - 1
const Chev = ({ style, flip }) => (
  <svg className="chev" style={style} viewBox="0 0 13 8"><g fill="#fff" transform={flip ? 'rotate(180 6.5 4)' : undefined}>
    <circle cx="1.5" cy="1.5" r=".8" /><circle cx="4" cy="4" r=".8" /><circle cx="6.5" cy="6.5" r=".9" /><circle cx="9" cy="4" r=".8" /><circle cx="11.5" cy="1.5" r=".8" /></g></svg>
)
const Near = ({ style, flip }) => (
  <svg className="near" style={style} viewBox="0 0 16 32"><g fill="#fff" transform={flip ? 'scale(-1 1) translate(-16 0)' : undefined}>
    <circle cx="12" cy="4" r="1.1" opacity=".5" /><circle cx="8.5" cy="10" r="1.3" opacity=".7" /><circle cx="5" cy="16" r="1.6" />
    <circle cx="8.5" cy="22" r="1.3" opacity=".7" /><circle cx="12" cy="28" r="1.1" opacity=".5" /></g></svg>
)

export default function App() {
  const q = new URLSearchParams(location.search)
  const s = useRef({ v: Number(q.get('s') || 0), target: Number(q.get('s') || 0) })
  const [ui, setUi] = useState({ v: s.current.v })
  useEffect(() => {
    const onWheel = (e) => { s.current.target = Math.min(1, Math.max(0, s.current.target + e.deltaY * 0.0006)) }
    let y0 = null
    const ts = (e) => { y0 = e.touches[0].clientY }
    const tm = (e) => { if (y0 != null) { s.current.target = Math.min(1, Math.max(0, s.current.target + (y0 - e.touches[0].clientY) * 0.002)); y0 = e.touches[0].clientY } }
    addEventListener('wheel', onWheel, { passive: true }); addEventListener('touchstart', ts); addEventListener('touchmove', tm)
    let raf
    const tick = () => {
      s.current.v += (s.current.target - s.current.v) * 0.06
      setUi((u) => (Math.abs(u.v - s.current.v) > 1e-4 ? { v: s.current.v } : u))
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => { cancelAnimationFrame(raf); removeEventListener('wheel', onWheel); removeEventListener('touchstart', ts); removeEventListener('touchmove', tm) }
  }, [])
  const name = FLAVORS[Math.round(ui.v * N)]
  return (
    <>
      <Canvas style={{ position: 'fixed', inset: 0 }} dpr={[1, 2]} gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping }}
        camera={{ fov: 20, position: [0, 3.1, 29.75], near: 1, far: 100 }} onCreated={({ camera }) => camera.lookAt(0, 0.0, 0)}>
        <Scene s={s} />
      </Canvas>
      <div className="ui">
        <div className="rule" />
        <div className="on">ON <span className="bars">{[9, 9, 6, 4].map((h, i) => <i key={i} style={{ height: h }} />)}</span></div>
        <div className="logo"><span className="a">HALF</span><span className="b">TONIC</span></div>
        <div className="menu"><span className="dots"><i /><i /><i /><i /></span>MENU</div>
        <div className="contact">CONTACT</div>
        <div className="corner tl" /><div className="corner tr" /><div className="corner bl" /><div className="corner br" />
        <div className="side" style={{ top: 452 }}>C</div><div className="side" style={{ top: 518 }}>E</div><div className="side" style={{ top: 566 }}>–</div>
        <div className="tick" style={{ top: 180 }} /><div className="tick" style={{ top: 802 }} />
        <Chev style={{ left: 54, top: 655 }} /><Chev style={{ left: 54, top: 686 }} /><Chev style={{ left: 54, top: 717 }} />
        <Chev style={{ right: 54, top: 655 }} /><Chev style={{ right: 54, top: 686 }} /><Chev style={{ right: 54, top: 717 }} />
        <Near style={{ left: 566 }} /><Near style={{ left: 856 }} flip />
        <div className="title">{name[0]}<br />{name[1]}</div>
        <div className="track" style={{ background: 'linear-gradient(90deg,#888bd4 0%,#00a5e2 18%,#65bb9e 37%,#d6b471 56%,#eba99e 68%,#e69be3 81%,#fe68a0 100%)' }} />
        <div className="knob" style={{ left: 485 + 478 * ui.v, background: `rgb(${grad(ui.v).map((c) => Math.round(c * 245)).join(',')})` }} />
        <div className="hint">SCROLLER POUR GOÛTER</div>
        <div className="credit">Day 104 — after CIAO ENERGY</div>
      </div>
    </>
  )
}
