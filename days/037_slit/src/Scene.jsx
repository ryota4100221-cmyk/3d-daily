import { useMemo, useEffect } from 'react'
import * as THREE from 'three'
import { SKY } from './palette.js'

/**
 * The court — a scene graph with no light in it, for the second day.
 *
 * Yesterday this file lost its `DirectionalLight` and its procedural
 * environment map together, and what was left was a claim the piece can be
 * checked against: nothing in this frame is lit by anything that was not, at
 * some remove, lit by the lamp. That still holds this morning, and it is worth
 * saying why it is *load-bearing* today rather than merely tidy.
 *
 * The soft terminator arriving in `area.js` makes surfaces near the light's
 * horizon brighter than Lambert made them, over a band a few degrees wide. The
 * traditional way to get that look is to raise an ambient term until the
 * creases stop looking like creases. There is no ambient term here to raise —
 * so if the band appears, it is because a disc is setting behind the horizon,
 * and if it looked wrong there would be nowhere to hide the mistake.
 *
 * What remains here is geometry and albedo. The materials are never rendered
 * with their own shaders any more; they are read once, when a mesh registers,
 * for their colour and their roughness, and after that they are data. Today the
 * roughness half of that stopped being a formality — see `mat.glaze` in rig.js.
 */

function Backdrop() {
  // A material that is never drawn: the G-buffer's EMISSIVE variant replaces it
  // in the only pass this mesh appears in. It exists so the mesh is a mesh, and
  // so `userData.emissive` has somewhere to be read.
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ color: 0x000000 }), [])
  useEffect(() => () => mat.dispose(), [mat])
  return (
    // castShadow false is a correctness fix, not an optimisation: the light comes
    // from behind this plane, so a backdrop in the light-space depth map would be
    // the nearest occluder for every ray in the court and put the whole scene in
    // shadow.
    <mesh
      position={[0, 7, SKY.wallZ]}
      material={mat}
      castShadow={false}
      userData={{ emissive: true, matId: 1 }}
    >
      <planeGeometry args={[86, 34]} />
    </mesh>
  )
}

export default function Scene({ rig }) {
  useEffect(() => () => rig.dispose(), [rig])

  const floor = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        // Dark cold stone, unpolished. The apron on top of it is pale, so what
        // the ceiling and the air receive is the *shape* of the apron and not a
        // general lift — Day 035's arrangement, kept, because the return path is
        // still running underneath today's work.
        color: new THREE.Color('#191b1f'),
        roughness: 0.92,
        metalness: 0.0,
      }),
    []
  )
  useEffect(() => () => floor.dispose(), [floor])

  return (
    <>
      <color attach="background" args={['#030406']} />

      <Backdrop />

      <mesh rotation-x={-Math.PI / 2} position={[0, 0, 0]} material={floor} castShadow={false}>
        <planeGeometry args={[300, 300]} />
      </mesh>

      <primitive object={rig.group} />
    </>
  )
}
