import { useRef, useEffect } from 'react'
import { useFrame, useThree, extend } from '@react-three/fiber'
import { shaderMaterial } from '@react-three/drei'
import * as THREE from 'three'

/* ------------------------------------------------------------------ *
 * Day 015 — Week 3 · "Contour"  (shaderMaterial 入門)
 *
 * The whole frame is ONE fragment shader. A full-screen clip-space quad
 * (gl_Position = position.xy, so the camera is irrelevant) is painted by a
 * custom material built with drei's declarative `shaderMaterial` helper +
 * `extend` — the new technique this week, one step past Day 012's raw
 * THREE.ShaderMaterial. Inside the shader an fBm height field is sliced into
 * anti-aliased topographic isolines (contours) that drift with a uTime
 * uniform. A damped pointer uniform (Day 008/009 easing, now feeding GLSL)
 * warps the sampling domain so the terrain parts around the cursor and warms
 * the nearby lines to terracotta. No geometry, no lights, no textures —
 * every pixel is math. Fully offline-safe; no troika Text (white-screen trap).
 * ------------------------------------------------------------------ */

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    // clip-space fullscreen quad — ignore the camera entirely
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

const fragmentShader = /* glsl */ `
  precision highp float;
  varying vec2 vUv;

  uniform float uTime;
  uniform float uAspect;
  uniform vec2  uPointer;   // aspect-space, damped
  uniform float uHover;     // 0..1 damped presence

  // sRGB palette (matches the HUD) → linearised below for flat output
  const vec3 PAPER  = vec3(0.925, 0.906, 0.867); // #ECE7DD
  const vec3 INK    = vec3(0.149, 0.141, 0.122); // #26241F
  const vec3 TERRA  = vec3(0.776, 0.416, 0.247); // #C66A3F

  const float DENSITY = 7.0;   // number of contour bands across the field
  const float SIGMA   = 0.045; // pointer influence radius²

  vec3 toLinear(vec3 c) { return pow(c, vec3(2.2)); }

  // --- dependency-free value-noise fBm (hash → quintic → 5 octaves) ---
  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 345.45));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
    for (int i = 0; i < 5; i++) {
      v += a * vnoise(p);
      p = m * p;
      a *= 0.5;
    }
    return v;
  }

  void main() {
    // aspect-corrected, centred coordinates
    vec2 p = vUv - 0.5;
    p.x *= uAspect;

    float t = uTime;

    // slow rotation + drift so the whole map reads like a moving tide
    float ca = cos(t * 0.02), sa = sin(t * 0.02);
    vec2 q = mat2(ca, -sa, sa, ca) * (p * 1.7);
    q += vec2(0.03 * t, -0.02 * t);

    // pointer warp: push the sampling domain radially away from the cursor
    vec2 toP = p - uPointer;
    float d2 = dot(toP, toP);
    float bump = exp(-d2 / SIGMA) * uHover;
    q += normalize(toP + 1e-4) * bump * 0.42;

    // --- the height field, and its analytic isolines ------------------
    float field = fbm(q + 0.05 * t);
    float f = field * DENSITY;

    // anti-aliased distance to the nearest integer level (needs derivatives)
    float w = fwidth(f);
    float df = abs(fract(f + 0.5) - 0.5);
    float lineMinor = 1.0 - smoothstep(0.0, w * 1.4, df);
    float lineMajor = 1.0 - smoothstep(0.0, w * 2.8, df);
    float idx = floor(f + 0.5);
    float isMajor = 1.0 - clamp(abs(mod(idx, 5.0)), 0.0, 1.0); // every 5th line

    float minorI = lineMinor * 0.40 * (1.0 - isMajor);
    float majorI = lineMajor * 0.78 * isMajor;
    float ai = max(minorI, majorI);

    // --- fake relief shading from the field gradient (emboss on paper) --
    float e = 0.0016;
    float gx = fbm(q + vec2(e, 0.0)) - fbm(q - vec2(e, 0.0));
    float gy = fbm(q + vec2(0.0, e)) - fbm(q - vec2(0.0, e));
    vec3 n = normalize(vec3(-gx, -gy, e * 0.9));
    float light = clamp(dot(n, normalize(vec3(0.35, 0.55, 0.8))) * 0.5 + 0.5, 0.0, 1.0);

    // base paper, subtly embossed + a faint tonal wash of elevation
    vec3 base = mix(PAPER * 0.955, PAPER, light);
    base = mix(base, PAPER * 0.9, smoothstep(0.25, 0.95, field) * 0.22);

    // ink lines, warmed toward terracotta near the cursor
    float warmth = clamp(bump * 1.5, 0.0, 1.0);
    vec3 lineCol = mix(INK, TERRA, warmth);
    vec3 col = mix(base, lineCol, ai);

    // gentle paper glow under the cursor to draw the eye
    col = mix(col, mix(col, PAPER, 0.16), bump);

    // paper grain + soft vignette
    float grain = (hash(vUv * (900.0 + 3.0 * uAspect) + t) - 0.5) * 0.016;
    col += grain;
    float vig = smoothstep(1.25, 0.25, length(p));
    col *= 0.9 + 0.1 * vig;

    gl_FragColor = vec4(toLinear(col), 1.0);
  }
`

const ContourMaterial = shaderMaterial(
  { uTime: 0, uAspect: 1, uPointer: new THREE.Vector2(0, 0), uHover: 0 },
  vertexShader,
  fragmentShader,
)
extend({ ContourMaterial })

export default function Scene({ onState }) {
  const mat = useRef()
  const { size } = useThree()

  // damped pointer (aspect space) + presence, all eased frame-rate-independently
  const target = useRef(new THREE.Vector2(0, 0))
  const cur = useRef(new THREE.Vector2(0, 0))
  const hover = useRef(0)
  const moved = useRef(false)
  const lastMove = useRef(-10)
  const lastLabel = useRef('flow')

  useEffect(() => {
    const h = () => (moved.current = true)
    window.addEventListener('pointermove', h)
    return () => window.removeEventListener('pointermove', h)
  }, [])

  useFrame((st, delta) => {
    const m = mat.current
    if (!m) return
    const t = st.clock.elapsedTime
    const dt = Math.min(delta, 1 / 30)
    const aspect = size.width / size.height

    m.uTime = t
    m.uAspect = aspect

    // R3F keeps st.pointer as NDC (-1..1) over the canvas → aspect space
    target.current.set(st.pointer.x * 0.5 * aspect, st.pointer.y * 0.5)
    cur.current.x = THREE.MathUtils.damp(cur.current.x, target.current.x, 6, dt)
    cur.current.y = THREE.MathUtils.damp(cur.current.y, target.current.y, 6, dt)
    m.uPointer.copy(cur.current)

    if (moved.current) {
      lastMove.current = t
      moved.current = false
    }
    const activeNow = t - lastMove.current < 1.1 ? 1 : 0
    hover.current = THREE.MathUtils.damp(hover.current, activeNow, 4, dt)
    m.uHover = hover.current

    const label = hover.current > 0.35 ? 'warp' : 'flow'
    if (label !== lastLabel.current) {
      lastLabel.current = label
      onState && onState(label)
    }
  })

  return (
    <mesh frustumCulled={false}>
      <planeGeometry args={[2, 2]} />
      <contourMaterial
        ref={mat}
        toneMapped={false}
        depthTest={false}
        depthWrite={false}
        extensions={{ derivatives: true }}
      />
    </mesh>
  )
}
