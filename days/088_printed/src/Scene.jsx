import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { createCloth, NX, NY, H } from './rig.js'

// ── the opening ────────────────────────────────────────────────────────────
// An arch cut out of a wall the same colour as the page. The page and the
// wall are one surface; only the reveal (the thickness of the cut) is shaded.
export const ARCH = { cx: 1.95, bottom: -2.62, w: 3.3, rect: 3.55 }
const R = ARCH.w / 2
const TOP = ARCH.bottom + ARCH.rect + R
const WALL_DEPTH = 0.34
const GROUND = '#F0F0E8'

function archPath(shape) {
  const x0 = ARCH.cx - R, x1 = ARCH.cx + R
  shape.moveTo(x0, ARCH.bottom)
  shape.lineTo(x1, ARCH.bottom)
  shape.lineTo(x1, ARCH.bottom + ARCH.rect)
  shape.absarc(ARCH.cx, ARCH.bottom + ARCH.rect, R, 0, Math.PI, false)
  shape.lineTo(x0, ARCH.bottom)
  return shape
}

function Wall() {
  const geo = useMemo(() => {
    const s = new THREE.Shape()
    s.moveTo(-30, -20); s.lineTo(30, -20); s.lineTo(30, 20); s.lineTo(-30, 20); s.lineTo(-30, -20)
    s.holes.push(archPath(new THREE.Path()))
    const g = new THREE.ExtrudeGeometry(s, { depth: WALL_DEPTH, bevelEnabled: false, curveSegments: 64 })
    g.translate(0, 0, -WALL_DEPTH + 0.0)
    return g
  }, [])
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uGround: { value: new THREE.Vector3(240 / 255, 240 / 255, 232 / 255) } }, // sRGB, written as-is
        vertexShader: /* glsl */ `
          varying vec3 vN; varying vec3 vP;
          void main(){ vN = normal; vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uGround; varying vec3 vN; varying vec3 vP;
          void main(){
            vec3 n = normalize(vN);
            if (n.z > 0.5) { gl_FragColor = vec4(uGround,1.); return; }
            // the reveal: lit from the upper right, deeper toward the back edge
            float lit = 0.80 + 0.12*dot(n, normalize(vec3(-0.55,-0.8,0.)));
            float back = smoothstep(0.0, -${WALL_DEPTH.toFixed(2)}, vP.z);
            gl_FragColor = vec4(uGround * mix(lit, lit*0.93, back), 1.);
          }`,
      }),
    []
  )
  return <mesh geometry={geo} material={mat} />
}

function Sky() {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 } },
        vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
        fragmentShader: /* glsl */ `
          varying vec2 vUv; uniform float uTime;
          void main(){
            vec3 hi = vec3(0.62,0.78,0.90);
            vec3 lo = vec3(0.93,0.93,0.88);
            vec3 c = mix(lo, hi, smoothstep(0.18, 0.95, vUv.y));
            // two slow clouds, just enough that the opening is not a flat card
            float cl = 0.0;
            vec2 p = vUv*vec2(3.0,2.0) + vec2(uTime*0.004, 0.);
            cl += smoothstep(0.55, 0.9, sin(p.x*2.1+sin(p.y*3.)*0.6)*0.5+0.5) * smoothstep(0.35,0.55,vUv.y)*smoothstep(0.75,0.6,vUv.y);
            c = mix(c, vec3(0.97,0.97,0.95), cl*0.35);
            gl_FragColor = vec4(c,1.);
          }`,
      }),
    []
  )
  useFrame((_, dt) => (mat.uniforms.uTime.value += dt))
  return (
    <mesh position={[ARCH.cx, ARCH.bottom + (ARCH.rect + R) / 2, -4.5]} material={mat}>
      <planeGeometry args={[ARCH.w * 2.4, (ARCH.rect + R) * 1.9]} />
    </mesh>
  )
}

// ── the print ──────────────────────────────────────────────────────────────
// uPrint = 1: pattern indexed by uv (on the threads).
// uPrint = 0: the same pattern indexed by where the fragment lands on screen
//             (a projector — the cloth moves through a still image).
const clothVert = /* glsl */ `
  varying vec2 vUv; varying vec3 vN; varying vec3 vW; varying vec4 vClip;
  void main(){
    vUv = uv;
    vN = normalize(mat3(modelMatrix) * normal);
    vec4 w = modelMatrix * vec4(position,1.);
    vW = w.xyz;
    vClip = projectionMatrix * viewMatrix * w;
    gl_Position = vClip;
  }`
