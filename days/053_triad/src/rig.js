// rig.js — 旋盤の身体 / the lathe body
//
// Schlemmer の Figurine は、腕でも脚でもなく **旋盤で挽いた立体**でできている。
// 円盤・球・釣鐘・紡錘を1本の縦軸に積んだだけの体で、関節がない。
// だからこの日の被写体は「ポーズを持たない体」であって、踊りは姿勢の変化ではなく
// **輪郭 r(h) そのものの変化**になる。幕が変わるとは、profile が別の profile へ
// 挽き直されることを言う。
//
// ここが持っているのは3つだけ:
//   1. profile（(t, r) の制御点列 → 256サンプルの半径列）
//   2. それを幕ぶん重ねた DataTexture（R=第1幕 / G=第2幕 / B=第3幕 の半径）
//   3. 高さで色を塗る 1D パレットテクスチャ（漆・金・白の帯）
// 頂点はこのテクスチャを読んで自分の居場所を決める。CPU は毎フレーム何もしない。

import * as THREE from 'three'

export const PROFILE_SAMPLES = 256

// ── 舞台 ────────────────────────────────────────────────────────────────
// 三幕・三色。原作の指定は「レモンイエロー（諧謔）→ ピンク（荘重）→ 黒（神秘）」で、
// 明度が段階的に落ちていく。落ち方そのものが構成なので、彩度は落とさない。
export const ACTS = [
  {
    roman: 'I',
    name: 'SERENE BURLESQUE',
    ground: '#EBCE43',
    floor: '#D2AF23',
    horizon: '#F4E087',
    tint: '#FFFFFF',
    key: '#FFF6D8',
    fill: '#B98F17',
    spin: 1.0,
    breath: 0.07,
    shadow: 0.4,
  },
  {
    roman: 'II',
    name: 'CEREMONIOUS',
    ground: '#D28189',
    floor: '#B4626C',
    horizon: '#DE9AA0',
    tint: '#FBEDEC',
    key: '#FFE9E6',
    fill: '#8E4A56',
    spin: 0.34,
    breath: 0.03,
    shadow: 0.42,
  },
  {
    roman: 'III',
    name: 'MYSTICAL FANTASTIC',
    ground: '#0C0B0A',
    floor: '#141210',
    horizon: '#1D1A17',
    tint: '#E8DFCB',
    key: '#FFF3D6',
    fill: '#241E16',
    spin: 0.07,
    breath: 0.016,
    shadow: 0.6,
  },
]

// ── profile の書き方 ────────────────────────────────────────────────────
// 制御点は [t, r]。t は足元 0 → 頭頂 1。間は単調寄りの Catmull-Rom で埋める。
// 「くびれ」を一点で指定できることが大事で、旋盤の体はくびれの位置で人格が決まる。
function sampleProfile(points, n = PROFILE_SAMPLES) {
  const pts = points.slice().sort((a, b) => a[0] - b[0])
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1)
    let k = 0
    while (k < pts.length - 2 && pts[k + 1][0] < t) k++
    const p0 = pts[Math.max(0, k - 1)]
    const p1 = pts[k]
    const p2 = pts[Math.min(pts.length - 1, k + 1)]
    const p3 = pts[Math.min(pts.length - 1, k + 2)]
    const span = Math.max(1e-6, p2[0] - p1[0])
    const u = Math.min(1, Math.max(0, (t - p1[0]) / span))
    // Catmull-Rom（半径だけ）。負に落ちると裏返るのでクランプする。
    const u2 = u * u
    const u3 = u2 * u
    const r =
      0.5 *
      (2 * p1[1] +
        (-p0[1] + p2[1]) * u +
        (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * u2 +
        (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * u3)
    out[i] = Math.max(0.004, r)
  }
  return out
}

