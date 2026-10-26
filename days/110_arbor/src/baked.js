// engine/bake/baked.js — bake.py が焼いた光を three / R3F のシーンに差す（2026-10-25・Bake Lab から汎用化）
//
//   import { applyBaked, rig, bakedPoints } from './baked.js'     ← 🔴 日フォルダの src/ にコピーして使う（相対 import は dev で 403→500）
//   const manifest = await (await fetch(`${BASE}lm/manifest.json`)).json()
//   const baked = applyBaked(gltf.scene, manifest, { base: BASE })   // BASE = import.meta.env.BASE_URL
//   baked.blend('day', 'night', k)   // 2つの状態を k で混ぜる（毎フレーム呼んでよい）。状態が1つなら呼ばなくてよい
//   baked.gain.value = 1.2           // 焼いた光の露出
//   const parts = rig(gltf.scene)    // 名前→親グループ。振り付けは必ずこの親を動かす（下の🔴）
//
// R3F なら：const { scene } = useGLTF(url, true, true, (l) => l.setMeshoptDecoder(MeshoptDecoder))
//           const baked = useMemo(() => applyBaked(scene, manifest, { base }), [scene])
//
// 仕組み：素材の色 × 焼いた光。ライトは1灯も要らない。鏡面だけ scene.environment から取り、拡散の IBL は外す（二重に明るくしない）。
// 🔴 meshopt の量子化はノードに「元の寸法へ戻す scale と移動」を載せる。ノードの scale を直接いじると物体が中心から縮み・浮く → rig() で親を挟む
// 🔴 gl_PointSize = 0 では点は消えない（M1 / ANGLE Metal は最小1pxで描く）。bakedPoints は散る前の点を clip の外へ出す
import * as THREE from 'three'

const NO_IBL_DIFFUSE = 'iblIrradiance += getIBLIrradiance( geometryNormal );'

export function applyBaked(root, manifest, { base = './', envIntensity = 0.5 } = {}) {
  const LMAX = manifest.lmax
  const states = manifest.states
  const loader = new THREE.TextureLoader()
  const texCache = {}
  const tex = (name, st) => {
    const url = `${base}lm/${name}_${st}.webp`
    if (texCache[url]) return texCache[url]
    const t = (texCache[url] = loader.load(url))
    t.channel = 1                          // UV1（TEXCOORD_1）
    t.flipY = false
    t.colorSpace = THREE.SRGBColorSpace    // 焼くときに sRGB で符号化してある
    return t
  }
  const uMix = { value: 0 }
  const gain = { value: 1 }
  const mapMats = []   // { mat, name, uA, uB }
  const vtxGeos = []   // geometry（頂点に焼いた物）
  const materials = []

  root.traverse((o) => {
    if (!o.isMesh) return
    // primitive が複数ある物体は GLTFLoader が Group にまとめ、子の Mesh は別名になる → 親の名前で引く
    const name = manifest.objects[o.name] ? o.name : o.parent?.name
    const entry = manifest.objects[name]
    if (!entry) return
    const list = Array.isArray(o.material) ? o.material : [o.material]
    const cloned = list.map((m) => {
      const mm = m.clone()
      mm.envMapIntensity = envIntensity
      materials.push(mm)
      if (entry.kind === 'map') {
        const uA = { value: tex(name, states[0]) }, uB = { value: tex(name, states[states.length - 1]) }
        mm.lightMap = uA.value
        mm.lightMapIntensity = LMAX * Math.PI   // three は lightMap を irradiance として足し BRDF_Lambert で /π する
        mm.onBeforeCompile = (sh) => {
          Object.assign(sh.uniforms, { lmA: uA, lmB: uB, uMix, uGain: gain })
          sh.fragmentShader = sh.fragmentShader
            .replace('#include <common>', '#include <common>\nuniform sampler2D lmA;\nuniform sampler2D lmB;\nuniform float uMix;\nuniform float uGain;')
            .replace('#include <lights_fragment_maps>', THREE.ShaderChunk.lights_fragment_maps
              .replace('vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );',
                'vec4 lightMapTexel = mix( texture2D( lmA, vLightMapUv ), texture2D( lmB, vLightMapUv ), uMix ) * uGain;')
              .replace(NO_IBL_DIFFUSE, ''))
        }
        mm.customProgramCacheKey = () => 'baked-map'
        mapMats.push({ name, uA, uB })
      } else {
        const g = o.geometry
        if (!g.userData.bakedVtx) { g.userData.bakedVtx = true; vtxGeos.push(g) }
        g.setAttribute('lmA', g.getAttribute(`_lm_${states[0]}`))
        g.setAttribute('lmB', g.getAttribute(`_lm_${states[states.length - 1]}`))
        mm.onBeforeCompile = (sh) => {
          Object.assign(sh.uniforms, { uMix, uGain: gain })
          sh.vertexShader = sh.vertexShader
            .replace('#include <common>', '#include <common>\nattribute vec4 lmA;\nattribute vec4 lmB;\nuniform float uMix;\nvarying vec3 vLm;')
            .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLm = mix( lmA.rgb, lmB.rgb, uMix );')
          sh.fragmentShader = sh.fragmentShader
            .replace('#include <common>', '#include <common>\nvarying vec3 vLm;\nuniform float uGain;')
            .replace('#include <lights_fragment_maps>', THREE.ShaderChunk.lights_fragment_maps.replace(NO_IBL_DIFFUSE, '')
              + '\nreflectedLight.indirectDiffuse += min( vLm, vec3( 12.0 ) ) * uGain * material.diffuseColor;')
        }
        mm.customProgramCacheKey = () => 'baked-vertex'
      }
      return mm
    })
    o.material = Array.isArray(o.material) ? cloned : cloned[0]
  })

  let pair = `${states[0]}|${states[states.length - 1]}`
  function blend(a, b, k) {
    uMix.value = k
    const key = `${a}|${b}`
    if (key === pair) return
    pair = key
    for (const m of mapMats) { m.uA.value = tex(m.name, a); m.uB.value = tex(m.name, b) }
    for (const g of vtxGeos) { g.setAttribute('lmA', g.getAttribute(`_lm_${a}`)); g.setAttribute('lmB', g.getAttribute(`_lm_${b}`)) }
  }
  return { blend, uMix, gain, materials, tex, manifest, LMAX }
}

