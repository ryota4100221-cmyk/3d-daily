import { useMemo, useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { makeStudioEnvironment } from './env.js'
import { SKY, SKY_GLSL, skyUniforms } from './palette.js'

/**
 * The room the rig turns in: two lights, a backdrop, and a lacquer plate.
 *
 * The plate is the one surface flagged `matId: 1`. In the beauty pass it is
 * painted almost black on purpose — everything that reads as polish is added
 * later by the reflection pass (the argument Day 029 made about water, kept,
 * because it is still true and now it has moving things to carry).
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
            // vertical slots, because a horizontal mirror turns a vertical slot
            // into a streak that runs toward the viewer
            gl_FragColor = vec4(skyAt(vP), 1.0);
          }
        `,
      }),
    []
  )
  useEffect(() => () => mat.dispose(), [mat])
  return (
    <mesh position={[0, 7, SKY.wallZ]} material={mat}>
      <planeGeometry args={[78, 34]} />
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

  const plate = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: new THREE.Color('#05070b'),
        roughness: 0.34,
        metalness: 0.0,
        envMapIntensity: 0.10,
      }),
    []
  )
  useEffect(() => () => plate.dispose(), [plate])

  return (
    <>
      <color attach="background" args={['#05070a']} />

      <hemisphereLight args={['#8f9db0', '#05070a', 0.09]} />

      {/* key: narrow and high on the right, aligned with the panel painted into
          the environment map so the specular line and the diffuse form agree */}
      <directionalLight
        position={[5.0, 7.4, 3.2]}
        intensity={2.35}
        color="#fff5e8"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0008}
        shadow-normalBias={0.02}
      >
        <orthographicCamera attach="shadow-camera" args={[-7, 7, 7, -7, 0.5, 26]} />
      </directionalLight>

      {/* the warm slot standing behind the piece, as a light rather than a wall */}
      <directionalLight position={[4.6, 1.1, -8.0]} intensity={0.62} color="#ffb37a" />
      <directionalLight position={[-6.0, 2.0, 2.0]} intensity={0.24} color="#8fb2d8" />

      <Backdrop />

      {/* the plate — flat, still, and the only surface flagged for reflection */}
      <mesh
        rotation-x={-Math.PI / 2}
        position={[0, 0, 0]}
        material={plate}
        receiveShadow
        userData={{ matId: 1 }}
      >
        <planeGeometry args={[320, 320]} />
      </mesh>

      {/* the kinetic rig: built imperatively so that "where was this last
          frame" is a property of the object graph, not of a React render */}
      <primitive object={rig.group} />
    </>
  )
}
