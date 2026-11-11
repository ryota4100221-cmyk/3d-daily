import { Suspense, useEffect, useRef } from 'react'
import { Canvas } from '@react-three/fiber'
import * as THREE from 'three'
import Scene from './Scene.jsx'
import Room from './Room.jsx'

function Logo() {
  // 架空のロゴ：黄のグラデーションの正方形に、左上の一点から広がる同心の弧（レンズの絞り）と斜体の語
  const arcs = [14, 22, 30, 38, 46, 54]
  return (
    <svg className="logo" width="68" height="68" viewBox="0 0 68 68" aria-label="Mirel">
      <defs>
        <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#FFF35A" /><stop offset="0.55" stopColor="#FFE100" /><stop offset="1" stopColor="#F2C800" /></linearGradient>
        <clipPath id="lc"><rect width="68" height="68" /></clipPath>
      </defs>
      <rect width="68" height="68" fill="url(#lg)" />
      <g clipPath="url(#lc)" fill="none" stroke="#fff" strokeOpacity="0.8">
        {arcs.map((r, i) => <circle key={i} cx="6" cy="4" r={r} strokeWidth={2.4 - i * 0.3} />)}
      </g>
      <text x="34" y="61" textAnchor="middle" fontFamily="Arial Black, Arial, sans-serif" fontWeight="900" fontStyle="italic" fontSize="17" fill="#000" letterSpacing="-0.5">Mirel</text>
    </svg>
  )
}

const Chev = () => (
  <svg width="8" height="13" viewBox="0 0 8 13" aria-hidden="true"><path d="M1.5 1.5 6.5 6.5 1.5 11.5" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
)

export default function App() {
  const pointer = useRef([0, 0])
  useEffect(() => {
    const onMove = (e) => { pointer.current = [(e.clientX / window.innerWidth) * 2 - 1, -((e.clientY / window.innerHeight) * 2 - 1)] }
    window.addEventListener('pointermove', onMove)
    return () => window.removeEventListener('pointermove', onMove)
  }, [])
  return (
    <div className="stage">
      <Canvas className="gl" dpr={[1, 2]} gl={{ antialias: false, alpha: true, toneMapping: THREE.NoToneMapping }}
        onCreated={({ gl }) => gl.setClearColor(0x000000, 0)}>
        <Suspense fallback={null}><Scene pointer={pointer} /></Suspense>
      </Canvas>

      <header className="head">
        <div className="row1">
          <Logo />
          <span className="corp">企業情報</span>
          <span className="tiny">株式会社ミレル｜Japan</span>
          <nav className="util">
            <a>総合トップ<Chev /></a><a>法人のお客様<Chev /></a><a>個人のお客様<Chev /></a>
            <svg className="search" width="20" height="20" viewBox="0 0 20 20"><circle cx="8" cy="8" r="6.5" fill="none" stroke="#222" strokeWidth="1.6" /><path d="M13 13 18.5 18.5" stroke="#222" strokeWidth="1.6" /></svg>
            <a className="gs">Global Site
              <svg width="20" height="20" viewBox="0 0 20 20"><circle cx="10" cy="10" r="8.6" fill="none" stroke="#222" strokeWidth="1.3" /><ellipse cx="10" cy="10" rx="3.8" ry="8.6" fill="none" stroke="#222" strokeWidth="1.3" /><path d="M1.5 10h17M3 5.5h14M3 14.5h14" stroke="#222" strokeWidth="1.3" fill="none" /></svg>
            </a>
          </nav>
        </div>
        <nav className="row2">
          <a>ミレルについて</a><a>テクノロジー</a><a className="on">デザイン</a><a>サステナビリティ</a><a>投資家情報</a><a>採用情報</a><a>ニュース</a>
        </nav>
      </header>

      <div className="crumb"><a>ホーム</a><Chev /><span>デザイン</span></div>

      <section className="hero">
        <p className="cat"><i />デザイン</p>
        <h1>指さきまで<br />伝える。</h1>
        <p className="sub">Carried to the Fingertips</p>
      </section>

      <div className="rule" />
      <p className="news"><span>2026.10.15</span>2026年度「グッドデザイン賞」を受賞<Chev /></p>

      <div className="pager"><span>01</span><span className="sl">/</span><span>04</span>
        <svg className="pv" width="8" height="13" viewBox="0 0 8 13"><path d="M6.5 1.5 1.5 6.5 6.5 11.5" fill="none" stroke="#bbb" strokeWidth="1.5" /></svg>
        <Chev /></div>
      <article className="card">
        <div className="txt">
          <p className="k">Works</p>
          <p className="lead">光と手ざわり、ふたつの研究がひとつのかたちになったスタジオのリニューアル</p>
          <a className="go"><Chev /></a>
        </div>
        <div className="thumb">
          <Canvas dpr={[1, 2]} gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping }}>
            <Suspense fallback={null}><Room /></Suspense>
          </Canvas>
        </div>
      </article>

      <a className="credit" href="../../">
        <b>3D Daily</b>
        <span className="t">Day 117 — The Cube Worn Soft</span>
        <span>A study after Nikon Design. Brand and copy are fictional.</span>
      </a>
    </div>
  )
}
