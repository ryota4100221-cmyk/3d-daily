import { useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { field, N, SPAN, SEA, sunDir, sunElevationDeg } from './rig.js'

// ── the baked field, shared by the terrain and the cloud lid ────────────────
function useFieldTexture() {
  return useMemo(() => {
    const tex = new THREE.DataTexture(field, N, N, THREE.RedFormat, THREE.FloatType)
    tex.minFilter = tex.magFilter = THREE.NearestFilter
    tex.needsUpdate = true
    return tex
  }, [])
}

const COMMON = /* glsl */ `
uniform sampler2D uField;
uniform vec3 uSun;
uniform float uElev;   // degrees
uniform float uLid;
const float N = ${N.toFixed(1)};
const float SPAN = ${SPAN.toFixed(1)};

float hField(vec2 p) {
  vec2 f = (p + SPAN * 0.5) / SPAN * (N - 1.0);
  if (f.x < 0.0 || f.y < 0.0 || f.x > N - 1.0 || f.y > N - 1.0) return ${SEA.toFixed(1)};
  vec2 i = floor(f); vec2 u = f - i;
  float a = texture2D(uField, (i + vec2(0.5, 0.5)) / N).r;
  float b = texture2D(uField, (i + vec2(1.5, 0.5)) / N).r;
  float c = texture2D(uField, (i + vec2(0.5, 1.5)) / N).r;
  float d = texture2D(uField, (i + vec2(1.5, 1.5)) / N).r;
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// march toward the sun over the field: 1 = lit, 0 = in the island's shadow
float sunVis(vec3 p) {
  float res = 1.0;
  float t = 0.15;
  for (int k = 0; k < 72; k++) {
    vec3 q = p + uSun * t;
    if (q.y > 9.0) break;
    if (abs(q.x) > SPAN * 0.5 || abs(q.z) > SPAN * 0.5) {
      // left the field; if heading away from it, nothing can shade us
      if (dot(q.xz, uSun.xz) > 0.0) break;
    }
    float d = q.y - hField(q.xz);
    res = min(res, 9.0 * d / t);
    if (res < 0.0) break;
    t += max(0.25, t * 0.045);
  }
  return clamp(res, 0.0, 1.0);
}

vec3 sunColor() {
  float k = smoothstep(0.0, 11.0, uElev);
  return mix(vec3(1.0, 0.42, 0.20) * 2.2, vec3(1.0, 0.86, 0.70) * 2.6, k);
}
vec3 skyAt(vec3 dir) {
  float k = smoothstep(0.0, 11.0, uElev);
  vec3 zen = mix(vec3(0.012, 0.022, 0.075), vec3(0.08, 0.13, 0.28), k);
  vec3 hor = mix(vec3(0.86, 0.52, 0.42), vec3(0.88, 0.76, 0.70), k);
  float y = max(dir.y, 0.0);
  vec3 c = mix(hor, zen, pow(y, 0.2));
  // the band of dawn along the horizon, strongest toward the sun's azimuth
  float az = max(dot(normalize(dir.xz + 1e-5), normalize(uSun.xz)), 0.0);
  c += sunColor() * 0.16 * pow(az, 3.0) * exp(-y * 9.0);
  float s = max(dot(normalize(dir), uSun), 0.0);
  c += sunColor() * (pow(s, 900.0) * 6.0 + pow(s, 24.0) * 0.30 + pow(s, 4.0) * 0.10);
  return c;
}
vec3 finish(vec3 c) {
  c = c / (1.0 + c * 0.55);           // soft shoulder
  return pow(max(c, 0.0), vec3(1.0 / 2.2));
}
`

function useUniforms(tex) {
  return useMemo(
    () => ({
      uField: { value: tex },
      uSun: { value: new THREE.Vector3(-0.8, 0.05, -0.5) },
      uElev: { value: 3 },
      uLid: { value: 4.7 },
      uTime: { value: 0 },
    }),
    [tex]
  )
}

// ── sky dome ────────────────────────────────────────────────────────────────
function Sky({ uniforms }) {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms,
        side: THREE.BackSide,
        depthWrite: false,
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = position;
            vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            gl_Position = p.xyww;
          }`,
        fragmentShader: COMMON + /* glsl */ `
          varying vec3 vDir;
          void main() { gl_FragColor = vec4(finish(skyAt(normalize(vDir))), 1.0); }`,
      }),
    [uniforms]
  )
  return <mesh material={mat} renderOrder={-1} frustumCulled={false}><sphereGeometry args={[900, 48, 24]} /></mesh>
}

// ── the island ──────────────────────────────────────────────────────────────
function Island({ uniforms }) {
  const geo = useMemo(() => {
    const g = new THREE.PlaneGeometry(SPAN, SPAN, N - 1, N - 1)
    g.rotateX(-Math.PI / 2)
    const pos = g.attributes.position
    // after rotateX(−90°) row r sits at z = −SPAN/2 + r·step, i.e. row = field j
    for (let k = 0; k < pos.count; k++) {
      const i = k % N, j = (k / N) | 0
      pos.setY(k, field[j * N + i])
    }
    g.computeVertexNormals()
    return g
  }, [])
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms,
        vertexShader: /* glsl */ `
          varying vec3 vP; varying vec3 vN;
          void main() {
            vP = (modelMatrix * vec4(position, 1.0)).xyz;
            vN = normal;
            gl_Position = projectionMatrix * viewMatrix * vec4(vP, 1.0);
          }`,
        fragmentShader: COMMON + /* glsl */ `
          varying vec3 vP; varying vec3 vN;
          void main() {
            vec3 n = normalize(vN);
            float slope = 1.0 - n.y;
            // laurel-dark forest on the flats, wet rock on the walls
            vec3 alb = mix(vec3(0.075, 0.115, 0.080), vec3(0.17, 0.15, 0.14), smoothstep(0.25, 0.6, slope));
            float lit = max(dot(n, uSun), 0.0) * sunVis(vP + n * 0.05);
            vec3 amb = mix(vec3(0.50, 0.36, 0.36), vec3(0.14, 0.19, 0.34), 0.5 + 0.5 * n.y) * 0.45;
            vec3 c = alb * (sunColor() * lit + amb);
            // the lid is not a knife: the last ~40 m above it sink into vapour
            float wet = smoothstep(uLid + 0.55, uLid - 0.05, vP.y);
            vec3 vap = mix(vec3(0.80, 0.68, 0.70), sunColor() * 0.55, 0.25);
            c = mix(c, vap, wet * 0.85);
            vec3 V = normalize(vP - cameraPosition);
            c = mix(c, skyAt(vec3(V.x, 0.02, V.z)), 1.0 - exp(-length(vP - cameraPosition) / 420.0));
            gl_FragColor = vec4(finish(c), 1.0);
          }`,
      }),
    [uniforms]
  )
  return <mesh geometry={geo} material={mat} />
}

// ── the cloud lid ───────────────────────────────────────────────────────────
function CloudSea({ uniforms }) {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms,
        side: THREE.DoubleSide,
        vertexShader: /* glsl */ `
          uniform float uLid;
          varying vec3 vP;
          void main() {
            // the plane is authored in xy; lay it flat at the lid ourselves
            vP = vec3(position.x, uLid, -position.y);
            gl_Position = projectionMatrix * viewMatrix * vec4(vP, 1.0);
          }`,
        fragmentShader: COMMON + /* glsl */ `
          uniform float uTime;
          varying vec3 vP;
          float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
          float vn(vec2 p) {
            vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
            return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y);
          }
          // billows: rounded tops, creased valleys
          float billow(vec2 p, float oct) {
            float s = 0.0, a = 0.55, f = 1.0;
            for (int o = 0; o < 6; o++) {
              if (float(o) >= oct) break;
              s += a * (1.0 - abs(vn(p * f) * 2.0 - 1.0));
              a *= 0.48; f *= 2.07;
              p += vec2(3.1, -1.7);
            }
            return s;
          }
          void main() {
            vec2 drift = vec2(uTime * 0.035, uTime * 0.012);
            vec2 q = vP.xz * 0.11 + drift;
            float dist = length(vP - cameraPosition);
            float oct = clamp(6.0 - log2(1.0 + dist / 45.0) * 1.4, 1.0, 6.0);
            float amp = 0.9 / (1.0 + dist / 120.0);
            float e = 0.03;
            float h0 = billow(q, oct);
            float hx = billow(q + vec2(e, 0.0), oct);
            float hz = billow(q + vec2(0.0, e), oct);
            vec3 n = normalize(vec3(-(hx - h0) / e * amp * 0.11, 1.0, -(hz - h0) / e * amp * 0.11));

            // where the lid meets a cliff it piles up and brightens
            float hT = hField(vP.xz);
            float pile = smoothstep(-0.9, 0.0, hT - uLid) * step(0.0, hT);

            vec3 P = vP + vec3(0.0, (h0 - 0.5) * amp, 0.0);
            float vis = sunVis(P + vec3(0.0, 0.05, 0.0));
            float lam = max(dot(n, uSun) + 0.22, 0.0) / 1.22;
            vec3 amb = mix(vec3(0.42, 0.30, 0.40), vec3(0.22, 0.28, 0.50), 0.5 + 0.5 * n.y) * 0.75;
            vec3 alb = vec3(0.92, 0.90, 0.93);
            vec3 c = alb * (sunColor() * lam * vis * (0.55 + 0.45 * h0) + amb);
            // in the island's shadow the lid is lit by the sky only, cold
            c += pile * vec3(0.10, 0.08, 0.09);
            vec3 V = normalize(vP - cameraPosition);
            c = mix(c, skyAt(vec3(V.x, 0.012, V.z)), 1.0 - exp(-dist / 380.0));
            gl_FragColor = vec4(finish(c), 1.0);
          }`,
      }),
    [uniforms]
  )
  return (
    <mesh material={mat} frustumCulled={false}>
      <planeGeometry args={[2400, 2400, 1, 1]} />
    </mesh>
  )
}

export default function Scene({ state }) {
  const tex = useFieldTexture()
  const uniforms = useUniforms(tex)
  const { camera, size } = useThree()
  const sd = useMemo(() => [0, 0, 0], [])

  useFrame((_, dt) => {
    const s = state.current
    sunDir(s.t, sd)
    uniforms.uSun.value.set(sd[0], sd[1], sd[2])
    uniforms.uElev.value = sunElevationDeg(s.t)
    uniforms.uLid.value = s.H
    uniforms.uTime.value = s.t
    // a very slow aerial drift — the source is a drone shot
    const a = 0.10 * Math.sin((2 * Math.PI * s.t) / 90)
    const narrow = size.width < size.height
    const R = narrow ? 104 : 72
    camera.position.set(Math.sin(0.42 + a) * R, narrow ? 24 : 13.5, Math.cos(0.42 + a) * R)
    camera.lookAt(narrow ? 2 : -12, 8.5, 0)
  })

  return (
    <>
      <Sky uniforms={uniforms} />
      <CloudSea uniforms={uniforms} />
      <Island uniforms={uniforms} />
    </>
  )
}
