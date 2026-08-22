// rig.js — 累算開口（accumulated aperture）
//
// 装置の主張はひとつだけ:
//   **光源を1つも置かない。明るさは「視線が横切った面の枚数」でできている。**
//
// そのために2つのスイッチを切る:
//   depthTest  = false   … 手前の面が奥の面を隠さない＝可視性の問題が消える
//   blending   = ONE/ONE … 画素の値が「その画素を通った面の数 × 一定の寄与」になる
//
// この2つを切った瞬間、絵の中の明暗は「どこに何枚あるか」だけの関数になる。
// トンネルの中心が明るいのは中心に光を置いたからではなく、遠い開口ほど
// 画面上で中心に畳まれ、単位面積あたりの枚数が距離の2乗で増えるからでしかない。
// `D` キーで depthTest を戻すと、同じ512枚がただの暗い筒に戻る（芯が消える）。
//
// 座標は2つある。混ぜると必ず壊れる（実際に一度壊した。下の 🔴 を見ること）:
//   c   トンネル座標。開口が輪のどこに居るかで、時間が経っても変わらない
//   sc  カメラの現在地（= mod(t * speed, PERIOD)）
//   u   カメラからの前方距離 = mod(c - sc, PERIOD)
//
// 形（芯の蛇行 spine・半径 radius・ロール roll）は **c の関数**。トンネルの持ち物だから。
// 見え方（フェード・色温度）は **u の関数**。カメラとの関係だから。
//   N, p  開口の角数と「多角形らしさ」。16枚ごとの帯で 7角→5角→円→4角→6角 と替わる

import * as THREE from 'three'

export const RIG = {
  count: 512, // 開口の枚数
  spacing: 0.78, // 開口の間隔（トンネル座標）
  seg: 256, // 開口1枚の分割数
  halfWidth: 0.058, // 帯の半幅（半径に対する比）
  r0: 2.35, // 基準半径
  speed: 7.4, // 前進速度（u/秒）
  gains: [0.038, 0.098, 0.240], // 1 / 2 / 3 キー。1枚あたりの寄与
  nSet: [7, 5, 64, 4, 6], // 帯ごとの角数（64 は実質まるい開口）
}

export const PERIOD = RIG.count * RIG.spacing // トンネルは周期 PERIOD の輪

// ── 幾何 ────────────────────────────────────────────────────────────────
// 頂点は位置を持たない。持つのは (aTheta, aBand) の2つだけで、
// どこに立つかは毎フレーム頂点シェーダが u から挽く。
export function buildApertureGeometry() {
  const { count, spacing, seg, nSet } = RIG
  const g = new THREE.InstancedBufferGeometry()

  const nv = (seg + 1) * 2
  const theta = new Float32Array(nv)
  const band = new Float32Array(nv)
  const dummy = new Float32Array(nv * 3)
  for (let i = 0; i <= seg; i++) {
    for (let j = 0; j < 2; j++) {
      const k = i * 2 + j
      theta[k] = i / seg
      band[k] = j * 2 - 1 // -1 = 内側 / +1 = 外側
    }
  }
  const idx = new Uint32Array(seg * 6)
  for (let i = 0; i < seg; i++) {
    const a = i * 2
    idx.set([a, a + 1, a + 3, a, a + 3, a + 2], i * 6)
  }

  g.setAttribute('position', new THREE.BufferAttribute(dummy, 3)) // three が要求するので置くだけ
  g.setAttribute('aTheta', new THREE.BufferAttribute(theta, 1))
  g.setAttribute('aBand', new THREE.BufferAttribute(band, 1))
  g.setIndex(new THREE.BufferAttribute(idx, 1))

  const iU = new Float32Array(count)
  const iN = new Float32Array(count)
  const iP = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    iU[i] = i * spacing
    const nIdx = Math.floor(i / 16) % nSet.length
    iN[i] = nSet[nIdx]
    iP[i] = nSet[nIdx] > 32 ? 0.0 : 1.0
  }
  g.setAttribute('iU', new THREE.InstancedBufferAttribute(iU, 1))
  g.setAttribute('iN', new THREE.InstancedBufferAttribute(iN, 1))
  g.setAttribute('iP', new THREE.InstancedBufferAttribute(iP, 1))
  g.instanceCount = count
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6) // カリングさせない

  return g
}

