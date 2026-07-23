import { useRef, useMemo, useLayoutEffect } from 'react'
import { useFrame, useThree, extend } from '@react-three/fiber'
import { Environment, Lightformer, shaderMaterial } from '@react-three/drei'
import { EffectComposer, Bloom, Vignette, Noise } from '@react-three/postprocessing'
import { BlendFunction } from 'postprocessing'
import * as THREE from 'three'
import { Atmosphere } from './Atmosphere.jsx'

/* ------------------------------------------------------------------ *
 * Day 024 — Week 4 · SCENE COMPOSITION  "Meridian"
 *
 * The ⭐5 capstone: one coherent WORLD built by composing everything the
 * project has learned — real lights + a procedural studio (wk1/3), a
 * displaced relief ground shader (Day 016) that catches the sun, an
 * instanced field of standing monuments receding into haze (wk1/2), a
 * drifting mote stratum (Day 012), and a full post stack — all bound
 * together by the NEW depth-fog Atmosphere pass (Atmosphere.jsx) so near
 * porcelain and far monoliths sit in a single volume of air.
 *
 * Interaction: POINTER-AS-SUN (time of day). The cursor steers the sun's
 * azimuth (x) and elevation (y); the key light, the sky gradient, the fog
 * colour, and the screen-space sun glow all move together — you don't push
 * an object, you move the light of the whole world.
 * ------------------------------------------------------------------ */

function mulberry32(a) {
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/* ---- ground: relief shader (Day 016 heritage), lit by the moving sun ---- */
const GroundMaterial = shaderMaterial(
  {
    uTime: 0,
    uSunDir: new THREE.Vector3(0, 0.3, -1),
    uPaper: new THREE.Color('#d9d0c0'),
    uWarm: new THREE.Color('#c9a988'),
    uSunColor: new THREE.Color('#ffb974'),
    uLow: 0.3,
  },
  /* glsl vertex */ `
    uniform float uTime;
    varying vec3 vNormalW;
    varying float vHeight;

    float hash(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
    float vnoise(vec2 p){
      vec2 i=floor(p), f=fract(p);
      float a=hash(i), b=hash(i+vec2(1.,0.)), c=hash(i+vec2(0.,1.)), d=hash(i+vec2(1.,1.));
      vec2 u=f*f*(3.-2.*f);
      return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
    }
    float fbm(vec2 p){ float s=0.,a=0.5; for(int i=0;i<3;i++){ s+=a*vnoise(p); p*=2.0; a*=0.5; } return s; }
    // gentle rolling relief; drifts very slowly so the ground breathes
    float heightAt(vec2 p){ return (fbm(p*0.11 + uTime*0.008) - 0.5) * 0.9; }

    void main(){
      vec3 pos = position;
      float h = heightAt(pos.xy);
      pos.z += h;
      // analytic-ish normal from finite differences (Day 016)
      float e = 0.6;
      float hx = heightAt(pos.xy + vec2(e,0.)) - heightAt(pos.xy - vec2(e,0.));
      float hy = heightAt(pos.xy + vec2(0.,e)) - heightAt(pos.xy - vec2(0.,e));
      vec3 n = normalize(vec3(-hx, -hy, 2.0*e));
      vNormalW = normalize(normalMatrix * n);
      vHeight = h;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
    }
  `,
  /* glsl fragment */ `
    uniform vec3 uSunDir;
    uniform vec3 uPaper;
    uniform vec3 uWarm;
    uniform vec3 uSunColor;
    uniform float uLow;
    varying vec3 vNormalW;
    varying float vHeight;

    void main(){
      vec3 N = normalize(vNormalW);
      float lamb = clamp(dot(N, normalize(uSunDir)), 0.0, 1.0);
      vec3 base = mix(uPaper, uWarm, uLow * 0.65);
      vec3 col = base * (0.5 + lamb * 0.85);
      col += uSunColor * lamb * 0.16;                 // warm sun kiss on slopes
      // faint contour lines wrapped over the relief (Day 015/016)
      float hv = vHeight * 2.6;
      float ev = abs(fract(hv) - 0.5);
      float aa = fwidth(hv);
      float line = 1.0 - smoothstep(0.0, aa * 2.0, ev);
      col = mix(col, col * 0.86, line * 0.3);
      gl_FragColor = vec4(col, 1.0);
    }
  `,
)
extend({ GroundMaterial })

function Ground({ matRef }) {
  const geo = useMemo(() => new THREE.PlaneGeometry(200, 200, 220, 220), [])
  return (
    <mesh geometry={geo} rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.7, -18]}>
      <groundMaterial ref={matRef} key={GroundMaterial.key} />
    </mesh>
  )
}

