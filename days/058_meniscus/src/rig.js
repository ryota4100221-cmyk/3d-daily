// Day 058 — Meniscus Rim
//
// 再現元: SAKAZUKI（日本の造り手を紹介するコレクティブ・酒器/工芸） https://sakazuki.io/
//
// 分解した装置：**面張力の縁（meniscus rim）**
//   液体はどこにもモデリングされていない。あるのは円板の上の高さ場 h(x,z) 1枚だけで、
//   それを「器に注がれた液体」に見せているのは 壁際の境界条件 ただ1つ。
//     ① 壁で高さ場が反射する（波が跳ね返る＝閉じた器）
//     ② 壁際で液面が接触角ぶん持ち上がる（m(r) = A·exp(-(1-r)/λ)）
//   この2行を消すと、同じ高さ場が「ただ揺れる平円板」に落ちる。明るい縁の輪も、
//   朱漆の底を走る集光も、器の存在そのものも、境界条件の副産物として出てくる。
//
// このファイルには「画面に映る被写体」だけを置く。器の断面・高さ場のソルバ・
// 液面のシェーダ・環境。ライティングの都合は Scene.jsx 側。

import * as THREE from 'three'

// ── 色（再現元の実測から）──────────────────────────────────────────────
// 地#E1D6CE（土の生成り）／朱#C30D23／黒#000000／淡生成り#F3EAE4
// 「地の構成」実測: #E0D0C8 26.8% / #000000 23.7% / #C00820 23.0% / #F0E8E0 3.2%
export const CLAY = '#E1D6CE' // 地・土の生成り
export const PAPER = '#F3EAE4' // 淡生成り（環境の上半分）
export const SHADE = '#3B332D' // 部屋の下半分。ここを暗くしないと漆が灰色になる
export const HORIZON = '#7A6C62' // 地平の帯
export const LACQUER = '#0A0908' // 黒漆（器の外）
export const VERMILION = '#C30D23' // 朱漆（器の中・液体の底）

// ── 器の断面 ────────────────────────────────────────────────────────────
// 盃は「浅い」ことが唯一の設計。深さ 0.32 に対して口径 2.0＝深さは半径の 1/3 。
// この浅さのおかげで、底の集光が液面の起伏にそのまま追従して見える。
export const RIM_R = 1.0 // 口の半径（ワールド単位＝ローカル単位）
export const RIM_Y = 0.42 // 口の高さ＝液面の高さ（すりきり一杯）
export const FLOOR_Y = 0.1 // 見込み（内側の底）の高さ
export const BOWL_P = 2.2 // 内側の断面の指数。大きいほど底が平たい

// 半径 r（0..1）における液体の深さ。GLSL 側と必ず同じ式にする。
export function bowlDepth(r) {
  const t = Math.min(Math.max(r, 0), 1)
  return RIM_Y - (FLOOR_Y + (RIM_Y - FLOOR_Y) * Math.pow(t, BOWL_P))
}

const GLSL_BOWL = /* glsl */ `
  float bowlDepth(float r){
    float t = clamp(r, 0.0, 1.0);
    return ${(RIM_Y - FLOOR_Y).toFixed(4)} * (1.0 - pow(t, ${BOWL_P.toFixed(2)}));
  }
`

// 外側（黒漆）の輪郭。高台 → 腰 → 口縁。LatheGeometry に渡す。
export function cupProfile(steps = 64) {
  const pts = []
  // 高台（footring）: 細い輪で卓に触れる
  pts.push(new THREE.Vector2(0.0001, 0.062))
  pts.push(new THREE.Vector2(0.26, 0.055))
  pts.push(new THREE.Vector2(0.3, 0.004))
  pts.push(new THREE.Vector2(0.335, 0.004))
  pts.push(new THREE.Vector2(0.352, 0.05))
  // 腰から口縁へ。内側の断面を厚み分だけ下げた形を使う（口で厚みが 0 に収束する）
  for (let i = 0; i <= steps; i++) {
    const r = 0.352 + (RIM_R - 0.352) * (i / steps)
    const inner = FLOOR_Y + (RIM_Y - FLOOR_Y) * Math.pow(r, BOWL_P)
    const wall = 0.052 * (1 - Math.pow(r, 6)) + 0.006
    pts.push(new THREE.Vector2(r, inner - wall))
  }
  return pts
}

// 内側（朱漆）の輪郭。液面の下なので普段は液体シェーダ越しにしか見えないが、
// 波が引いた縁のあたりで直接覗く瞬間があるので置いておく。
export function innerProfile(steps = 48) {
  const pts = []
  for (let i = 0; i <= steps; i++) {
    const r = (RIM_R * i) / steps
    pts.push(new THREE.Vector2(Math.max(r, 0.0001), FLOOR_Y + (RIM_Y - FLOOR_Y) * Math.pow(r, BOWL_P)))
  }
  return pts
}

