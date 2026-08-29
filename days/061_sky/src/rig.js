// rig.js — 一次元の空 / the one-dimensional sky
//
// 再現元は IVS2026（https://www.ivs.events/）の FV。
// 実測メモにはこうある：「黒地(#200000 40.9%)に赤#C80403の一色。FVは赤いメタリックの
// グラデーションがcanvasで流れ、背景に『無限冒険頂点』の白抜き袋文字を敷く。」
//
// あの面が金属に見える理由は、反射率でも粗さでもない。**環境が1本の帯しかない**ことだ。
// 空を1次元に潰すと、面の色は「法線がどこを向いているか」ではなく
// 「反射ベクトルの仰角ひとつ」で決まる。帯の勾配が急な所に、金属特有の折れが出る。
//
// だからこのファイルが作るのは3つだけ：
//   1. makeSkyBand()   — 256×1 の空。これが環境の全部
//   2. makeGlyphField()— 地紋。色を持たず、法線を曲げるためだけに存在する高さ場
//   3. FIELD_GLSL      — 高さ場と、その **解析微分**（法線を有限差分で作らない理由は下）
//
// メッシュは 220×140 しかない。法線をメッシュの分解能から作っていたら、
// この粗さでは帯は階段になる。h(x,y) の ∂h/∂x, ∂h/∂y を閉じた式で持てば、
// 法線は頂点数と無関係になる——粗い幾何の上に、細かい反射が乗る。

import * as THREE from 'three'

// ── 1. 空（256×1）──────────────────────────────────────────────────────
// 上から下まで、黒・熱い赤の帯・細い白のストリップ。それだけ。
// 停止点は「反射ベクトルの仰角 t=0(真下)〜1(真上)」に対応する。
// 🔴 帯の停止点は「面がその高さを映したときの色」で、画面のどこに何色が出るかは
// 帯の形と uHorizon（下）の2つだけで決まる。平らな面は t=0.40 の暗い所に置いてあり、
// 熱い赤 0.50 と白の1本 0.676 には、波で傾いた面しか届かない。
// = 明るい線は描いていない。傾きが帯の段差に届いた場所に、勝手に出る。
const STOPS = [
  [0.0, '#020101'],
  [0.2, '#050202'],
  [0.36, '#0d0303'], // ← 帯の下 4割は実質まっ黒。元サイトの「黒地 40.9%」はここから出す
  [0.46, '#2e0504'],
  [0.545, '#7c0806'],
  [0.6, '#c80403'], // ← IVS の赤
  [0.645, '#e8321c'],
  [0.668, '#ff7a4e'],
  [0.684, '#fff6f0'], // スタジオの1本。幅 0.016。金属を金属にしているのはだいたいこれ
  [0.7, '#ff9b73'],
  [0.725, '#b3120c'],
  [0.79, '#360504'],
  [0.88, '#0a0202'],
  [1.0, '#040101'],
]

function hexToRgb(h) {
  const n = parseInt(h.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function makeSkyBand(N = 256) {
  const data = new Uint8Array(N * 4)
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1)
    let a = STOPS[0]
    let b = STOPS[STOPS.length - 1]
    for (let s = 0; s < STOPS.length - 1; s++) {
      if (t >= STOPS[s][0] && t <= STOPS[s + 1][0]) {
        a = STOPS[s]
        b = STOPS[s + 1]
        break
      }
    }
    const k = b[0] === a[0] ? 0 : (t - a[0]) / (b[0] - a[0])
    const ca = hexToRgb(a[1])
    const cb = hexToRgb(b[1])
    data[i * 4 + 0] = ca[0] + (cb[0] - ca[0]) * k
    data[i * 4 + 1] = ca[1] + (cb[1] - ca[1]) * k
    data[i * 4 + 2] = ca[2] + (cb[2] - ca[2]) * k
    data[i * 4 + 3] = 255
  }
  const tex = new THREE.DataTexture(data, 1, N, THREE.RGBAFormat)
  tex.minFilter = THREE.LinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.wrapS = THREE.ClampToEdgeWrapping
  tex.wrapT = THREE.ClampToEdgeWrapping
  tex.needsUpdate = true
  return tex
}