// ── 三体 ────────────────────────────────────────────────────────────────
// 原作の三人に相当するものを、旋盤で挽ける形だけで組み直す。
// 各体は幕ごとに別の profile を持つ。幕が進むと縦に伸び、横が減り、
// 装飾（円盤・鍔）が体に吸収されていく。
//
//   THE BELL     釣鐘のスカート。第1幕でいちばん広がり、第3幕で紡錘になる。
//   THE SPINDLE  くびれ2つの紡錘。首が伸び、頭の球だけが残る。
//   THE DISC     円盤の塔。鍔が痩せて、最後は1本の柱になる。
const FIGURES = [
  {
    id: 'BELL',
    label: 'THE BELL',
    x: -2.62,
    height: [3.05, 3.35, 3.6],
    lean: 1.9,
    profiles: [
      // 第1幕：床まで届く釣鐘、肩に鍔、頭は小さい球
      [
        [0.0, 0.03], [0.02, 0.86], [0.1, 0.82], [0.22, 0.7], [0.34, 0.56],
        [0.46, 0.42], [0.54, 0.3], [0.6, 0.34], [0.66, 0.44], [0.7, 0.3],
        [0.76, 0.19], [0.8, 0.1], [0.84, 0.09], [0.9, 0.2], [0.96, 0.17],
        [1.0, 0.02],
      ],
      // 第2幕：裾が閉じ、鍔が薄くなり、首が伸びる
      [
        [0.0, 0.03], [0.03, 0.58], [0.14, 0.55], [0.28, 0.47], [0.42, 0.38],
        [0.54, 0.28], [0.6, 0.3], [0.65, 0.34], [0.7, 0.24], [0.78, 0.13],
        [0.84, 0.07], [0.88, 0.07], [0.93, 0.17], [0.98, 0.14], [1.0, 0.02],
      ],
      // 第3幕：鍔が消えて、ただの紡錘＋球
      [
        [0.0, 0.03], [0.04, 0.28], [0.2, 0.3], [0.4, 0.29], [0.58, 0.24],
        [0.72, 0.14], [0.82, 0.06], [0.87, 0.06], [0.93, 0.16], [0.98, 0.13],
        [1.0, 0.02],
      ],
    ],
    // 色は高さで塗る。[t, hex] の帯。ここが漆の塗り分けにあたる。
    bands: [
      [0.0, '#151310'], [0.5, '#151310'], [0.52, '#F1EAD9'], [0.68, '#F1EAD9'],
      [0.7, '#C8912E'], [0.78, '#C8912E'], [0.8, '#F1EAD9'], [0.88, '#F1EAD9'],
      [0.9, '#151310'], [1.0, '#151310'],
    ],
  },
  {
    id: 'SPINDLE',
    label: 'THE SPINDLE',
    x: 0.02,
    height: [3.5, 3.85, 4.05],
    lean: -3.2,
    profiles: [
      [
        [0.0, 0.03], [0.03, 0.2], [0.1, 0.16], [0.2, 0.24], [0.3, 0.44],
        [0.4, 0.52], [0.48, 0.42], [0.54, 0.24], [0.58, 0.36], [0.62, 0.22],
        [0.72, 0.14], [0.8, 0.1], [0.85, 0.1], [0.92, 0.22], [0.98, 0.18],
        [1.0, 0.02],
      ],
      [
        [0.0, 0.03], [0.03, 0.17], [0.12, 0.13], [0.24, 0.2], [0.34, 0.36],
        [0.44, 0.4], [0.52, 0.3], [0.58, 0.19], [0.63, 0.25], [0.68, 0.16],
        [0.78, 0.1], [0.85, 0.08], [0.89, 0.08], [0.94, 0.19], [0.99, 0.15],
        [1.0, 0.02],
      ],
      [
        [0.0, 0.03], [0.04, 0.11], [0.16, 0.1], [0.34, 0.16], [0.5, 0.22],
        [0.62, 0.17], [0.74, 0.1], [0.84, 0.07], [0.89, 0.07], [0.94, 0.18],
        [0.99, 0.14], [1.0, 0.02],
      ],
    ],
    bands: [
      [0.0, '#C8912E'], [0.26, '#C8912E'], [0.28, '#F1EAD9'], [0.5, '#F1EAD9'],
      [0.52, '#151310'], [0.66, '#151310'], [0.68, '#F1EAD9'], [0.86, '#F1EAD9'],
      [0.88, '#C8912E'], [1.0, '#C8912E'],
    ],
  },
  {
    id: 'DISC',
    label: 'THE DISC',
    x: 2.66,
    height: [3.2, 3.5, 3.75],
    lean: -4.1,
    profiles: [
      // 第1幕：鍔（円盤）を4段。旋盤の体でいちばん機械寄りの一体。
      [
        [0.0, 0.03], [0.02, 0.34], [0.08, 0.3], [0.12, 0.62], [0.16, 0.28],
        [0.28, 0.26], [0.32, 0.56], [0.36, 0.25], [0.48, 0.24], [0.52, 0.5],
        [0.56, 0.22], [0.66, 0.2], [0.7, 0.42], [0.74, 0.16], [0.84, 0.12],
        [0.9, 0.21], [0.97, 0.16], [1.0, 0.02],
      ],
      [
        [0.0, 0.03], [0.03, 0.28], [0.1, 0.25], [0.14, 0.44], [0.18, 0.24],
        [0.3, 0.23], [0.34, 0.4], [0.38, 0.22], [0.5, 0.21], [0.54, 0.36],
        [0.58, 0.2], [0.7, 0.18], [0.74, 0.3], [0.78, 0.15], [0.86, 0.11],
        [0.92, 0.2], [0.98, 0.15], [1.0, 0.02],
      ],
      [
        [0.0, 0.03], [0.04, 0.2], [0.14, 0.18], [0.3, 0.17], [0.46, 0.16],
        [0.62, 0.15], [0.76, 0.13], [0.85, 0.09], [0.91, 0.19], [0.98, 0.14],
        [1.0, 0.02],
      ],
    ],
    bands: [
      [0.0, '#F1EAD9'], [0.34, '#F1EAD9'], [0.36, '#151310'], [0.56, '#151310'],
      [0.58, '#C8912E'], [0.72, '#C8912E'], [0.74, '#F1EAD9'], [0.9, '#F1EAD9'],
      [0.92, '#151310'], [1.0, '#151310'],
    ],
  },
]