/* ---- the monument field: instanced standing stones receding into haze ---- */
function Monuments({ material }) {
  const meshRef = useRef()
  const items = useMemo(() => {
    const rnd = mulberry32(0x024f)
    const arr = []
    const N = 42
    for (let i = 0; i < N; i++) {
      // recede along -z; keep the near lower-left open for the headline
      const z = THREE.MathUtils.lerp(2.5, -52, rnd() ** 0.8)
      const spread = THREE.MathUtils.lerp(5.0, 26, (2.5 - z) / 54)
      let x = (rnd() - 0.5) * 2 * spread
      // bias away from the front-left quadrant where the type sits
      if (z > -6 && x < 0) x = Math.abs(x) * 0.5 + 1.2
      const tall = THREE.MathUtils.lerp(1.6, 4.8, rnd()) * (z < -20 ? 1.3 : 1)
      const w = 0.24 + rnd() * 0.2
      arr.push({ x, z, tall, w, yaw: (rnd() - 0.5) * 0.5, tone: 0.82 + rnd() * 0.16 })
    }
    return arr
  }, [])

  const geo = useMemo(() => {
    const g = new THREE.BoxGeometry(1, 1, 1)
    return g
  }, [])

  useLayoutEffect(() => {
    const m = meshRef.current
    const dummy = new THREE.Object3D()
    const col = new THREE.Color()
    const base = new THREE.Color('#efe8dc')
    items.forEach((it, i) => {
      // sink the base slightly below the relief ground so nothing floats
      dummy.position.set(it.x, -1.95 + it.tall / 2, it.z)
      dummy.rotation.set(0, it.yaw, 0)
      dummy.scale.set(it.w, it.tall, it.w)
      dummy.updateMatrix()
      m.setMatrixAt(i, dummy.matrix)
      col.copy(base).multiplyScalar(it.tone)
      m.setColorAt(i, col)
    })
    m.instanceMatrix.needsUpdate = true
    if (m.instanceColor) m.instanceColor.needsUpdate = true
  }, [items])

  return (
    <instancedMesh ref={meshRef} args={[geo, material, items.length]} castShadow={false} />
  )
}

/* ---- drifting motes (Day 012 heritage) — dust catching the low sun ---- */
function Motes() {
  const matRef = useRef()
  const { geometry, uniforms } = useMemo(() => {
    const rnd = mulberry32(0x0242)
    const N = 900
    const pos = new Float32Array(N * 3)
    const seed = new Float32Array(N)
    for (let i = 0; i < N; i++) {
      pos[i * 3 + 0] = (rnd() - 0.5) * 40
      pos[i * 3 + 1] = rnd() * 8 - 1.2
      pos[i * 3 + 2] = THREE.MathUtils.lerp(4, -40, rnd())
      seed[i] = rnd() * 6.283
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1))
    const uniforms = { uTime: { value: 0 }, uColor: { value: new THREE.Color('#ffdcae') } }
    return { geometry, uniforms }
  }, [])

  useFrame((state) => {
    if (matRef.current) matRef.current.uniforms.uTime.value = state.clock.elapsedTime
  })

  return (
    <points geometry={geometry}>
      <shaderMaterial
        ref={matRef}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        uniforms={uniforms}
        vertexShader={`
          uniform float uTime;
          attribute float aSeed;
          varying float vA;
          void main(){
            vec3 p = position;
            p.x += sin(uTime*0.15 + aSeed) * 0.6;
            p.y += sin(uTime*0.1 + aSeed*1.7) * 0.4 + cos(uTime*0.05 + aSeed)*0.2;
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            gl_Position = projectionMatrix * mv;
            float d = -mv.z;
            gl_PointSize = (18.0 / d) * (0.6 + 0.4*sin(uTime*0.6 + aSeed));
            vA = smoothstep(45.0, 8.0, d) * 0.5;
          }
        `}
        fragmentShader={`
          uniform vec3 uColor;
          varying float vA;
          void main(){
            vec2 uv = gl_PointCoord - 0.5;
            float r = length(uv);
            float a = smoothstep(0.5, 0.0, r) * vA;
            gl_FragColor = vec4(uColor, a);
          }
        `}
      />
    </points>
  )
}