// ── 2. 地紋 ────────────────────────────────────────────────────────────
// 「無限冒険頂点」を英語に置いた3行。読ませない。読ませないので袋文字（stroke のみ）で、
// しかも強くぼかす。文字が持っているのは色ではなく **勾配** だけで、
// 金属の帯がそこで折れることでしか存在が分からない。
//
// x 方向は必ず整数個ちょうどで割り切れるように横スケールを調整する。
// そうしないと RepeatWrapping の継ぎ目が「反射の段差」として出てしまう。
const LINES = [
  { text: 'INFINITE ', y: 0.345, size: 0.145, weight: 700 },
  { text: 'ADVENTURE ', y: 0.5, size: 0.185, weight: 700 },
  { text: 'SUMMIT ', y: 0.655, size: 0.145, weight: 700 },
]

export function makeGlyphField(W = 1024, H = 512) {
  const cv = document.createElement('canvas')
  cv.width = W
  cv.height = H
  const c = cv.getContext('2d')
  c.fillStyle = '#000'
  c.fillRect(0, 0, W, H)

  c.filter = 'blur(4px)'
  c.strokeStyle = '#fff'
  c.lineJoin = 'round'
  c.textBaseline = 'middle'

  for (const L of LINES) {
    const px = Math.round(H * L.size)
    c.font = `${L.weight} ${px}px "Helvetica Neue", Helvetica, Arial, sans-serif`
    // 1単位の幅を測り、W にちょうど n 個入るよう横に縮める（= 継ぎ目を消す）
    const unit = c.measureText(L.text).width
    const n = Math.max(1, Math.round(W / unit))
    const sx = W / (unit * n)
    c.lineWidth = Math.max(2, px * 0.055) / sx
    c.save()
    c.scale(sx, 1)
    for (let i = -1; i <= n; i++) c.strokeText(L.text, i * unit, H * L.y)
    c.restore()
  }
  c.filter = 'none'

  const tex = new THREE.CanvasTexture(cv)
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.ClampToEdgeWrapping
  tex.minFilter = THREE.LinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.generateMipmaps = false
  tex.needsUpdate = true
  return tex
}

// ── 3. 高さ場とその解析微分 ─────────────────────────────────────────────
// field(p) は vec3(h, ∂h/∂x, ∂h/∂y) を返す。頂点シェーダと断片シェーダの両方が
// 同じ関数を呼ぶ（頂点は h だけ、断片は微分だけ使う）。
//
// 第1項だけ入れ子の sin にしてある。sin(x + B·sin(y)) は「波が波に押されて曲がる」形で、
// 流れる金属の見た目のほとんどはこの1項から出る。微分も閉じた形で書ける：
//   u = kx·x + w·t + B·sin(v),  v = my·y + q·t
//   ∂u/∂x = kx,  ∂u/∂y = B·my·cos(v)
export const FIELD_GLSL = /* glsl */ `
uniform sampler2D uGlyph;
uniform float uTime;
uniform float uScroll;
uniform float uGlyphAmp;
uniform float uAmp;

#define WAVE(a, kx, ky, w, ph) { \
  float f = (kx)*p.x + (ky)*p.y + (w)*uTime + (ph); \
  float s = sin(f), cc = cos(f); \
  r.x += (a)*s; r.y += (a)*(kx)*cc; r.z += (a)*(ky)*cc; }

vec3 field(vec2 p) {
  vec3 r = vec3(0.0);

  // 1. うねり（入れ子の1項）。広い帯の流れはほぼこの1項が作る
  float v  = p.y * 0.62 + uTime * 0.21;
  float cv = cos(v);
  float u  = p.x * 2.30 - uTime * 0.55 + 1.35 * sin(v);
  float su = sin(u), cu = cos(u);
  r.x += 0.130 * su;
  r.y += 0.130 * cu * 2.30;
  r.z += 0.130 * cu * (1.35 * 0.62 * cv);

  // 2〜6. 平面波。ここで効くのは高さ a ではなく **傾き a·k** のほう：
  //   0.062 / 0.221 / 0.147 / 0.128 / 0.091  （+ 上の 0.299）＝ 合計およそ 0.95
  // 傾きが 1 に届くと法線は 45° 倒れ、反射は 90° 振れる。つまり
  // 「256px の空を端から端まで舐める」のに必要な傾きはこの辺にある。
  // 波を **高く** するのではなく **短く** して稼いでいる（板の起伏は 0.13 のまま）。
  // ky を kx より小さく取ってあるのは、細かい成分まで ky を大きくすると
  // 斜めの干渉縞が立って画面が織物になるから（今日1回そうなった）。
  WAVE(0.0600,  -1.04,  1.10, -0.35, 2.2)
  WAVE(0.0480,   4.60,  1.90,  0.90, 0.0)
  WAVE(0.0160,   9.20, -2.60, -1.30, 1.7)
  WAVE(0.0058,  22.00,  5.00,  1.80, 0.4)
  WAVE(0.0019,  48.00, -11.0, -2.40, 2.9)

  r *= uAmp;

  // 6. 地紋。色を持たず勾配だけを持つ層。スクロールで横に流れる（= 元サイトの横スクロール）
  vec2 guv = vec2(p.x * 0.088 - uScroll * 0.78, p.y * 0.132 + 0.5);
  const float e = 1.0 / 384.0;
  float g  = texture2D(uGlyph, guv).r;
  float gx = texture2D(uGlyph, guv + vec2(e, 0.0)).r - texture2D(uGlyph, guv - vec2(e, 0.0)).r;
  float gy = texture2D(uGlyph, guv + vec2(0.0, e)).r - texture2D(uGlyph, guv - vec2(0.0, e)).r;
  r.x += uGlyphAmp * (g - 0.5);
  r.y += uGlyphAmp * (gx / (2.0 * e)) * 0.088;
  r.z += uGlyphAmp * (gy / (2.0 * e)) * 0.132;

  return r;
}
`

