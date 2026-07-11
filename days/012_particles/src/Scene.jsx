import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'

/* ------------------------------------------------------------------ *
 * Day 012 — Particle field · "Drift"
 *
 * First use of a raw ShaderMaterial on <points>: a GPU particle field
 * where all motion lives in the vertex shader.  A curl-noise vector
 * field advects every point, and the pointer (raycast onto y=0, reused
 * from Day 009) drives a Gaussian repulsion + updraft — all stateless,
 * so the field naturally eases back once the cursor leaves.  Depth-fog
 * fades far points into the paper for atmosphere.  Palette stays in the
 * house tones: graphite ink on warm paper, terracotta where disturbed.
 * ------------------------------------------------------------------ */

const PAPER = new THREE.Color('#ece7dd')
const INK = new THREE.Color('#2b2924')
const ACCENT = new THREE.Color('#c66a3f')

const COUNT = 40000
const DISC_R = 17.0

// ---- classic Ashima 3D simplex noise + curl (GLSL) ------------------
const NOISE_GLSL = /* glsl */ `
vec3 mod289(vec3 x){ return x - floor(x*(1.0/289.0))*289.0; }
vec4 mod289(vec4 x){ return x - floor(x*(1.0/289.0))*289.0; }
vec4 permute(vec4 x){ return mod289(((x*34.0)+1.0)*x); }
vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314*r; }

float snoise(vec3 v){
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
             i.z + vec4(0.0, i1.z, i2.z, 1.0))
           + i.y + vec4(0.0, i1.y, i2.y, 1.0))
           + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ *ns.x + ns.yyyy;
  vec4 y = y_ *ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0)*2.0 + 1.0;
  vec4 s1 = floor(b1)*2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}

vec3 snoiseVec3(vec3 x){
  return vec3(
    snoise(x),
    snoise(vec3(x.y - 19.1, x.z + 33.4, x.x + 47.2)),
    snoise(vec3(x.z + 74.2, x.x - 124.5, x.y + 99.4))
  );
}

vec3 curlNoise(vec3 p){
  const float e = 0.12;
  vec3 dx = vec3(e, 0.0, 0.0);
  vec3 dy = vec3(0.0, e, 0.0);
  vec3 dz = vec3(0.0, 0.0, e);
  vec3 px0 = snoiseVec3(p - dx), px1 = snoiseVec3(p + dx);
  vec3 py0 = snoiseVec3(p - dy), py1 = snoiseVec3(p + dy);
  vec3 pz0 = snoiseVec3(p - dz), pz1 = snoiseVec3(p + dz);
  float x = py1.z - py0.z - pz1.y + pz0.y;
  float y = pz1.x - pz0.x - px1.z + px0.z;
  float z = px1.y - px0.y - py1.x + py0.x;
  return vec3(x, y, z) / (2.0 * e);
}
`

const VERT = /* glsl */ `
uniform float uTime;
uniform vec3  uMouse;
uniform float uPress;
uniform float uSize;
uniform float uPixelRatio;

attribute float aScale;
attribute float aSeed;

varying float vProx;
varying float vDepth;
varying float vSpeed;

${NOISE_GLSL}

void main(){
  vec3 base = position;

  // slow curl-noise current — mostly horizontal, gentle vertical sway
  vec3 flow = curlNoise(base * 0.055 + vec3(0.0, uTime * 0.03, uTime * 0.05));
  flow.y *= 0.4;
  vec3 disp = flow * (0.9 + aSeed * 0.5);

  // per-particle breathing bob so the field never reads as frozen
  disp.y += sin(uTime * 0.6 + aSeed * 6.2831) * 0.12;

  // pointer repulsion + updraft (Gaussian falloff in the xz plane)
  vec3 d = base - uMouse; d.y = 0.0;
  float dist = length(d);
  float sigma = 2.6;
  float w = exp(-dist * dist / (2.0 * sigma * sigma));
  vec3 dir = dist > 1e-4 ? d / dist : vec3(0.0);
  float press = uPress;
  disp += dir * w * (2.4 + press * 2.4);
  disp.y += w * (1.1 + press * 2.6);

  vec3 pos = base + disp;

  // colour tracks raw proximity only, so pressing grows the motion, not
  // the warm footprint — keeps the field mostly graphite / minimal
  vProx  = clamp(w, 0.0, 1.0);
  vSpeed = clamp(length(flow) * 0.5, 0.0, 1.0);

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;

  float atten = 320.0 / max(-mv.z, 0.1);
  gl_PointSize = uSize * aScale * uPixelRatio * atten * (1.0 + vProx * 1.6);
}
`

const FRAG = /* glsl */ `
precision highp float;

uniform vec3  uInk;
uniform vec3  uAccent;
uniform vec3  uPaper;
uniform float uFogNear;
uniform float uFogFar;

varying float vProx;
varying float vDepth;
varying float vSpeed;

void main(){
  // soft round sprite
  vec2 c = gl_PointCoord - 0.5;
  float r = length(c);
  float alpha = smoothstep(0.5, 0.12, r);
  if (alpha <= 0.001) discard;

  // ink by default, warming toward terracotta only close to the cursor
  float warm = clamp(smoothstep(0.15, 0.85, vProx) + vSpeed * 0.12, 0.0, 1.0);
  vec3 col = mix(uInk, uAccent, warm);

  // depth fog into the paper for atmosphere
  float fog = smoothstep(uFogNear, uFogFar, vDepth);
  col = mix(col, uPaper, fog);
  alpha *= mix(0.9, 0.06, fog);
  alpha *= 0.55 + vProx * 0.45;

  gl_FragColor = vec4(col, alpha);
}
`

