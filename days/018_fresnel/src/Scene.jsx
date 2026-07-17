import { useRef, useMemo, useEffect } from 'react'
import { useFrame, useThree, extend } from '@react-three/fiber'
import { shaderMaterial, ContactShadows } from '@react-three/drei'
import * as THREE from 'three'

/* ------------------------------------------------------------------ *
 * Day 018 — Week 3 · "Fresnel"  (フレネル / rim light · glass edge glow)
 *
 * Days 015–017 painted flat quads with fragment noise. Today the shader
 * finally wraps real geometry, and the whole look is driven by ONE optical
 * fact — the FRESNEL term: surfaces reflect more at grazing angles. In the
 * fragment shader we compute  fr = pow(1 - dot(N, V), power)  from the
 * world normal and the view vector, and let it steer everything:
 *
 *   • REFLECTANCE — mix( interior , env ) by fr, so the silhouette turns
 *     mirror-bright while the centre stays glassy and see-through.
 *   • EDGE GLOW (the hero effect / 縁光り) — fr, raised and tinted
 *     terracotta, is added as an emissive rim that traces the outline.
 *   • ALPHA — opacity = mix(base, 1, fr): transparent through the middle,
 *     opaque at the rim. Real glass, one pass, no FBO.
 *
 * The reflections themselves come from a hand-written procedural
 * environment: envColor(dir) is a paper→sand→ink vertical studio gradient
 * with a warm key blob and a cool fill blob — sampled by the REFLECT vector
 * for the mirror layer and by a REFRACT vector (bent view ray) for the
 * interior, giving a cheap single-pass sense of thickness. No HDRI, no
 * three.js lights — the glass lights itself.
 *
 * Pointer (Day 009/015 lineage): the cursor IS the studio key light. Its
 * damped position becomes uLightDir, so the sharp specular glint and the
 * warm reflection sweep across every bead as you move; uHover swells the
 * rim. Camera keeps a soft parallax, the cluster drifts and breathes.
 * `<Canvas flat>` + sRGB palette linearised on output, troika Text avoided
 * — fully offline-safe.
 * ------------------------------------------------------------------ */

const vertexShader = /* glsl */ `
  precision highp float;

  varying vec3 vWorldNormal;
  varying vec3 vViewDir;
  varying vec3 vWorldPos;

  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    // uniform scale on every form -> modelMatrix upper-3x3 is safe for normals
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    vViewDir = cameraPosition - wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`

