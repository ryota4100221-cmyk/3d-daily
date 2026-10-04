import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { advance, shape, makeSet, LOOP } from './rig.js'

// 1 unit = 1 mm. Five drops, slowest on the left, all landing at t = 60 ms.
export const XS = [-11, -5.5, 0, 5.5, 11]
const N = XS.length
export const BG = new THREE.Color('#e9ebec')

// ── shared GLSL: the floor, its print, and what the drops do to its light ──
const COMMON = /* glsl */ `
  #define N ${N}
  uniform vec3 uC[N];   // drop centres (mm)
  uniform vec3 uAx[N];  // semi-axes (a, c, a)
  uniform vec3 uBg;
  const vec3 L = normalize(vec3(-0.32, 1.0, 0.38)); // key light, above-left-front

  // studio: a cyclorama that is lighter overhead, a long softbox above,
  // and the dark side of the room behind the camera.
  vec3 env(vec3 d) {
    float y = d.y;
    vec3 c = mix(vec3(0.74,0.76,0.78), uBg * 1.03, smoothstep(-0.1, 0.45, y));
    float box = smoothstep(0.02, 0.0, abs(d.x + 0.18) - 0.30) * smoothstep(0.70, 0.80, y);
    c = mix(c, vec3(1.9), box);
    float back = smoothstep(0.35, 0.75, d.z) * smoothstep(0.45, 0.05, abs(y - 0.12));
    c = mix(c, vec3(0.16,0.17,0.18), back * 0.85);
    return c;
  }

  float gridLine(float v, float w) {
    float f = abs(fract(v - 0.5) - 0.5) / max(fwidth(v), 1e-4);
    return 1.0 - smoothstep(w - 0.5, w + 0.5, f);
  }

  vec3 floorCol(vec2 p, float dist) {
    vec3 col = vec3(0.958, 0.960, 0.962);
    // the print: a millimetre grid, every fifth line heavier, fading with distance
    float fade = 1.0 - smoothstep(18.0, 60.0, dist);
    float minor = gridLine(p.x, 0.5) + gridLine(p.y, 0.5);
    float major = gridLine(p.x / 5.0, 0.8) + gridLine(p.y / 5.0, 0.8);
    col -= 0.045 * clamp(minor, 0.0, 1.0) * fade;
    col -= 0.10 * clamp(major, 0.0, 1.0) * fade;
    // the line every drop lands on
    col -= 0.22 * gridLine(p.y / 40.0, 0.9) * step(abs(p.x), 16.0) * fade;

    // Transparent drops do not cast a disc. They throw a dim ring (the light
    // bent away from the rim) around a caustic (the light the lens gathers).
    // This part is an approximation — no photons are traced.
    for (int i = 0; i < N; i++) {
      vec3 c = uC[i]; vec3 ax = uAx[i];
      vec2 sc = c.xz - L.xz / L.y * c.y;
      vec2 q = p - sc;
      // stretch along the light's footprint
      vec2 ld = normalize(L.xz);
      float along = dot(q, ld), across = dot(q, vec2(-ld.y, ld.x));
      float lift = max(c.y - ax.y, 0.0);
      float r = ax.x * 1.02 + 0.10 * lift;
      float rl = r + ax.y * 0.35;
      float d = length(vec2(along / rl, across / r));
      float blur = 0.10 + 0.05 * lift;
      float ring = smoothstep(0.55 - blur, 0.92, d) * (1.0 - smoothstep(0.92, 1.0 + blur * 1.4, d));
      float near = 1.0 / (1.0 + 0.18 * lift);
      col *= 1.0 - 0.24 * ring * near;
      float focus = 0.30 + 0.06 * lift;
      col += vec3(0.30, 0.31, 0.30) * exp(-pow(d / focus, 2.0)) * near * near;
    }
    col = mix(col, uBg, smoothstep(30.0, 140.0, dist));
    return col;
  }
`

function useDropUniforms() {
  return useMemo(
    () => ({
      uC: { value: Array.from({ length: N }, () => new THREE.Vector3()) },
      uAx: { value: Array.from({ length: N }, () => new THREE.Vector3(1, 1, 1)) },
      // shaders here write display values directly, so hand them the sRGB triple
      uBg: { value: new THREE.Vector3(233 / 255, 235 / 255, 236 / 255) },
    }),
    []
  )
}

const floorVert = /* glsl */ `
  varying vec3 vW;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`
