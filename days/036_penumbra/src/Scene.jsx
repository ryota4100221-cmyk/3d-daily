import { useMemo, useEffect } from 'react'
import * as THREE from 'three'
import { SKY } from './palette.js'

/**
 * The court — and today, for the first time in thirty-six days, a scene graph
 * with no light in it.
 *
 * Yesterday this file created a `DirectionalLight`, gave it a shadow camera
 * built from the same numbers as the froxel injection's own light camera, and
 * spent a comment explaining that if the two ever drifted apart the shafts would
 * stop landing on the pools of light they had made. That whole problem is gone:
 * there is one light camera now, it lives in Pipeline.jsx, and the direct term
 * is computed in the composite out of the G-buffer.
 *
 * Also gone: `scene.environment`. Every day since Day 002 has had a procedural
 * studio IBL under everything as a quiet floor of light, and every day since
 * Day 034 has been trying to remove the last of the fills. This was the last
 * one. What is left is a claim the piece can be checked against — nothing in
 * this frame is lit by anything that was not, at some remove, lit by the lamp.
 *
 * What remains here is geometry and albedo. The materials are never rendered
 * with their own shaders any more; they are read once, when a mesh registers,
 * for their colour and their roughness, and after that they are data.
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
