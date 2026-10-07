import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { GEOM, SPEED, ABBE } from './rig.js'

// ── the wall: horizontal lines of running dashes ─────────────────────────────
// Each dash brightens toward its leading (right-hand) edge, so the direction of
// travel can be read off a still frame. Seen through the tube, that ramp flips.
const STRIPES = /* glsl */ `
  uniform float uTime;
  uniform float uSpeed;
  float hash(float x) { return fract(sin(x * 127.1 + 11.7) * 43758.5453); }
  const vec3 NAVY = vec3(0.039, 0.078, 0.150);
  vec3 wall(vec2 p) {
    float P = 0.085;
    float k = floor(p.y / P);
    float fy = fract(p.y / P);
    float w = mix(0.10, 0.62, pow(hash(k), 1.6));
    float aa = 0.06;
    float line = smoothstep(0.0, aa, fy) * (1.0 - smoothstep(w - aa, w, fy));
    float L = mix(0.45, 2.6, hash(k + 17.3));
    float duty = mix(0.30, 0.86, hash(k + 5.1));
    float u = fract((p.x - uTime * uSpeed) / L + hash(k + 41.7) * 7.0);
    float dash = smoothstep(0.0, 0.02, u) * (1.0 - smoothstep(duty - 0.012, duty, u));
    float ramp = mix(0.22, 1.0, pow(clamp(u / duty, 0.0, 1.0), 1.5));
    float pick = hash(k + 9.0);
    vec3 col = pick < 0.55 ? vec3(0.094, 0.502, 0.722)   // #1880B8
             : pick < 0.86 ? vec3(0.247, 0.722, 0.925)   // #3FB8EC
             : vec3(0.627, 0.827, 0.914);                // #A0D3E9
    // the site's stripes live in a band; let them thin out above and below it
    float band = smoothstep(2.15, 1.25, abs(p.y + 0.15));
    float on = line * dash * ramp * mix(0.07, 1.0, band) * step(0.08, hash(k + 3.3));
    vec3 c = mix(NAVY, col, on);
    // a cool vignette that belongs to the wall, not the screen
    c *= mix(0.72, 1.0, smoothstep(5.5, 1.0, length(p * vec2(0.55, 1.0))));
    return c;
  }
`

function Wall() {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uSpeed: { value: SPEED } },
        vertexShader: /* glsl */ `
          varying vec3 vW;
          void main() {
            vec4 w = modelMatrix * vec4(position, 1.0);
            vW = w.xyz;
            gl_Position = projectionMatrix * viewMatrix * w;
          }`,
        fragmentShader: /* glsl */ `
          varying vec3 vW;
          ${STRIPES}
          void main() { gl_FragColor = vec4(wall(vW.xy), 1.0); }`,
      }),
    []
  )
  useFrame((s) => (mat.uniforms.uTime.value = s.clock.elapsedTime))
  return (
    <mesh position={[0, 0, -GEOM.D]} material={mat}>
      <planeGeometry args={[60, 36]} />
    </mesh>
  )
}

