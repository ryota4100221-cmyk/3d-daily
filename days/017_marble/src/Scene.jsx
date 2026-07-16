import { useRef, useEffect, useMemo } from 'react'
import { useFrame, useThree, extend } from '@react-three/fiber'
import { shaderMaterial } from '@react-three/drei'
import * as THREE from 'three'

/* ------------------------------------------------------------------ *
 * Day 017 — Week 3 · "Marble"  (フラグメントノイズ / fragment noise gradient)
 *
 * The whole screen is one fragment shader again (a full-screen clip-space
 * quad, Day 015 lineage), but the noise underneath is a level up. Days 015
 * and 016 leaned on a cheap dependency-free *value*-noise fBm. Today the
 * base is TRUE 2D SIMPLEX noise (Gustavson / Ashima), and — the new
 * technique of the day — it is the *analytic-derivative* variant `snoised`,
 * which returns the noise value AND its gradient (∂/∂x, ∂/∂y) in one call.
 *
 * Having the gradient for free unlocks two things a plain noise can't do:
 *   1. DERIVATIVE fBm (IQ) — each octave's amplitude is damped by the
 *      running gradient magnitude, 1/(1+|d|²). Slopes suppress detail, so
 *      the field reads like eroded stone / marble veining instead of even
 *      static — an organic gradient, not TV snow.
 *   2. GRADIENT SHADING — the accumulated ∇ is a real surface slope, so we
 *      can emboss the flat quad (dot with a light dir) and get relief with
 *      zero geometry.
 *
 * On top of that sits IQ DOMAIN WARPING: pattern(p) = fbm(p + 4·fbm(p +
 * 4·fbm(p))). Feeding the field back through itself twice is what turns
 * noise into flowing marble. The two intermediate warp vectors (q, r) are
 * kept and folded into the colour, IQ-style, so the veins carry their own
 * tonal drift across paper → ink → terracotta.
 *
 * Pointer (Day 015/009 lineage): the cursor, cast into aspect space and
 * damped, deepens the warp and warms a Gaussian pool of veining toward
 * terracotta; leave and it eases back (stateless). `<Canvas flat>`, sRGB
 * palette linearised on output, troika Text avoided — fully offline-safe.
 * ------------------------------------------------------------------ */

const vertexShader = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    // full-screen clip-space quad — ignore the camera entirely
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

