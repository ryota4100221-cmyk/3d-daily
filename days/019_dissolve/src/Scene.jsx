import { useRef, useMemo, useEffect } from 'react'
import { useFrame, useThree, extend } from '@react-three/fiber'
import { shaderMaterial, ContactShadows } from '@react-three/drei'
import * as THREE from 'three'

/* ------------------------------------------------------------------ *
 * Day 019 — Week 3 · "Dissolve"  (ディゾルブ / hologram · appearance FX)
 *
 * Days 015–018 kept the fragment shader either flat or fully covering its
 * geometry. Today the shader decides, per pixel, whether the surface EXISTS
 * at all — the new technique is a NOISE-DRIVEN ALPHA CLIP with `discard`:
 *
 *   float nz  = fbm3(objectPos * scale + drift);   // 3-D field on the solid
 *   float rev = uReveal + wipeBias;                // breathing threshold
 *   if (nz > rev) discard;                          // eat it into the paper
 *
 * Because the noise is sampled in OBJECT space, the erosion pattern is glued
 * to the surface instead of swimming through it as the form turns. `rev`
 * breathes between ~0.05 and ~0.95 on a per-object phase, so each form eats
 * itself down to paper and re-condenses out of it — a genuine materialise /
 * dematerialise cycle rather than a fade.
 *
 * The hero effect is the BURN FRONT: near the cut (small nz-below-rev
 * margin) a thin, hot terracotta band with a near-white core glows along the
 * dissolving edge — the difference between "an object with holes" and "an
 * object being consumed". Whatever survives wears a HOLOGRAM: a fresnel rim
 * (Day 018 lineage) plus faint horizontal scanlines drifting in object Y.
 *
 * Pointer (Day 009/015/018 lineage): the cursor is the WIPE STEER. Its damped
 * position becomes uWipeDir; a dot() against the object-space direction biases
 * `rev`, so the face you point at materialises first and the burn front sweeps
 * where you push it. uHover warms the rim and brightens the edge.
 *
 * Fully offline-safe: discard-based clipping means the material stays OPAQUE
 * (depthWrite on, no transparency sorting), the holes simply reveal the paper
 * background, so there is no white-screen / sort risk. `<Canvas flat>` + sRGB
 * palette linearised on output; noise inlined; troika Text avoided.
 * ------------------------------------------------------------------ */

const vertexShader = /* glsl */ `
  precision highp float;

  varying vec3 vObjPos;
  varying vec3 vWorldNormal;
  varying vec3 vViewDir;

  void main() {
    vObjPos = position;                              // object space -> stable noise
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    vViewDir = cameraPosition - wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`