// ── 材質 ────────────────────────────────────────────────────────────────
const COMMON = /* glsl */ `
  #define TAU 6.28318530718
  uniform float uTime, uSpeed, uPeriod, uR0, uHW;

  // 🔴 ここの引数は「カメラからの距離 u」ではなく「トンネル座標 c」でなければならない。
  // 最初 u で書いてしまい、くびれが常にカメラの136手前に貼り付いて永久に近づかなかった。
  // 形はトンネルの持ち物で、距離の関数ではない。近づく・通り抜けるは c と現在地の差から出る。
  vec2 spine(float c) {
    return vec2(
      0.86 * sin(c * 0.0412) + 0.42 * sin(c * 0.0171 + 1.3),
      0.62 * cos(c * 0.0287) + 0.33 * sin(c * 0.0123 + 0.4)
    );
  }

  // 半径。0.52 まで絞られる くびれ と 1.38 の広間 が1周の中に1つずつ来る
  float radius(float c) {
    float s = 0.95
      + 0.34 * sin(c * 0.0157 + 0.8)
      + 0.11 * sin(c * 0.0620 + 2.1)
      - 0.30 * exp(-pow((c - uPeriod * 0.34) / 22.0, 2.0));
    return uR0 * max(s, 0.30);
  }

  float roll(float c) { return c * 0.0605 + 0.35 * sin(c * 0.021); }

  // 正N角形の半径（角で 1、辺の中央で cos(pi/N)）
  float polyR(float a, float n) {
    float k = TAU / n;
    return cos(3.14159265 / n) / cos(mod(a, k) - k * 0.5);
  }
`

const VERT = /* glsl */ `
  attribute float aTheta, aBand;
  attribute float iU, iN, iP;
  varying float vBand, vU, vFade;
  ${COMMON}

  void main() {
    float sc = mod(uTime * uSpeed, uPeriod); // カメラの現在地（トンネル座標）
    float cc = iU;                           // この開口の居場所（不変）
    float u = mod(cc - sc, uPeriod);         // カメラからの前方距離

    float R = radius(cc);
    float r = R * mix(1.0, polyR(aTheta * TAU, iN), iP);
    float rr = r + aBand * uHW * R;
    float a = aTheta * TAU;
    vec2 p = vec2(cos(a), sin(a)) * rr;
    float co = cos(roll(cc)), si = sin(roll(cc));
    // 芯はカメラの居る所を原点に取る＝カメラは管の中心線に乗って運ばれる。
    // 遠いほど横ずれを寝かせる（本当は接線に合わせて首を振るべきで、その代用）。
    vec2 off = (spine(cc) - spine(sc)) * exp(-u / 190.0);
    p = vec2(p.x * co - p.y * si, p.x * si + p.y * co) + off;

    // 入り口と出口だけ落とす。中間は一様＝枚数がそのまま明るさになる
    vFade = smoothstep(0.0, 6.0, u) * (1.0 - smoothstep(uPeriod - 130.0, uPeriod, u));
    vBand = aBand;
    vU = u;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, -u, 1.0);
  }
`

const FRAG = /* glsl */ `
  precision highp float;
  varying float vBand, vU, vFade;
  uniform float uGain, uOpaque;
  uniform vec3 uNear, uFar;
  ${COMMON}

  void main() {
    // 帯を横切る方向のガウス。硬い縁を作らない（遠くの開口が1画素を割るので）
    float g = exp(-vBand * vBand * 2.6);
    vec3 tint = mix(uNear, uFar, smoothstep(16.0, 150.0, vU));

    if (uOpaque > 0.5) {
      // D キー: depthTest を戻した世界。同じ512枚が、ただの暗い筒になる。
      // 手前の1枚が奥の511枚を隠した瞬間、芯は消える＝芯は枚数でできていた
      float sh = exp(-vU * 0.022);
      gl_FragColor = vec4(tint * (0.30 * sh + 0.012) * vFade, 1.0);
      return;
    }
    gl_FragColor = vec4(tint * (uGain * g * vFade), 1.0);
  }
`

export function buildApertureMaterial(gain) {
  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uTime: { value: 0 },
      uSpeed: { value: RIG.speed },
      uPeriod: { value: PERIOD },
      uR0: { value: RIG.r0 },
      uHW: { value: RIG.halfWidth },
      uGain: { value: gain },
      uOpaque: { value: 0 },
      uNear: { value: new THREE.Color(0.66, 0.74, 0.96) }, // 手前は銀
      uFar: { value: new THREE.Color(1.00, 0.82, 0.55) }, // 奥は金
    },
    transparent: true,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
}

// depthTest を戻す／切る。装置が本当にこの2つのスイッチで出来ていることの実演
export function setOpaque(mat, on) {
  mat.uniforms.uOpaque.value = on ? 1 : 0
  mat.depthTest = on
  mat.depthWrite = on
  mat.blending = on ? THREE.NormalBlending : THREE.CustomBlending
  mat.transparent = !on
  mat.needsUpdate = true
}