// ── 環境（窓が1枚だけある生成りの部屋）────────────────────────────────
// 漆の照りは環境の写り込みでしか出ないので、器と液面が同じ関数を見るようにする。
// JS 版（PMREM 用の equirect を焼く）と GLSL 版（液面の反射）は同じ式。
export const WIN1 = new THREE.Vector3(-0.34, 0.6, 0.72).normalize()
export const WIN2 = new THREE.Vector3(0.25, 0.42, -0.87).normalize() // 奥の低い窓：液面がこれを映す

const c = (hex) => new THREE.Color(hex)
const C_PAPER = c(PAPER),
  C_CLAY = c(CLAY),
  C_HORIZON = c(HORIZON),
  C_SHADE = c(SHADE)

// 部屋：下半分は暗い床、地平に生成りの帯、上に淡生成りの天井、窓が1枚。
// 黒漆は環境の写り込みでしか黒く見えない（部屋を明るくすると灰色の陶器になる）。
function envColorJS(d, out) {
  const s1 = THREE.MathUtils.smoothstep(d.y, -0.75, -0.02)
  const s2 = THREE.MathUtils.smoothstep(d.y, 0.30, 0.70)
  const s3 = THREE.MathUtils.smoothstep(d.y, 0.72, 0.98)
  out.copy(C_SHADE).lerp(C_HORIZON, s1).lerp(C_CLAY, s2).lerp(C_PAPER, s3)
  const w1 = THREE.MathUtils.smoothstep(d.dot(WIN1), 0.948, 0.996)
  const w2 = THREE.MathUtils.smoothstep(d.dot(WIN2), 0.955, 0.998)
  out.r += 1.0 * w1 * 5.4 + 1.0 * w2 * 0.55
  out.g += 0.985 * w1 * 5.4 + 0.96 * w2 * 0.55
  out.b += 0.955 * w1 * 5.4 + 0.9 * w2 * 0.55
  return out
}

const v3 = (hex) => `vec3(${new THREE.Color(hex).toArray().map((v) => v.toFixed(4)).join(',')})`

const GLSL_ENV = /* glsl */ `
  vec3 envColor(vec3 d){
    vec3 col = mix(${v3(SHADE)},   ${v3(HORIZON)}, smoothstep(-0.75, -0.02, d.y));
    col      = mix(col,            ${v3(CLAY)},    smoothstep( 0.30,  0.70, d.y));
    col      = mix(col,            ${v3(PAPER)},   smoothstep( 0.72,  0.98, d.y));
    col += vec3(1.0, 0.985, 0.955) * smoothstep(0.948, 0.996, dot(d, uWin1)) * 5.4;
    col += vec3(1.0, 0.960, 0.900) * smoothstep(0.955, 0.998, dot(d, uWin2)) * 0.55;
    return col;
  }
`

// equirect を焼いて PMREM に通す。ネットワークも HDRI ファイルも要らない。
//
// 🔴 行の並びは three の equirectUv に合わせる：
//      u = atan2(z, x)/2π + 0.5 ／ v = asin(y)/π + 0.5
//    DataTexture は flipY=false なので **row 0 が v=0＝真下**。
//    素直に「上から下へ」焼くと天地が逆さの部屋になり、器の底が空を映して
//    黒漆が白い陶器に化ける（2026-08-27 に1時間溶かした）。
export function makeEnvironment(gl) {
  const W = 256,
    H = 128
  const data = new Float32Array(W * H * 4)
  const d = new THREE.Vector3()
  const out = new THREE.Color()
  for (let j = 0; j < H; j++) {
    const v = (j + 0.5) / H
    const elev = (v - 0.5) * Math.PI
    const cy = Math.cos(elev)
    for (let i0 = 0; i0 < W; i0++) {
      const u = (i0 + 0.5) / W
      const theta = (u - 0.5) * Math.PI * 2
      d.set(Math.cos(theta) * cy, Math.sin(elev), Math.sin(theta) * cy)
      envColorJS(d, out)
      const i = (j * W + i0) * 4
      data[i] = out.r
      data[i + 1] = out.g
      data[i + 2] = out.b
      data[i + 3] = 1
    }
  }
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.FloatType)
  tex.mapping = THREE.EquirectangularReflectionMapping
  tex.colorSpace = THREE.LinearSRGBColorSpace
  tex.needsUpdate = true
  const pmrem = new THREE.PMREMGenerator(gl)
  const rt = pmrem.fromEquirectangular(tex)
  pmrem.dispose()
  tex.dispose()
  return rt.texture
}

