import { Suspense, Component } from 'react'
import { Canvas } from '@react-three/fiber'
import Scene from './Scene.jsx'

class Guard extends Component {
  state = { err: null }
  static getDerivedStateFromError(err) { return { err } }
  render() { return this.state.err ? null : this.props.children }
}

// 地に散る点（ref.png から拾った位置・径・色。p=桃 g=緑）
const DOTS = [
  [1276, 17, 5, 'g'], [476, 139, 5, 'p'], [243, 177, 4, 'p'], [1240, 192, 5, 'p'], [831, 198, 4, 'g'],
  [758, 203, 7, 'p'], [1328, 228, 5, 'g'], [108, 232, 7, 'p'], [22, 350, 4, 'p'], [1332, 376, 4, 'p'],
  [215, 395, 8, 'g'], [116, 458, 4, 'g'], [1236, 482, 5, 'p'], [235, 520, 5, 'g'], [918, 560, 4, 'g'],
  [881, 569, 4, 'p'], [990, 598, 5, 'g'], [892, 314, 6, 'g'], [64, 754, 8, 'p'], [1170, 640, 7, 'p'],
  [770, 841, 6, 'p'], [1110, 877, 5, 'p'], [248, 862, 4, 'g'], [244, 885, 6, 'p'], [712, 732, 4, 'g'],
  [955, 463, 5, 'g'], [804, 549, 5, 'p'], [678, 538, 4, 'p'], [158, 255, 4, 'g'], [55, 390, 4, 'g'],
  [160, 298, 4, 'p'], [207, 428, 3, 'p'], [994, 559, 4, 'g'], [1430, 637, 4, 'p'], [116, 19, 4, 'p'], [468, 49, 5, 'p'],
]

export default function App() {
  return (
    <div className="page">
      <div className="stage">
        <div className="dots">
          {DOTS.map(([x, y, s, c], i) => (
            <i key={i} className={c} style={{ left: x - s / 2, top: y - s / 2, width: s, height: s }} />
          ))}
        </div>
        <Canvas className="gl" flat dpr={[1, 2]} camera={{ fov: 15, near: 1, far: 100 }}>
          <Guard>
            <Suspense fallback={null}>
              <Scene />
            </Suspense>
          </Guard>
        </Canvas>

        <header className="nav">
          <span className="logo">
            <svg width="38" height="38" viewBox="0 0 38 38">
              <circle cx="19" cy="19" r="17" fill="none" stroke="#009B4A" strokeWidth="3" />
              <path d="M8 24 C 14 10, 26 8, 31 12 C 28 24, 18 30, 8 24 Z" fill="#009B4A" />
              <path d="M10 25 C 17 19, 23 16, 29 13" stroke="#F4F1EE" strokeWidth="1.6" fill="none" />
            </svg>
            <span>Fallow<b>·</b>Hog</span>
          </span>
          <nav className="links">
            <span className="on">Home</span><span>Approach</span><span>Service</span><span>Company</span><span>Careers</span>
          </nav>
          <span className="menu"><i /><i /><i /></span>
        </header>

        <h1 className="head">
          <span className="l1">Field Data for</span>
          <span className="l2">Accountable</span>
          <span className="l3">Swine Farming</span>
        </h1>
        <span className="down">
          <svg width="26" height="30" viewBox="0 0 26 30"><path d="M13 3 V26 M3 16 L13 26 L23 16" stroke="#fff" strokeWidth="2.2" fill="none" /></svg>
        </span>

        <a className="credit" href="../../">
          <b>3D Daily</b>
          <span className="t">Day 114 — The Pig Folded from Light</span>
          <span>A study after Eco-Pork. Brand and copy are fictional.</span>
        </a>
      </div>
    </div>
  )
}