export const VERT = /* glsl */ `
varying vec2 vP;
varying vec3 vWorld;
${FIELD_GLSL}
void main() {
  vP = position.xy;
  vec3 disp = position;
  disp.z += field(vP).x;
  vec4 wp = modelMatrix * vec4(disp, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`

export const FRAG = /* glsl */ `
precision highp float;
varying vec2 vP;
varying vec3 vWorld;
uniform sampler2D uBand;
uniform float uRough;
uniform float uBandShift;
uniform float uHorizon;
uniform vec3 uTint;
uniform vec2 uRes;
// 🔴 three は normalMatrix / modelMatrix を **頂点シェーダにしか** 注入しない
// （WebGLProgram の prefixFragment は viewMatrix / cameraPosition / isOrthographic だけ）。
// 断片側で normalMatrix を書くと「未定義の識別子」でリンクに失敗し、
// エラーは console にしか出ないので、画面には「板が1枚も無い真っ黒」が出る。
// ビルドは通る。プレビューを撮って初めて分かる類の穴で、今日1回踏んだ。
uniform mat3 uNrm;
${FIELD_GLSL}

vec3 sky(float t) {
  return texture2D(uBand, vec2(0.5, clamp(t, 0.004, 0.996))).rgb;
}

void main() {
  vec3 f = field(vP);

  // 面の法線。メッシュの分解能ではなく、閉じた式から。
  vec3 nLocal = normalize(vec3(-f.y, -f.z, 1.0));
  vec3 N = normalize(uNrm * nLocal);

  vec3 V = normalize(vWorld - cameraPosition);
  vec3 R = reflect(V, N);

  // ここが全部。3次元の環境を、仰角というスカラー1つに潰す。
  // uHorizon は「板が平らな所を帯のどこに置くか」の1つの数。
  // 板の傾き（-0.34rad）とカメラ位置から、平らな面の R.y は約 0.55 になる＝ t≈0.775。
  // そこを帯の 0.40（暗い赤）に落としているので、既定値は 0.40-0.775 = -0.375。
  float t = R.y * 0.5 + 0.5 + uHorizon + uBandShift;

  // 粗さ = 帯をどれだけ舐めるか。BRDF は無い。積分幅が1つあるだけ。
  vec3 c = (sky(t - uRough) + sky(t) + sky(t + uRough)) * 0.3333;
  c *= uTint;

  // 面が視線と平行に近いところだけ、帯をもう一度薄く重ねる（グレージングの伸び）
  float graze = pow(1.0 - abs(dot(N, -V)), 5.0);
  c += sky(t + 0.055) * graze * 0.32;

  // 粒。金属の面は必ずどこかで粒を持つ
  float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  c += (n - 0.5) * 0.016;

  gl_FragColor = vec4(max(c, 0.0), 1.0);
}
`

// スクロール量は React の外に置く（毎フレーム再レンダリングさせないため）
export const scroll = { target: 0, value: 0 }
