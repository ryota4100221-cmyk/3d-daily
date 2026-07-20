import { useRef, useEffect, useMemo } from 'react'
import { useFrame, useThree, extend } from '@react-three/fiber'
import { shaderMaterial } from '@react-three/drei'
import * as THREE from 'three'

/* ------------------------------------------------------------------ *
 * Day 021 — Week 3 · CAPSTONE  "Cairn"  (レイマーチ / raymarched SDF)
 *
 * Week 3 has been a march away from geometry and into the fragment shader:
 * 015 painted a full-screen field, 016 pushed real vertices with a height
 * map, 017 grew marble from noise gradients, 018 wrapped glass around real
 * meshes with a Fresnel term, 019 dissolved surfaces by discard, 020 kept
 * a fluid in an FBO. The capstone folds that arc into ONE technique that
 * subsumes them all:
 *
 *   NEW TECHNIQUE — RAYMARCHING A SIGNED-DISTANCE FIELD.
 *   There is no three.js geometry and no three.js light in the scene. A
 *   single full-screen quad (Day 015 lineage) shoots one ray per pixel,
 *   and a distance field is sphere-traced until the ray meets a surface.
 *   The "objects" are pure math — spheres, a rounded box, a torus — welded
 *   together by a SMOOTH-MINIMUM (smin) so they melt into one continuous
 *   porcelain cairn instead of intersecting hard.
 *
 * Everything the week taught is reused here, but now in 3D:
 *   • NORMALS FROM THE GRADIENT of the SDF (the tetrahedron trick) — the
 *     same "reconstruct the normal analytically" idea as Day 016's height
 *     field, but for a volume.
 *   • DOMAIN-WARPED fBm (Day 017) perturbs the surface normal into an
 *     unglazed-ceramic micro-relief — noise as material, not as colour.
 *   • A FRESNEL rim (Day 018): pow(1+dot(rd,N)) lights the silhouette with
 *     terracotta where the porcelain turns from the eye.
 *   • IQ SOFT SHADOWS + AO, marched through the same field, give the
 *     penumbra and contact darkening that Day 004 needed a whole
 *     accumulation buffer for — here it is a dozen extra distance taps.
 *   • POINTER-AS-LIGHT (Day 018/015 lineage): the cursor, damped, steers
 *     the key-light direction and warms a pool on the ground; leave and it
 *     eases home (stateless).
 *
 * monaka palette: porcelain paper-white forms, one terracotta accent, warm
 * paper ground fading to the background at the horizon. `<Canvas flat>`,
 * sRGB linearised on output, no troika Text — fully offline-safe.
 * ------------------------------------------------------------------ */

const vertexShader = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    // full-screen clip-space quad — the camera is built by hand in the frag
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

