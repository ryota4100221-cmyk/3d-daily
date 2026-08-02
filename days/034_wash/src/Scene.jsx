import { useMemo, useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { makeStudioEnvironment } from './env.js'
import { SKY, SKY_GLSL, skyUniforms, LIGHT, lightPosition } from './palette.js'

/**
 * The court: one key, a floor, a painted distance, and nothing else.
 *
 * The list of lights in this file is the shortest it has ever been, and that is
 * the day's claim rather than an economy. Day 033 had one directional light and
 * a hemisphere fill, and its own comment called the fill a stand-in: the volume
 * knew how much light was standing in the air at every point of the court, and a
 * surface had no way to ask, so a very dim ambient held the place.
 *
 * The surface can ask now. The hemisphere is gone, and nothing replaced it —
 * everything in this frame facing away from the beam is lit by the froxel grid,
 * sampled per pixel in the composite. Press 8 to turn that off and the plaster
 * goes to almost nothing, which is the correct amount of light for a wall in an
 * unlit room and the reason the fill was there in the first place.
 *
 * The key is built imperatively rather than declared, because three's shadow
 * camera and the froxel injection's own light camera have to come out of the
 * same numbers. If they drift apart by a degree, the shafts stop landing on the
 * pools of light they are supposed to have made.
 */

function Backdrop() {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: skyUniforms(THREE),
        vertexShader: /* glsl */ `
          varying vec2 vP;
          void main() {
            vec4 world = modelMatrix * vec4(position, 1.0);
            vP = world.xy;
            gl_Position = projectionMatrix * viewMatrix * world;
          }
        `,
        fragmentShader: /* glsl */ `
          precision highp float;
          ${SKY_GLSL}
          varying vec2 vP;
          void main() {
            gl_FragColor = vec4(skyAt(vP), 1.0);
          }
        `,
      }),
    []
  )
  useEffect(() => () => mat.dispose(), [mat])
  return (
    // castShadow false is a correctness fix, not an optimisation: the light comes
    // from behind this plane, so a backdrop in the light-space depth map would be
    // the nearest occluder for every ray in the court and put the whole scene in
    // shadow.
    <mesh position={[0, 7, SKY.wallZ]} material={mat} castShadow={false}>
      <planeGeometry args={[86, 34]} />
    </mesh>
  )
}

export default function Scene({ rig }) {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)

  const envMap = useMemo(() => makeStudioEnvironment(gl), [gl])
  useEffect(() => {
    scene.environment = envMap
    return () => {
      scene.environment = null
      envMap.dispose()
    }
  }, [scene, envMap])

  useEffect(() => () => rig.dispose(), [rig])

  const key = useMemo(() => {
    const l = new THREE.DirectionalLight(new THREE.Color(...LIGHT.color), LIGHT.intensity)
    l.position.set(...lightPosition())
    l.target.position.set(...LIGHT.target)
    l.castShadow = true
    l.shadow.mapSize.set(2048, 2048)
    l.shadow.bias = -0.0007
    l.shadow.normalBias = 0.024
    const c = l.shadow.camera
    c.left = -LIGHT.halfSize
    c.right = LIGHT.halfSize
    c.top = LIGHT.halfSize
    c.bottom = -LIGHT.halfSize
    c.near = 0.5
    c.far = LIGHT.far
    c.updateProjectionMatrix()
    return l
  }, [])
  useEffect(() => () => key.dispose(), [key])

  const floor = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        // dark cold stone, unpolished. A mirror under a shaft doubles the shaft
        // and halves the contrast, and a pool of light on a floor is half the
        // evidence that the shaft is real.
        color: new THREE.Color('#1b1d21'),
        roughness: 0.90,
        metalness: 0.0,
        envMapIntensity: 0.30,
      }),
    []
  )
  useEffect(() => () => floor.dispose(), [floor])

  return (
    <>
      <color attach="background" args={['#030406']} />

      {/* One light. There is no fill of any kind in this scene — no hemisphere,
          no second key, no ambient. Everything that is visible and not standing
          in the beam is standing next to lit air, and that is now enough. */}
      <primitive object={key} />
      <primitive object={key.target} />

      <Backdrop />

      <mesh
        rotation-x={-Math.PI / 2}
        position={[0, 0, 0]}
        material={floor}
        receiveShadow
        castShadow={false}
      >
        <planeGeometry args={[300, 300]} />
      </mesh>

      <primitive object={rig.group} />
    </>
  )
}
