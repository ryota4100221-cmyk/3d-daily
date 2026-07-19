import { useRef, useMemo, useEffect } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'

/* ------------------------------------------------------------------ *
 * Day 020 — Week 3 · "Ink"  (流体 / 墨流し風 · advection–diffusion)
 *
 * Every prior day was deliberately STATELESS: each frame recomputed the whole
 * image from time + pointer, so nothing the field did last frame survived into
 * this one (Day 012 particles, Day 015–019 shaders — all one-shot). Today the
 * new technique is exactly the opposite: a real STATEFUL ping-pong FBO fluid.
 *
 *   read → [ advect · diffuse · dissipate · inject ] → write ; swap ; repeat
 *
 * Two half-float render targets are ping-ponged through a full-screen sim pass.
 * The ink density is a genuine simulation variable — it is transported by a
 * divergence-free CURL-NOISE velocity field with SEMI-LAGRANGIAN advection
 * (Stam): each texel backtraces `uv - v·dt`, reads where the fluid *came from*,
 * so filaments stretch and fold into sumi-nagashi marbling instead of being
 * drawn. A whisper of diffusion (neighbour blend) and dissipation (·0.995)
 * keeps it from either freezing or washing out. Because the field remembers,
 * a splat you make now is still swirling ten seconds later.
 *
 * Channels: .r = ink density (slow dissipation), .g = "heat" (fast dissipation)
 * that flags freshly-injected ink so the display can warm it to terracotta.
 *
 * Pointer (Day 009/014/019 lineage): the cursor is a BRUSH. Its gaussian splat
 * injects ink + heat, and its damped VELOCITY is added to the flow field, so
 * ink is physically dragged along the stroke — a real advected wake, not a
 * recolour. A first-frame seed pass paints an fbm marble so the piece is alive
 * on frame 1; from then on the curl field does the mixing.
 *
 * Display pass reads the field: density → paper→sand→ink ramp, the density
 * GRADIENT gives an emboss/side-light and pools darker at filament edges (wet
 * ink), heat tints the accent terracotta, plus grain + vignette. Fully
 * offline-safe: no textures fetched, noise inlined, `<Canvas flat>` + pow(2.2),
 * troika Text avoided. Half-float RTs with a Uint8 fallback for old GL.
 * ------------------------------------------------------------------ */

// Shared full-screen vertex stage (clip-space quad, camera-independent).
const quadVertex = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

// ---- shared noise (dependency-free value-noise fbm) -----------------
const noiseGLSL = /* glsl */ `
  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 345.45));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
  }
  float vnoise(vec2 x) {
    vec2 i = floor(x), f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
  float fbm(vec2 p) {
    float s = 0.0, a = 0.5;
    mat2 r = mat2(0.80, -0.60, 0.60, 0.80);
    for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = r * p * 2.02; a *= 0.5; }
    return s;
  }
`