const fragmentShader = /* glsl */ `
  precision highp float;

  uniform float uTime;
  uniform vec2  uRes;
  uniform vec2  uPointer;   // NDC-ish, damped (x in [-a,a], y in [-1,1])
  uniform float uHover;     // 0..1 damped presence

  varying vec2 vUv;

  // --- monaka palette (sRGB -> linearised on output) ------------------
  const vec3 PAPER = vec3(0.925, 0.906, 0.867); // #ECE7DD background
  const vec3 PORC  = vec3(0.895, 0.879, 0.842); // porcelain albedo
  const vec3 INK   = vec3(0.149, 0.141, 0.122); // #26241F
  const vec3 TERRA = vec3(0.776, 0.416, 0.247); // #C66A3F accent
  const vec3 SAND  = vec3(0.815, 0.766, 0.680); // warm ground

  vec3 toLinear(vec3 c) { return pow(c, vec3(2.2)); }

  // ---- cheap value-noise fBm (Day 015/016 lineage) for micro-relief ----
  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float vnoise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
                   mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                   mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  float fbm(vec3 p) {
    float a = 0.5, f = 0.0;
    for (int i = 0; i < 4; i++) { f += a * vnoise(p); p *= 2.03; a *= 0.5; }
    return f;
  }

  // ------------------------- SDF primitives ---------------------------
  float sdSphere(vec3 p, float r) { return length(p) - r; }
  float sdRoundBox(vec3 p, vec3 b, float r) {
    vec3 q = abs(p) - b;
    return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
  }
  float sdTorus(vec3 p, vec2 t) {
    vec2 q = vec2(length(p.xz) - t.x, p.y);
    return length(q) - t.y;
  }
  // smooth minimum (polynomial) — welds forms into one body
  float smin(float a, float b, float k) {
    float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
    return mix(b, a, h) - k * h * (1.0 - h);
  }
  mat2 rot(float a) { float s = sin(a), c = cos(a); return mat2(c, -s, s, c); }

  // The cairn: distance to the *porcelain* forms only (no accent, no ground).
  float sdPorcelain(vec3 p) {
    float t = uTime * 0.25;
    // hero rounded box, slowly turning
    vec3 pb = p - vec3(0.0, 0.05, 0.0);
    pb.xz = rot(t * 0.6) * pb.xz;
    pb.xy = rot(0.18 * sin(t * 0.5)) * pb.xy;
    float d = sdRoundBox(pb, vec3(0.62, 0.50, 0.62), 0.22);
    // a sphere resting on the shoulder, bobbing
    vec3 ps = p - vec3(0.62, 0.86 + 0.05 * sin(t * 1.3), 0.30);
    d = smin(d, sdSphere(ps, 0.42), 0.34);
    // a lower sphere leaning in from the other side
    vec3 pl = p - vec3(-0.72, -0.28, -0.10);
    d = smin(d, sdSphere(pl, 0.50), 0.40);
    // a thin ring threaded through — reads as a drawn line in 3D
    vec3 pt = p - vec3(-0.10, 0.28, 0.05);
    pt.yz = rot(0.9) * pt.yz;
    pt.xy = rot(t * 0.4) * pt.xy;
    d = smin(d, sdTorus(pt, vec2(1.02, 0.055)), 0.14);
    return d;
  }

  // the single terracotta accent — a sphere nested against the body,
  // sitting forward so the key light finds it as a clean accent
  float sdAccent(vec3 p) {
    float t = uTime * 0.25;
    vec3 pa = p - vec3(0.34, -0.30 + 0.04 * sin(t * 1.1 + 1.0), 0.82);
    return sdSphere(pa, 0.34);
  }

  // scene map: returns vec2(distance, materialId)
  //   id 1.0 = ground, 2.0 = porcelain, 3.0 = terracotta
  vec2 map(vec3 p) {
    float ground = p.y + 1.15;                 // flat plane
    float porc = sdPorcelain(p);
    float acc  = sdAccent(p);
    // weld the accent into the body so it looks nested, not stuck on
    float body = smin(porc, acc, 0.22);

    vec2 res = vec2(ground, 1.0);
    if (body < res.x) res = vec2(body, porc < acc ? 2.0 : 3.0);
    return res;
  }

  // material blend weight of terracotta at a hit (soft seam, Day 017 idea)
  float terraWeight(vec3 p) {
    float porc = sdPorcelain(p);
    float acc  = sdAccent(p);
    return clamp((porc - acc) * 2.6 + 0.5, 0.0, 1.0);
  }

  // normal from the SDF gradient (tetrahedron taps) — Day 016 idea in 3D
  vec3 calcNormal(vec3 p) {
    const vec2 e = vec2(1.0, -1.0) * 0.0009;
    return normalize(
        e.xyy * map(p + e.xyy).x + e.yyx * map(p + e.yyx).x +
        e.yxy * map(p + e.yxy).x + e.xxx * map(p + e.xxx).x);
  }

  // iq soft shadow — penumbra marched through the same field
  float softShadow(vec3 ro, vec3 rd, float mint, float maxt, float k) {
    float res = 1.0;
    float t = mint;
    for (int i = 0; i < 28; i++) {
      float h = map(ro + rd * t).x;
      res = min(res, k * h / t);
      t += clamp(h, 0.02, 0.22);
      if (res < 0.003 || t > maxt) break;
    }
    return clamp(res, 0.0, 1.0);
  }

  // iq ambient occlusion
  float calcAO(vec3 p, vec3 n) {
    float occ = 0.0, sca = 1.0;
    for (int i = 0; i < 5; i++) {
      float hr = 0.012 + 0.13 * float(i) / 4.0;
      float d = map(p + n * hr).x;
      occ += (hr - d) * sca;
      sca *= 0.93;
    }
    return clamp(1.0 - 2.6 * occ, 0.0, 1.0);
  }

  // march the primary ray
  vec2 raymarch(vec3 ro, vec3 rd) {
    float t = 0.4;
    float m = -1.0;
    for (int i = 0; i < 96; i++) {
      vec3 pos = ro + rd * t;
      vec2 h = map(pos);
      if (h.x < 0.0009 * t) { m = h.y; break; }
      t += h.x;
      if (t > 22.0) break;
    }
    if (t > 22.0) m = -1.0;
    return vec2(t, m);
  }

  void main() {
    vec2 uv = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0) * 2.0;
    float t = uTime;

    // ---- hand-built camera (slow drift + gentle pointer parallax) ----
    float orbit = 0.35 + 0.12 * sin(t * 0.08) + uPointer.x * 0.28 * uHover;
    float elev  = 0.55 + uPointer.y * 0.35 * uHover;
    float R = 5.2;
    vec3 ro = vec3(sin(orbit) * R, 1.05 + elev, cos(orbit) * R);
    vec3 ta = vec3(0.0, 0.05, 0.0);
    vec3 ww = normalize(ta - ro);
    vec3 uu = normalize(cross(ww, vec3(0.0, 1.0, 0.0)));
    vec3 vv = cross(uu, ww);
    vec3 rd = normalize(uv.x * uu + uv.y * vv + 1.7 * ww);

    // ---- key light: base direction, steered by the cursor -----------
    vec3 keyBase = normalize(vec3(-0.55, 0.85, 0.35));
    vec3 keyPtr  = normalize(vec3(uPointer.x * 1.4, 0.6 + uPointer.y * 0.7, 0.75));
    vec3 key = normalize(mix(keyBase, keyPtr, 0.6 * uHover));
    vec3 keyCol = mix(vec3(1.0, 0.98, 0.94), vec3(1.0, 0.93, 0.84), uHover);

    // ---- background: clean, near-flat paper void (monaka 余白) --------
    float grad = smoothstep(-1.0, 1.4, rd.y);
    vec3 bg = mix(PAPER * 1.015, PAPER * 0.965, grad);
    bg = mix(bg, SAND, smoothstep(0.12, -0.30, rd.y) * 0.28); // faint warm horizon

    vec3 col = bg;

    vec2 res = raymarch(ro, rd);
    float dist = res.x;
    float mid  = res.y;

    if (mid > 0.0) {
      vec3 pos = ro + rd * dist;
      vec3 n = calcNormal(pos);

      // --- material -------------------------------------------------
      vec3 albedo;
      float rough;
      if (mid < 1.5) {
        // ground: warm paper, very slightly textured
        albedo = mix(SAND, PAPER, 0.35);
        rough = 1.0;
      } else {
        // sculpture: porcelain, terracotta blended across the seam
        float tw = terraWeight(pos);
        albedo = mix(PORC, TERRA * 1.06, tw);
        rough = mix(0.55, 0.68, tw);
        // unglazed ceramic micro-relief: warp the normal by fBm gradient
        float e = 0.06;
        vec3 gp = pos * 3.2;
        float f0 = fbm(gp);
        vec3 gN = vec3(
          fbm(gp + vec3(e, 0.0, 0.0)) - f0,
          fbm(gp + vec3(0.0, e, 0.0)) - f0,
          fbm(gp + vec3(0.0, 0.0, e)) - f0) / e;
        n = normalize(n - (gN - n * dot(gN, n)) * 0.16);
      }

      // --- lighting (all hand-computed, no three.js lights) ---------
      float dif = clamp(dot(n, key), 0.0, 1.0);
      float sh  = softShadow(pos + n * 0.015, key, 0.03, 9.0, 14.0);
      float ao  = calcAO(pos, n);

      float sky = clamp(0.5 + 0.5 * n.y, 0.0, 1.0);        // hemisphere fill
      float bnc = clamp(0.35 - 0.5 * n.y, 0.0, 1.0);        // ground bounce
      // key specular (Blinn) — a soft porcelain highlight
      vec3 h = normalize(key - rd);
      float spe = pow(clamp(dot(n, h), 0.0, 1.0), mix(60.0, 18.0, rough))
                  * sh * (mid > 1.5 ? 1.0 : 0.15);

      vec3 lin = vec3(0.0);
      lin += albedo * 1.18 * dif * sh * keyCol;
      lin += albedo * 0.78 * sky * vec3(0.87, 0.89, 0.95) * ao; // lifted fill
      lin += albedo * 0.26 * bnc * SAND * ao;
      lin += albedo * 0.10 * ao;                                 // flat ambient floor
      lin += vec3(spe) * 0.6 * keyCol;

      // --- Fresnel rim (Day 018): a THIN terracotta edge on turn-away --
      float fre = pow(clamp(1.0 + dot(rd, n), 0.0, 1.0), 4.0);
      if (mid > 1.5) {
        lin += fre * TERRA * (0.35 + 0.45 * sh) * 0.55;
        // cool sky rim on the opposite silhouette for porcelain read
        lin += fre * vec3(0.80, 0.85, 0.92) * 0.10;
      }

      col = lin;

      // --- pointer warmth pooled on the ground near the cursor -------
      if (mid < 1.5) {
        // project cursor onto ground and warm a Gaussian pool
        vec2 pd = pos.xz - vec2(uPointer.x * 3.0, -uPointer.y * 3.0 + 1.0);
        float pool = exp(-dot(pd, pd) * 0.25) * uHover;
        col = mix(col, mix(col, TERRA, 0.5), pool * 0.35);
      }

      // atmospheric fade to the paper background with depth
      float fog = 1.0 - exp(-0.0032 * dist * dist);
      col = mix(col, bg, fog);
    }

    // ---- paper grain + soft vignette --------------------------------
    float g = fract(sin(dot(vUv * uRes, vec2(12.9898, 78.233)) + t) * 43758.5453);
    col += (g - 0.5) * 0.012;
    float vig = smoothstep(1.5, 0.35, length(uv));
    col *= 0.92 + 0.08 * vig;

    gl_FragColor = vec4(toLinear(col), 1.0);
  }
`