const fragmentShader = /* glsl */ `
  precision highp float;

  uniform float uTime;
  uniform vec2  uRes;
  uniform vec2  uPointer;   // aspect-space, damped
  uniform float uHover;     // 0..1 damped presence

  varying vec2 vUv;

  // sRGB monaka palette -> linearised on output for <Canvas flat>
  const vec3 PAPER = vec3(0.925, 0.906, 0.867); // #ECE7DD
  const vec3 INK   = vec3(0.149, 0.141, 0.122); // #26241F
  const vec3 TERRA = vec3(0.776, 0.416, 0.247); // #C66A3F
  const vec3 SAND  = vec3(0.847, 0.796, 0.706); // warm mid paper

  vec3 toLinear(vec3 c) { return pow(c, vec3(2.2)); }

  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec3 permute(vec3 x) { return mod289(((x * 34.0) + 1.0) * x); }

  // --- 2D SIMPLEX NOISE WITH DERIVATIVES (Gustavson) --------------------
  // returns vec3(value, dValue/dx, dValue/dy)
  vec3 snoised(vec2 v) {
    const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                       -0.577350269189626, 0.024390243902439);
    vec2 i  = floor(v + dot(v, C.yy));
    vec2 x0 = v - i + dot(i, C.xx);
    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod289(i);
    vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0))
                            + i.x + vec3(0.0, i1.x, 1.0));
    vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy),
                            dot(x12.zw, x12.zw)), 0.0);
    vec3 m2 = m * m;
    vec3 m3 = m2 * m;
    vec3 m4 = m2 * m2;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    vec2 g0 = vec2(a0.x, h.x);
    vec2 g1 = vec2(a0.y, h.y);
    vec2 g2 = vec2(a0.z, h.z);
    vec3 norm = 1.79284291400159 - 0.85373472095314 *
                vec3(dot(g0, g0), dot(g1, g1), dot(g2, g2));
    g0 *= norm.x; g1 *= norm.y; g2 *= norm.z;
    vec3 gdotx = vec3(dot(g0, x0), dot(g1, x12.xy), dot(g2, x12.zw));
    float value = 130.0 * dot(m4, gdotx);
    // gradient: 130 * Σ[ -8 mᵢ³ (gᵢ·xᵢ) xᵢ + mᵢ⁴ gᵢ ]
    vec3 temp = m3 * gdotx;
    vec2 grad = -8.0 * (temp.x * x0 + temp.y * x12.xy + temp.z * x12.zw);
    grad += m4.x * g0 + m4.y * g1 + m4.z * g2;
    grad *= 130.0;
    return vec3(value, grad);
  }

  // Derivative fBm (IQ): octaves damped by running |gradient|²  -> erosion.
  // Returns vec3(value, gradX, gradY); the gradient is the marble's slope.
  vec3 fbmd(vec2 p) {
    float a = 0.5;
    float f = 0.0;
    vec2  d = vec2(0.0);
    // rotate the domain each octave so the veins don't grid up
    mat2 m = mat2(0.8, 0.6, -0.6, 0.8);
    mat2 total = mat2(1.0, 0.0, 0.0, 1.0);
    for (int i = 0; i < 6; i++) {
      vec3 n = snoised(p);
      d += total * n.yz;                 // accumulate rotated gradient
      f += a * n.x / (1.0 + dot(d, d));  // slope-damped octave
      a *= 0.5;
      p = 2.0 * m * p;
      total = 2.0 * m * total;
    }
    return vec3(f, d);
  }

  // plain fBm value (for the domain-warp feedback stages)
  float fbm(vec2 p) { return fbmd(p).x; }

  void main() {
    // aspect-correct centred coords in [-1,1]-ish
    vec2 uv = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0) * 2.0;

    float t = uTime;

    // pointer pool: how strongly the cursor is warping the field here
    vec2  pd = uv - uPointer;
    float pool = exp(-dot(pd, pd) * 3.0) * uHover;

    // slow drift so the marble is always flowing (lower freq -> larger, calmer veins)
    vec2 p = uv * 0.82 + vec2(0.02 * t, -0.015 * t);

    // --- IQ domain warping: fbm(p + 4·fbm(p + 4·fbm(p))) ---------------
    float warp = 4.0 + pool * 3.0;   // cursor pushes the veins harder
    vec2 q = vec2(
      fbm(p + vec2(0.0, 0.0) + 0.10 * t),
      fbm(p + vec2(5.2, 1.3) - 0.08 * t));
    vec2 r = vec2(
      fbm(p + warp * q + vec2(1.7, 9.2)),
      fbm(p + warp * q + vec2(8.3, 2.8) + 0.05 * t));

    vec3 fd = fbmd(p + warp * r);     // final field + its gradient
    float f = fd.x;
    vec2  grad = fd.yz;

    // --- colour: PAPER-dominant marble, thin ink veins (monaka / 余白) --
    // bias v high so paper is the majority of the canvas; veins live in the
    // low tail of the field where the warp folds sharply.
    float v = clamp(f * 2.1 + 0.70, 0.0, 1.0);
    vec3 col = mix(INK, PAPER, smoothstep(0.06, 0.62, v));
    col = mix(col, SAND, clamp(dot(q, q) * 1.2, 0.0, 1.0) * 0.5);     // warm mids, gentle
    // deepen only the very cores of the veins, and only a little
    col = mix(col, INK, clamp((r.x - 0.35) * 1.1, 0.0, 1.0) * 0.32);

    // terracotta rides the second warp vector — the signature coloured thread
    float thread = smoothstep(0.45, 0.80, r.y * 0.5 + 0.5) *
                   smoothstep(0.62, 0.30, v);
    col = mix(col, TERRA, thread * 0.6);

    // --- GRADIENT SHADING: emboss the flat quad from the noise slope ---
    // keep it light — a raking sheen, not a darkening, so paper stays paper.
    vec3 N = normalize(vec3(-grad * 0.7, 1.0));
    vec3 L = normalize(vec3(0.55, 0.75, 0.85));
    float diff = clamp(dot(N, L) * 0.5 + 0.5, 0.0, 1.0);
    col *= 0.88 + 0.16 * diff;
    col += vec3(0.035) * smoothstep(0.62, 1.0, diff) * smoothstep(0.4, 0.9, v); // veined sheen
    // faint terracotta warmth along the steepest ridges
    col += TERRA * 0.05 * pow(clamp(length(grad) * 0.3, 0.0, 1.0), 1.5)
                * smoothstep(0.35, 0.85, v);

    // --- pointer warmth: pool the veining toward terracotta -----------
    col = mix(col, mix(col, TERRA, 0.6), pool * 0.55);
    col += TERRA * pool * 0.08 * smoothstep(0.3, 0.7, v);

    // paper grain + soft vignette
    float grain = fract(sin(dot(vUv * uRes, vec2(12.9898, 78.233)) + t)
                        * 43758.5453);
    col += (grain - 0.5) * 0.012;
    float vig = smoothstep(1.35, 0.35, length(uv));
    col *= 0.9 + 0.1 * vig;

    gl_FragColor = vec4(toLinear(col), 1.0);
  }
`