// ── テクスチャに焼く ────────────────────────────────────────────────────
// 半径は RGB の3チャンネルに幕を並べて入れる。頂点シェーダはこれを1回読んで
// 幕どうしを mix するだけで済む。「幕の切り替え」がテクスチャの重み和になる。
function radiusTexture(profiles) {
  const n = PROFILE_SAMPLES
  const a = profiles.map((p) => sampleProfile(p, n))
  const data = new Float32Array(n * 4)
  for (let i = 0; i < n; i++) {
    data[i * 4] = a[0][i]
    data[i * 4 + 1] = a[1][i]
    data[i * 4 + 2] = a[2][i]
    data[i * 4 + 3] = 1
  }
  const tex = new THREE.DataTexture(data, n, 1, THREE.RGBAFormat, THREE.FloatType)
  tex.minFilter = tex.magFilter = THREE.LinearFilter
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping
  tex.needsUpdate = true
  return tex
}

function bandTexture(bands) {
  const n = PROFILE_SAMPLES
  const data = new Uint8Array(n * 4)
  const cols = bands.map(([t, hex]) => [t, new THREE.Color(hex)])
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1)
    let k = 0
    while (k < cols.length - 2 && cols[k + 1][0] < t) k++
    const [t0, c0] = cols[k]
    const [t1, c1] = cols[Math.min(cols.length - 1, k + 1)]
    const u = t1 > t0 ? Math.min(1, Math.max(0, (t - t0) / (t1 - t0))) : 0
    const c = c0.clone().lerp(c1, u)
    data[i * 4] = Math.round(c.r * 255)
    data[i * 4 + 1] = Math.round(c.g * 255)
    data[i * 4 + 2] = Math.round(c.b * 255)
    data[i * 4 + 3] = 255
  }
  const tex = new THREE.DataTexture(data, n, 1, THREE.RGBAFormat)
  tex.minFilter = tex.magFilter = THREE.LinearFilter
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping
  tex.colorSpace = THREE.SRGBColorSpace
  tex.needsUpdate = true
  return tex
}

// ── 素の格子 ────────────────────────────────────────────────────────────
// 位置は入れない。入っているのは (t, 角度) だけで、頂点はそれを持って
// テクスチャに半径を訊きに行く。CPU が形を知らないのがこの日の要点。
function latheLattice(rings = PROFILE_SAMPLES, segs = 128) {
  const g = new THREE.BufferGeometry()
  const count = rings * (segs + 1)
  const pos = new Float32Array(count * 3)
  const at = new Float32Array(count)
  const aa = new Float32Array(count)
  let p = 0
  for (let i = 0; i < rings; i++) {
    const t = i / (rings - 1)
    for (let j = 0; j <= segs; j++) {
      const a = (j / segs) * Math.PI * 2
      at[p] = t
      aa[p] = a
      pos[p * 3] = 0
      pos[p * 3 + 1] = t
      pos[p * 3 + 2] = 0
      p++
    }
  }
  const idx = []
  for (let i = 0; i < rings - 1; i++) {
    for (let j = 0; j < segs; j++) {
      const a = i * (segs + 1) + j
      const b = a + segs + 1
      idx.push(a, b, a + 1, b, b + 1, a + 1)
    }
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('aT', new THREE.BufferAttribute(at, 1))
  g.setAttribute('aA', new THREE.BufferAttribute(aa, 1))
  g.setIndex(idx)
  // 形が毎フレーム変わるので、境界は最大の見積もりで固定して置く
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.5, 0), 3)
  return g
}