export default function Scene() {
  const matRef = useRef()
  const groupRef = useRef()
  const { camera } = useThree()

  // ---- pointer state (raycast onto y=0, reused from Day 009) --------
  const pointer = useRef({
    world: new THREE.Vector3(0, 0, 40), // start off-field
    target: new THREE.Vector3(0, 0, 40),
    ndc: new THREE.Vector2(0, 0),
    press: 0,
    pressTarget: 0,
  })
  const ray = useMemo(() => new THREE.Raycaster(), [])
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), [])
  const hit = useMemo(() => new THREE.Vector3(), [])

  // ---- particle attributes -----------------------------------------
  const { positions, scales, seeds } = useMemo(() => {
    const positions = new Float32Array(COUNT * 3)
    const scales = new Float32Array(COUNT)
    const seeds = new Float32Array(COUNT)
    for (let i = 0; i < COUNT; i++) {
      // uniform-ish disc, biased slightly denser toward the centre
      const t = Math.random()
      const r = DISC_R * Math.pow(t, 0.62)
      const a = Math.random() * Math.PI * 2
      positions[i * 3 + 0] = Math.cos(a) * r
      positions[i * 3 + 1] = (Math.random() - 0.5) * 0.6
      positions[i * 3 + 2] = Math.sin(a) * r
      scales[i] = 0.55 + Math.random() * 1.1
      seeds[i] = Math.random()
    }
    return { positions, scales, seeds }
  }, [])

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uMouse: { value: new THREE.Vector3(0, 0, 40) },
      uPress: { value: 0 },
      uSize: { value: 0.9 },
      uPixelRatio: { value: 1 },
      uInk: { value: INK },
      uAccent: { value: ACCENT },
      uPaper: { value: PAPER },
      uFogNear: { value: 14 },
      uFogFar: { value: 34 },
    }),
    []
  )

  const onMove = (e) => {
    pointer.current.ndc.set(
      (e.clientX / window.innerWidth) * 2 - 1,
      -(e.clientY / window.innerHeight) * 2 + 1
    )
  }
  const onDown = () => (pointer.current.pressTarget = 1)
  const onUp = () => (pointer.current.pressTarget = 0)

  useFrame((state, delta) => {
    const dt = Math.min(delta, 1 / 30)
    const p = pointer.current

    // NDC -> world point on the ground plane
    ray.setFromCamera(p.ndc, camera)
    if (ray.ray.intersectPlane(plane, hit)) p.target.copy(hit)

    p.world.x = THREE.MathUtils.damp(p.world.x, p.target.x, 9, dt)
    p.world.y = THREE.MathUtils.damp(p.world.y, p.target.y, 9, dt)
    p.world.z = THREE.MathUtils.damp(p.world.z, p.target.z, 9, dt)
    p.press = THREE.MathUtils.damp(p.press, p.pressTarget, 6, dt)

    if (matRef.current) {
      const u = matRef.current.uniforms
      u.uTime.value = state.clock.elapsedTime
      u.uMouse.value.copy(p.world)
      u.uPress.value = p.press
      u.uPixelRatio.value = state.gl.getPixelRatio()
    }

    // whole-field slow yaw + subtle parallax toward the pointer
    if (groupRef.current) {
      groupRef.current.rotation.y = state.clock.elapsedTime * 0.02
    }
    const px = p.ndc.x, py = p.ndc.y
    camera.position.x = THREE.MathUtils.damp(camera.position.x, px * 1.6, 3, dt)
    camera.position.y = THREE.MathUtils.damp(camera.position.y, 6.2 + py * 0.9, 3, dt)
    camera.lookAt(0, 0.4, 0)
  })

  return (
    <>
      <color attach="background" args={['#ece7dd']} />
      <fog attach="fog" args={['#ece7dd', 26, 46]} />

      {/* full-viewport invisible catcher so pointer events always fire */}
      <mesh
        position={[0, 0, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        onPointerMove={onMove}
        onPointerDown={onDown}
        onPointerUp={onUp}
        onPointerLeave={onUp}
        visible={false}
      >
        <planeGeometry args={[200, 200]} />
        <meshBasicMaterial />
      </mesh>

      <group ref={groupRef}>
        <points frustumCulled={false}>
          <bufferGeometry>
            <bufferAttribute
              attach="attributes-position"
              count={COUNT}
              array={positions}
              itemSize={3}
            />
            <bufferAttribute
              attach="attributes-aScale"
              count={COUNT}
              array={scales}
              itemSize={1}
            />
            <bufferAttribute
              attach="attributes-aSeed"
              count={COUNT}
              array={seeds}
              itemSize={1}
            />
          </bufferGeometry>
          <shaderMaterial
            ref={matRef}
            uniforms={uniforms}
            vertexShader={VERT}
            fragmentShader={FRAG}
            transparent
            depthWrite={false}
            depthTest
            blending={THREE.NormalBlending}
          />
        </points>
      </group>
    </>
  )
}