// ── the ring: an exact torus traced through, three wavelengths ────────────────
const RING_FRAG = /* glsl */ `
  varying vec3 vW;
  uniform mat4 uInv;
  uniform mat4 uModel;
  uniform float uN;
  uniform float uDisp;
  uniform float uR;
  uniform float uRt;
  uniform float uD;
  ${STRIPES}

  float sdTorus(vec3 p) { vec2 q = vec2(length(p.xy) - uR, p.z); return length(q) - uRt; }
  vec3 nTorus(vec3 p) {
    vec2 a = p.xy; float l = max(length(a), 1e-5);
    vec3 c = vec3(a / l * uR, 0.0);
    return normalize(p - c);
  }
  // studio: navy room, one long soft light strip above and slightly in front
  vec3 env(vec3 d) {
    float strip = exp(-pow((d.y - 0.62) * 7.0, 2.0)) * smoothstep(-0.2, 0.5, d.z);
    float floorGlow = exp(-pow((d.y + 0.55) * 5.0, 2.0)) * 0.25;
    return NAVY * 1.2 + vec3(0.78, 0.90, 1.0) * strip * 0.95 + vec3(0.25, 0.55, 0.8) * floorGlow;
  }

  // follows one wavelength through the glass; returns the wall colour it lands on
  // (in channel ch) and the path length spent inside
  float through(vec3 p, vec3 d, vec3 N, float n, int ch, out float len, out float tir) {
    len = 0.0; tir = 0.0;
    d = refract(d, N, 1.0 / n);
    for (int b = 0; b < 4; b++) {
      float t = 0.004;
      for (int i = 0; i < 56; i++) {
        float s = -sdTorus(p + d * t);
        if (s < 2e-4) break;
        t += max(s, 0.002);
      }
      p += d * t; len += t;
      vec3 Nout = nTorus(p);
      vec3 o = refract(d, -Nout, n);
      if (dot(o, o) > 0.0) { d = o; break; }
      d = reflect(d, -Nout); tir += 1.0;
      p += d * 0.003;
    }
    // back to world and onto the wall
    vec3 pw = (uModel * vec4(p, 1.0)).xyz;
    vec3 dw = normalize(mat3(uModel) * d);
    vec3 c;
    if (dw.z < -1e-3) {
      float s = (-uD - pw.z) / dw.z;
      c = wall((pw + dw * s).xy);
    } else {
      c = env(dw);
    }
    return ch == 0 ? c.r : ch == 1 ? c.g : c.b;
  }

  void main() {
    vec3 roW = cameraPosition;
    vec3 rdW = normalize(vW - roW);
    vec3 ro = (uInv * vec4(roW, 1.0)).xyz;
    vec3 rd = normalize(mat3(uInv) * rdW);
    // find the true surface: start a little before the proxy mesh and sphere-trace
    float t = max(length(vW - roW) - 0.12, 0.0);
    bool hit = false;
    for (int i = 0; i < 40; i++) {
      float s = sdTorus(ro + rd * t);
      if (s < 1e-4) { hit = true; break; }
      t += s;
      if (t > 40.0) break;
    }
    if (!hit) discard;
    vec3 p = ro + rd * t;
    vec3 N = nTorus(p);

    float len, tir, l2, t2, l3, t3;
    float dn = uDisp;
    vec3 col;
    col.r = through(p, rd, N, uN - dn, 0, len, tir);
    col.g = through(p, rd, N, uN, 1, l2, t2);
    col.b = through(p, rd, N, uN + dn, 2, l3, t3);
    // a whisper of cyan in the glass (Beer–Lambert over the green path)
    col *= exp(-l2 * vec3(0.10, 0.035, 0.02) * (uN - 1.0) * 2.0);

    float c = clamp(dot(-rd, N), 0.0, 1.0);
    float f0 = pow((uN - 1.0) / (uN + 1.0), 2.0);
    float F = f0 + (1.0 - f0) * pow(1.0 - c, 5.0);
    vec3 R = normalize(mat3(uModel) * reflect(rd, N));
    vec3 o = mix(col, env(R), F);
    // the air ring still shows its edge, faintly — a ghost, not nothing
    o += vec3(0.55, 0.75, 0.95) * pow(1.0 - c, 6.0) * 0.12;
    gl_FragColor = vec4(o, 1.0);
  }
`

function Ring({ nRef, tilt }) {
  const mesh = useRef()
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uSpeed: { value: SPEED },
          uInv: { value: new THREE.Matrix4() },
          uModel: { value: new THREE.Matrix4() },
          uN: { value: 1.523 },
          uDisp: { value: 0 },
          uR: { value: GEOM.R },
          uRt: { value: GEOM.r },
          uD: { value: GEOM.D },
        },
        vertexShader: /* glsl */ `
          varying vec3 vW;
          void main() {
            vec4 w = modelMatrix * vec4(position, 1.0);
            vW = w.xyz;
            gl_Position = projectionMatrix * viewMatrix * w;
          }`,
        fragmentShader: RING_FRAG,
      }),
    []
  )
  useFrame((s) => {
    const t = s.clock.elapsedTime
    const m = mesh.current
    // a slow sway; the pointer's height leans it toward or away
    m.rotation.y = Math.sin(t * 0.21) * 0.16 + tilt.current.x * 0.1
    m.rotation.x = Math.sin(t * 0.17 + 1.3) * 0.08 + tilt.current.y * 0.14
    m.updateMatrixWorld()
    mat.uniforms.uModel.value.copy(m.matrixWorld)
    mat.uniforms.uInv.value.copy(m.matrixWorld).invert()
    mat.uniforms.uTime.value = t
    const n = nRef.current
    mat.uniforms.uN.value = n
    mat.uniforms.uDisp.value = (0.5 * (n - 1)) / ABBE
  })
  return (
    <mesh ref={mesh} material={mat}>
      <torusGeometry args={[GEOM.R, GEOM.r + 0.025, 48, 160]} />
    </mesh>
  )
}

export default function Scene({ nRef, tilt }) {
  const { camera } = useThree()
  useFrame(() => camera.lookAt(0, -0.32, 0))
  return (
    <>
      <Wall />
      <Ring nRef={nRef} tilt={tilt} />
    </>
  )
}