// ── 材質 ────────────────────────────────────────────────────────────────
// 漆と金の板。拡散は帯テクスチャ、反射はステージの2灯（キーとフィル）だけ。
// 影は落とさない。原作の舞台は影を持たないし、影を足した瞬間に部屋になる。
const VERT = /* glsl */ `
  uniform sampler2D uRadius;
  uniform vec3  uActW;      // 幕の重み（3幕ぶん・和は1）
  uniform float uHeight;
  uniform float uBreath;    // 呼吸の振幅
  uniform float uTime;
  uniform float uPhase;

  attribute float aT;
  attribute float aA;

  varying vec3  vN;
  varying vec3  vWorld;
  varying float vT;

  float radiusAt(float t) {
    vec3 r = texture2D(uRadius, vec2(clamp(t, 0.0, 1.0), 0.5)).rgb;
    float base = dot(r, uActW);
    // 呼吸：輪郭に沿って進む1本の波。ポーズではなく輪郭のほうが動く。
    float w = sin(t * 9.42477 - uTime * 1.15 + uPhase);
    return base * (1.0 + uBreath * w);
  }

  void main() {
    float t  = aT;
    float r  = radiusAt(t);
    float c  = cos(aA);
    float s  = sin(aA);
    vec3 p   = vec3(r * c, t * uHeight, r * s);

    // 法線は同じ関数の差分から作る（形が profile しか持っていないので、
    // 法線も profile からしか作れない）
    float dt = 1.0 / 255.0;
    float rp = radiusAt(t + dt);
    float rm = radiusAt(t - dt);
    float dr = (rp - rm) / (2.0 * dt);
    float dy = uHeight;
    vec2  n2 = normalize(vec2(dy, -dr));
    vec3  n  = vec3(n2.x * c, n2.y, n2.x * s);

    vec4 world = modelMatrix * vec4(p, 1.0);
    vWorld = world.xyz;
    vN = normalize(mat3(modelMatrix) * n);
    vT = t;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`

const FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D uBands;
  uniform vec3  uKey;
  uniform vec3  uFill;
  uniform vec3  uTint;
  uniform vec3  uKeyDir;
  uniform vec3  uCam;
  uniform float uGloss;

  varying vec3  vN;
  varying vec3  vWorld;
  varying float vT;

  void main() {
    vec3 n = normalize(vN);
    vec3 v = normalize(uCam - vWorld);
    if (!gl_FrontFacing) n = -n;

    vec3 base = texture2D(uBands, vec2(clamp(vT, 0.0, 1.0), 0.5)).rgb * uTint;

    vec3 k = normalize(uKeyDir);
    float lam = max(0.0, dot(n, k));
    // 舞台の2灯。上からのキーと、床から返ってくるフィル。
    float up = 0.5 + 0.5 * n.y;
    vec3 diff = uKey * (0.18 + 0.82 * lam) + uFill * (1.0 - up) * 0.55;

    // 漆のハイライト。金の帯だけ強く出したいので、明度で鋭さを変える。
    float lum = dot(base, vec3(0.2126, 0.7152, 0.0722));
    vec3 h = normalize(k + v);
    float spec = pow(max(0.0, dot(n, h)), mix(28.0, 96.0, lum)) * uGloss;
    float rim = pow(1.0 - max(0.0, dot(n, v)), 3.6) * 0.2 * (0.25 + 0.75 * lum);

    vec3 col = base * diff + uKey * spec * (0.35 + 0.65 * lum) + uKey * rim;
    col = col / (col + vec3(0.86)) * 1.86;   // やわらかいトーンマップ
    gl_FragColor = vec4(pow(col, vec3(1.0 / 2.2)), 1.0);
  }
`

export function buildFigures() {
  return FIGURES.map((f, i) => ({
    ...f,
    index: i,
    geometry: latheLattice(),
    radius: radiusTexture(f.profiles),
    bands: bandTexture(f.bands),
    uniforms: {
      uRadius: { value: null },
      uBands: { value: null },
      uActW: { value: new THREE.Vector3(1, 0, 0) },
      uHeight: { value: f.height[0] },
      uBreath: { value: ACTS[0].breath },
      uTime: { value: 0 },
      uPhase: { value: i * 2.1 },
      uKey: { value: new THREE.Color(ACTS[0].key) },
      uFill: { value: new THREE.Color(ACTS[0].fill) },
      uTint: { value: new THREE.Color(ACTS[0].tint) },
      uKeyDir: { value: new THREE.Vector3(-0.34, 0.9, 0.5) },
      uCam: { value: new THREE.Vector3() },
      uGloss: { value: 0.55 },
    },
  }))
}

export const FIGURE_SHADER = { VERT, FRAG }

// 幕の重み。切り替えの最中は2つの幕が同時に立っていて、体はその和として挽かれる。
export function actWeights(pos, out) {
  const w = [0, 0, 0]
  const a = Math.floor(pos)
  const u = pos - a
  const e = u * u * (3 - 2 * u)
  w[Math.min(2, Math.max(0, a))] += 1 - e
  w[Math.min(2, Math.max(0, a + 1))] += e
  out.set(w[0], w[1], w[2])
  return out
}

export function mixScalar(pos, arr) {
  const a = Math.min(ACTS.length - 2, Math.max(0, Math.floor(pos)))
  const u = Math.min(1, Math.max(0, pos - a))
  const e = u * u * (3 - 2 * u)
  return arr[a] * (1 - e) + arr[a + 1] * e
}