/* ---- the hero: a standing porcelain gate + calm forms (the focal point) ---- */
function Hero() {
  const groupRef = useRef()
  const emberRef = useRef()
  const porcelain = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        color: new THREE.Color('#f3ede2'),
        roughness: 0.4,
        metalness: 0.0,
        clearcoat: 0.7,
        clearcoatRoughness: 0.3,
        sheen: 0.4,
        sheenColor: new THREE.Color('#ffe8d0'),
      }),
    [],
  )
  const geoGate = useMemo(() => new THREE.TorusGeometry(1.55, 0.17, 28, 96), [])
  const geoSphere = useMemo(() => new THREE.SphereGeometry(1, 96, 96), [])
  const geoSlab = useMemo(() => new THREE.BoxGeometry(0.34, 3.1, 0.34), [])

  useFrame((state) => {
    const t = state.clock.elapsedTime
    if (groupRef.current) groupRef.current.rotation.y = Math.sin(t * 0.04) * 0.08
    if (emberRef.current) {
      const p = 0.5 + 0.5 * Math.sin(t * 0.9)
      emberRef.current.material.emissiveIntensity = 2.2 * (0.7 + 0.6 * p)
    }
  })

  return (
    <group ref={groupRef} position={[1.4, 0, -3.2]}>
      {/* the gate — a standing ring, the world's landmark */}
      <mesh geometry={geoGate} material={porcelain} position={[0, 0.35, 0]} scale={1.15} />
      {/* calm anchoring sphere at its foot */}
      <mesh geometry={geoSphere} material={porcelain} position={[-1.35, -1.05, 0.6]} scale={0.62} />
      {/* a slender monolith */}
      <mesh geometry={geoSlab} material={porcelain} position={[1.5, -0.15, -0.4]} />
      {/* terracotta ember — the single warm accent, seeds bloom */}
      <mesh ref={emberRef} geometry={geoSphere} position={[-0.55, -1.35, 1.1]} scale={0.16}>
        <meshStandardMaterial
          color="#1a1510"
          emissive={new THREE.Color('#e0813f')}
          emissiveIntensity={2.2}
          roughness={0.4}
        />
      </mesh>
    </group>
  )
}

/* ---- the rig: pointer → sun; drives lights, ground, atmosphere, camera ---- */
function SunRig({ atmoRef, groundRef, sunRef, coolRef, onSun }) {
  const { camera, pointer, size } = useThree()
  const s = useRef({ az: 0.25, el: 0.24, camX: 0, camY: 0.8, label: '' })
  const last = useRef(0)
  const sunDir = useMemo(() => new THREE.Vector3(), [])
  const sunPt = useMemo(() => new THREE.Vector3(), [])
  const horizon = useMemo(() => new THREE.Vector3(), [])
  const zenith = useMemo(() => new THREE.Vector3(), [])
  const sunCol = useMemo(() => new THREE.Vector3(), [])
  const cA = useMemo(() => new THREE.Color(), [])
  const cB = useMemo(() => new THREE.Color(), [])

  // dawn (low) → morning (high) palettes for the air
  const HORIZON_LOW = new THREE.Color('#f4c893')
  const HORIZON_HIGH = new THREE.Color('#e6ddca')
  const ZENITH_LOW = new THREE.Color('#9fb0c6')
  const ZENITH_HIGH = new THREE.Color('#aebfd2')
  const SUN_LOW = new THREE.Color('#ff9c4d')
  const SUN_HIGH = new THREE.Color('#fff0d2')

  useFrame((state, delta) => {
    const st = s.current
    const wantAz = THREE.MathUtils.clamp(pointer.x, -1, 1) * 1.15
    const wantEl = THREE.MathUtils.lerp(0.06, 0.62, pointer.y * 0.5 + 0.5)
    st.az = THREE.MathUtils.damp(st.az, wantAz, 3.0, delta)
    st.el = THREE.MathUtils.damp(st.el, wantEl, 3.0, delta)

    const ce = Math.cos(st.el)
    sunDir.set(Math.sin(st.az) * ce, Math.sin(st.el), -Math.cos(st.az) * ce).normalize()

    // "lowness" 1 at horizon → 0 up high, drives all the warmth
    const low = THREE.MathUtils.clamp(1.0 - st.el / 0.62, 0, 1)

    // key light = the sun
    if (sunRef.current) {
      sunRef.current.position.set(sunDir.x * 20, sunDir.y * 20 + 2, sunDir.z * 20)
      sunRef.current.color.copy(cA.copy(SUN_LOW).lerp(SUN_HIGH, 1 - low))
      sunRef.current.intensity = 2.0 + (1 - low) * 1.2
    }
    if (coolRef.current) coolRef.current.intensity = 0.5 + low * 0.35

    // ground uniforms
    if (groundRef.current) {
      groundRef.current.uniforms.uSunDir.value.copy(sunDir)
      groundRef.current.uniforms.uLow.value = low
      groundRef.current.uniforms.uSunColor.value.copy(cA.copy(SUN_LOW).lerp(SUN_HIGH, 1 - low))
      groundRef.current.uniforms.uTime.value = state.clock.elapsedTime
    }

    // project the sun to screen uv for the atmosphere glow
    sunPt.copy(camera.position).addScaledVector(sunDir, 45)
    sunPt.project(camera)
    const su = sunPt.x * 0.5 + 0.5
    const sv = sunPt.y * 0.5 + 0.5

    if (atmoRef.current) {
      cA.copy(HORIZON_LOW).lerp(HORIZON_HIGH, 1 - low)
      cB.copy(ZENITH_LOW).lerp(ZENITH_HIGH, 1 - low)
      cActrl(horizon, cA)
      cActrl(zenith, cB)
      cActrl(sunCol, cA.copy(SUN_LOW).lerp(SUN_HIGH, 1 - low))
      atmoRef.current.set({
        horizon,
        zenith,
        sun: new THREE.Vector2(su, sv),
        sunColor: sunCol,
        sunStr: 0.55 + low * 0.5,
        density: 0.05,
        near: camera.near,
        far: camera.far,
        aspect: size.width / size.height,
      })
    }

    // very slight parallax; the sun is the interaction, not the camera
    st.camX = THREE.MathUtils.damp(st.camX, pointer.x * 0.5, 2.0, delta)
    st.camY = THREE.MathUtils.damp(st.camY, 0.8 + pointer.y * 0.18, 2.0, delta)
    camera.position.x = st.camX
    camera.position.y = st.camY
    camera.lookAt(0.5, 0.1, -3.0)

    // HUD readout ~8/s
    const now = state.clock.elapsedTime
    if (now - last.current > 0.12) {
      last.current = now
      const label = low > 0.72 ? 'First light' : low > 0.4 ? 'Low sun' : low > 0.15 ? 'Morning' : 'High morning'
      const azDeg = Math.round((st.az * 180) / Math.PI)
      if (label !== st.label || true) {
        st.label = label
        onSun({ label, az: azDeg, el: Math.round((st.el * 180) / Math.PI) })
      }
    }
  })

  return null
}

