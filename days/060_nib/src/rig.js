// rig.js — 今日の被写体。
//
// 装置の名前: 「ニブの角度（the nib angle）」
//
// 字は輪郭を持たない。持っているのは骨格（glyphs.js の線分と円弧）と、
// ペン先（nib）ひとつ。平筆のペン先は「幅を持った1本の線分」で、紙に落ちる
// ストロークの太さは、進行方向とペン先の角度の差の sin で決まる。
//
//     w(t) = W * |sin( φ(t) − θ_nib )|
//
// θ_nib を回すと、同じ骨格から別の書体が出る。差が消える向き（uContrast=0）が
// 等幅の geometric sans、差を全部通す向き（uContrast=1）がコントラストのついた
// カリグラフィ寄りの書体。CREDIT SAISON TYPEFACE が2書体を並べて見せている
// SAISON Sans と SAISON Sans Advance の関係は、この1つの角度でつながっている。
//
// 太さは CPU では一切決めない。頂点は「骨格上の点」と「そこでの法線・接線角」
// だけを持って GPU に渡り、太らせるのは頂点シェーダの仕事。だから nib を回して
// も1バイトもバッファを書き換えない。

import * as THREE from 'three'
import { GLYPHS, polyline } from './glyphs.js'

// ── 骨格 → リボンのソリッド ─────────────────────────────────────────────
// 頂点が持つのは skeleton の点・面内法線・side(±1)・z(±1)・接線角・種別。
// 種別 0 = 前後の面 / 1 = 側壁 / 2 = 端のフタ。
function strokeSoup(pts, out) {
  const n = pts.length
  if (n < 2) return

  const tang = []
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)]
    const b = pts[Math.min(n - 1, i + 1)]
    tang.push(Math.atan2(b[1] - a[1], b[0] - a[0]))
  }

  const push = (i, side, z, kind, cap) => {
    const phi = tang[i]
    out.pos.push(pts[i][0], pts[i][1], 0)
    out.nrm.push(-Math.sin(phi), Math.cos(phi))
    out.side.push(side)
    out.z.push(z)
    out.phi.push(phi)
    out.kind.push(kind)
    out.cap.push(cap)
  }

  for (let i = 0; i < n - 1; i++) {
    const j = i + 1
    // 前面 / 背面
    for (const z of [1, -1]) {
      push(i, -1, z, 0, 0); push(i, 1, z, 0, 0); push(j, 1, z, 0, 0)
      push(i, -1, z, 0, 0); push(j, 1, z, 0, 0); push(j, -1, z, 0, 0)
    }
    // 左右の側壁
    for (const s of [1, -1]) {
      push(i, s, 1, 1, 0); push(i, s, -1, 1, 0); push(j, s, -1, 1, 0)
      push(i, s, 1, 1, 0); push(j, s, -1, 1, 0); push(j, s, 1, 1, 0)
    }
  }
  // 端のフタ（幅が0になる向きでは潰れるので、そこは自然に消える）
  for (const [i, cap] of [[0, -1], [n - 1, 1]]) {
    push(i, -1, 1, 2, cap); push(i, 1, 1, 2, cap); push(i, 1, -1, 2, cap)
    push(i, -1, 1, 2, cap); push(i, 1, -1, 2, cap); push(i, -1, -1, 2, cap)
  }
}

const cache = new Map()

export function glyphGeometry(ch) {
  if (cache.has(ch)) return cache.get(ch)
  const g = GLYPHS[ch]
  const out = { pos: [], nrm: [], side: [], z: [], phi: [], kind: [], cap: [] }
  for (const s of g.s) strokeSoup(polyline(s), out)

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(out.pos, 3))
  geo.setAttribute('aNormal', new THREE.Float32BufferAttribute(out.nrm, 2))
  geo.setAttribute('aSide', new THREE.Float32BufferAttribute(out.side, 1))
  geo.setAttribute('aZ', new THREE.Float32BufferAttribute(out.z, 1))
  geo.setAttribute('aPhi', new THREE.Float32BufferAttribute(out.phi, 1))
  geo.setAttribute('aKind', new THREE.Float32BufferAttribute(out.kind, 1))
  geo.setAttribute('aCap', new THREE.Float32BufferAttribute(out.cap, 1))
  // 骨格の点しか入っていないので、three が計算する bounding sphere は太らせた後の
  // 実体より小さい。フラスタムカリングで消えないよう広めに手で持たせる。
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(g.w / 2, 0.5, 0), g.w + 1.2)
  cache.set(ch, geo)
  return geo
}