const fragmentShader = /* glsl */ `
  precision highp float;

  uniform float uTime;
  uniform vec3  uLightDir;   // world-space key direction (from pointer), damped
  uniform vec3  uTint;       // glass body tint
  uniform vec3  uRimColor;   // edge-glow colour
  uniform float uFresnel;    // fresnel power
  uniform float uOpacity;    // base (centre) opacity
  uniform float uSpecPow;    // specular sharpness
  uniform float uHover;      // 0..1 damped pointer presence

  varying vec3 vWorldNormal;
  varying vec3 vViewDir;
  varying vec3 vWorldPos;

  // sRGB monaka palette — linearised on output for <Canvas flat>
  const vec3 PAPER = vec3(0.925, 0.906, 0.867); // #ECE7DD
  const vec3 INK   = vec3(0.149, 0.141, 0.122); // #26241F
  const vec3 TERRA = vec3(0.776, 0.416, 0.247); // #C66A3F
  const vec3 SAND  = vec3(0.847, 0.796, 0.706);
  const vec3 COOL  = vec3(0.706, 0.749, 0.804); // faint cool fill for glass

  // Procedural studio environment sampled by a direction.
  // Vertical paper->sand->ink gradient + a warm key blob toward uLightDir
  // and a cool fill blob opposite it. This is what the glass "reflects".
  vec3 envColor(vec3 d) {
    float t = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 grad = mix(INK * 1.15, SAND, smoothstep(0.0, 0.6, t));
    grad = mix(grad, PAPER, smoothstep(0.45, 1.0, t));
    float key  = pow(max(dot(d, uLightDir), 0.0), 6.0);
    float fill = pow(max(dot(d, -uLightDir), 0.0), 3.0);
    grad += TERRA * key * 0.55;
    grad = mix(grad, COOL, fill * 0.28);
    return grad;
  }

  void main() {
    vec3 N = normalize(vWorldNormal);
    vec3 V = normalize(vViewDir);
    if (!gl_FrontFacing) N = -N;          // safety if a form is drawn 2-sided
    vec3 L = normalize(uLightDir);

    // --- Fresnel: the whole day in one line ---------------------------
    float fr = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), uFresnel);

    // reflection (mirror layer) and refraction (interior / thickness)
    vec3 R  = reflect(-V, N);
    vec3 Rf = refract(-V, N, 0.72);
    vec3 envR = envColor(R);
    vec3 envT = envColor(Rf);

    // interior body of the glass — deep, tinted, softly lit by the key
    float ndl = dot(N, L) * 0.5 + 0.5;
    vec3 interior = mix(INK, envT, 0.55);
    interior = mix(interior, uTint, 0.40);
    interior *= 0.75 + 0.45 * ndl;

    // Fresnel mixes interior -> mirror across the surface
    float refl = mix(0.08, 0.96, fr);
    vec3 col = mix(interior, envR, refl);

    // crisp specular glint that tracks the cursor-light
    float spec = pow(max(dot(R, L), 0.0), uSpecPow);
    col += spec * vec3(1.0) * 0.9;

    // the edge glow — Fresnel raised, tinted, swelled by hover
    vec3 rim = uRimColor * pow(fr, 1.3) * (0.55 + 0.95 * uHover);
    col += rim;

    // faint grain so the flats don't band
    float g = fract(sin(dot(vWorldPos.xy + uTime * 0.01, vec2(12.9898, 78.233))) * 43758.5453);
    col += (g - 0.5) * 0.015;

    // glass alpha: see-through centre, opaque glowing rim; glints stay solid
    float a = mix(uOpacity, 1.0, pow(fr, 0.85));
    a = clamp(a + spec * 0.5, 0.0, 1.0);

    gl_FragColor = vec4(pow(clamp(col, 0.0, 1.0), vec3(2.2)), a);
  }
`

const GlassMaterial = shaderMaterial(
  {
    uTime: 0,
    uLightDir: new THREE.Vector3(0.4, 0.6, 0.8),
    uTint: new THREE.Color('#8fa0ad'),
    uRimColor: new THREE.Color('#c66a3f'),
    uFresnel: 3.4,
    uOpacity: 0.14,
    uSpecPow: 200.0,
    uHover: 0,
  },
  vertexShader,
  fragmentShader,
)
extend({ GlassMaterial })

// A single glass form; owns its material so tint/opacity can differ per bead.
function Glass({ geometry, tint, rimColor, opacity, fresnel, specPow, floatSeed = 0, baseY, ...props }) {
  const mat = useRef()
  const grp = useRef()
  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    if (mat.current) mat.current.uTime = t
    if (grp.current) {
      grp.current.position.y = baseY + Math.sin(t * 0.6 + floatSeed) * 0.05
      grp.current.rotation.y = Math.sin(t * 0.15 + floatSeed) * 0.4
    }
  })
  return (
    <group ref={grp} {...props}>
      <mesh geometry={geometry}>
        <glassMaterial
          ref={mat}
          transparent
          depthWrite={false}
          uTint={tint}
          uRimColor={rimColor}
          uOpacity={opacity}
          uFresnel={fresnel}
          uSpecPow={specPow}
        />
      </mesh>
    </group>
  )
}