// 卓（和紙）の粒。ラフネスに極小の揺らぎを入れておくと、望遠で寄ったとき
// 地がのっぺりせず、器の影の縁が紙に沈む。
export function makePaperGrain(size = 256) {
  const px = new Uint8Array(size * size)
  let seed = 20260827
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)
  for (let i = 0; i < px.length; i++) px[i] = 118 + rnd() * 34
  // 縦に軽く伸ばして繊維に見せる
  const out = new Uint8Array(size * size)
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let s = 0
      for (let k = -2; k <= 2; k++) s += px[((y + k + size) % size) * size + x]
      out[y * size + x] = s / 5
    }
  const tex = new THREE.DataTexture(out, size, size, THREE.RedFormat)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.minFilter = tex.magFilter = THREE.LinearFilter
  tex.needsUpdate = true
  return tex
}

// ── 高さ場のソルバ ──────────────────────────────────────────────────────
// r=1 の円で反射する2次元波動方程式。1テクセルに (h_t, h_{t-1}) を持つ。
// 🔴 この装置の核心は最後の 6 行（壁の反射）で、そこを外すと器でなくなる。
export const SIM = 384

export function makeSimMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uPrev: { value: null },
      uTexel: { value: 1 / SIM },
      uDamp: { value: 0.9986 },
      uC2: { value: 0.34 },
      uDrop: { value: new THREE.Vector4(0, 0, 0, 0.05) }, // xy=位置 z=強さ w=半径
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      varying vec2 vUv;
      uniform sampler2D uPrev;
      uniform float uTexel, uDamp, uC2;
      uniform vec4 uDrop;

      void main(){
        vec2 p = vUv * 2.0 - 1.0;
        float r = length(p);

        // 壁の外側 = 内側を鏡像に折り返す。これが「閉じた器」。
        if (r > 0.995) {
          vec2 q = (p / max(r, 1e-4)) * max(2.0 * 0.995 - r, 0.0);
          gl_FragColor = texture2D(uPrev, q * 0.5 + 0.5);
          return;
        }

        vec4 s = texture2D(uPrev, vUv);
        float h = s.r, hp = s.g;
        float lap =
            texture2D(uPrev, vUv + vec2(uTexel, 0.0)).r
          + texture2D(uPrev, vUv - vec2(uTexel, 0.0)).r
          + texture2D(uPrev, vUv + vec2(0.0, uTexel)).r
          + texture2D(uPrev, vUv - vec2(0.0, uTexel)).r
          - 4.0 * h;

        float nh = (2.0 * h - hp + uC2 * lap) * uDamp;

        // 落ちてきた一滴
        float d = length(p - uDrop.xy);
        nh += uDrop.z * exp(-(d * d) / (uDrop.w * uDrop.w));

        gl_FragColor = vec4(nh, h, 0.0, 1.0);
      }
    `,
    depthTest: false,
    depthWrite: false,
  })
}

// ── 液面 ────────────────────────────────────────────────────────────────
// 面張力の縁 m(r) は高さ場に足さない（波動方程式を壊すので）。**描くときに足す。**
// これで「静かな器の縁は常に持ち上がっている／波はその上を通り過ぎる」が両立する。
export const MEN_A = 0.0138 // 縁で持ち上がる量（ワールド単位）
export const MEN_L = 0.042 // 減衰長。接触角の代わりにこれ1つで効く

export function makeSurfaceMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uH: { value: null },
      uTexel: { value: 1 / SIM },
      uCam: { value: new THREE.Vector3() },
      uAmp: { value: 0.0088 }, // 高さ場 → ワールド高さ
      uCaustic: { value: 0.115 },
      uWin1: { value: WIN1.clone() },
      uWin2: { value: WIN2.clone() },
      uVermilion: { value: new THREE.Color(VERMILION) },
    },
    transparent: false,
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      varying vec2 vLocal;
      void main(){
        vLocal = position.xy;                       // CircleGeometry は xy 平面
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      varying vec3 vWorld;
      varying vec2 vLocal;
      uniform sampler2D uH;
      uniform float uTexel, uAmp, uCaustic;
      uniform vec3 uCam, uWin1, uWin2, uVermilion;

      ${GLSL_BOWL}
      ${GLSL_ENV}

      // 面張力の縁：壁に向かって指数で立ち上がる。器の中身を器にしているのはこれ。
      float meniscus(float r){ return ${MEN_A.toFixed(5)} * exp(-(1.0 - r) / ${MEN_L.toFixed(4)}); }
      float meniscusSlope(float r){ return ${(MEN_A / MEN_L).toFixed(5)} * exp(-(1.0 - r) / ${MEN_L.toFixed(4)}); }

      void main(){
        float r = length(vLocal);
        if (r > 0.9995) discard;
        vec2 uv = vLocal * 0.5 + 0.5;

        float hC = texture2D(uH, uv).r;
        float hR = texture2D(uH, uv + vec2(uTexel, 0.0)).r;
        float hL = texture2D(uH, uv - vec2(uTexel, 0.0)).r;
        float hU = texture2D(uH, uv + vec2(0.0, uTexel)).r;
        float hD = texture2D(uH, uv - vec2(0.0, uTexel)).r;

        // ローカル座標での勾配（uv 1 = ローカル 2 なので、隣接テクセルは 2*uTexel 離れている）
        float dx = 2.0 * uTexel;        // 隣接テクセルまでのローカル距離
        float step2 = 2.0 * dx;         // 中心差分の分母
        vec2 grad = vec2(hR - hL, hU - hD) / step2 * uAmp;
        grad += (vLocal / max(r, 1e-4)) * meniscusSlope(r);

        // CircleGeometry を -90° 回してあるので、ローカル y は ワールド -z
        vec3 N = normalize(vec3(-grad.x, 1.0, grad.y));
        vec3 V = normalize(uCam - vWorld);

        // ── 屈折して朱漆の底へ ───────────────────────────────────────
        float depth = bowlDepth(r);
        vec3 T = refract(-V, N, 1.0 / 1.339);
        vec2 hit = vLocal + vec2(T.x, -T.z) * (depth / max(-T.y, 0.08));
        float hr = length(hit);

        // 見込みの轆轤目（挽き跡）。朱漆は必ずこの筋を持っている。
        float rings = 0.5 + 0.5 * sin(hr * 168.0);
        vec3 floorCol = uVermilion * (0.93 + 0.11 * rings);
        floorCol *= mix(0.45, 1.0, smoothstep(1.06, 0.20, hr));    // 壁際は落ちる
        floorCol *= mix(1.0, 0.22, smoothstep(0.95, 1.05, hr));    // 器の外は無い

        // 集光：屈折した光束の発散＝液面の曲率 × 深さ。
        // 窓の1枚が朱漆の底に落とす明暗はここだけで出来ていて、光源は増やしていない。
        float curv = (hR + hL + hU + hD - 4.0 * hC) * uAmp / (dx * dx);
        float cg = clamp(1.0 - uCaustic * curv * depth, 0.12, 3.2);
        floorCol *= cg * 1.12;

        // 浅いなりの吸収（縁は明るく、見込みの中央は沈む）
        floorCol *= exp(-depth * vec3(0.20, 1.70, 2.10));

        // ── 反射 ─────────────────────────────────────────────────────
        vec3 R = reflect(-V, N);
        vec3 refl = envColor(R);
        float glint = pow(max(dot(R, uWin1), 0.0), 900.0) * 5.0
                    + pow(max(dot(R, uWin2), 0.0), 420.0) * 0.55;
        refl += vec3(1.0, 0.99, 0.96) * glint;

        float f0 = 0.021;
        float F = f0 + (1.0 - f0) * pow(1.0 - max(dot(N, V), 0.0), 5.0);

        vec3 col = mix(floorCol, refl, F);

        // 縁の1本：面張力が立ち上がった帯だけ、環境の明部を正面から拾う
        col += vec3(1.0, 0.98, 0.95) * smoothstep(0.928, 1.0, r) * 0.165;

        // トーン（白点 2.2 の Reinhard。暗部を持ち上げないので朱が朱のまま残る）
        col = max(col, 0.0);
        col = col * (1.0 + col / (2.2 * 2.2)) / (1.0 + col);
        col = pow(col, vec3(0.4545));
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  })
}

// 一滴を落とす場所と間隔。**尽きない列**にしてある。
//
// 配列で7滴だけ用意していたときは、17.2 秒で焼けた1枚に波が1本も残っていなかった
// （最後の滴が 11.4 秒＝5.8 秒ぶん減衰したあと）。何秒の1枚を撮ることになるか
// こちらでは決められないので、水面のほうを「いつ見ても直前に一滴落ちている」状態に置く。
// 位置は黄金角の螺旋。同じ場所に二度落ちないので、輪の重なりが毎回ちがう。
export const DROP0 = 0.55
export const DROP_GAP = 1.75

export function dropAt(k) {
  const ang = k * 2.39996323
  const f = (k * 0.6180339887) % 1
  const rad = 0.2 + 0.52 * f
  return {
    t: DROP0 + DROP_GAP * k,
    x: Math.cos(ang) * rad,
    y: Math.sin(ang) * rad,
    a: 0.55 + 0.32 * ((k * 0.7548776662) % 1),
    r: 0.028 + 0.011 * ((k * 0.3247179572) % 1),
  }
}
