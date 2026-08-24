// rig.js — Day 056 / Blade Phase
//
// 再現元 Dgrees (https://dgrees.studio/) の FV は、紫のグラデーションの上に
// 「羽根の集合でできた3Dのリング」が1つだけ置いてある。
//
// この装置の勘所は、リングが *面* ではないところにある。羽根の根元は円周上に
// 固定されていて一度も動かない。にもかかわらず環に見えたり見えなかったりする。
// 環を作っているのは位置ではなく、**羽根どうしの向きが揃っていること**だけ。
//
// だからこの rig は「羽根1枚の形」を θ の関数として書き、その関数の係数を
// coherence という1つのスカラーで
//
//     揃った法則（θ の滑らかな関数）  ←→  各羽根が勝手に決めた値
//
// のあいだで混ぜる。coherence を θ に沿って進む波にすると、1枚の静止画の中で
// 環と鱗片の散乱が同時に見える。

import * as THREE from 'three'

// ── 今日の色 ────────────────────────────────────────────────────────────
// Dgrees の実測（Notion スワイプファイルDB）:
//   紫 #7A2ACC のグラデーションを地に、同系の青紫〜マゼンタで塗った3Dのリング。
//   差し色は黄緑 #C8E858 を見出しとラベルに、橙 #FF5900 をカーソルの矩形にだけ。
export const PAL = {
  deep: '#33115F', //  地のいちばん暗いところ（画面外周）
  ground: '#7A2ACC', //  実測の主色。地の中庸
  glow: '#C255DE', //  リングの背後だけ持ち上げる
  violet: '#3A1FD6', //  羽根の根元側
  magenta: '#FF4FA8', //  羽根の先端側
  lime: '#C8E858', //  差し色。先端の稜線にだけ
  orange: '#FF5900', //  カーソルの矩形にだけ（DOM 側）
}

// ── リングの寸法 ────────────────────────────────────────────────────────
export const RING = {
  radius: 1.26,
  blades: 288,
  seg: 16, // 羽根1枚を s 方向に何分割するか
  length: 0.66,
  width: 0.052,
}

// coherence の波が θ を一周する周期（秒）
export const SEAM_PERIOD = 21.0

// 位相の継ぎ目（＝いま揃っている側の中心）が今どこにいるか。
// Scene と DOM の読み値がずれないよう、両方ここを呼ぶ。
export function seamAngle(t) {
  const a = ((t / SEAM_PERIOD) * Math.PI * 2) % (Math.PI * 2)
  return a < 0 ? a + Math.PI * 2 : a
}

// ── 羽根の帯を1本の BufferGeometry に畳む ───────────────────────────────
//
// 頂点が持つのは「その頂点が何番の羽根の、どこの点か」だけ。実際の座標は
// 全部 vertex shader で組み立てる（羽根の形が毎フレーム変わるので、CPU 側に
// 座標を持たせても書き戻す羽目になる）。
export function buildBladeField({ blades, seg, radius } = RING) {
  const rows = seg + 1
  const vertsPerBlade = rows * 2
  const count = blades * vertsPerBlade

  const position = new Float32Array(count * 3) // 根元の点。bounding 用の当て馬
  const aTheta = new Float32Array(count)
  const aSU = new Float32Array(count * 2)
  const aRand = new Float32Array(count * 4)

  const index = []
  let v = 0

  for (let i = 0; i < blades; i++) {
    const theta = (i / blades) * Math.PI * 2
    const base = v

    // 羽根ごとの「勝手な値」。乱数は毎回同じ絵が出るよう決定的に作る。
    const r0 = hash(i * 1.0 + 0.5)
    const r1 = hash(i * 2.7 + 11.3)
    const r2 = hash(i * 5.1 + 27.9)
    const r3 = hash(i * 9.4 + 61.7)

    const cx = Math.cos(theta) * radius
    const cz = Math.sin(theta) * radius

    for (let r = 0; r < rows; r++) {
      const s = r / seg
      for (let k = 0; k < 2; k++) {
        const u = k === 0 ? -1 : 1
        position[v * 3 + 0] = cx
        position[v * 3 + 1] = 0
        position[v * 3 + 2] = cz
        aTheta[v] = theta
        aSU[v * 2 + 0] = s
        aSU[v * 2 + 1] = u
        aRand[v * 4 + 0] = r0
        aRand[v * 4 + 1] = r1
        aRand[v * 4 + 2] = r2
        aRand[v * 4 + 3] = r3
        v++
      }
    }

    for (let r = 0; r < seg; r++) {
      const a = base + r * 2
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
  }

  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(position, 3))
  g.setAttribute('aTheta', new THREE.BufferAttribute(aTheta, 1))
  g.setAttribute('aSU', new THREE.BufferAttribute(aSU, 2))
  g.setAttribute('aRand', new THREE.BufferAttribute(aRand, 4))
  g.setIndex(index)
  // 座標は shader 側で作るので、three に測らせると潰れた球が出る。手で置く。
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.25, 0), 3.2)
  return g
}