const MarbleMaterial = shaderMaterial(
  {
    uTime: 0,
    uRes: new THREE.Vector2(1, 1),
    uPointer: new THREE.Vector2(0, 0),
    uHover: 0,
  },
  vertexShader,
  fragmentShader,
)
extend({ MarbleMaterial })

export default function Scene({ onState }) {
  const mat = useRef()
  const { size, viewport } = useThree()

  // pointer -> aspect-space target, damped frame-rate-independently
  const target = useRef(new THREE.Vector2(0, 0))
  const cur = useRef(new THREE.Vector2(0, 0))
  const hover = useRef(0)
  const moved = useRef(false)
  const lastMove = useRef(-10)
  const lastLabel = useRef('drift')

  const aspect = useMemo(() => size.width / size.height, [size])

  useEffect(() => {
    const h = (e) => {
      moved.current = true
      // NDC -> aspect space, matching the shader's uv mapping
      const nx = (e.clientX / window.innerWidth) * 2 - 1
      const ny = -((e.clientY / window.innerHeight) * 2 - 1)
      target.current.set(nx * (window.innerWidth / window.innerHeight), ny)
    }
    window.addEventListener('pointermove', h)
    return () => window.removeEventListener('pointermove', h)
  }, [])

  useFrame((st, delta) => {
    const m = mat.current
    if (!m) return
    const t = st.clock.elapsedTime
    const dt = Math.min(delta, 1 / 30)

    m.uTime = t
    m.uRes.set(size.width * viewport.dpr, size.height * viewport.dpr)

    cur.current.x = THREE.MathUtils.damp(cur.current.x, target.current.x, 5, dt)
    cur.current.y = THREE.MathUtils.damp(cur.current.y, target.current.y, 5, dt)
    m.uPointer.copy(cur.current)

    if (moved.current) {
      lastMove.current = t
      moved.current = false
    }
    const activeNow = t - lastMove.current < 1.2 ? 1 : 0
    hover.current = THREE.MathUtils.damp(hover.current, activeNow, 4, dt)
    m.uHover = hover.current

    const label = hover.current > 0.35 ? 'stir' : 'drift'
    if (label !== lastLabel.current) {
      lastLabel.current = label
      onState && onState(label)
    }
  })

  return (
    <mesh frustumCulled={false}>
      <planeGeometry args={[2, 2]} />
      <marbleMaterial
        ref={mat}
        toneMapped={false}
        depthTest={false}
        depthWrite={false}
      />
    </mesh>
  )
}