// copy a THREE.Color's rgb into a THREE.Vector3 (atmosphere uniforms are vec3)
function cActrl(v, c) {
  v.set(c.r, c.g, c.b)
}

export default function Scene({ onSun }) {
  const atmoRef = useRef()
  const groundRef = useRef()
  const sunRef = useRef()
  const coolRef = useRef()

  // shared porcelain-ish material for the instanced monuments
  const monumentMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        vertexColors: false,
        color: new THREE.Color('#e9e1d3'),
        roughness: 0.62,
        metalness: 0.0,
      }),
    [],
  )

  return (
    <>
      <color attach="background" args={['#e7ddca']} />

      <hemisphereLight args={['#fff4e2', '#b9ad97', 0.7]} />
      <directionalLight ref={sunRef} position={[6, 6, -6]} intensity={2.4} color="#ffcf9a" />
      <directionalLight ref={coolRef} position={[-6, 3, 5]} intensity={0.6} color="#c7d6f2" />

      {/* procedural studio for the porcelain reflections — baked once, offline-safe */}
      <Environment resolution={256} frames={1}>
        <color attach="background" args={['#2a2620']} />
        <Lightformer intensity={2.0} position={[4, 4, -3]} scale={[7, 7, 1]} color="#fff1da" />
        <Lightformer intensity={0.8} position={[-5, 2, 3]} scale={[6, 6, 1]} color="#c3d4ff" />
        <Lightformer intensity={1.0} position={[0, -3, 2]} scale={[9, 3, 1]} color="#ffe6c8" />
      </Environment>

      <Ground matRef={groundRef} />
      <Monuments material={monumentMat} />
      <Hero />
      <Motes />

      <SunRig
        atmoRef={atmoRef}
        groundRef={groundRef}
        sunRef={sunRef}
        coolRef={coolRef}
        onSun={onSun}
      />

      {/* the composited air: our depth-fog Atmosphere paints the sky + hazes
          the scene into one volume, THEN bloom lifts the sun, then finish. */}
      <EffectComposer disableNormalPass multisampling={4}>
        <Atmosphere ref={atmoRef} />
        <Bloom mipmapBlur luminanceThreshold={0.85} luminanceSmoothing={0.3} intensity={0.7} radius={0.8} />
        <Vignette eskil={false} offset={0.3} darkness={0.5} />
        <Noise premultiply blendFunction={BlendFunction.OVERLAY} opacity={0.22} />
      </EffectComposer>
    </>
  )
}