function hash(n) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

// ── 羽根の shader ───────────────────────────────────────────────────────
//
// bladePoint() が装置そのもの。coherence = 1 のとき係数は θ の滑らかな関数で、
// 268枚が同じ法則に従う＝環が読める。coherence = 0 のとき係数は羽根ごとの
// 乱数になり、根元は円周上のままなのに環としての読みが消える。

export const BLADE_VERT = /* glsl */ `
attribute float aTheta;
attribute vec2  aSU;
attribute vec4  aRand;

uniform float uTime;
uniform float uSeam;      // 位相の継ぎ目の角度
uniform float uBand;      // 揃っている側の広さ（rad 相当の smoothstep 幅）
uniform float uRadius;
uniform float uLength;
uniform float uWidth;
uniform float uPsi;       // 揃ったときの仰角
uniform float uPsiAmp;
uniform float uBend;
uniform float uBendAmp;
uniform float uTwist;

varying vec3  vNormal;
varying vec3  vWorld;
varying float vS;
varying float vTheta;
varying float vCoh;

// θ における coherence。継ぎ目を挟んで 0 → 1 に立ち上がる帯。
float coherenceAt(float theta) {
  float d = cos(theta - uSeam);           // -1 .. 1
  return smoothstep(-uBand, uBand, d);
}

vec3 bladePoint(float theta, float s, float u, vec4 rnd, float coh) {
  float ct = cos(theta), st = sin(theta);
  vec3  C  = vec3(uRadius * ct, 0.0, uRadius * st);   // 根元。coh に依らず不動
  vec3  Nr = vec3(ct, 0.0, st);                       // 外向き
  vec3  Up = vec3(0.0, 1.0, 0.0);
  vec3  Tg = vec3(-st, 0.0, ct);                      // 接線

  // 揃った法則：全部 θ の関数
  float wob   = sin(2.0 * theta + 0.6) ;
  float psiC   = uPsi   + uPsiAmp  * wob;
  float bendC  = uBend  + uBendAmp * cos(2.0 * theta + 0.6);
  float twistC = uTwist + 0.35 * wob;
  float lenC   = uLength * (1.0 + 0.10 * sin(3.0 * theta + 1.4));

  // 勝手な値：全部その羽根の乱数
  float psiI   = -0.22 + rnd.x * 2.35;
  float bendI  = -1.35 + rnd.y * 3.9;
  float twistI = -2.6 + rnd.z * 5.2;
  float lenI   = uLength * (0.58 + 0.78 * rnd.w);

  float psi   = mix(psiI,   psiC,   coh);
  float bend  = mix(bendI,  bendC,  coh);
  float twist = mix(twistI, twistC, coh);
  float len   = mix(lenI,   lenC,   coh);

  // 方向 d(σ) = cos(psi + bend·σ)·Nr + sin(psi + bend·σ)·Up を σ=0..s で積分する。
  // 曲率一定なので閉じた形になる（円弧）。bend→0 で直線に落ちるよう分岐。
  float bs = bend * s;
  float ia, ib;
  if (abs(bend) < 1e-3) {
    ia = s * cos(psi);
    ib = s * sin(psi);
  } else {
    ia = (sin(psi + bs) - sin(psi)) / bend;
    ib = (cos(psi) - cos(psi + bs)) / bend;
  }
  vec3 axis = C + len * (ia * Nr + ib * Up);

  // 幅の向きは、羽根の軸まわりに twist·s だけ回した接線
  vec3  d  = cos(psi + bs) * Nr + sin(psi + bs) * Up;
  float ph = twist * s;
  vec3  W  = Tg * cos(ph) + cross(d, Tg) * sin(ph);

  // 根元は点、s≈0.41 で最大、先端は点。羽根の外形はここだけで決まる
  float w = uWidth * pow(sin(3.14159265 * pow(clamp(s, 0.0, 1.0), 0.72)), 1.05);

  return axis + W * (u * w);
}

void main() {
  float theta = aTheta;
  float s = aSU.x;
  float u = aSU.y;
  float coh = coherenceAt(theta);

  vec3 p = bladePoint(theta, s, u, aRand, coh);

  // 法線は中央差分で取る。解析的に出すより式が短く、bend の分岐にも巻き込まれない
  float e = 0.012;
  vec3 pa = bladePoint(theta, min(s + e, 1.0), u, aRand, coh);
  vec3 pb = bladePoint(theta, max(s - e, 0.0), u, aRand, coh);
  vec3 pc = bladePoint(theta, s, u + e, aRand, coh);
  vec3 pd = bladePoint(theta, s, u - e, aRand, coh);
  vec3 n  = cross(pa - pb, pc - pd);
  n = length(n) > 1e-8 ? normalize(n) : vec3(0.0, 1.0, 0.0);

  vec4 world = modelMatrix * vec4(p, 1.0);
  vWorld  = world.xyz;
  vNormal = normalize(mat3(modelMatrix) * n);
  vS = s;
  vTheta = theta;
  vCoh = coh;

  gl_Position = projectionMatrix * viewMatrix * world;
}
`

