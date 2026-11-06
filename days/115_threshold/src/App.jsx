import { Suspense, useEffect, useRef } from 'react'
import { Canvas } from '@react-three/fiber'
import { EffectComposer, Vignette, Noise } from '@react-three/postprocessing'
import { BlendFunction } from 'postprocessing'
import * as THREE from 'three'
import Scene, { CAM } from './Scene.jsx'

const NOFX = typeof location !== 'undefined' && location.search.includes('nofx')

export default function App() {
  const progress = useRef(0)
  const pointer = useRef([0, 0])
  const numRef = useRef()
  useEffect(() => {
    const onScroll = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight
      const p = max > 0 ? window.scrollY / max : 0
      progress.current = p
      if (numRef.current) {
        const s = Math.min(1, p / 0.5)
        numRef.current.style.setProperty('--split', `${s * 260}px`)
        numRef.current.style.opacity = String(1 - s)
        document.querySelectorAll('.fadeout').forEach((el) => { el.style.opacity = String(1 - s) })
      }
    }
    const onMove = (e) => {
      pointer.current = [(e.clientX / window.innerWidth) * 2 - 1, -((e.clientY / window.innerHeight) * 2 - 1)]
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('pointermove', onMove)
    onScroll()
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('pointermove', onMove)
    }
  }, [])
  return (
    <>
      <div className="stage">
        <Canvas
          shadows={!location.search.includes("nosh")}
          dpr={[1, 2]}
          camera={{ position: [0, CAM.y, CAM.z], fov: CAM.fov, near: 0.1, far: 80 }}
          gl={{ antialias: true, toneMapping: THREE.NoToneMapping }}
          onCreated={({ camera }) => camera.lookAt(0, CAM.y, 0)}
        >
          <Suspense fallback={null}>
            <Scene progress={progress} pointer={pointer} />
          </Suspense>
          {!NOFX && <EffectComposer multisampling={4}>
            <Vignette offset={0.18} darkness={0.97} />
            <Noise opacity={0.16} blendFunction={BlendFunction.OVERLAY} />
          </EffectComposer>}
        </Canvas>

        <div className="dusk" aria-hidden="true" />
        <div className="frames fadeout" aria-hidden="true">
          <i style={{ left: 305, top: 344, width: 122, height: 371 }} />
          <i style={{ left: 1015, top: 344, width: 120, height: 371 }} />
          <i className="v" style={{ left: 830, top: 290, height: 70 }} />
        </div>

        <h1 className="num" ref={numRef} aria-label="100">
          <span className="d1">1</span>
          <span className="d2">0</span>
          <span className="d3">0</span>
        </h1>
        <p className="side fadeout">100 years<br />without Varenne</p>
        <p className="foot">Independent non-commercial study · the painter and the house are fictional</p>

        <a className="credit" href="../../">
          <b>3D Daily</b>
          <span className="t">Day 115 — The Door Between the Numerals</span>
          <span>A study after Monet 100. Brand and copy are fictional.</span>
        </a>
      </div>
      <div className="scroll" />
    </>
  )
}