const fragmentShader = /* glsl */ `
  precision highp float;

  uniform float uTime;
  uniform float uReveal;     // 0..1 breathing dissolve threshold
  uniform vec3  uWipeDir;    // object-independent steer (from pointer), damped
  uniform float uWipeAmt;    // how strongly the wipe biases the threshold
  uniform float uNoiseScale; // erosion grain
  uniform float uEdgeW;      // width of the hot burn band
  uniform vec3  uTint;       // hologram body tint
  uniform vec3  uEdgeColor;  // burn-front colour
  uniform float uHover;      // 0..1 damped pointer presence

  varying vec3 vObjPos;
  varying vec3 vWorldNormal;
  varying vec3 vViewDir;

  // sRGB monaka palette — linearised on output for <Canvas flat>
  const vec3 PAPER = vec3(0.925, 0.906, 0.867); // #ECE7DD
  const vec3 INK   = vec3(0.149, 0.141, 0.122); // #26241F
  const vec3 TERRA = vec3(0.776, 0.416, 0.247); // #C66A3F
  const vec3 COOL  = vec3(0.706, 0.749, 0.804); // hologram cool

  // --- cheap 3-D value noise + fbm (dependency-free) ----------------
  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float vnoise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i + vec3(0.0, 0.0, 0.0)), hash(i + vec3(1.0, 0.0, 0.0)), f.x),
                   mix(hash(i + vec3(0.0, 1.0, 0.0)), hash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
               mix(mix(hash(i + vec3(0.0, 0.0, 1.0)), hash(i + vec3(1.0, 0.0, 1.0)), f.x),
                   mix(hash(i + vec3(0.0, 1.0, 1.0)), hash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
  }
  float fbm(vec3 p) {
    float a = 0.5, s = 0.0, n = 0.0;
    for (int i = 0; i < 4; i++) { s += a * vnoise(p); n += a; p *= 2.03; a *= 0.5; }
    return s / n;                                    // normalised ~0..1
  }

  void main() {
    // --- the dissolve: object-space noise vs breathing threshold ------
    float nz = fbm(vObjPos * uNoiseScale + vec3(0.0, uTime * 0.06, 0.0));

    // pointer steer: bias the local threshold by facing direction
    float bias = dot(normalize(vObjPos + 1e-4), uWipeDir) * uWipeAmt;
    float rev  = uReveal + bias;

    float d = rev - nz;                              // >0 solid, <0 gone
    if (d < 0.0) discard;                            // eat surface into paper

    vec3 N = normalize(vWorldNormal);
    vec3 V = normalize(vViewDir);
    if (!gl_FrontFacing) N = -N;

    // --- hologram body ------------------------------------------------
    float fr = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 2.6);
    vec3 body = mix(INK, uTint, 0.35);
    // fresnel rim, warmed toward terracotta by hover (Day 018 lineage)
    body += mix(COOL, TERRA, 0.35 + 0.5 * uHover) * fr * 0.95;
    // drifting horizontal scanlines glued to object Y
    float scan = 0.5 + 0.5 * sin(vObjPos.y * 60.0 - uTime * 2.4);
    body *= 0.82 + 0.18 * scan;
    // faint interference flicker so it reads as a projection
    body += COOL * 0.06 * (0.5 + 0.5 * sin(uTime * 6.0 + vObjPos.x * 30.0)) * fr;

    // --- burn front: hot band where the cut passes -------------------
    float band = 1.0 - smoothstep(0.0, uEdgeW, d);   // 1 at the very cut
    vec3 edge = uEdgeColor * band * (1.1 + 1.3 * uHover);
    edge += vec3(1.0, 0.96, 0.88) * pow(band, 5.0) * 0.9; // white-hot core
    vec3 col = body + edge;

    // grain so the flats don't band
    float g = fract(sin(dot(vObjPos.xy + uTime * 0.01, vec2(12.9898, 78.233))) * 43758.5453);
    col += (g - 0.5) * 0.015;

    gl_FragColor = vec4(pow(clamp(col, 0.0, 1.0), vec3(2.2)), 1.0);
  }
`

const DissolveMaterial = shaderMaterial(
  {
    uTime: 0,
    uReveal: 0.6,
    uWipeDir: new THREE.Vector3(0.2, 0.4, 0.8),
    uWipeAmt: 0.22,
    uNoiseScale: 2.2,
    uEdgeW: 0.06,
    uTint: new THREE.Color('#9aa7ad'),
    uEdgeColor: new THREE.Color('#c66a3f'),
    uHover: 0,
  },
  vertexShader,
  fragmentShader,
)
extend({ DissolveMaterial })

// One dissolving form; owns its material so phase / tint can differ per body.
function Form({ geometry, tint, noiseScale, edgeW, wipeAmt, phase = 0, speed = 0.5, revBase = 0.5, revAmp = 0.46, baseY = 0, spin = 0.12, ...props }) {
  const mat = useRef()
  const grp = useRef()
  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    if (mat.current) {
      mat.current.uTime = t
      // breathe the reveal so the body eats itself down and re-condenses
      mat.current.uReveal = revBase + revAmp * Math.sin(t * speed + phase)
    }
    if (grp.current) {
      grp.current.rotation.y = t * spin + phase
      grp.current.position.y = baseY + Math.sin(t * 0.5 + phase) * 0.05
    }
  })
  return (
    <group ref={grp} {...props}>
      <mesh geometry={geometry}>
        <dissolveMaterial
          ref={mat}
          uTint={tint}
          uNoiseScale={noiseScale}
          uEdgeW={edgeW}
          uWipeAmt={wipeAmt}
        />
      </mesh>
    </group>
  )
}