export default function Scene({ onState }) {
  const { camera } = useThree()

  // geometries (memoised) — smooth glass icosphere hero + faceted gem beads
  const heroGeo = useMemo(() => new THREE.IcosahedronGeometry(1, 12), [])
  const gemGeo = useMemo(() => new THREE.IcosahedronGeometry(1, 1), []) // faceted gem
  const octaGeo = useMemo(() => new THREE.OctahedronGeometry(1, 0), [])
  useEffect(() => () => { heroGeo.dispose(); gemGeo.dispose(); octaGeo.dispose() }, [heroGeo, gemGeo, octaGeo])

  // orbiting beads — placed on a gently tilted ring around the hero
  const beads = useMemo(() => {
    const out = []
    const N = 6
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2
      const r = 2.35
      out.push({
        pos: [Math.cos(a) * r, Math.sin(a * 2.0) * 0.55, Math.sin(a) * r],
        scale: 0.34 + (i % 2) * 0.12,
        gem: i % 2 === 0,
        seed: i * 1.7,
      })
    }
    return out
  }, [])

  // shared per-frame state
  const mats = useRef([])          // every glass material, for one-shot uniform push
  const rootGrp = useRef()
  const target = useRef({ lx: 0.15, ly: 0.55, hover: 0, px: 0, py: 0 })
  const pointer = useRef({ x: 0, y: 0, active: 0 })
  const lightDir = useRef(new THREE.Vector3(0.15, 0.55, 0.85).normalize())
  const lastState = useRef('')

  // collect all glass materials in the subtree after mount
  useEffect(() => {
    const found = []
    rootGrp.current?.traverse((o) => {
      if (o.material && o.material.uLightDir) found.push(o.material)
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

    // cursor becomes the studio key light — upper-front, swept by pointer
    tg.lx = THREE.MathUtils.damp(tg.lx, 0.15 + p.x * 1.15, 5, d)
    tg.ly = THREE.MathUtils.damp(tg.ly, 0.55 + p.y * 0.85, 5, d)
    tg.hover = THREE.MathUtils.damp(tg.hover, p.active, 3, d)
    lightDir.current.set(tg.lx, tg.ly, 0.85).normalize()

    // push shared light dir + hover into every glass material (one loop)
    for (const m of mats.current) {
      m.uLightDir.copy(lightDir.current)
      m.uHover = tg.hover
    }

    // camera parallax
    tg.px = THREE.MathUtils.damp(tg.px, p.x * 0.9, 4, d)
    tg.py = THREE.MathUtils.damp(tg.py, p.y * 0.6, 4, d)
    camera.position.set(tg.px, 0.35 + tg.py, 5.4)
    camera.lookAt(0, 0, 0)

    // slow drift of the whole cluster
    if (rootGrp.current) rootGrp.current.rotation.y += d * 0.05

    const s = tg.hover > 0.5 ? 'lit' : 'idle'
    if (s !== lastState.current) { lastState.current = s; onState && onState(s) }
  })

  return (
    <group>
      <group ref={rootGrp}>
        {/* hero */}
        <Glass
          geometry={heroGeo}
          position={[0, 0.1, 0]}
          baseY={0.1}
          scale={1.35}
          tint={new THREE.Color('#8fa0ad')}
          rimColor={new THREE.Color('#c66a3f')}
          opacity={0.12}
          fresnel={3.2}
          specPow={240}
          floatSeed={0}
        />
        {beads.map((b, i) => (
          <Glass
            key={i}
            geometry={b.gem ? gemGeo : octaGeo}
            position={b.pos}
            baseY={b.pos[1]}
            scale={b.scale}
            tint={b.gem ? new THREE.Color('#c98a5e') : new THREE.Color('#9aa7ad')}
            rimColor={new THREE.Color('#c66a3f')}
            opacity={b.gem ? 0.28 : 0.18}
            fresnel={b.gem ? 2.6 : 3.4}
            specPow={160}
            floatSeed={b.seed}
          />
        ))}
      </group>

      {/* soft grounding shadow — monaka negative space */}
      <ContactShadows
        position={[0, -1.65, 0]}
        opacity={0.3}
        scale={12}
        blur={2.8}
        far={5}
        resolution={512}
        color="#26241f"
      />
    </group>
  )
}
