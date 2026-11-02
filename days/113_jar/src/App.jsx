import { Suspense, useEffect, useMemo, Component } from 'react'
import { Canvas } from '@react-three/fiber'
import Scene from './Scene.jsx'

class Guard extends Component {
  state = { err: null }
  static getDerivedStateFromError(err) { return { err } }
  render() { return this.state.err ? null : this.props.children }
}

export default function App() {
  const pointer = useMemo(() => ({ x: 0, y: 0 }), [])
  useEffect(() => {
    const onMove = (e) => {
      pointer.x = (e.clientX / innerWidth) * 2 - 1
      pointer.y = (e.clientY / innerHeight) * 2 - 1
    }
    addEventListener('pointermove', onMove)
    return () => removeEventListener('pointermove', onMove)
  }, [])

  return (
    <div className="stage">
      <Canvas className="gl" flat dpr={[1, 2]} orthographic camera={{ position: [0, 0, 1000], near: 1, far: 3000, zoom: 1 }}>
        <Guard>
          <Suspense fallback={null}>
            <Scene pointer={pointer} />
          </Suspense>
        </Guard>
      </Canvas>

      <header className="nav">
        <span className="logo">MATSU<i /></span>
        <nav className="links"><span>The app</span><span>The idea</span></nav>
        <span className="get">Get Matsu<svg width="14" height="14" viewBox="0 0 14 14"><path d="M2 12 L12 2 M5 2 H12 V9" stroke="#20221C" strokeWidth="1.1" fill="none" /></svg></span>
        <span className="lang"><b>EN</b><span>日本語</span></span>
      </header>

      <p className="kicker">THE HABIT OF WAITING.</p>
      <p className="aside">A brining companion.<br />A patient kind of good.</p>
      <p className="vert">SALTED TODAY. OPENED LATER.</p>

      <h2 className="tag">A little salt.<br /><em>A lot of patience.</em></h2>
      <p className="body">Turn plain vegetables into something worth<br />opening slowly. Pick a brine. Seal a jar. Let the<br />days do the rest.</p>
      <span className="pause"><i /><i /></span>
      <span className="ring" />

      <a className="credit" href="../../">
        <b>3D Daily</b>
        <span className="t">Day 113 — The Jar Between the Letters</span>
        <span>A study after Hozon. Brand and copy are fictional.</span>
      </a>
    </div>
  )
}