// ── インクの材質 ───────────────────────────────────────────────────────
// 太らせる計算がここに入っている。CPU 側は uNib を1つ書き換えるだけ。
const VERT = /* glsl */ `
  attribute vec2 aNormal;
  attribute float aSide;
  attribute float aZ;
  attribute float aPhi;
  attribute float aKind;
  attribute float aCap;

  uniform float uNib;       // ペン先の角度（rad）
  uniform float uContrast;  // 0 = 等幅（Sans） / 1 = 全部通す（Advance）
  uniform float uWeight;    // 最大の太さ（em）
  uniform float uMin;       // 細くなりきる手前で止める（紙に線が残る限界）
  uniform float uDepth;

  varying vec3 vN;
  varying float vKind;

  void main() {
    float s = abs(sin(aPhi - uNib));
    float w = 0.5 * uWeight * mix(1.0, max(s, uMin), uContrast);

    vec3 p = position;
    p.xy += aNormal * (aSide * w);
    p.z += aZ * uDepth * 0.5;

    vec3 n;
    if (aKind < 0.5)      n = vec3(0.0, 0.0, aZ);
    else if (aKind < 1.5) n = vec3(aNormal * aSide, 0.0);
    else                  n = vec3(cos(aPhi) * aCap, sin(aPhi) * aCap, 0.0);

    vN = normalize(normalMatrix * n);
    vKind = aKind;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`

const FRAG = /* glsl */ `
  uniform vec3 uColor;
  varying vec3 vN;
  varying float vKind;

  void main() {
    vec3 n = normalize(vN);
    if (!gl_FrontFacing) n = -n;

    vec3 L1 = normalize(vec3(-0.40, 0.72, 0.56));
    vec3 L2 = normalize(vec3( 0.78, -0.26, 0.30));
    float d1 = max(dot(n, L1), 0.0);
    float d2 = max(dot(n, L2), 0.0);

    vec3 c = uColor * (0.60 + 0.40 * d1) + uColor * 0.26 * d2;
    c += vec3(1.0) * 0.14 * pow(d1, 16.0);
    c *= (vKind < 0.5) ? 1.0 : 0.76;   // 面はインクの色、壁は一段沈める

    gl_FragColor = vec4(c, 1.0);
    #include <colorspace_fragment>
  }
`

export function inkMaterial(hex, shared) {
  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: THREE.DoubleSide,
    uniforms: {
      uColor: { value: new THREE.Color(hex).convertSRGBToLinear() },
      uNib: shared.uNib,
      uContrast: shared.uContrast,
      uWeight: shared.uWeight,
      uMin: { value: 0.17 },
      uDepth: { value: 0.16 },
    },
  })
}

// ── 見本帳の地 ─────────────────────────────────────────────────────────
export function backdropMaterial(top, bottom) {
  return new THREE.ShaderMaterial({
    depthWrite: false,
    uniforms: {
      uTop: { value: new THREE.Color(top).convertSRGBToLinear() },
      uBottom: { value: new THREE.Color(bottom).convertSRGBToLinear() },
    },
    vertexShader: `
      varying vec2 vUv;
      void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
    `,
    fragmentShader: `
      uniform vec3 uTop; uniform vec3 uBottom;
      varying vec2 vUv;
      void main(){
        float v = smoothstep(0.0, 1.0, vUv.y);
        vec3 c = mix(uBottom, uTop, v);
        // 版面の中央だけわずかに白を抜く（紙の照り）
        float r = length((vUv - vec2(0.5, 0.56)) * vec2(1.5, 1.0));
        c += vec3(0.035) * (1.0 - smoothstep(0.15, 0.85, r));
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }
    `,
  })
}
