import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { buildWaves, NW, CAM_H, CAM_PITCH, sunDir, coxMunk, RESOLVED_SHARE } from './rig.js'

const SKY = /* glsl */ `
uniform vec3 uSun;
vec3 skyBase(vec3 d) {
  float e = max(d.y, 0.0);
  vec3 hor = vec3(0.96, 0.90, 0.84);   // white haze on the line
  vec3 mid = vec3(0.86, 0.50, 0.33);   // dusk orange
  vec3 zen = vec3(0.09, 0.13, 0.28);   // indigo
  vec3 c = mix(hor, mid, smoothstep(0.0, 0.035, e));
  c = mix(c, zen, smoothstep(0.02, 0.17, e));
  float cs = max(dot(d, uSun), 0.0);
  // away from the sun the band cools toward indigo
  c = mix(c, zen * 1.8 + vec3(0.06, 0.06, 0.09), (1.0 - cs) * 0.9 * (1.0 - smoothstep(0.0, 0.2, e)));
  c += vec3(1.0, 0.50, 0.24) * pow(cs, 14.0) * 0.6;
  return c;
}
vec3 sky(vec3 d) {
  vec3 c = skyBase(d);
  float cs = max(dot(d, uSun), 0.0);
  c += vec3(1.0, 0.68, 0.40) * pow(cs, 220.0) * 1.6;
  c += vec3(1.0, 0.86, 0.66) * smoothstep(0.99975, 0.99988, cs) * 14.0;
  return c;
}
`

const skyVert = /* glsl */ `
varying vec3 vDir;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vDir = wp.xyz - cameraPosition;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`
const skyFrag = /* glsl */ `
varying vec3 vDir;
${SKY}
void main() {
  vec3 d = normalize(vDir);
  gl_FragColor = vec4(sky(d), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

const seaVert = /* glsl */ `
varying vec3 vPos;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`

const seaFrag = /* glsl */ `
#define NW ${NW}
varying vec3 vPos;
uniform vec4 uW[NW];      // dir.x, dir.z, k, ak (for mss = 1)
uniform vec2 uWp[NW];     // omega, phase
uniform float uTime;
uniform float uMss;       // Cox–Munk total
uniform float uFloor;     // capillary share, never resolved
uniform float uHold;      // 1 = drop the statistical term (sparkles only)
${SKY}

void main() {
  vec3 V = cameraPosition - vPos;
  float dist = length(V);
  V /= dist;
  vec2 p = vPos.xz;
  float fp = length(fwidth(p));
  float amp = sqrt(uMss);

  vec2 slope = vec2(0.0);
  float unres = uFloor;             // share of mss the pixel cannot draw
  for (int i = 0; i < NW; i++) {
    vec4 w = uW[i];
    float lambda = 6.2831853 / w.z;
    float r = fp / lambda;
    float x = clamp((r - 0.25) / 0.35, 0.0, 1.0);
    float f = 1.0 - x * x * (3.0 - 2.0 * x);
    float ph = w.z * dot(w.xy, p) - uWp[i].x * uTime + uWp[i].y;
    slope += f * w.w * amp * w.xy * (-sin(ph));
    unres += (1.0 - f * f) * 0.5 * w.w * w.w;   // handed over, not lost
  }
  vec3 n = normalize(vec3(-slope.x, 1.0, -slope.y));

  // per-axis variance of what the pixel could not draw
  float s2 = mix(unres * uMss * 0.5, 2.0e-5, uHold);

  vec3 L = uSun;
  vec3 H = normalize(L + V);
  float cb = max(dot(n, H), 1e-3);
  float t2 = 1.0 / (cb * cb) - 1.0;
  float P = exp(-t2 / (2.0 * s2)) / (6.2831853 * s2);
  float nv = max(dot(n, V), 0.02);
  float vh = clamp(dot(V, H), 0.0, 1.0);
  float F = 0.02 + 0.98 * pow(1.0 - vh, 5.0);
  float glint = F * P / (4.0 * nv * cb * cb * cb * cb);

  vec3 R = reflect(-V, n);
  R.y = abs(R.y);
  float Fv = 0.02 + 0.98 * pow(1.0 - nv, 5.0);
  vec3 deep = vec3(0.020, 0.035, 0.070);
  vec3 col = mix(deep, sky(R), Fv);
  col += vec3(1.0, 0.80, 0.58) * glint * 0.9;

  // haze: the far sea melts into the white line
  float fog = 1.0 - exp(-dist / 20000.0);
  col = mix(col, skyBase(normalize(vec3(-V.x, 0.0, -V.z))), fog);

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

export default function Scene({ state }) {
  const { camera } = useThree()
  const waves = useMemo(() => buildWaves(), [])
  const sun = useMemo(() => new THREE.Vector3(...sunDir()), [])
  const sea = useRef()

  const uniforms = useMemo(
    () => ({
      uSun: { value: sun },
      uW: { value: waves.map((w) => new THREE.Vector4(w.dx, w.dz, w.k, w.ak)) },
      uWp: { value: waves.map((w) => new THREE.Vector2(w.omega, w.phase)) },
      uTime: { value: 0 },
      uMss: { value: coxMunk(7) },
      uFloor: { value: 1 - RESOLVED_SHARE },
      uHold: { value: 0 },
    }),
    [waves, sun]
  )
  const skyUniforms = useMemo(() => ({ uSun: { value: sun } }), [sun])

  useMemo(() => {
    camera.position.set(0, CAM_H, 0)
    camera.rotation.set(CAM_PITCH, 0, 0, 'YXZ')
  }, [camera])

  useFrame((_, dt) => {
    const s = state.current
    uniforms.uTime.value = s.time
    uniforms.uMss.value = coxMunk(s.U)
    uniforms.uHold.value += (s.hold - uniforms.uHold.value) * Math.min(1, dt * 8)
    // tiny drift of the viewer, like a hand-held aerial
    camera.rotation.y = Math.sin(s.time * 0.05) * 0.006
  })

  return (
    <>
      <mesh renderOrder={-1}>
        <sphereGeometry args={[50000, 48, 24]} />
        <shaderMaterial
          vertexShader={skyVert}
          fragmentShader={skyFrag}
          uniforms={skyUniforms}
          side={THREE.BackSide}
          depthWrite={false}
        />
      </mesh>
      <mesh ref={sea} rotation-x={-Math.PI / 2}>
        <planeGeometry args={[60000, 60000, 1, 1]} />
        <shaderMaterial vertexShader={seaVert} fragmentShader={seaFrag} uniforms={uniforms} />
      </mesh>
    </>
  )
}
