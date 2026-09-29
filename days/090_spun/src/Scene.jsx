import { useMemo, useRef, useEffect } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { ContactShadows } from '@react-three/drei'
import * as THREE from 'three'
import { makeSteel, lampDir, measureBar, PALETTE } from './rig.js'

const SEG = 360 // one lathe step per degree — the grooves need a smooth tangent

// profile helpers: a list of [r, y] → Vector2 for LatheGeometry
const V2 = (pts) => pts.map(([r, y]) => new THREE.Vector2(r, y))

function lidProfile() {
  const pts = []
  // flat spun field out to r = 1.05, then a shallow shoulder down to the lip
  for (let i = 0; i <= 24; i++) pts.push([0.001 + (1.05 * i) / 24, 0.16])
  for (let i = 1; i <= 16; i++) {
    const t = i / 16
    pts.push([1.05 + 0.5 * t, 0.16 - 0.13 * t * t])
  }
  pts.push([1.585, 0.02], [1.6, 0.0], [1.585, -0.02], [1.54, -0.015], [1.45, 0.02])
  for (let i = 1; i <= 12; i++) {
    const t = i / 12
    pts.push([1.45 * (1 - t) + 0.001 * t, 0.02 + 0.1 * t])
  }
  return V2(pts)
}

function knobProfile() {
  return V2([
    [0.001, 0.16], [0.2, 0.16], [0.2, 0.18], [0.1, 0.22], [0.08, 0.3],
    [0.24, 0.33], [0.27, 0.36], [0.25, 0.38], [0.001, 0.385],
  ])
}

function potProfile() {
  const pts = [[0.001, 0.0]]
  for (let i = 1; i <= 10; i++) pts.push([(1.0 * i) / 10, 0.0])
  // fillet at the base
  for (let i = 1; i <= 8; i++) {
    const a = (i / 8) * (Math.PI / 2)
    pts.push([1.0 + 0.1 * Math.sin(a), 0.1 - 0.1 * Math.cos(a)])
  }
  for (let i = 1; i <= 12; i++) pts.push([1.1, 0.1 + (1.0 * i) / 12])
  // rolled rim
  for (let i = 1; i <= 10; i++) {
    const a = (i / 10) * Math.PI
    pts.push([1.13 - 0.03 * Math.cos(a), 1.1 + 0.035 * Math.sin(a)])
  }
  pts.push([1.08, 1.08])
  for (let i = 1; i <= 10; i++) pts.push([1.08, 1.08 - (1.0 * i) / 10])
  for (let i = 1; i <= 10; i++) pts.push([1.08 * (1 - i / 10) + 0.001, 0.08])
  return V2(pts)
}

export default function Scene({ state, onReadout }) {
  const steel = useMemo(makeSteel, [])
  const lid = useMemo(() => new THREE.LatheGeometry(lidProfile(), SEG), [])
  const knob = useMemo(() => new THREE.LatheGeometry(knobProfile(), SEG), [])
  const pot = useMemo(() => new THREE.LatheGeometry(potProfile(), SEG), [])
  const lidGroup = useRef()
  const { camera } = useThree()
  const tick = useRef(0)

  useEffect(() => () => steel.dispose(), [steel])

  useFrame((_, dt) => {
    const s = state.current
    // pointer x drags the lamp round; left alone it walks on by itself
    if (!s.frozen) s.idle += dt * 0.22
    const az = s.fixedAz ?? s.idle + s.px * Math.PI * 0.9
    s.iso += ((s.down ? 1 : 0) - s.iso) * Math.min(1, dt * 7)
    if (s.forceIso != null) s.iso = s.forceIso
    const L = lampDir(az)
    steel.uniforms.uL.value.copy(L)
    steel.uniforms.uIso.value = s.iso

    tick.current += dt
    if (tick.current > 0.1) {
      tick.current = 0
      const c = new THREE.Vector3()
      lidGroup.current.getWorldPosition(c)
      c.y += 0.16
      onReadout({ az, iso: s.iso, ...measureBar(L, camera.position, c) })
    }
  })

  return (
    <>
      <group ref={lidGroup} position={[-1.05, 0.02, 0.55]}>
        <mesh geometry={lid} material={steel} />
        <mesh geometry={knob} material={steel} />
      </group>
      <group position={[1.75, 0.0, -1.05]}>
        <mesh geometry={pot} material={steel} />
      </group>
      <ContactShadows
        position={[0, -0.001, 0]}
        scale={12}
        blur={2.6}
        far={2.2}
        resolution={512}
        opacity={0.42}
        color={PALETTE.olive}
      />
    </>
  )
}