// ---- SIMULATION pass: advect + diffuse + dissipate + inject ---------
const simFragment = /* glsl */ `
  precision highp float;
  varying vec2 vUv;

  uniform sampler2D uPrev;
  uniform vec2  uTexel;      // 1 / resolution
  uniform float uAspect;     // width / height of sim domain
  uniform float uTime;
  uniform float uDt;
  uniform float uInit;       // 1.0 on the very first frame -> seed marble
  uniform vec2  uPointer;    // uv, 0..1
  uniform vec2  uPtrVel;     // damped pointer velocity (uv / sec)
  uniform float uHover;      // 0..1 pointer presence

  ${noiseGLSL}

  // aspect-corrected coords so swirls stay round on wide screens
  vec2 asp(vec2 uv) { return vec2(uv.x * uAspect, uv.y); }

  // divergence-free velocity from the curl of a scalar streamfunction psi.
  float psi(vec2 p) {
    float t = uTime * 0.045;
    // two drifting octaves of fbm -> large slow eddies + finer curl
    return fbm(p * 1.6 + vec2(t, -t * 0.7)) + 0.5 * fbm(p * 3.3 - vec2(t * 0.6, t));
  }
  vec2 curl(vec2 p) {
    float e = 0.0015;
    float n = psi(p + vec2(0.0, e));
    float s = psi(p - vec2(0.0, e));
    float w = psi(p + vec2(e, 0.0));
    float d = psi(p - vec2(e, 0.0));
    return vec2(n - s, d - w) / (2.0 * e);   // (dPsi/dy, -dPsi/dx)
  }

  void main() {
    vec2 ap = asp(vUv);

    // ---- first-frame seed: an fbm marble so it is alive immediately ----
    if (uInit > 0.5) {
      float m = fbm(ap * 3.0 + 4.0);
      float veins = smoothstep(0.42, 0.72, m);
      float ink = veins * (0.55 + 0.45 * fbm(ap * 6.0));
      gl_FragColor = vec4(ink, 0.0, 0.0, 1.0);
      return;
    }

    // ---- velocity field: curl noise + pointer drag --------------------
    vec2 v = curl(ap) * 0.9;
    // ink is dragged along the brush stroke, falling off with distance
    float dp = distance(ap, asp(uPointer));
    float drag = exp(-dp * dp / 0.010);
    v += uPtrVel * drag * 26.0 * uHover;
    // convert aspect-space velocity to uv step for the backtrace
    vec2 vUvStep = vec2(v.x / uAspect, v.y);

    // ---- semi-Lagrangian advection (backtrace) ------------------------
    vec2 src = vUv - vUvStep * uDt;
    vec4 state = texture2D(uPrev, src);

    // ---- diffusion: blend toward the 4-neighbour average --------------
    vec4 lap = (
      texture2D(uPrev, vUv + vec2(uTexel.x, 0.0)) +
      texture2D(uPrev, vUv - vec2(uTexel.x, 0.0)) +
      texture2D(uPrev, vUv + vec2(0.0, uTexel.y)) +
      texture2D(uPrev, vUv - vec2(0.0, uTexel.y))
    ) * 0.25;
    state = mix(state, lap, 0.11);

    // ---- dissipation (density lingers, heat fades fast) ---------------
    state.r *= 0.9955;
    state.g *= 0.94;

    // ---- injection: cursor brush + two breathing ambient sources ------
    float splat = exp(-dp * dp / 0.0016);
    state.r += splat * 0.85 * uHover;
    state.g += splat * 1.00 * uHover;

    vec2 sA = asp(vec2(0.34, 0.40));
    vec2 sB = asp(vec2(0.68, 0.62));
    float dA = distance(ap, sA), dB = distance(ap, sB);
    float pulseA = 0.5 + 0.5 * sin(uTime * 0.55);
    float pulseB = 0.5 + 0.5 * sin(uTime * 0.47 + 2.1);
    state.r += exp(-dA * dA / 0.0020) * 0.14 * pulseA;
    state.r += exp(-dB * dB / 0.0024) * 0.11 * pulseB;
    state.g += exp(-dB * dB / 0.0024) * 0.05 * pulseB;

    state.r = clamp(state.r, 0.0, 1.4);
    state.g = clamp(state.g, 0.0, 1.4);
    gl_FragColor = vec4(state.rgb, 1.0);
  }
`

