import { useMemo, useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { makeStudioEnvironment } from './env.js'
import { SKY, SKY_GLSL, skyUniforms } from './palette.js'

/**
 * The still life.
 *
 * Everything here is deliberately *static*. The reflection buffer in
 * Pipeline.jsx is reprojected through motion vectors that assume a fixed world
 * and a moving camera; the moment a form drifted, its history would smear. So
 * the piece keeps still and lets the camera do the breathing — which is also
 * the only way a basin reads as still water.
 */

// A profile of [radius, height] control points, smoothed and revolved. Designing
// a vessel becomes designing a curve — ten numbers instead of a model.
function lathe(profile, segments = 128) {
  const curve = new THREE.SplineCurve(profile.map(([x, y]) => new THREE.Vector2(x, y)))
  const g = new THREE.LatheGeometry(curve.getPoints(96), segments)
  g.computeVertexNormals()
  return g
}

const BOTTLE = [
  [0.0, 0.0], [0.30, 0.005], [0.345, 0.055], [0.365, 0.26], [0.335, 0.60],
  [0.235, 0.95], [0.140, 1.24], [0.100, 1.48], [0.104, 1.74], [0.132, 1.88],
  [0.118, 1.955], [0.0, 1.97],
]

const PEBBLE = [
  [0.0, 0.0], [0.34, 0.004], [0.50, 0.05], [0.565, 0.17], [0.575, 0.31],
  [0.52, 0.43], [0.40, 0.50], [0.22, 0.535], [0.0, 0.542],
]

const VASE = [
  [0.0, 0.0], [0.24, 0.004], [0.295, 0.07], [0.310, 0.30], [0.268, 0.56],
  [0.198, 0.82], [0.172, 1.00], [0.192, 1.09], [0.150, 1.145], [0.0, 1.155],
]

function Backdrop() {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: skyUniforms(THREE),
        vertexShader: /* glsl */ `
          varying float vY;
          void main() {
            vec4 world = modelMatrix * vec4(position, 1.0);
            vY = world.y;
            gl_Position = projectionMatrix * viewMatrix * world;
          }
        `,
        fragmentShader: /* glsl */ `
          precision highp float;
          ${SKY_GLSL}
          varying float vY;
          void main() {
            // a warm bar sits on the waterline; the basin carries it back
            // across the bottom of the frame
            gl_FragColor = vec4(skyAtHeight(vY), 1.0);
          }
        `,
      }),
    []
  )
  useEffect(() => () => mat.dispose(), [mat])
  return (
    <mesh position={[0, 7, SKY.wallZ]} material={mat}>
      <planeGeometry args={[76, 34]} />
    </mesh>
  )
}

export default function Scene() {
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

  const geo = useMemo(
    () => ({ bottle: lathe(BOTTLE), pebble: lathe(PEBBLE), vase: lathe(VASE) }),
    []
  )
  useEffect(() => () => Object.values(geo).forEach((g) => g.dispose()), [geo])

  const porcelain = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        color: new THREE.Color('#efe8dc'),
        roughness: 0.34,
        metalness: 0.0,
        clearcoat: 0.55,
        clearcoatRoughness: 0.26,
        envMapIntensity: 0.72,
      }),
    []
  )
  const shadowed = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        color: new THREE.Color('#e4dccf'),
        roughness: 0.52,
        metalness: 0.0,
        envMapIntensity: 0.66,
      }),
    []
  )
  const terracotta = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        color: new THREE.Color('#a3573d'),
        roughness: 0.50,
        metalness: 0.0,
        clearcoat: 0.3,
        envMapIntensity: 0.9,
      }),
    []
  )
  // The basin itself is almost black in the beauty pass on purpose: everything
  // you will read as "water" is added later, by the reflection buffer.
  const water = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: new THREE.Color('#070910'),
        roughness: 0.40,
        metalness: 0.0,
        envMapIntensity: 0.10,
      }),
    []
  )
  useEffect(
    () => () => [porcelain, shadowed, terracotta, water].forEach((m) => m.dispose()),
    [porcelain, shadowed, terracotta, water]
  )

  return (
    <>
      <color attach="background" args={['#191d24']} />

      <hemisphereLight args={['#aab6c6', '#0d1016', 0.13]} />
      <directionalLight
        position={[-5.4, 7.2, 3.4]}
        intensity={2.05}
        color="#fff3e2"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0008}
        shadow-normalBias={0.02}
      >
        <orthographicCamera attach="shadow-camera" args={[-7, 7, 7, -7, 0.5, 26]} />
      </directionalLight>
      <directionalLight position={[4.8, 2.4, -6.0]} intensity={0.42} color="#9fb4cc" />

      <Backdrop />

      {/* the basin — flat, still, and the only surface flagged for reflection */}
      <mesh
        rotation-x={-Math.PI / 2}
        position={[0, 0, 0]}
        material={water}
        receiveShadow
        userData={{ water: true }}
      >
        <planeGeometry args={[300, 300]} />
      </mesh>

      {/* the still life lives right of centre — the left third of the frame is
          left to the water and the type */}
      <mesh
        geometry={geo.bottle}
        material={porcelain}
        position={[-0.52, -0.02, -1.15]}
        rotation-y={0.4}
        castShadow
        receiveShadow
      />
      <mesh
        geometry={geo.pebble}
        material={shadowed}
        position={[0.96, -0.02, 0.55]}
        rotation-y={-0.8}
        scale={0.84}
        castShadow
        receiveShadow
      />
      <mesh
        geometry={geo.vase}
        material={terracotta}
        position={[2.06, -0.02, -1.65]}
        rotation-y={1.1}
        castShadow
        receiveShadow
      />
      <mesh material={porcelain} position={[0.24, 0.15, 1.72]} castShadow receiveShadow>
        <sphereGeometry args={[0.17, 64, 48]} />
      </mesh>

      {/* two distant columns: their job is to be long verticals in the water */}
      <mesh material={shadowed} position={[3.42, 1.55, -5.0]} castShadow>
        <boxGeometry args={[0.17, 3.1, 0.17]} />
      </mesh>
      <mesh material={shadowed} position={[5.15, 1.12, -8.6]} castShadow>
        <boxGeometry args={[0.15, 2.24, 0.15]} />
      </mesh>
    </>
  )
}