const CairnMaterial = shaderMaterial(
  {
    uTime: 0,
    uRes: new THREE.Vector2(1, 1),
    uPointer: new THREE.Vector2(0, 0),
    uHover: 0,
  },
  vertexShader,
  fragmentShader,
)
extend({ CairnMaterial })

export default function Scene({ onState }) {
  const mat = useRef()
  const { size, viewport } = useThree()

  const target = useRef(new THREE.Vector2(0, 0))
  const cur = useRef(new THREE.Vector2(0, 0))
  const hover = useRef(0)
  const moved = useRef(false)
  const lastMove = useRef(-10)
  const lastLabel = useRef('drift')

  useEffect(() => {
    const h = (e) => {
      moved.current = true
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

    cur.current.x = THREE.MathUtils.damp(cur.current.x, target.current.x, 4, dt)
    cur.current.y = THREE.MathUtils.damp(cur.current.y, target.current.y, 4, dt)
    m.uPointer.copy(cur.current)

    if (moved.current) {
      lastMove.current = t
      moved.current = false
    }
    const activeNow = t - lastMove.current < 1.2 ? 1 : 0
    hover.current = THREE.MathUtils.damp(hover.current, activeNow, 4, dt)
    m.uHover = hover.current

    const label = hover.current > 0.35 ? 'light' : 'drift'
    if (label !== lastLabel.current) {
      lastLabel.current = label
      onState && onState(label)
    }
  })

  return (
    <mesh frustumCulled={false}>
      <planeGeometry args={[2, 2]} />
      <cairnMaterial
        ref={mat}
        toneMapped={false}
        depthTest={false}
        depthWrite={false}
      />
    </mesh>
  )
}
