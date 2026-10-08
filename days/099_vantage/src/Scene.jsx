import { useMemo, useRef, useLayoutEffect } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { buildDots, eyeAt, latticeError } from './rig.js'

// One red, written once. ShaderMaterial skips three's output conversion unless
// asked, so the colour is linearised here and re-encoded by colorspace_fragment.
const RED = new THREE.Color('#e7152d')

const dotVert = /* glsl */ `
  varying vec3 vN;
  varying vec3 vView;
  void main() {
    vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
    vN = normalize(mat3(modelMatrix * instanceMatrix) * normal);
    vView = normalize(cameraPosition - wp.xyz);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`
// Shading depends only on the angle to the eye, never on distance, so from E
// a near dot and a far dot are the same disc. Off E, size is the only tell.
const dotFrag = /* glsl */ `
  uniform vec3 uRed;
  varying vec3 vN;
  varying vec3 vView;
  void main() {
    float f = clamp(dot(normalize(vN), normalize(vView)), 0.0, 1.0);
    vec3 c = uRed * (0.80 + 0.20 * f);
    c *= 1.0 - 0.10 * pow(1.0 - f, 3.0);
    gl_FragColor = vec4(c, 1.0);
    #include <colorspace_fragment>
  }
`

function Dots({ dots }) {
  const ref = useRef()
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uRed: { value: RED.clone() } },
        vertexShader: dotVert,
        fragmentShader: dotFrag,
      }),
    []
  )
  useLayoutEffect(() => {
    const m = new THREE.Matrix4()
    dots.forEach((d, i) => {
      m.makeScale(d.radius, d.radius, d.radius)
      m.setPosition(d.pos[0], d.pos[1], d.pos[2])
      ref.current.setMatrixAt(i, m)
    })
    ref.current.instanceMatrix.needsUpdate = true
  }, [dots])
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, dots.length]} material={mat} frustumCulled={false}>
      <sphereGeometry args={[1, 32, 20]} />
    </instancedMesh>
  )
}

// The lattice at infinity: each node pushed 400 m out along its ray. No
// translation of the eye can move it, which is why it is the reference.
function Ghost({ dots, gref }) {
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry()
    const a = new Float32Array(dots.length * 3)
    dots.forEach((d, i) => {
      a[i * 3] = d.dir[0] * 400
      a[i * 3 + 1] = d.dir[1] * 400
      a[i * 3 + 2] = d.dir[2] * 400
    })
    g.setAttribute('position', new THREE.BufferAttribute(a, 3))
    return g
  }, [dots])
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: { uPx: { value: 9 }, uAlpha: { value: 0.0 } },
        vertexShader: /* glsl */ `
          uniform float uPx;
          void main() {
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = uPx;
          }
        `,
        // a hairline ring: where the dot should be
        fragmentShader: /* glsl */ `
          uniform float uAlpha;
          void main() {
            vec2 p = gl_PointCoord * 2.0 - 1.0;
            float r = length(p);
            float ring = smoothstep(0.62, 0.74, r) * (1.0 - smoothstep(0.86, 0.98, r));
            gl_FragColor = vec4(vec3(0.16, 0.19, 0.21), ring * uAlpha);
          }
        `,
      }),
    []
  )
  return <points ref={gref} geometry={geo} material={mat} renderOrder={-1} />
}

export default function Scene({ pointer, clock, onReadout }) {
  const dots = useMemo(() => buildDots(), [])
  const { camera, size, gl } = useThree()
  const ghostRef = useRef()
  const last = useRef(0)

  useFrame((_, dt) => {
    clock.current.t += clock.current.frozen ? 0 : Math.min(dt, 0.05)
    const p = pointer.current
    p.weight += ((p.active ? 1 : 0) - p.weight) * Math.min(1, dt * 3)
    const { C, yaw, pitch, breath } = eyeAt(clock.current.t, p)
    camera.position.set(C[0], C[1], C[2])
    camera.rotation.set(pitch, yaw, 0, 'YXZ')
    camera.updateMatrixWorld()

    const err = latticeError(dots, C, yaw, pitch)
    // ghost rings only show up once the grid has torn by a fraction of a cell
    const g = ghostRef.current
    if (g) {
      g.material.uniforms.uAlpha.value = THREE.MathUtils.smoothstep(err.rms, 0.04, 0.35) * 0.55
      g.material.uniforms.uPx.value = Math.max(7, (size.height / (2 * Math.tan((camera.fov * Math.PI) / 360))) * 0.0085 * 2.4 * gl.getPixelRatio())
    }
    const now = performance.now()
    if (now - last.current > 90) {
      last.current = now
      onReadout({
        d: Math.hypot(C[0], C[1], C[2]),
        yaw: (yaw * 180) / Math.PI,
        pitch: (pitch * 180) / Math.PI,
        rms: err.rms,
        worst: err.worst,
        breath,
      })
    }
  })

  return (
    <>
      <Ghost dots={dots} gref={ghostRef} />
      <Dots dots={dots} />
    </>
  )
}