export const BLADE_FRAG = /* glsl */ `
precision highp float;

uniform vec3  uViolet;
uniform vec3  uMagenta;
uniform vec3  uLime;
uniform vec3  uGround;
uniform vec3  uDeep;
uniform vec3  uCamPos;

varying vec3  vNormal;
varying vec3  vWorld;
varying float vS;
varying float vTheta;
varying float vCoh;

void main() {
  vec3 n = normalize(vNormal);
  if (!gl_FrontFacing) n = -n;
  vec3 v = normalize(uCamPos - vWorld);

  vec3 L1 = normalize(vec3(-0.30,  0.92,  0.38));
  vec3 L2 = normalize(vec3( 0.78, -0.16,  0.52));

  // 薄板なので半ランバートで拾う。陰側を落としきると環が穴だらけに見える
  float d1 = clamp(dot(n, L1) * 0.5 + 0.5, 0.0, 1.0);
  float d2 = clamp(dot(n, L2) * 0.5 + 0.5, 0.0, 1.0);

  vec3 h1 = normalize(L1 + v);
  float spec = pow(max(dot(n, h1), 0.0), 46.0);

  float along = clamp(vS * 0.78 + 0.22 * (0.5 + 0.5 * sin(vTheta * 2.0 + 0.6)), 0.0, 1.0);
  vec3 base = mix(uViolet, uMagenta, smoothstep(0.04, 0.96, along));

  vec3 col = base * (0.11 + 1.16 * d1) + uMagenta * 0.14 * d2;
  col += vec3(1.0) * spec * 0.26;

  // 縁が立っている羽根だけ光る。板の集合であることはここで読める
  float rim = pow(1.0 - abs(dot(n, v)), 2.6);
  col += mix(uGround, uMagenta, 0.58) * rim * 0.52;

  // 差し色。揃っている側の先端の稜線にだけ乗せる（Dgrees の黄緑と同じ扱い）
  float tip = smoothstep(0.78, 1.0, vS) * vCoh;
  col += uLime * tip * rim * 1.45;
  col += uLime * tip * 0.075;

  // 位相が崩れた側は地の紫へ沈める。環の読みは明るさでも補強される
  col = mix(mix(uDeep, uGround, 0.16) * 0.72, col, 0.44 + 0.56 * vCoh);

  // 奥は地に溶かす（広角なので手前と奥の距離差が大きい）
  float dist = length(uCamPos - vWorld);
  col = mix(col, mix(uDeep, uGround, 0.34), smoothstep(3.4, 7.0, dist) * 0.42);

  // filmic 寄りの軽いトーンマップ
  col = col / (col + vec3(0.85)) * 1.30;
  gl_FragColor = vec4(col, 1.0);

  // 🔴 自前の fragment shader は three の色空間変換に乗らない。
  //    #include を落とすと linear の値がそのまま sRGB のバッファへ行き、
  //    絵が丸ごと沈む（今日ここで1時間溶かした）。
  #include <colorspace_fragment>
}
`

// ── 地（背景の球）──────────────────────────────────────────────────────
// Dgrees の地は canvas の紫グラデーション1枚。ここも同じく、面ではなく
// 「見ている方向」の関数として塗る。

export const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

export const SKY_FRAG = /* glsl */ `
precision highp float;
uniform vec3 uDeep;
uniform vec3 uGround;
uniform vec3 uGlow;
uniform vec2 uRes;
varying vec3 vDir;

void main() {
  // 地は「見ている方向」ではなく素直に画面の縦位置で作る。
  // 方向ベースにすると広角の歪みで下端だけ落ち込み、実測の #7A2ACC が
  // 画面のどこにも出てこなくなる（1度そうなった）。
  vec2 uv = gl_FragCoord.xy / uRes;

  vec3 col = mix(uDeep, uGround, smoothstep(-0.10, 0.92, uv.y));

  // リングの立つ高さのすぐ上に光の帯を1本
  float band = exp(-pow((uv.y - 0.62) * 3.1, 2.0));
  col = mix(col, uGlow, band * 0.30);

  // 四隅を軽く締める
  float vig = 1.0 - 0.30 * pow(length((uv - 0.5) * vec2(1.06, 1.0)) * 1.42, 2.0);
  col *= clamp(vig, 0.58, 1.0);

  // 粗い縦のバンディングを潰す
  float dither = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  col += (dither - 0.5) * 0.006;

  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`
