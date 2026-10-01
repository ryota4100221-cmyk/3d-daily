import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { buildRuns, voiceGLSL, pose, SPAN, SPEED, DMAX } from './rig.js'

const vert = /* glsl */ `
  attribute vec4 aRun;   // x, y, w, h  (em)
  attribute float aU;    // 0..1 across the slab = position in the utterance
  uniform float uOff;    // audio seconds elapsed
  varying float vBack;   // how far behind the face this fragment is, /DMAX
  varying vec3 vN;
  ${voiceGLSL}
  void main(){
    float s = aU*${SPAN.toFixed(2)} + uOff;
    float d = 0.035 + ${DMAX.toFixed(3)} * loudness(s);
    vec3 p = position;
    float back = 0.5 - p.z;              // 0 at the face, 1 at the tail
    vec3 w = vec3(aRun.x + p.x*aRun.z*1.004, aRun.y + p.y*aRun.w, -back*d);
    vBack = back*d / ${DMAX.toFixed(3)};
    vN = normal;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(w, 1.0);
  }
`

const frag = /* glsl */ `
  varying float vBack;
  varying vec3 vN;
  void main(){
    float v;
    if (vN.z > 0.5) {
      v = 0.055;                                   // the face: ink
    } else if (vN.z < -0.5) {
      v = 0.80 + 0.12*vBack;                        // tail cap
    } else {
      // the walls fade from ink to paper as they go back, like a voice dying out
      v = mix(0.13, 0.965, pow(clamp(vBack,0.0,1.0), 0.62));
      v += vN.y > 0.5 ? 0.075 : (vN.y < -0.5 ? -0.05 : (vN.x > 0.5 ? 0.0 : -0.035));
    }
    gl_FragColor = vec4(vec3(v) * vec3(1.0, 0.996, 0.988), 1.0);
  }
`

export default function Scene({ progress, onReady, hud }) {
  const [slab, setSlab] = useState(null)
  const mesh = useRef()
  const cam = useThree((s) => s.camera)
  const size = useThree((s) => s.size)
  const smooth = useRef(progress.current)

  useEffect(() => {
    buildRuns(import.meta.env.BASE_URL + 'sans.ttf').then((r) => {
      setSlab(r)
      onReady?.(r)
    })
  }, [])

  const { geom, mat } = useMemo(() => {
    if (!slab) return {}
    const n = slab.runs.length
    const g = new THREE.InstancedBufferGeometry()
    const box = new THREE.BoxGeometry(1, 1, 1)
    g.index = box.index
    g.setAttribute('position', box.getAttribute('position'))
    g.setAttribute('normal', box.getAttribute('normal'))
    const run = new Float32Array(n * 4)
    const u = new Float32Array(n)
    slab.runs.forEach((r, i) => {
      run.set(r.slice(0, 4), i * 4)
      u[i] = r[4]
    })
    g.setAttribute('aRun', new THREE.InstancedBufferAttribute(run, 4))
    g.setAttribute('aU', new THREE.InstancedBufferAttribute(u, 1))
    g.instanceCount = n
    const m = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: { uOff: { value: 0 } },
    })
    return { geom: g, mat: m }
  }, [slab])

  useFrame((state, dt) => {
    smooth.current += (progress.current - smooth.current) * Math.min(1, dt * 4.5)
    const p = smooth.current
    const { az, el } = pose(p)
    const target = new THREE.Vector3(0, 0, -DMAX * 0.3 * Math.min(1, p * 2))
    const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el))
    cam.position.copy(target).addScaledVector(dir, 30)
    cam.up.set(0, 1, 0)
    cam.lookAt(target)
    if (slab) {
      const z = Math.min((size.width * 0.64) / slab.width, (size.height * 0.6) / slab.height)
      if (Math.abs(cam.zoom - z) > 1e-3) {
        cam.zoom = z
        cam.updateProjectionMatrix()
      }
    }
    const off = state.clock.elapsedTime * SPEED
    if (mat) mat.uniforms.uOff.value = off
    hud?.(p, off)
  })

  if (!geom) return null
  return <mesh ref={mesh} geometry={geom} material={mat} frustumCulled={false} />
}