// 物体ごとに原点の空の親を挟む。返り値：{ 名前: 親グループ }。親の scale.y＝床から立ち上がる／scale.xz＝中心から広がる
export function rig(root) {
  const parts = {}
  const nodes = []
  root.traverse((o) => { if (o.isMesh) nodes.push(o.parent && o.parent !== root && o.parent.type === 'Group' && !o.parent.userData.isRig ? o.parent : o) })
  for (const node of new Set(nodes)) {
    const g = new THREE.Group()
    g.name = `${node.name}__rig`
    g.userData.isRig = true
    root.add(g)
    g.attach(node)
    parts[node.name] = g
  }
  return parts
}

// ---------- 焼いた光を持つ粒（Bake Lab 4周目「Apart」から） ----------
// 表面に面積比で count 粒を撒き、各粒に「その点に焼いた光」を持たせる。前線（中心 center からの距離＋揺らぎ）が uDis を越えた所から
// メッシュを捨て、同じ場所の粒が昇って散る＝継ぎ目なく入れ替わる。散った粒は光の色へ寄り、bloom に掛かる。
//   const pts = bakedPoints(parts, baked, { count: 170000, center: [-2, 1.5, 0.1], skip: ['ground'] })
//   毎フレーム：pts.uDis.value = 前線の距離(m)（-9 で何も解けていない）／ pts.update(time) ／ 章の外では pts.setVisible(false)
// 🔴 parts は rig() の返り値。粒は親（rig）の子として入る＝親を動かす振り付け（分解図など）をそのまま継ぐ。
//    rig は静止時に原点・回転なし前提＝撒いた時点の世界座標が rig の局所座標になる
export function bakedPoints(parts, baked, { count = 150000, center = [0, 1, 0], skip = [], spread = 1.4, rise = 1.5, glow = [1.25, 1.1, 0.92], renderer } = {}) {
  const { manifest, LMAX } = baked
  const uDis = { value: -9 }, uTime = { value: 0 }
  const uPx = { value: renderer ? renderer.getPixelRatio() : Math.min(devicePixelRatio, 2) }
  const C = new THREE.Vector3(...center)
  const DIS_GLSL = `
float dh(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float dvn(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(mix(dh(i), dh(i + vec3(1,0,0)), f.x), mix(dh(i + vec3(0,1,0)), dh(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(dh(i + vec3(0,0,1)), dh(i + vec3(1,0,1)), f.x), mix(dh(i + vec3(0,1,1)), dh(i + vec3(1,1,1)), f.x), f.y), f.z); }
float disN(vec3 p){ return distance(p, vec3(${C.x.toFixed(3)}, ${C.y.toFixed(3)}, ${C.z.toFixed(3)})) + .7 * dvn(p * 1.7); }
`
  const skipSet = new Set(skip)
  const rigs = Object.entries(parts).filter(([n]) => !skipSet.has(n))

  // メッシュ側：前線の内側を捨て、縁を光らせる
  for (const [, g] of rigs) {
    const uRigInv = { value: new THREE.Matrix4() }
    g.userData.uRigInv = uRigInv
    g.traverse((o) => {
      if (!o.isMesh) return
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey
        m.onBeforeCompile = (sh, r) => {
          prev.call(m, sh, r)
          Object.assign(sh.uniforms, { uDis, uRigInv })
          sh.vertexShader = sh.vertexShader
            .replace('#include <common>', '#include <common>\nuniform mat4 uRigInv;\nvarying vec3 vRest;')
            .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRest = ( uRigInv * modelMatrix * vec4( transformed, 1.0 ) ).xyz;')
          sh.fragmentShader = sh.fragmentShader
            .replace('#include <common>', '#include <common>\nuniform float uDis;\nvarying vec3 vRest;\n' + DIS_GLSL)
            .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nfloat dN = disN( vRest );\nif ( dN < uDis ) discard;')
            .replace('#include <tonemapping_fragment>', `gl_FragColor.rgb += vec3( ${glow.map((v) => (v * 0.8).toFixed(2)).join(', ')} ) * 2.4 * ( 1.0 - smoothstep( 0.0, 0.07, dN - uDis ) ) * step( -8.0, uDis );\n#include <tonemapping_fragment>`)
        }
        m.customProgramCacheKey = () => `${prevKey ? prevKey.call(m) : ''}-dis`
      }
    })
  }

  // 撒く
  const tris = []
  let total = 0
  const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3()
  for (const [n, g] of rigs) {
    g.updateMatrixWorld(true)
    g.traverse((o) => {
      if (!o.isMesh) return
      const geo = o.geometry, P = geo.attributes.position, I = geo.index
      const nT = I ? I.count / 3 : P.count / 3
      for (let k = 0; k < nT; k++) {
        const ia = I ? I.getX(k * 3) : k * 3, ib = I ? I.getX(k * 3 + 1) : k * 3 + 1, ic = I ? I.getX(k * 3 + 2) : k * 3 + 2
        va.fromBufferAttribute(P, ia).applyMatrix4(o.matrixWorld)
        vb.fromBufferAttribute(P, ib).applyMatrix4(o.matrixWorld)
        vc.fromBufferAttribute(P, ic).applyMatrix4(o.matrixWorld)
        const area = vb.sub(va).cross(vc.sub(va)).length() / 2
        if (area <= 0) continue
        total += area
        tris.push({ n, o, ia, ib, ic, cum: total })
      }
    })
  }
  const byPart = {}
  const A = new THREE.Vector3(), B = new THREE.Vector3(), Cc = new THREE.Vector3()
  for (let i = 0; i < count; i++) {
    const r = Math.random() * total
    let lo = 0, hi = tris.length - 1
    while (lo < hi) { const mid = (lo + hi) >> 1; if (tris[mid].cum < r) lo = mid + 1; else hi = mid }
    const t = tris[lo]
    let u = Math.random(), v = Math.random()
    if (u + v > 1) { u = 1 - u; v = 1 - v }
    const w = 1 - u - v
    const geo = t.o.geometry
    A.fromBufferAttribute(geo.attributes.position, t.ia).applyMatrix4(t.o.matrixWorld)
    B.fromBufferAttribute(geo.attributes.position, t.ib).applyMatrix4(t.o.matrixWorld)
    Cc.fromBufferAttribute(geo.attributes.position, t.ic).applyMatrix4(t.o.matrixWorld)
    const bp = (byPart[t.n] ??= { pos: [], uv: [], a: [], b: [], seed: [], o: t.o })
    bp.pos.push(A.x * w + B.x * u + Cc.x * v, A.y * w + B.y * u + Cc.y * v, A.z * w + B.z * u + Cc.z * v)
    const lerpAttr = (attr, out) => { for (let c = 0; c < Math.min(attr.itemSize, 3); c++) out.push(attr.getComponent(t.ia, c) * w + attr.getComponent(t.ib, c) * u + attr.getComponent(t.ic, c) * v) }
    if (geo.attributes.uv1) lerpAttr(geo.attributes.uv1, bp.uv)
    if (geo.attributes.lmA) { lerpAttr(geo.attributes.lmA, bp.a); lerpAttr(geo.attributes.lmB, bp.b) }
    bp.seed.push(Math.random())
  }

  const objects = []
  for (const [n, bp] of Object.entries(byPart)) {
    const isMap = manifest.objects[n]?.kind === 'map' && bp.uv.length
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(bp.pos, 3))
    geo.setAttribute('seed', new THREE.Float32BufferAttribute(bp.seed, 1))
    if (isMap) geo.setAttribute('uvL', new THREE.Float32BufferAttribute(bp.uv, 2))
    else if (bp.a.length) { geo.setAttribute('lmVA', new THREE.Float32BufferAttribute(bp.a, 3)); geo.setAttribute('lmVB', new THREE.Float32BufferAttribute(bp.b, 3)) }
    const m0 = Array.isArray(bp.o.material) ? bp.o.material[0] : bp.o.material
    // 地図の状態ペアは applyBaked の blend() が差し替える uniform をそのまま共有する
    const uA = { value: isMap ? baked.tex(n, manifest.states[0]) : null }, uB = { value: isMap ? baked.tex(n, manifest.states[manifest.states.length - 1]) : null }
    const mat = new THREE.ShaderMaterial({
      fog: false,
      defines: isMap ? { LM_MAP: '' } : bp.a.length ? { LM_VERT: '' } : {},
      uniforms: { uDis, uTime, uPx, uMix: baked.uMix, uGain: baked.gain, uAlb: { value: (m0.color || new THREE.Color(1, 1, 1)).clone() }, lmA: uA, lmB: uB, uLmax: { value: LMAX } },
      vertexShader: `
        attribute float seed;
        #ifdef LM_MAP
        attribute vec2 uvL; uniform sampler2D lmA; uniform sampler2D lmB; uniform float uLmax;
        #endif
        #ifdef LM_VERT
        attribute vec3 lmVA; attribute vec3 lmVB;
        #endif
        uniform float uDis; uniform float uTime; uniform float uPx; uniform float uMix; uniform float uGain; uniform vec3 uAlb;
        varying vec3 vCol;
        ${DIS_GLSL}
        void main(){
          float s = clamp( ( uDis - disN( position ) ) / ${spread.toFixed(2)}, 0., 1. );
          float e = s * s * ( 3. - 2. * s );
          float r1 = fract( seed * 7.13 ), r2 = fract( seed * 3.71 ), a = seed * 6.2832;
          vec3 p = position;
          float ang = e * ( .6 + 1.2 * r2 ) + uTime * .05 * e;
          float cs = cos( ang ), sn = sin( ang );
          p.xz = mat2( cs, -sn, sn, cs ) * p.xz * ( 1. + .35 * e * r1 );
          p.y += e * ( .4 + ${rise.toFixed(2)} * r1 );
          p += e * .25 * vec3( sin( a + uTime * .4 ), sin( a * 1.7 + uTime * .3 ), cos( a + uTime * .35 ) );
          vec4 mv = modelViewMatrix * vec4( p, 1. );
          gl_Position = projectionMatrix * mv;
          vec3 L = vec3( 1. );
          #ifdef LM_MAP
          L = mix( texture2D( lmA, uvL ).rgb, texture2D( lmB, uvL ).rgb, uMix ) * uLmax;
          #endif
          #ifdef LM_VERT
          L = min( mix( lmVA, lmVB, uMix ), vec3( 12. ) );
          #endif
          vCol = mix( uAlb * L * uGain, vec3( ${glow.map((v) => v.toFixed(2)).join(', ')} ) * ( .8 + .9 * r2 ), e * .75 );
          if ( s <= 0. ) gl_Position = vec4( 2., 2., 2., 1. );   // 🔴 PointSize 0 では消えない（Metal は最小1px）
          gl_PointSize = s > 0. ? uPx * ( 2.6 - 1.2 * e + 1.2 * e * r1 * r1 ) * ( 11. / -mv.z ) : 0.;
        }`,
      fragmentShader: 'varying vec3 vCol; void main(){ if ( length( gl_PointCoord - .5 ) > .5 ) discard; gl_FragColor = vec4( vCol, 1. ); }',
    })
    mat.userData.state = { uA, uB, name: n }
    const pts = new THREE.Points(geo, mat)
    pts.frustumCulled = false
    pts.visible = false
    pts.name = `${n}__pts`
    parts[n].add(pts)
    objects.push(pts)
  }

  return {
    uDis, uTime, objects,
    setVisible(v) { for (const p of objects) p.visible = v },
    // 毎フレーム：時間と、rig の逆行列（メッシュ側の前線を「静止時の座標」で判定するため）を更新
    update(time, a = manifest.states[0], b = manifest.states[manifest.states.length - 1]) {
      uTime.value = time
      for (const [, g] of rigs) { g.updateMatrixWorld(); g.userData.uRigInv.value.copy(g.matrixWorld).invert() }
      for (const p of objects) { const st = p.material.userData.state; if (st.uA.value) { st.uA.value = baked.tex(st.name, a); st.uB.value = baked.tex(st.name, b) } }
    },
  }
}
