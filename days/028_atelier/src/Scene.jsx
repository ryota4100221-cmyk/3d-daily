import { useMemo, useRef, useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { RoundedBox } from '@react-three/drei'
import { makeStudioEnvironment } from './env.js'

/* --- lathe profiles ------------------------------------------------------
 * Every vessel is a spline revolved around Y. Control points are authored as
 * (radius, height); the spline smooths them into a continuous silhouette, so a
 * dozen numbers describe a piece of porcelain. Profiles start and end near
 * radius 0 so each form closes into a solid — clean normals for the G-buffer.
 * -------------------------------------------------------------------- */
function lathe(controls, segments = 128, samples = 96) {
  const curve = new THREE.SplineCurve(controls.map(([x, y]) => new THREE.Vector2(x, y)))
  const pts = curve.getPoints(samples)
  const geo = new THREE.LatheGeometry(pts, segments)
  geo.computeVertexNormals()
  return geo
}

const BOTTLE = [
  [0.001, 0.0], [0.20, 0.0], [0.33, 0.05], [0.385, 0.20], [0.36, 0.42],
  [0.24, 0.68], [0.135, 0.92], [0.118, 1.10], [0.155, 1.22], [0.150, 1.27],
  [0.10, 1.28], [0.001, 1.275],
]

const JAR = [
  [0.001, 0.0], [0.24, 0.0], [0.42, 0.06], [0.505, 0.24], [0.47, 0.46],
  [0.36, 0.60], [0.285, 0.66], [0.275, 0.70], [0.20, 0.715], [0.001, 0.71],
]

const OVOID = [
  [0.001, 0.0], [0.12, 0.0], [0.205, 0.07], [0.235, 0.19], [0.195, 0.33],
  [0.115, 0.41], [0.001, 0.435],
]

const PEBBLE = [
  [0.001, 0.0], [0.14, 0.005], [0.20, 0.055], [0.185, 0.13], [0.11, 0.18],
  [0.001, 0.195],
]

/* --- the sky / room wash rendered *inside* the beauty pass ---------------
 * Drawing the background as scene geometry (rather than compositing it in
 * later) means object silhouettes resolve against it with the beauty buffer's
 * MSAA instead of a hard 1-bit mask. It is hidden during the G-buffer prepass
 * so it never writes normals or depth.
 * -------------------------------------------------------------------- */
function SkyQuad() {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        depthTest: false,
        depthWrite: false,
        uniforms: { uAspect: { value: 1.6 } },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() { vUv = uv; gl_Position = vec4(position.xy, 1.0, 1.0); }
        `,
        fragmentShader: /* glsl */ `
          uniform float uAspect;
          varying vec2 vUv;
          void main() {
            vec3 top = vec3(0.905, 0.881, 0.836);
            vec3 bottom = vec3(0.760, 0.729, 0.686);
            vec3 c = mix(bottom, top, smoothstep(0.0, 0.95, vUv.y));
            float glow = exp(-pow(distance(vUv * vec2(uAspect, 1.0),
                                           vec2(0.30 * uAspect, 0.82)) * 1.35, 2.0));
            c += vec3(0.10, 0.088, 0.072) * glow;
            gl_FragColor = vec4(c, 1.0);
          }
        `,
      }),
    []
  )
  const size = useThree((s) => s.size)
  mat.uniforms.uAspect.value = size.width / Math.max(1, size.height)

  return (
    <mesh name="sky-quad" material={mat} frustumCulled={false} renderOrder={-1000}>
      <planeGeometry args={[2, 2]} />
    </mesh>
  )
}

export default function Scene() {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)

  // hand-painted IBL, generated once
  const envMap = useMemo(() => makeStudioEnvironment(gl), [gl])
  useEffect(() => {
    scene.environment = envMap
    scene.environmentIntensity = 1.0
    return () => {
      scene.environment = null
      envMap.dispose()
    }
  }, [scene, envMap])

  const geos = useMemo(
    () => ({
      bottle: lathe(BOTTLE),
      jar: lathe(JAR),
      ovoid: lathe(OVOID),
      pebble: lathe(PEBBLE),
    }),
    []
  )
  useEffect(() => () => Object.values(geos).forEach((g) => g.dispose()), [geos])

  const key = useRef()
  useEffect(() => {
    if (!key.current) return
    const c = key.current.shadow.camera
    c.left = -6
    c.right = 6
    c.top = 6
    c.bottom = -6
    c.near = 1
    c.far = 22
    c.updateProjectionMatrix()
  }, [])

  const porcelain = {
    color: '#f0ebe1',
    roughness: 0.44,
    metalness: 0,
    clearcoat: 0.42,
    clearcoatRoughness: 0.52,
    envMapIntensity: 1.0,
  }

  return (
    <>
      <SkyQuad />

      {/* one hard key with a real shadow map, one broad fill; everything else
          is the procedural environment map */}
      <directionalLight
        ref={key}
        position={[-4.4, 6.2, 3.6]}
        intensity={1.45}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0008}
        shadow-normalBias={0.022}
      />
      <directionalLight position={[5.2, 2.4, -2.6]} intensity={0.2} color="#dfe6f2" />
      <ambientLight intensity={0.05} />

      {/* studio: floor + cyclorama wall. The corner between them is where the
          screen-space occlusion earns its keep. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[40, 40]} />
        <meshStandardMaterial color="#ddd5c6" roughness={0.92} metalness={0} />
      </mesh>
      <mesh position={[0, 7, -3.1]} receiveShadow>
        <planeGeometry args={[40, 18]} />
        <meshStandardMaterial color="#e7e0d2" roughness={0.95} metalness={0} />
      </mesh>

      {/* the plinth */}
      <RoundedBox
        args={[3.05, 0.34, 1.42]}
        radius={0.022}
        smoothness={5}
        position={[0.12, 0.17, 0]}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial color="#cfc6b4" roughness={0.78} metalness={0} />
      </RoundedBox>

      {/* the still life — deliberately motionless; only the camera breathes */}
      <group position={[0, 0.34, 0]}>
        <mesh geometry={geos.bottle} position={[-0.68, 0, -0.06]} castShadow receiveShadow>
          <meshPhysicalMaterial {...porcelain} />
        </mesh>

        <mesh geometry={geos.jar} position={[0.22, 0, 0.14]} rotation={[0, 0.4, 0]} castShadow receiveShadow>
          <meshPhysicalMaterial {...porcelain} color="#eae3d6" roughness={0.55} clearcoat={0.18} />
        </mesh>

        <mesh geometry={geos.ovoid} position={[1.02, 0, 0.02]} castShadow receiveShadow>
          <meshPhysicalMaterial
            color="#c05f39"
            roughness={0.52}
            metalness={0}
            clearcoat={0.3}
            clearcoatRoughness={0.6}
            envMapIntensity={0.9}
          />
        </mesh>

        <mesh geometry={geos.pebble} position={[1.30, 0, 0.36]} rotation={[0, 0.9, 0]} castShadow receiveShadow>
          <meshPhysicalMaterial {...porcelain} roughness={0.62} clearcoat={0.1} />
        </mesh>

        {/* a standing ring: pure silhouette, and the piece the contour pass
            renders best */}
        <mesh position={[-1.24, 0.415, 0.18]} rotation={[0, -0.42, 0]} castShadow receiveShadow>
          <torusGeometry args={[0.38, 0.034, 28, 140]} />
          <meshPhysicalMaterial {...porcelain} roughness={0.38} clearcoat={0.5} />
        </mesh>
      </group>
    </>
  )
}
