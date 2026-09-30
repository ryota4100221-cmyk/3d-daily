import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import {
  OBLATE, RING_IN, RING_OUT, RING_K, TAU_GLSL, SLAB_GLSL,
  sunDir, CAM_EL, CAM_DIST,
} from './rig.js'

const ELLIPSOID_GLSL = /* glsl */ `
uniform float uOblate;
// Distance of closest approach of the ray o + s·d (s > 0) to the planet centre,
// measured in the space where the ellipsoid is the unit sphere. < 1 = blocked.
float planetBlock(vec3 o, vec3 d) {
  vec3 q = o / vec3(1.0, uOblate, 1.0);
  vec3 e = d / vec3(1.0, uOblate, 1.0);
  float s = -dot(q, e) / dot(e, e);
  if (s <= 0.0) return 10.0;
  return length(q + s * e);
}
`

const planetVert = /* glsl */ `
varying vec3 vPos;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vPos = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`

const planetFrag = /* glsl */ `
uniform vec3 uSun;
uniform float uOblate;
uniform float uRingK;
varying vec3 vPos;
${TAU_GLSL}

void main() {
  vec3 n = normalize(vec3(vPos.x, vPos.y / (uOblate * uOblate), vPos.z));
  vec3 V = normalize(cameraPosition - vPos);
  float lat = asin(clamp(vPos.y / uOblate, -1.0, 1.0));

  // belts and zones: pale sand, with a cold cap at the poles
  float b = 0.5 + 0.5 * sin(lat * 21.0 + 0.7 * sin(lat * 6.0));
  float fine = 0.5 + 0.5 * sin(lat * 83.0 + 1.7);
  vec3 zone = vec3(0.93, 0.86, 0.70);
  vec3 belt = vec3(0.78, 0.66, 0.50);
  vec3 alb = mix(zone, belt, b * 0.55 + fine * 0.12);
  alb = mix(alb, vec3(0.62, 0.66, 0.68), smoothstep(1.0, 1.35, abs(lat)));
  alb *= 0.78;

  float mu0 = dot(n, uSun);
  float lambert = max(mu0, 0.0);
  lambert *= smoothstep(-0.02, 0.06, mu0);
  float mu = max(dot(n, V), 0.0);
  float limb = 0.30 + 0.70 * pow(mu, 0.45);

  // the rings' shadow: walk toward the Sun until the ring plane, read tau there
  float T = 1.0;
  if (abs(uSun.y) > 1e-5) {
    float s = -vPos.y / uSun.y;
    if (s > 0.0) {
      vec3 h = vPos + s * uSun;
      float r = length(h.xz);
      T = exp(-ringTau(r) / abs(uSun.y));
    }
  }

  vec3 c = alb * lambert * limb * T * 1.35;
  // the faintest glow of the ring-lit night side, so the disc never vanishes
  c += vec3(0.0022, 0.0026, 0.0036) * limb;
  c = pow(c, vec3(1.0 / 2.2));
  gl_FragColor = vec4(c, 1.0);
}
`

const ringVert = planetVert

const ringFrag = /* glsl */ `
uniform vec3 uSun;
uniform float uRingK;
varying vec3 vPos;
${TAU_GLSL}
${SLAB_GLSL}
${ELLIPSOID_GLSL}

void main() {
  float r = length(vPos.xz);
  // the profile has structure far finer than a pixel: average it across the
  // pixel's radial footprint instead of point-sampling it (moire otherwise)
  float fw = max(fwidth(r), 1e-5);
  float tau = 0.0;
  for (int k = 0; k < 8; k++) tau += ringTau(r + fw * ((float(k) + 0.5) / 8.0 - 0.5) * 1.5);
  tau /= 8.0;
  vec3 V = normalize(cameraPosition - vPos);
  float mu = max(abs(V.y), 1e-3);
  float mu0 = abs(uSun.y);
  bool sameSide = sign(uSun.y) == sign(V.y);

  float alpha = 1.0 - exp(-tau / mu);
  float I = 0.0;
  if (mu0 > 1e-6) I = uRingK * (sameSide ? slabLit(tau, mu0, mu) : slabUnlit(tau, mu0, mu));

  // the planet's shadow across the sheet
  float h = planetBlock(vPos, uSun);
  I *= smoothstep(0.985, 1.012, h);

  // ice is a touch warmer where it is thick, greyer in the C ring
  vec3 tint = mix(vec3(0.80, 0.80, 0.82), vec3(1.0, 0.90, 0.74), smoothstep(0.3, 1.5, tau));
  vec3 c = pow(I * tint * 1.6, vec3(1.0 / 2.2));
  // premultiplied: c is emitted light, alpha is what the sheet hides behind it
  gl_FragColor = vec4(c, alpha);
}
`

function Planet({ uniforms }) {
  return (
    <mesh scale={[1, OBLATE, 1]} renderOrder={0}>
      <sphereGeometry args={[1, 192, 128]} />
      <shaderMaterial vertexShader={planetVert} fragmentShader={planetFrag} uniforms={uniforms} />
    </mesh>
  )
}

function Rings({ uniforms }) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={1}>
      <ringGeometry args={[RING_IN, RING_OUT, 720, 1]} />
      <shaderMaterial
        vertexShader={ringVert}
        fragmentShader={ringFrag}
        uniforms={uniforms}
        side={THREE.DoubleSide}
        transparent
        depthWrite={false}
        blending={THREE.CustomBlending}
        blendSrc={THREE.OneFactor}
        blendDst={THREE.OneMinusSrcAlphaFactor}
      />
    </mesh>
  )
}

function Stars() {
  const geo = useMemo(() => {
    let seed = 91
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    const n = 1400
    const pos = new Float32Array(n * 3)
    const col = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      const z = rnd() * 2 - 1
      const a = rnd() * Math.PI * 2
      const s = Math.sqrt(1 - z * z)
      pos.set([s * Math.cos(a) * 300, z * 300, s * Math.sin(a) * 300], i * 3)
      const k = Math.pow(rnd(), 3) * 0.55 + 0.05
      col.set([k * 0.9, k * 0.95, k], i * 3)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('color', new THREE.BufferAttribute(col, 3))
    return g
  }, [])
  return (
    <points geometry={geo} renderOrder={-1}>
      <pointsMaterial size={1.4} sizeAttenuation={false} vertexColors depthWrite={false} />
    </points>
  )
}

export default function Scene({ clock }) {
  const { camera } = useThree()
  const uniforms = useMemo(
    () => ({
      uSun: { value: new THREE.Vector3(...sunDir(clock.year)) },
      uOblate: { value: OBLATE },
      uRingK: { value: RING_K },
    }),
    []
  )
  const placed = useRef(false)

  useFrame((_, dt) => {
    if (!placed.current) {
      // telephoto from 13° above the ring plane; the frame is rolled a little
      // so the ring plane reads as a slow diagonal, not a horizon
      const az = 0.0
      camera.position.set(
        Math.sin(az) * Math.cos(CAM_EL) * CAM_DIST,
        Math.sin(CAM_EL) * CAM_DIST,
        Math.cos(az) * Math.cos(CAM_EL) * CAM_DIST
      )
      const roll = -0.16
      camera.up.set(Math.sin(roll), Math.cos(roll), 0)
      camera.lookAt(-0.9, 0.0, 0)
      camera.updateProjectionMatrix()
      placed.current = true
    }
    clock.tick(Math.min(dt, 0.1))
    uniforms.uSun.value.set(...sunDir(clock.year))
  })

  return (
    <>
      <Stars />
      <Planet uniforms={uniforms} />
      <Rings uniforms={uniforms} />
    </>
  )
}
