import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import Scene from './Scene.jsx'
import { WALL, BALL, bendRadius, kick } from './rig.js'

const VIEW_W = 21.5 // 画面の横に何メートル入れるか
const TILT = (16 * Math.PI) / 180 // 真上から 16° だけ倒す。倒さないとタイルの厚みが出ない

function CamRig() {
  const { camera, size } = useThree()
  useLayoutEffect(() => {
    const D = 90
    camera.up.set(0, 0, -1)
    camera.position.set(0, D * Math.cos(TILT), D * Math.sin(TILT))
    camera.lookAt(0, 0, 0)
    camera.near = 1
    camera.far = 260
    camera.zoom = size.width / VIEW_W
    camera.updateProjectionMatrix()
  }, [camera, size])
  return null
}

/** ボールを飛ばして、少し置いてまた蹴る。 */
function Flight({ tRef }) {
  const phase = useRef(0)
  useFrame((_, dt) => {
    phase.current = (phase.current + dt / 2.1) % 1
    const p = phase.current
    tRef.current = p < 0.6 ? p / 0.6 : 1
  })
  return null
}

const f = (x, n = 3) => x.toFixed(n)
const pct = (x, n = 2) => (100 * x).toFixed(n) + '%'
const deg = (r) => (r * 180) / Math.PI

export default function App() {
  const [CL, setCL] = useState(BALL.CL)
  const [C, setC] = useState(2 * WALL)
  const tRef = useRef(0)

  const R = useMemo(() => bendRadius({ ...BALL, CL }), [CL])
  const k = useMemo(() => kick(R, C), [R, C])
  const hole = Math.abs(C - 2 * WALL) < 0.12

  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    const u = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
    const v = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))
    setC(12 + u * 18)
    setCL(0.2 + (1 - v) * 0.25)
  }
  const onLeave = () => {
    setC(2 * WALL)
    setCL(BALL.CL)
  }

  return (
    <div className="wrap" onPointerMove={onMove} onPointerLeave={onLeave}>
      <Canvas
        flat
        shadows
        orthographic
        dpr={[1, 2]}
        gl={{ antialias: true }}
        camera={{ position: [0, 86, 25], zoom: 74, near: 1, far: 260 }}
      >
        <color attach="background" args={['#ff00aa']} />
        <CamRig />
        <Flight tRef={tRef} />
        <Scene CL={CL} C={C} tRef={tRef} />
      </Canvas>

      <div className="hud">
        <header className="mast">
          <p className="eyebrow">3D Daily · Day 083 · Gallery reconstruction</p>
          <h1 className="title">
            THE TWENTY
            <br />
            YARD HOLE
          </h1>
        </header>

        <section className="lede">
          <p className="after">
            AFTER <b>ATLETICO SUZUKA CLUB</b> · JFL · atletico-suzuka.com
          </p>
          <p>
            The wall stands <b>9.144 m</b> from the ball, always. A ball held by a constant sideways
            force runs on a circular arc — and an arc is farthest from its own chord at the chord’s
            exact midpoint. At <b>18.288 m</b> those two points are one point.
          </p>
          <p className="jp">
            壁は必ず弦の上 9.144 m。弧が弦からいちばん離れるのは弦のちょうど中点。
            弦が 9.144 の二倍になった瞬間、その二つは同じ一点になる。
          </p>
        </section>

        <section className="stats">
          <Cell t="Ball → goal" k="C" v={f(C, 3)} u="m" hot={hole} />
          <Cell t="Wall offset" k="ξ" v={f(WALL - C / 2, 3)} u="m" hot={hole} />
          <Cell t="Bend length" k="R = 2m/ρAC_L" v={f(R, 2)} u="m" />
          <Cell t="Arc angle" k="φ" v={f(deg(k.phi), 3)} u="°" />
          <Cell t="Clearance at wall" k="d(ξ)" v={f(k.clearWall, 4)} u="m" />
          <Cell t="Largest clearance" k="d(0)" v={f(k.sagitta, 4)} u="m" />
          <Cell t="Wall ÷ largest" k="" v={pct(k.clearFrac, 3)} u="" hot={hole} />
          <Cell t="Bend done at wall" k="" v={pct(k.doneAtWall)} u="" />
        </section>

        <footer className="foot">
          <p className="key">
            <i className="sw lime" />arc<i className="sw ink" />beads every 0.06 s at v₀ = 18 m/s
            <i className="sw cob" />the same at v₀ = 34 m/s — one curve, two clocks
            <i className="sw grey" />aim line<i className="sw ink" />chord
          </p>
          <p className="key dim">
            Tile colour density per column = the fraction of the bend already spent there. No number
            is printed on the pitch; the floor is doing the counting.
          </p>
          <p className="drag">Drag — X: ball→goal 12…30 m · Y: lift C_L 0.20…0.45</p>
        </footer>

        {hole && <p className="snap">ξ = 0 — the wall is standing on the widest point</p>}
      </div>
    </div>
  )
}

function Cell({ t, k, v, u, hot }) {
  return (
    <div className={'cell' + (hot ? ' hot' : '')}>
      <p className="ct">{t}</p>
      <p className="cv">
        {v}
        <span className="cu">{u}</span>
      </p>
      <p className="ck">{k}</p>
    </div>
  )
}