const clothFrag = /* glsl */ `
  uniform float uPrint; uniform vec2 uCloth; uniform float uAspect; uniform float uRodZ;
  varying vec2 vUv; varying vec3 vN; varying vec3 vW; varying vec4 vClip;
  const vec3 CREAM = vec3(0.965,0.950,0.905);
  const vec3 RED   = vec3(0.976,0.227,0.200);
  const vec3 INK   = vec3(0.16,0.16,0.18);
  const vec3 BLUE  = vec3(0.33,0.52,0.72);

  float motif(vec2 p){ // p in pattern cells
    vec2 c = p; c.x += step(1., mod(floor(c.y),2.))*0.5; // half-drop
    vec2 f = fract(c) - 0.5;
    return 1. - smoothstep(0.17, 0.195, length(f));          // dot
  }
  float drop(vec2 p){ // small raindrop between the dots
    vec2 c = p + vec2(0.5,0.5); c.x += step(1., mod(floor(c.y),2.))*0.5;
    vec2 f = fract(c) - 0.5; f.y += 0.02;
    float d = length(f*vec2(1.,0.75)) - 0.075 + f.y*0.35;
    return 1. - smoothstep(0.0, 0.02, d);
  }

  void main(){
    vec2 onCloth = vUv * uCloth;                         // metres along warp/weft
    vec2 ndc = vClip.xy / vClip.w;
    vec2 onScreen = vec2(ndc.x*uAspect, ndc.y) * 3.15 + vec2(0.0, 0.0); // same scale, screen-anchored
    vec2 q = mix(onScreen, onCloth, uPrint) / 0.26;      // one cell = 26 cm — of fabric, or of screen

    float d = motif(q), r = drop(q);
    vec3 col = CREAM;
    col = mix(col, BLUE, r*0.9);
    col = mix(col, RED, d);
    // a thin ink check every 3 cells: the warp and weft made visible
    vec2 g = abs(fract(q/3.0 + 0.5) - 0.5)*3.0;
    float line = 1. - smoothstep(0.018, 0.04, min(g.x, g.y));
    col = mix(col, INK, line*0.55);
    // woven grain, always on the threads (this is the cloth, not the print)
    vec2 wv = vUv * vec2(${(NX - 1).toFixed(1)}, ${(NY - 1).toFixed(1)}) * 6.0;
    col *= 0.975 + 0.025*sin(wv.x*6.283)*sin(wv.y*6.283);
    // hem: a stitched border
    float e = min(min(vUv.x, 1.-vUv.x)*uCloth.x, min(vUv.y, 1.-vUv.y)*uCloth.y);
    col = mix(col, col*0.82, 1. - smoothstep(0.035, 0.05, e));
    float stitch = step(0.5, fract((vUv.x+vUv.y)*uCloth.x*9.)) * (1.-smoothstep(0.052,0.058,abs(e-0.065)));
    col = mix(col, INK, stitch*0.35);

    // light: a low sun from the upper right, sky behind
    vec3 n = normalize(vN); if (!gl_FrontFacing) n = -n;
    vec3 L = normalize(vec3(0.55, 0.65, 0.52));
    float diff = max(dot(n, L), 0.);
    float fold = smoothstep(uRodZ - 0.9, uRodZ + 0.2, vW.z);  // valleys of the pleats sit deeper
    float shade = 0.50 + 0.42*diff;
    shade *= mix(0.78, 1.04, fold);
    // backlight: the sky through a single layer of cotton
    float thru = pow(max(dot(-n, vec3(0.,0.,-1.)),0.), 2.) * 0.10;
    col = col*shade + vec3(0.95,0.96,0.97)*thru;
    gl_FragColor = vec4(col, 1.);
  }`

function Cloth({ printRef, stats, pointer }) {
  const { size, camera } = useThree()
  const tmp = useMemo(() => ({ v: new THREE.Vector3(), last: null }), [])
  const rod = { rodX0: ARCH.cx - R - 0.05, rodY: TOP + 0.12, rodZ: -0.5 }
  const cloth = useMemo(() => {
    const c = createCloth(rod)
    c.settle(3.0)
    return c
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(cloth.state.pos, 3))
    const uv = new Float32Array(NX * NY * 2)
    const idx = []
    for (let j = 0; j < NY; j++)
      for (let i = 0; i < NX; i++) {
        const k = j * NX + i
        uv[k * 2] = i / (NX - 1)
        uv[k * 2 + 1] = 1 - j / (NY - 1)
        if (i < NX - 1 && j < NY - 1) idx.push(k, k + NX, k + 1, k + 1, k + NX, k + NX + 1)
      }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
    g.setIndex(idx)
    g.computeVertexNormals()
    return g
  }, [cloth])
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uPrint: { value: 1 },
          uCloth: { value: new THREE.Vector2((NX - 1) * H, (NY - 1) * H) },
          uAspect: { value: 1.6 },
          uRodZ: { value: rod.rodZ },
        },
        vertexShader: clothVert,
        fragmentShader: clothFrag,
        side: THREE.DoubleSide,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  useFrame((_, dt) => {
    // pointer → the plane of the rod
    const p = pointer.current
    const cp = cloth.state.pointer
    cp.active = p.active
    if (p.active) {
      const v = tmp.v.set(p.ndcX, p.ndcY, 0.5).unproject(camera).sub(camera.position).normalize()
      const k = (rod.rodZ - camera.position.z) / v.z
      const x = camera.position.x + v.x * k
      const y = camera.position.y + v.y * k
      if (tmp.last && dt > 0) {
        cp.vx = cp.vx * 0.7 + ((x - tmp.last[0]) / dt) * 0.3 * 0.05
        cp.vy = cp.vy * 0.7 + ((y - tmp.last[1]) / dt) * 0.3 * 0.05
      }
      tmp.last = [x, y]
      cp.x = x
      cp.y = y
    } else {
      tmp.last = null
      cp.vx = cp.vy = 0
    }
    cloth.step(dt)
    geo.attributes.position.needsUpdate = true
    geo.computeVertexNormals()
    geo.computeBoundingSphere()
    const target = printRef.current ? 1 : 0
    const u = mat.uniforms.uPrint
    u.value += (target - u.value) * Math.min(1, dt * 5)
    mat.uniforms.uAspect.value = size.width / size.height
    stats.current = cloth.state
  })

  return <mesh geometry={geo} material={mat} frustumCulled={false} />
}

export default function Scene({ printRef, stats, pointer }) {
  return (
    <>
      <color attach="background" args={[GROUND]} />
      <Sky />
      <Cloth printRef={printRef} stats={stats} pointer={pointer} />
      <Wall />
    </>
  )
}
