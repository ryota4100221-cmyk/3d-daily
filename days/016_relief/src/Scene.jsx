import { useRef, useEffect, useMemo } from 'react'
import { useFrame, useThree, extend } from '@react-three/fiber'
import { shaderMaterial } from '@react-three/drei'
import * as THREE from 'three'

/* ------------------------------------------------------------------ *
 * Day 016 — Week 3 · "Relief"  (頂点シェーダ変位 / vertex displacement)
 *
 * Yesterday (Day 015) the terrain was FAKED — a flat full-screen fragment
 * shader that only *looked* three-dimensional. Today the vertices actually
 * move: a high-resolution plane is displaced along its normal inside the
 * VERTEX shader by sin waves + dependency-free fBm noise, so it becomes a
 * real, lit, perspective-correct relief you can orbit-drift around.
 *
 * The new technique — and the "one step higher" of the day — is recomputing
 * the surface NORMAL analytically *in the shader* from the height field
 * (four neighbour taps -> two tangents -> cross product). Displacing a mesh
 * is easy; lighting it correctly is the hard part, because the mesh's baked
 * normals no longer match the deformed surface. Deriving fresh normals per
 * vertex is what makes the crests catch the key light and the valleys fall
 * into shadow instead of the whole panel reading flat.
 *
 * On top of the lit surface we draw contour isolines (a callback to Day 015,
 * now wrapped onto true 3D geometry via a height varying + fwidth), a soft
 * fresnel rim, and a pointer SWELL: the ray is cast onto the panel's plane
 * (Day 009 lineage) and its local position feeds a Gaussian bump that raises
 * and warms the terrain toward the cursor, easing back when you leave.
 *
 * No lights, no textures, no fetch — fully offline-safe. Custom lighting is
 * done by hand in the fragment shader; troika Text is avoided (white-screen
 * trap). monaka palette: paper / ink / terracotta.
 * ------------------------------------------------------------------ */

const vertexShader = /* glsl */ `
  precision highp float;

  uniform float uTime;
  uniform float uAmp;
  uniform vec2  uPointer;   // panel-local XY, damped
  uniform float uHover;     // 0..1 damped presence
  uniform float uSigma;     // pointer influence radius squared

  varying vec3  vNormalW;   // world-space analytic normal
  varying vec3  vViewDir;   // view-space eye direction
  varying float vHeight;    // displacement (for tone + contours)
  varying float vSwell;     // pointer bump strength (for warming)
  varying vec2  vUv;

  // --- dependency-free value-noise fBm (hash -> quintic -> 5 octaves) ---
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

  // height of the relief at a panel-local XY position (centred ~0)
  float heightAt(vec2 pos) {
    float t = uTime;
    // drifting, slowly rotating sampling domain -> a moving tide
    float ca = cos(t * 0.03), sa = sin(t * 0.03);
    vec2 q = mat2(ca, -sa, sa, ca) * (pos * 1.35);
    q += vec2(0.05 * t, -0.035 * t);

    float h = fbm(q) - 0.5;                          // base rolling terrain
    // long, gentle sin swell crossing the field (curriculum: sin wave)
    h += 0.11 * sin(pos.x * 2.6 + t * 0.5) * cos(pos.y * 2.1 - t * 0.35);

    // pointer swell — a Gaussian mound raised toward the cursor
    vec2 d = pos - uPointer;
    float bump = exp(-dot(d, d) / uSigma) * uHover;
    h += bump * 0.85;
    return h;
  }

  void main() {
    vUv = uv;
    vec2 pos = position.xy;

    float h = heightAt(pos);
    vHeight = h;

    vec2 d = pos - uPointer;
    vSwell = exp(-dot(d, d) / uSigma) * uHover;

    // --- analytic normal: four neighbour taps -> two tangents -> cross ---
    float e = 0.012;
    float hR = heightAt(pos + vec2(e, 0.0));
    float hL = heightAt(pos - vec2(e, 0.0));
    float hU = heightAt(pos + vec2(0.0, e));
    float hD = heightAt(pos - vec2(0.0, e));
    vec3 tx = vec3(2.0 * e, 0.0, (hR - hL) * uAmp);
    vec3 ty = vec3(0.0, 2.0 * e, (hU - hD) * uAmp);
    vec3 nLocal = normalize(cross(tx, ty));
    vNormalW = normalize(normalMatrix * nLocal);

    // displace along the plane's local +Z, then to clip space
    vec3 displaced = vec3(position.xy, position.z + h * uAmp);
    vec4 mv = modelViewMatrix * vec4(displaced, 1.0);
    vViewDir = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`

