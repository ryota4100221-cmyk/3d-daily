import { useMemo, useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { makeStudioEnvironment } from './env.js'
import { SKY, SKY_GLSL, skyUniforms, LIGHT, LAMP, lightPosition } from './palette.js'

/**
 * The hall: one cold key from behind, one warm point light inside the glass, a
 * floor and a wall.
 *
 * The key light is built imperatively rather than declared, because three's
 * shadow camera and the froxel injection's own light camera have to be derived
 * from the same numbers. If they drift apart by a degree, the shafts stop
 * landing on the pools of light they are supposed to have made.
 *
 * The point light is the interesting one. It is here twice: as a three.js light
 * that shades the reeds and the plinth, and as six lines in the injection shader
 * that put its glow in the air. Both read LAMP, so the lamp cannot be one colour
 * on a surface and another in the mist.
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
    // the nearest occluder for every ray in the hall and put the whole scene in
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

  const lamp = useMemo(() => {
    const l = new THREE.PointLight(new THREE.Color(...LAMP.color), LAMP.intensity, LAMP.distance, 2)
    l.position.set(...LAMP.pos)
    l.castShadow = false
    return l
  }, [])
  useEffect(() => () => lamp.dispose(), [lamp])

  const floor = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        // dark cold stone, unpolished. A mirror under a shaft of light doubles
        // the shaft and halves the contrast, and a pool of light on a floor is
        // half the evidence that the shaft is real.
        color: new THREE.Color('#1d2025'),
        roughness: 0.88,
        metalness: 0.0,
        envMapIntensity: 0.32,
      }),
    []
  )
  useEffect(() => () => floor.dispose(), [floor])

  return (
    <>
      <color attach="background" args={['#040507']} />

      <hemisphereLight args={['#8c92a0', '#040507', 0.070]} />

      <primitive object={key} />
      <primitive object={key.target} />
      <primitive object={lamp} />

      {/* the only other light in the room: it exists so the shadowed side of the
          lantern is a form rather than a hole */}
      <directionalLight position={[-7.0, 3.4, 5.0]} intensity={0.14} color="#8fa8cc" />

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