export default function Scene({ onState }) {
  const { camera } = useThree()

  // hero + a tilted ring of shards (memoised, disposed on unmount)
  const heroGeo = useMemo(() => new THREE.TorusKnotGeometry(1, 0.34, 240, 32, 2, 3), [])
  const octaGeo = useMemo(() => new THREE.OctahedronGeometry(1, 0), [])
  const tetraGeo = useMemo(() => new THREE.TetrahedronGeometry(1, 0), [])
  useEffect(() => () => { heroGeo.dispose(); octaGeo.dispose(); tetraGeo.dispose() }, [heroGeo, octaGeo, tetraGeo])

  const shards = useMemo(() => {
    const out = []
    const N = 5
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2
      const r = 2.5
      out.push({
        pos: [Math.cos(a) * r, Math.sin(a * 2.0) * 0.5, Math.sin(a) * r],
        scale: 0.32 + (i % 2) * 0.1,
        octa: i % 2 === 0,
        phase: i * 1.3,
      })
    }
    return out
  }, [])

  // shared per-frame state
  const mats = useRef([])
  const rootGrp = useRef()
  const target = useRef({ wx: 0.2, wy: 0.4, hover: 0, px: 0, py: 0 })
  const pointer = useRef({ x: 0, y: 0, active: 0 })
  const wipeDir = useRef(new THREE.Vector3(0.2, 0.4, 0.8).normalize())
  const lastState = useRef('')

  // collect every dissolve material for a one-shot uniform push
  useEffect(() => {
    const found = []
    rootGrp.current?.traverse((o) => {
      if (o.material && o.material.uWipeDir) found.push(o.material)
    })
    mats.current = found
  })

  useEffect(() => {
    const onMove = (e) => {
      pointer.current.x = (e.clientX / window.innerWidth) * 2 - 1
      pointer.current.y = -((e.clientY / window.innerHeight) * 2 - 1)
      pointer.current.active = 1
    }
    const onLeave = () => { pointer.current.active = 0 }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerdown', onMove)
    window.addEventListener('pointerleave', onLeave)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerdown', onMove)
      window.removeEventListener('pointerleave', onLeave)
    }
  }, [])

  useFrame((_, delta) => {
    const d = Math.min(delta, 1 / 30)
    const p = pointer.current
    const tg = target.current

    // cursor steers the wipe direction (which face materialises first)
    tg.wx = THREE.MathUtils.damp(tg.wx, 0.2 + p.x * 1.1, 4, d)
    tg.wy = THREE.MathUtils.damp(tg.wy, 0.4 + p.y * 0.9, 4, d)
    tg.hover = THREE.MathUtils.damp(tg.hover, p.active, 3, d)
    wipeDir.current.set(tg.wx, tg.wy, 0.8).normalize()

    for (const m of mats.current) {
      m.uWipeDir.copy(wipeDir.current)
      m.uHover = tg.hover
    }

    // camera parallax
    tg.px = THREE.MathUtils.damp(tg.px, p.x * 0.85, 4, d)
    tg.py = THREE.MathUtils.damp(tg.py, p.y * 0.55, 4, d)
    camera.position.set(tg.px, 0.2 + tg.py, 5.2)
    camera.lookAt(0, 0, 0)

    if (rootGrp.current) rootGrp.current.rotation.y += d * 0.04

    const s = tg.hover > 0.5 ? 'steering' : 'forming'
    if (s !== lastState.current) { lastState.current = s; onState && onState(s) }
  })

  return (
    <group>
      <group ref={rootGrp}>
        {/* hero — a torus knot consumed and rebuilt by the noise field */}
        <Form
          geometry={heroGeo}
          position={[0, 0.05, 0]}
          baseY={0.05}
          scale={1.15}
          tint={new THREE.Color('#9aa7ad')}
          noiseScale={2.0}
          edgeW={0.055}
          wipeAmt={0.24}
          phase={2.81}
          speed={0.42}
          revBase={0.62}
          revAmp={0.32}
          spin={0.1}
        />
        {shards.map((s, i) => (
          <Form
            key={i}
            geometry={s.octa ? octaGeo : tetraGeo}
            position={s.pos}
            baseY={s.pos[1]}
            scale={s.scale}
            tint={s.octa ? new THREE.Color('#c98a5e') : new THREE.Color('#9aa7ad')}
            noiseScale={s.octa ? 2.6 : 3.0}
            edgeW={0.09}
            wipeAmt={0.28}
            phase={s.phase}
            speed={0.6}
            spin={0.22}
          />
        ))}
      </group>

      {/* soft grounding shadow — monaka negative space */}
      <ContactShadows
        position={[0, -1.7, 0]}
        opacity={0.28}
        scale={12}
        blur={2.8}
        far={5}
        resolution={512}
        color="#26241f"
      />
    </group>
  )
}