const fragmentShader = /* glsl */ `
  precision highp float;

  uniform float uTime;

  varying vec3  vNormalW;
  varying vec3  vViewDir;
  varying float vHeight;
  varying float vSwell;
  varying vec2  vUv;

  // sRGB palette (matches the HUD) -> linearised on output for flat rendering
  const vec3 PAPER = vec3(0.925, 0.906, 0.867); // #ECE7DD
  const vec3 INK   = vec3(0.149, 0.141, 0.122); // #26241F
  const vec3 TERRA = vec3(0.776, 0.416, 0.247); // #C66A3F

  const float DENSITY = 8.0; // contour bands across the relief

  vec3 toLinear(vec3 c) { return pow(c, vec3(2.2)); }
  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 345.45));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
  }

  void main() {
    vec3 N = normalize(vNormalW);
    vec3 V = normalize(vViewDir);

    // hand-rolled lighting: one key + a cool fill, wrapped a touch
    vec3 keyDir  = normalize(vec3(0.40, 0.72, 0.55));
    vec3 fillDir = normalize(vec3(-0.45, 0.20, 0.35));
    float key  = clamp(dot(N, keyDir), 0.0, 1.0);
    float fill = clamp(dot(N, fillDir) * 0.5 + 0.5, 0.0, 1.0);

    // elevation tone: valleys sink toward ink-tinted paper, crests brighten
    float elev = clamp(vHeight * 0.9 + 0.5, 0.0, 1.0);
    vec3 base = mix(PAPER * 0.82, PAPER, elev);
    base *= 0.62 + 0.42 * key + 0.14 * fill;

    // subtle fresnel rim to lift the silhouette off the paper
    float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.0);
    base += fres * 0.10;

    // contour isolines on the true surface (Day 015, now on 3D geometry)
    float f = vHeight * DENSITY;
    float w = fwidth(f);
    float df = abs(fract(f + 0.5) - 0.5);
    float lineMinor = 1.0 - smoothstep(0.0, w * 1.5, df);
    float lineMajor = 1.0 - smoothstep(0.0, w * 3.0, df);
    float idx = floor(f + 0.5);
    float isMajor = 1.0 - clamp(abs(mod(idx, 5.0)), 0.0, 1.0);
    float ai = max(lineMinor * 0.30 * (1.0 - isMajor), lineMajor * 0.55 * isMajor);

    float warmth = clamp(vSwell * 1.6, 0.0, 1.0);
    vec3 lineCol = mix(INK, TERRA, warmth);
    base = mix(base, lineCol, ai);

    // warm the swell region toward terracotta, and glow its peak
    base = mix(base, mix(base, TERRA, 0.55), clamp(vSwell * 0.7, 0.0, 1.0) * 0.5);
    base = mix(base, mix(base, PAPER, 0.25), clamp(vSwell - 0.4, 0.0, 1.0));

    // paper grain + soft vignette by uv
    base += (hash(vUv * 850.0 + uTime) - 0.5) * 0.014;
    float vig = smoothstep(1.15, 0.25, length(vUv - 0.5));
    base *= 0.92 + 0.08 * vig;

    gl_FragColor = vec4(toLinear(base), 1.0);
  }
`

const ReliefMaterial = shaderMaterial(
  { uTime: 0, uAmp: 0.5, uPointer: new THREE.Vector2(0, 0), uHover: 0, uSigma: 0.08 },
  vertexShader,
  fragmentShader,
)
extend({ ReliefMaterial })

export default function Scene({ onState }) {
  const mesh = useRef()
  const mat = useRef()
  const { camera } = useThree()

  // pointer -> panel-local swell target, damped frame-rate-independently
  const target = useRef(new THREE.Vector2(0, 0))
  const cur = useRef(new THREE.Vector2(0, 0))
  const hover = useRef(0)
  const moved = useRef(false)
  const lastMove = useRef(-10)
  const lastLabel = useRef('drift')

  // reusable scratch for the cheap ray-plane cast (no per-frame allocation)
  const geo = useMemo(
    () => ({
      ray: new THREE.Ray(),
      plane: new THREE.Plane(),
      normal: new THREE.Vector3(),
      hit: new THREE.Vector3(),
    }),
    [],
  )

  useEffect(() => {
    const h = () => (moved.current = true)
    window.addEventListener('pointermove', h)
    return () => window.removeEventListener('pointermove', h)
  }, [])

  useFrame((st, delta) => {
    const m = mat.current
    const ob = mesh.current
    if (!m || !ob) return
    const t = st.clock.elapsedTime
    const dt = Math.min(delta, 1 / 30)

    m.uTime = t

    // gentle idle sway so the relief breathes even when untouched
    ob.rotation.z = -0.14 + Math.sin(t * 0.18) * 0.05
    ob.rotation.y = Math.sin(t * 0.13) * 0.06

    // cast the pointer ray onto the panel's (undisplaced) plane -> local XY
    geo.ray.origin.setFromMatrixPosition(camera.matrixWorld)
    geo.ray.direction
      .set(st.pointer.x, st.pointer.y, 0.5)
      .unproject(camera)
      .sub(geo.ray.origin)
      .normalize()
    geo.normal.set(0, 0, 1).applyQuaternion(ob.quaternion)
    geo.plane.setFromNormalAndCoplanarPoint(geo.normal, ob.position)
    if (geo.ray.intersectPlane(geo.plane, geo.hit)) {
      ob.worldToLocal(geo.hit) // world -> panel-local (x, y, ~0)
      target.current.set(geo.hit.x, geo.hit.y)
    }
    cur.current.x = THREE.MathUtils.damp(cur.current.x, target.current.x, 6, dt)
    cur.current.y = THREE.MathUtils.damp(cur.current.y, target.current.y, 6, dt)
    m.uPointer.copy(cur.current)

    if (moved.current) {
      lastMove.current = t
      moved.current = false
    }
    const activeNow = t - lastMove.current < 1.2 ? 1 : 0
    hover.current = THREE.MathUtils.damp(hover.current, activeNow, 4, dt)
    m.uHover = hover.current

    const label = hover.current > 0.35 ? 'swell' : 'drift'
    if (label !== lastLabel.current) {
      lastLabel.current = label
      onState && onState(label)
    }
  })

  return (
    <mesh ref={mesh} rotation={[-0.62, 0, -0.14]}>
      <planeGeometry args={[3.4, 2.3, 220, 150]} />
      <reliefMaterial
        ref={mat}
        toneMapped={false}
        side={THREE.DoubleSide}
        extensions={{ derivatives: true }}
      />
    </mesh>
  )
}