// ---- DISPLAY pass: field -> monaka ink palette ----------------------
const displayFragment = /* glsl */ `
  precision highp float;
  varying vec2 vUv;

  uniform sampler2D uField;
  uniform vec2  uTexel;
  uniform float uTime;
  uniform float uHover;

  // sRGB monaka palette (linearised on output for <Canvas flat>)
  const vec3 PAPER = vec3(0.925, 0.906, 0.867); // #ECE7DD
  const vec3 SAND  = vec3(0.808, 0.773, 0.706);
  const vec3 INK   = vec3(0.118, 0.110, 0.098);
  const vec3 TERRA = vec3(0.776, 0.416, 0.247); // #C66A3F

  float dens(vec2 uv) { return texture2D(uField, uv).r; }

  void main() {
    vec4 f = texture2D(uField, vUv);
    float d = f.r;
    float heat = f.g;

    // gradient of density -> emboss side-light + wet edge pooling
    float dx = dens(vUv + vec2(uTexel.x, 0.0)) - dens(vUv - vec2(uTexel.x, 0.0));
    float dy = dens(vUv + vec2(0.0, uTexel.y)) - dens(vUv - vec2(0.0, uTexel.y));
    vec2 grad = vec2(dx, dy);
    float slope = length(grad);

    // paper -> sand -> ink ramp by density
    vec3 col = mix(PAPER, SAND, smoothstep(0.05, 0.34, d));
    col = mix(col, INK, smoothstep(0.30, 0.85, d));

    // side-light from a fixed key: raised ridges catch light, valleys darken
    vec3 L = normalize(vec3(-0.55, 0.75, 1.0));
    vec3 N = normalize(vec3(-grad * 5.0, 1.0));
    float shade = dot(N, L) * 0.5 + 0.5;
    col *= 0.86 + 0.28 * shade;

    // wet ink pools darker where the filament edge is steep
    col *= 1.0 - smoothstep(0.02, 0.24, slope) * 0.30;

    // heat tints fresh ink toward terracotta (edges of live splats)
    float warm = clamp(heat * 1.3, 0.0, 1.0) * smoothstep(0.04, 0.4, d);
    col = mix(col, TERRA, warm * (0.5 + 0.5 * uHover));
    // a thin terracotta rim where heat meets steep gradient (the wet front)
    col += TERRA * slope * heat * 2.4;

    // fine grain + soft vignette (monaka negative space)
    float g = fract(sin(dot(vUv + uTime * 0.01, vec2(12.9898, 78.233))) * 43758.5453);
    col += (g - 0.5) * 0.014;
    vec2 q = vUv - 0.5;
    col *= 1.0 - dot(q, q) * 0.55;

    gl_FragColor = vec4(pow(clamp(col, 0.0, 1.0), vec3(2.2)), 1.0);
  }
`

