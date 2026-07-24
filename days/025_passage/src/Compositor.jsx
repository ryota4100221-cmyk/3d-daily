import { useMemo, useRef } from 'react'
import { createPortal, useFrame, useThree } from '@react-three/fiber'
import { useFBO } from '@react-three/drei'
import * as THREE from 'three'
import { CHAPTERS } from './chapters.jsx'
import { makeEnv } from './env.js'
import './TransitionMaterial.jsx'

const LOAD_DUR = 2.7
const HOLD = 3.0
const TRANS = 1.95
const SEG = HOLD + TRANS
const TYPE_LABEL = ['directional wipe', 'noise dissolve', 'radial iris']

const easeInOut = (x) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2)
const clamp01 = (x) => Math.min(1, Math.max(0, x))

export default function Compositor({ onState }) {
  const quad = useRef()
  const azm = useRef(0)

  // ?t=<seconds> freezes the timeline at a moment (deep-link + deterministic
  // headless verification; the scene is heavy enough that virtual-time frames
  // don't advance the clock reliably).
  const seek = useMemo(() => {
    const v = new URLSearchParams(window.location.search).get('t')
    const n = v == null ? null : parseFloat(v)
    return Number.isFinite(n) ? n : null
  }, [])

  // two ping-pong scene targets (full viewport, no MSAA for swiftshader safety)
  const fboA = useFBO({ samples: 0, stencil: false, depthBuffer: true })
  const fboB = useFBO({ samples: 0, stencil: false, depthBuffer: true })

  // one off-screen THREE.Scene per chapter, each with paper bg + its own env
  const gl = useThree((s) => s.gl)
  const scenes = useMemo(() => {
    return CHAPTERS.map((c) => {
      const s = new THREE.Scene()
      s.background = new THREE.Color('#e7e1d5')
      s.environment = makeEnv(gl, c.env)
      return s
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl])

  const envs = useMemo(() => scenes.map((s) => s.environment), [scenes])

  // throttled HUD reporting
  const last = useRef({ phase: '', name: '', type: -1, prog: -1, load: -1 })

  useFrame((state, delta) => {
    const g = state.gl
    const cam = state.camera
    const E = seek != null ? seek : state.clock.elapsedTime
    const aspect = state.size.width / state.size.height

    let phase, fromIdx, toIdx, progress, ttype, fromSolid, dispName, load
    const px = state.pointer.x

    if (E < LOAD_DUR) {
      // ---- LOAD: choreographed reveal from paper void into Chapter I ----
      phase = 'load'
      load = clamp01(E / LOAD_DUR)
      fromIdx = 0
      toIdx = 0
      fromSolid = 1
      ttype = 1 // dissolve reveal
      progress = easeInOut(clamp01((E - LOAD_DUR * 0.35) / (LOAD_DUR * 0.6)))
      dispName = CHAPTERS[0].name
    } else {
      phase = 'run'
      load = 1
      fromSolid = 0
      const s = E - LOAD_DUR
      const seg = Math.floor(s / SEG)
      const within = s - seg * SEG
      fromIdx = seg % CHAPTERS.length
      toIdx = (seg + 1) % CHAPTERS.length
      ttype = seg % 3
      if (within < HOLD) {
        progress = 0
        dispName = CHAPTERS[fromIdx].name
      } else {
        const tp = clamp01((within - HOLD) / TRANS)
        // pointer scrubs the transition front (pointer-as-DIRECTOR)
        progress = clamp01(easeInOut(tp) + px * 0.1)
        dispName = progress < 0.5 ? CHAPTERS[fromIdx].name : CHAPTERS[toIdx].name
      }
    }

    // ---- camera: gentle azimuth per displayed chapter, damped ----
    const AZ = [0.0, 0.34, -0.4]
    const targetAz =
      progress > 0 && phase === 'run'
        ? AZ[fromIdx] * (1 - progress) + AZ[toIdx] * progress
        : AZ[fromIdx]
    azm.current = THREE.MathUtils.damp(azm.current, targetAz + px * 0.12, 3, Math.min(delta, 0.05))
    const R = 6.4
    cam.position.set(Math.sin(azm.current) * R, 0.55 + state.pointer.y * 0.25, Math.cos(azm.current) * R)
    cam.lookAt(0, -0.05, 0)

    // ---- render the two active chapter scenes into their FBOs ----
    const prev = g.getRenderTarget()
    g.setRenderTarget(fboA)
    g.render(scenes[fromIdx], cam)
    g.setRenderTarget(fboB)
    g.render(scenes[toIdx], cam)
    g.setRenderTarget(prev)

    // ---- composite via the transition quad ----
    const m = quad.current
    if (m) {
      m.uFrom = fboA.texture
      m.uTo = fboB.texture
      m.uProgress = progress
      m.uType = ttype
      m.uAspect = aspect
      m.uTime = E
      m.uFromSolid = fromSolid
      m.uAngle = 0.55 + px * 0.9 + Math.sin(E * 0.05) * 0.15
    }

    // priority>0 disables R3F auto-render — draw the root (quad) ourselves
    g.setRenderTarget(null)
    g.render(state.scene, cam)

    // ---- throttled HUD report ----
    const rp = Math.round(progress * 100)
    const rl = Math.round(load * 100)
    const l = last.current
    if (
      l.phase !== phase ||
      l.name !== dispName ||
      l.type !== ttype ||
      Math.abs(l.prog - rp) >= 2 ||
      (phase === 'load' && Math.abs(l.load - rl) >= 2)
    ) {
      last.current = { phase, name: dispName, type: ttype, prog: rp, load: rl }
      onState &&
        onState({
          phase,
          name: dispName,
          type: TYPE_LABEL[ttype],
          progress: rp,
          load: rl,
        })
    }
  }, 1)

  return (
    <>
      {/* off-screen chapter trees, each portaled into its own scene */}
      {CHAPTERS.map((c, i) => (
        <PortalChapter key={c.key} scene={scenes[i]} Comp={c.Comp} env={envs[i]} />
      ))}

      {/* the compositor quad — clip-space fullscreen, ignores camera */}
      <mesh frustumCulled={false}>
        <planeGeometry args={[2, 2]} />
        <transitionMaterial ref={quad} depthTest={false} depthWrite={false} />
      </mesh>
    </>
  )
}

function PortalChapter({ scene, Comp, env }) {
  return createPortal(<Comp env={env} />, scene)
}