const floorFrag = /* glsl */ `
  ${COMMON}
  varying vec3 vW;
  void main() {
    float dist = length(vW - cameraPosition);
    gl_FragColor = vec4(floorCol(vW.xz, dist), 1.0);
  }
`

// The drop: one analytic ellipsoid. Enter, cross the water, leave, land on the
// floor print (or the room) — two refractions, both with the true normal.
const dropVert = /* glsl */ `
  varying vec3 vW;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`
const dropFrag = /* glsl */ `
  ${COMMON}
  uniform int uI;
  varying vec3 vW;
  const float ETA = 1.333;

  vec3 trace(vec3 o, vec3 d) {
    if (d.y < -1e-4) {
      vec3 h = o + d * (-o.y / d.y);
      return floorCol(h.xz, length(h - cameraPosition));
    }
    return env(d);
  }

  void main() {
    vec3 C = uC[0], AX = uAx[0];
    for (int i = 0; i < N; i++) if (i == uI) { C = uC[i]; AX = uAx[i]; }
    vec3 I = normalize(vW - cameraPosition);
    vec3 n = normalize((vW - C) / (AX * AX));
    float cosi = clamp(dot(-I, n), 0.0, 1.0);
    float F = 0.02 + 0.98 * pow(1.0 - cosi, 5.0);

    vec3 refl = trace(vW + n * 1e-3, reflect(I, n));

    vec3 t1 = refract(I, n, 1.0 / ETA);
    vec3 o = (vW - C) / AX, dd = t1 / AX;
    float A = dot(dd, dd), B = dot(o, dd), Cc = dot(o, o) - 1.0;
    float s = (-B + sqrt(max(B * B - A * Cc, 0.0))) / A;
    vec3 P2 = vW + t1 * s;
    vec3 n2 = normalize((P2 - C) / (AX * AX));
    vec3 t2 = refract(t1, -n2, ETA);
    vec3 thru;
    if (dot(t2, t2) < 1e-6) {
      // total internal reflection: one more bounce inside, then out wherever
      vec3 t3 = reflect(t1, -n2);
      thru = trace(P2, normalize(t3 + n2 * 0.4)) * 0.85;
    } else {
      thru = trace(P2, t2);
    }
    // water at millimetres is clear; a breath of cool from the cyclorama
    thru *= vec3(0.985, 0.995, 1.0);
    vec3 col = mix(thru, refl, F);
    gl_FragColor = vec4(col, 1.0);
  }
`

function Drop({ i, uniforms }) {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { ...uniforms, uI: { value: i } },
        vertexShader: dropVert,
        fragmentShader: dropFrag,
        extensions: { derivatives: true },
      }),
    [i, uniforms]
  )
  return (
    <mesh name={`drop${i}`} material={mat}>
      <sphereGeometry args={[1, 96, 64]} />
    </mesh>
  )
}

export default function Scene({ world }) {
  const uniforms = useDropUniforms()
  const group = useRef()
  const { camera, size } = useThree()

  const floorMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms,
        vertexShader: floorVert,
        fragmentShader: floorFrag,
        extensions: { derivatives: true },
      }),
    [uniforms]
  )

  const v = useMemo(() => new THREE.Vector3(), [])

  useFrame((_, delta) => {
    const w = world.current
    if (w.frozen == null) {
      w.t += Math.min(delta, 0.05) / w.slow
      if (w.t > LOOP) {
        w.set = makeSet(w.R)
        w.t = 0
      }
    } else if (w.t !== w.frozen) {
      w.t = w.frozen
    }
    const g = group.current
    w.set.forEach((dp, i) => {
      advance(dp, w.t)
      const s = shape(dp)
      uniforms.uC.value[i].set(XS[i], s.y, 0)
      uniforms.uAx.value[i].set(s.a, s.c, s.a)
      const m = g.children[i]
      m.position.set(XS[i], s.y, 0)
      m.scale.set(s.a, s.c, s.a)
      // where the label under each drop goes, for the overlay
      v.set(XS[i], 0, 3.2).project(camera)
      w.screen[i] = [((v.x + 1) / 2) * size.width, ((1 - v.y) / 2) * size.height]
    })
  })

  return (
    <>
      <mesh rotation-x={-Math.PI / 2} material={floorMat}>
        <planeGeometry args={[400, 400]} />
      </mesh>
      <group ref={group}>
        {XS.map((_, i) => (
          <Drop key={i} i={i} uniforms={uniforms} />
        ))}
      </group>
    </>
  )
}
