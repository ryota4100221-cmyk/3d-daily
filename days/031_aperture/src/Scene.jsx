import { useMemo, useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { makeStudioEnvironment } from './env.js'
import { SKY, SKY_GLSL, skyUniforms, LIGHT, lightPosition } from './palette.js'

/**
 * The hall: one key light, one very dim fill, a floor, and a wall.
 *
 * There is less here than on any day since Day 004, and that is the design. The
 * frame's brightest object is not a surface — it is the air. Anything that
 * competes with a beam of light is a mistake, so the floor is unpolished
 * (Day 029 and 030 both had mirrors; a mirror under a shaft of light doubles the
 * shaft and halves the contrast) and the wall is nearly black.
 *
 * The key light is built imperatively rather than declared, because its shadow
 * camera and the ray march's own light camera have to be derived from the same
 * numbers. If they drift apart by so much as a degree, the beams stop landing
 * on the pools of light they are supposed to have made.
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
    // castShadow false is not an optimisation here, it is a correctness fix: the
    // light comes from behind this plane, so a backdrop in the light-space depth
    // map would be the nearest occluder for every ray in the hall and put the
    // entire scene in shadow.
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
    l.shadow.normalBias = 0.022
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
        // dark warm stone. Not a mirror, and not black either: a beam has to
        // have somewhere to land, and a pool of light on a floor is half the
        // evidence that the beam is real.
        color: new THREE.Color('#26211c'),
        roughness: 0.86,
        metalness: 0.0,
        envMapIntensity: 0.35,
      }),
    []
  )
  useEffect(() => () => floor.dispose(), [floor])

  return (
    <>
      <color attach="background" args={['#040507']} />

      <hemisphereLight args={['#8b8d94', '#040507', 0.075]} />

      <primitive object={key} />
      <primitive object={key.target} />

      {/* the only other light in the room, and it exists so that the shadowed
          side of the vessel is a form rather than a hole */}
      <directionalLight position={[-7.0, 3.4, 5.0]} intensity={0.16} color="#93b0d4" />

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