export default function Scene({ onState }) {
  const { gl, size } = useThree()

  // ---- pick a sim resolution matching screen aspect (capped) ----------
  const dims = useMemo(() => {
    const w = Math.min(720, Math.max(360, Math.round(size.width * 0.55)))
    const h = Math.round(w * (size.height / size.width))
    return { w, h, aspect: w / h }
  }, [size.width, size.height])

  // half-float ping-pong targets (Uint8 fallback if float RTs unsupported)
  const { rtA, rtB } = useMemo(() => {
    const supportHalf = gl.capabilities.isWebGL2 ||
      !!gl.extensions.get('OES_texture_half_float')
    const type = supportHalf ? THREE.HalfFloatType : THREE.UnsignedByteType
    const opts = {
      type,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      depthBuffer: false,
      stencilBuffer: false,
    }
    return {
      rtA: new THREE.WebGLRenderTarget(dims.w, dims.h, opts),
      rtB: new THREE.WebGLRenderTarget(dims.w, dims.h, opts),
    }
  }, [gl, dims.w, dims.h])

  // offscreen sim scene (a clip-space quad carrying the sim material)
  const sim = useMemo(() => {
    const scene = new THREE.Scene()
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
    const mat = new THREE.ShaderMaterial({
      vertexShader: quadVertex,
      fragmentShader: simFragment,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uPrev: { value: null },
        uTexel: { value: new THREE.Vector2(1 / dims.w, 1 / dims.h) },
        uAspect: { value: dims.aspect },
        uTime: { value: 0 },
        uDt: { value: 0.016 },
        uInit: { value: 1 },
        uPointer: { value: new THREE.Vector2(0.5, 0.5) },
        uPtrVel: { value: new THREE.Vector2(0, 0) },
        uHover: { value: 0 },
      },
    })
    scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat))
    return { scene, cam, mat }
  }, [dims.w, dims.h, dims.aspect])

  const displayMat = useRef()

  const read = useRef(rtA)
  const write = useRef(rtB)
  const first = useRef(true)

  // ---- pointer tracking (velocity in uv/sec) --------------------------
  const ptr = useRef({ x: 0.5, y: 0.5, px: 0.5, py: 0.5, active: 0 })
  const smooth = useRef({ x: 0.5, y: 0.5, vx: 0, vy: 0, hover: 0 })
  const lastState = useRef('')

  // keep read/write pointers aligned with the current target objects
  useEffect(() => {
    read.current = rtA
    write.current = rtB
    first.current = true
  }, [rtA, rtB])

  useEffect(() => {
    const onMove = (e) => {
      ptr.current.x = e.clientX / window.innerWidth
      ptr.current.y = 1 - e.clientY / window.innerHeight
      ptr.current.active = 1
    }
    const onLeave = () => { ptr.current.active = 0 }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerdown', onMove)
    window.addEventListener('pointerleave', onLeave)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerdown', onMove)
      window.removeEventListener('pointerleave', onLeave)
    }
  }, [])

  useEffect(() => () => { rtA.dispose(); rtB.dispose() }, [rtA, rtB])

  useFrame(({ clock }, delta) => {
    const dt = Math.min(delta, 1 / 30)
    const p = ptr.current
    const s = smooth.current

    // raw pointer velocity (uv/sec) from this frame's movement
    const rvx = (p.x - p.px) / Math.max(dt, 1e-3)
    const rvy = (p.y - p.py) / Math.max(dt, 1e-3)
    p.px = p.x; p.py = p.y

    // damp position, velocity and presence (frame-rate independent)
    s.x = THREE.MathUtils.damp(s.x, p.x, 18, dt)
    s.y = THREE.MathUtils.damp(s.y, p.y, 18, dt)
    s.vx = THREE.MathUtils.damp(s.vx, rvx * p.active, 10, dt)
    s.vy = THREE.MathUtils.damp(s.vy, rvy * p.active, 10, dt)
    s.hover = THREE.MathUtils.damp(s.hover, p.active, 4, dt)

    const u = sim.mat.uniforms
    u.uTime.value = clock.elapsedTime
    u.uDt.value = dt
    u.uInit.value = first.current ? 1 : 0
    u.uPointer.value.set(s.x, s.y)
    u.uPtrVel.value.set(s.vx, s.vy)
    u.uHover.value = s.hover
    u.uPrev.value = read.current.texture

    // ---- run the simulation into `write` ----
    gl.setRenderTarget(write.current)
    gl.render(sim.scene, sim.cam)
    gl.setRenderTarget(null)

    // swap ping-pong
    const tmp = read.current
    read.current = write.current
    write.current = tmp
    first.current = false

    // hand the freshly-written field to the on-screen display material
    if (displayMat.current) {
      displayMat.current.uniforms.uField.value = read.current.texture
      displayMat.current.uniforms.uTime.value = clock.elapsedTime
      displayMat.current.uniforms.uHover.value = s.hover
    }

    const st = s.hover > 0.5 ? 'brushing' : 'flowing'
    if (st !== lastState.current) { lastState.current = st; onState && onState(st) }
  }, 0)

  return (
    <mesh frustumCulled={false}>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial
        ref={displayMat}
        vertexShader={quadVertex}
        fragmentShader={displayFragment}
        depthTest={false}
        depthWrite={false}
        uniforms={{
          uField: { value: null },
          uTexel: { value: new THREE.Vector2(1 / dims.w, 1 / dims.h) },
          uTime: { value: 0 },
          uHover: { value: 0 },
        }}
      />
    </mesh>
  )
}
