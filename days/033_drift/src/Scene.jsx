import { useMemo, useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { makeStudioEnvironment } from './env.js'
import { SKY, SKY_GLSL, skyUniforms, LIGHT, lightPosition } from './palette.js'

/**
 * The court: one key, a floor, a wall, and nothing else.
 *
 * Day 032 had two lights and said so proudly, because a second light in a froxel
 * grid costs one more term per cell and the point was that this is cheap. Today
 * there is one, and that is also a claim about the technique: everything in this
 * frame that is not standing in the beam is lit by air that scattered the beam a
 * second time. Adding a fill light would make the picture easier and the
 * argument worthless.
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

      {/* Not a second light so much as a stand-in for one. The volume knows how
          much light is standing in the air at every point in this court, and a
          surface ought to be able to ask it — but froxel-to-surface irradiance
          is not built yet (it is written down as tomorrow's problem), so a very
          dim hemisphere holds the place, tinted toward the key so the borrowed
          bounce at least comes from the right direction. */}
      <hemisphereLight args={['#8d8a83', '#05060a', 0.155]} />

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
