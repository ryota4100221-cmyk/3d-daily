// rig.js — 装置：時計になった軸（the axis that became a clock）
//
// 再現元は USAvionix（無人ジェットによる重要インフラ監視・山火事検知・国境監視）。
// 実測値で分かっているのは「FVがcanvas」「地 #0f0f0f」「ブランドカラーが1つも無く、
// 有彩色は --color-red #f66 / --color-yellow #ffcb47 / --color-green #7aebff の3つだけ」
// 「--color-green の中身が緑ではなくシアン＝命名は機能・値は視環境」
// 「COORD / ALT / THERMAL のような等幅の実測値風文字列を UI ではなく画面の"地"として敷く」。
//
// 再現するのは色でも文字でもなく、その canvas が何を映しているかのほう——
// **ラインスキャナ（pushbroom）のフレーム**を1枚立てる。
//
// ラインスキャナには画素の行が1本しか無い。だから、どの瞬間にも絵が存在しない。
// 絵が出るのは機体が動くからで、画像の n 行目は「時刻 n の世界」である。
//   → 画像の縦軸は空間ではなく **時間** になる。
//
// このファイルに書いてあるのはその一行だけ：
//
//     地上点 x は、その画素の行が撮られた時刻で決まる     x_g = s(t),  t = T − age
//     age は画素の縦位置そのもの                          age = (1 − v) · SPAN_S
//
// 「歪ませる」「伸ばす」「ブラー」に当たる式は一行も無い。伸びは全部この2行の帰結で出る。

// ── 機体とセンサ（数字は固定・ドラッグで動くのは GS だけ） ──────────────
export const CONST = {
  ALT_M: 1220, // 4,000 ft
  FOV_DEG: 12.2, // across-track の全角
  SAMPLES: 640, // 1行あたりの画素数（across-track）
  // 機体は低速の監視UAV（33.0 m/s = 118.8 km/h）。速い機体にしないのは、
  // 「機体と同じ速度で走る車」が高速道路の実速度でなければ嘘になるから。
  GS_MS: 33.0,
  GS_MIN: 12,
  GS_MAX: 60,
  SPAN_S: 8.6, // 画面の縦に映っている「時間」（= 公称 GS で画素が正方になる長さ）
}

CONST.SWATH_M = 2 * CONST.ALT_M * Math.tan((CONST.FOV_DEG * Math.PI) / 360)
CONST.GSD_M = CONST.SWATH_M / CONST.SAMPLES // across-track の地上分解能

// ライン周期は「画素を正方形にする」条件で決まる： GSD = GS / f_L
export const lineRate = (gs) => gs / CONST.GSD_M

// 画像上の伸び。真の長さ L の物体は 1/|V−v| 秒ぶんの行を占め、静止物は 1/V 秒ぶん。
//   → 伸び率 = V / |V − v|    （機体と同じ速度の車は無限に伸びる）
export const stretch = (v, V) => {
  const d = Math.abs(V - v)
  return d < 1e-3 ? Infinity : V / d
}

// ── 道の上の5台 ────────────────────────────────────────────────────────
// v は along-track 成分（m/s）。負は対向。len/wid は実寸（m）、temp は輻射温度（℃）。
export const VEHICLES = [
  { id: 'V-01', v: 0.0, len: 4.6, wid: 1.9, lane: -3.0, temp: 34, o: -160 },
  { id: 'V-02', v: 18.9, len: 4.8, wid: 1.9, lane: 1.2, temp: 47, o: -60 },
  { id: 'V-03', v: -25.6, len: 12.4, wid: 2.6, lane: 9.0, temp: 52, o: -240 },
  { id: 'V-04', v: 31.4, len: 5.1, wid: 2.0, lane: 5.4, temp: 58, o: -8 },
  { id: 'V-05', v: 33.0, len: 5.6, wid: 2.1, lane: -7.5, temp: 61, o: 0 },
]

// 折り返し幅は「その車が帯に映っていられるオフセットの幅」そのものにする。
// Δ(age) = o + (V−v)·age が age∈[0,SPAN] のあいだに ±len/2 を通る o の範囲＝
//   幅 |V−v|·SPAN + len
// ここで畳むと、道の上に同じ間隔で同じ車が並んでいるのと同じことになり、
// どの瞬間も1台ずつ帯の中にいる。V と同じ速度の車だけは幅が len しかなく、
// つまり一度入ったら二度と出ていかない。
export function window1(v, V, len) {
  const a = (V - v) * CONST.SPAN_S
  const lo = a > 0 ? -a - len * 0.5 : -len * 0.5
  return { lo, w: Math.abs(a) + len }
}

// ── 状態：1本の時計と、1本の走った距離 ───────────────────────────────
export function makeState() {
  return {
    t: 0, // 絶対時刻（秒）— 全ての行がこの時計を共有する
    s: 0, // 機体の along-track 累積距離（m）
    gs: CONST.GS_MS,
    o: VEHICLES.map((v) => v.o), // 各車の「機体からのオフセット」
  }
}

// オフセットは do/dt = v − V。V と同じ車だけが動かない＝縞が途切れない。
export function step(st, dt) {
  st.t += dt
  st.s += st.gs * dt
  for (let i = 0; i < VEHICLES.length; i++) {
    const veh = VEHICLES[i]
    let o = st.o[i] + (veh.v - st.gs) * dt
    const { lo, w } = window1(veh.v, st.gs, veh.len)
    o = lo + ((((o - lo) % w) + w) % w)
    st.o[i] = o
  }
}

// ── シェーダ ───────────────────────────────────────────────────────────
export const VERT = /* glsl */ `
  void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`

export const FRAG = /* glsl */ `
precision highp float;

uniform vec2  uRes;
uniform float uT;        // 最新行の時刻
uniform float uS;        // 最新行での機体の along-track 位置
uniform float uGS;       // 対地速度
uniform float uAlt;
uniform float uHalfFov;
uniform float uSpan;     // 画面の縦が担う秒数
uniform vec4  uVeh[5];   // (offset, v, len, wid)
uniform vec4  uVeh2[5];  // (lane, temp, 0, 0)
uniform vec4  uRect;     // 帯の矩形 (x0,y0,x1,y1) / 画面比

// USAvionix の3つだけの有彩色。命名は機能、値は視環境。
const vec3 C_RED  = vec3(1.0, 0.4, 0.4);    // #f66
const vec3 C_YEL  = vec3(1.0, 0.796, 0.278); // #ffcb47
const vec3 C_CYA  = vec3(0.478, 0.922, 1.0); // #7aebff  (名前は green)
const vec3 BG     = vec3(0.0588, 0.0588, 0.0627); // #0f0f10

float h21(vec2 p) {
  p = mod(p, vec2(4096.0));
  return fract(sin(dot(p, vec2(41.713, 289.107))) * 43758.5453);
}
float vn(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = h21(i), b = h21(i + vec2(1.0, 0.0));
  float c = h21(i + vec2(0.0, 1.0)), d = h21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * vn(p); p *= 2.03; a *= 0.5; }
  return s / 0.9375;
}
// 尾根を立てる。夜の熱画像で起伏が読めるのは稜線の明暗差だけなので、
// なだらかな fbm では「雲」にしか見えない。
float rfbm(vec2 p) {
  float s = 0.0, a = 0.5, w = 1.0;
  for (int i = 0; i < 5; i++) {
    float n = 1.0 - abs(2.0 * vn(p) - 1.0);
    s += a * n * w;
    w = 0.55 + 0.45 * n;
    p *= 2.07; a *= 0.56;
  }
  return s;
}

// 起伏（m）。谷は −58、尾根は +82 あたり。
float relief(vec2 p) { return (rfbm(p / 48.0) - 0.62) * 86.0 + (fbm(p / 12.5) - 0.5) * 7.4; }

// 川の中心線（蛇行）と道の中心線。直下点をはさんで反対側に置く——
// 重ねると帯の片側だけが埋まり、もう半分が空く。
float riverZ(float x) { return -70.0 + 25.0 * sin(x / 430.0) + 11.0 * sin(x / 151.0 + 1.7); }
float roadZ(float x)  { return 49.0 + 16.0 * sin(x / 298.0); }

// 機体の姿勢。ロールは 0.5° 弱しか振れないが、行ごとに独立に効くので
// 「フレームカメラでは絶対に出ない横揺れ」として帯の中に残る。
float roll(float t) { return 0.0132 * sin(t * 0.47) + 0.0061 * sin(t * 1.31 + 1.1); }

void main() {
  vec2 px = gl_FragCoord.xy / uRes;
  vec3 col = BG;

  // 帯の外は地。1px のヘアラインだけ引く。
  vec2 r0 = uRect.xy, r1 = uRect.zw;
  vec2 pxPer = 1.0 / uRes;
  if (px.x < r0.x - pxPer.x || px.x > r1.x + pxPer.x ||
      px.y < r0.y - pxPer.y || px.y > r1.y + pxPer.y) {
    gl_FragColor = vec4(BG, 1.0);
    return;
  }
  if (px.x < r0.x || px.x > r1.x || px.y < r0.y || px.y > r1.y) {
    gl_FragColor = vec4(mix(BG, C_CYA, 0.22), 1.0);
    return;
  }

  vec2 q = (px - r0) / (r1 - r0);   // 帯の中の 0..1

  // ── ここが装置の全部 ──────────────────────────────────────────────
  float age = (1.0 - q.y) * uSpan;  // 画素の縦位置 = さかのぼる秒数
  float t   = uT - age;             // その行が撮られた時刻
  float xg  = uS - uGS * age;       // その行の along-track 位置（行の中では定数）
  // ──────────────────────────────────────────────────────────────────

  float a = (q.x - 0.5) * 2.0 * uHalfFov + roll(t);
  float ta = tan(a);

  // 起伏による地上点のずれ（relief displacement）。直下では 0、端ほど効く。
  float zg = uAlt * ta;
  float H = 0.0;
  for (int i = 0; i < 3; i++) {
    H = relief(vec2(xg, zg));
    zg = (uAlt - H) * ta;
  }

  // ── 放射（光源は1つも無い。映っているのは全部その面の自己放射） ────
  // 夜間の接地逆転：谷に冷気が溜まり、尾根が暖かい。起伏が見えるのは
  // 照らされているからではなく、貯めた熱が高さで違うから。
  float T = 5.4 + clamp((H + 40.0) / 84.0, 0.0, 1.0) * 9.6;

  // 樹冠は夜に地面より暖かい
  float canopy = smoothstep(0.50, 0.70, fbm(vec2(xg, zg) / 41.0 + 31.0));
  T += canopy * 2.6;

  // 川。水の熱容量が大きいので、夜はエンジン以外でいちばん明るいのが川になる。
  float dr = abs(zg - riverZ(xg));
  float water = 1.0 - smoothstep(8.0, 10.6, dr);
  T = mix(T, 19.6, water);

  // 道（アスファルト）
  float droad = abs(zg - roadZ(xg));
  float road = 1.0 - smoothstep(10.6, 11.4, droad);
  T = mix(T, 16.0, road * (1.0 - water));
  float shoulder = (1.0 - smoothstep(11.4, 15.0, droad)) * (1.0 - road);
  T = mix(T, 12.4, shoulder * 0.8);

  // くすぶり（山火事検知のための本来の仕事）
  vec2 fc = vec2(xg, zg) - vec2(floor(xg / 260.0) * 260.0 + 146.0, -14.0);
  vec2 fc2 = fc - vec2(5.5, -4.0);
  float fire = exp(-dot(fc, fc) / 9.0) + 0.7 * exp(-dot(fc2, fc2) / 4.4);
  T += fire * 226.0;

  // ── 車。伸びは「書いた」のではなく age の式から落ちてくる ───────────
  float veh = 0.0, vehT = 0.0;
  for (int i = 0; i < 5; i++) {
    float o = uVeh[i].x, v = uVeh[i].y, len = uVeh[i].z, wid = uVeh[i].w;
    float d = o + (uGS - v) * age;             // 機体とのすれ違い量
    float zc = roadZ(xg) + uVeh2[i].x;
    // 端を 1 GSD ぶん鈍らせる（光学の PSF）。硬い step のままだと 3px の棒になる。
    float m = (1.0 - smoothstep(len * 0.5 - 1.2, len * 0.5 + 1.2, abs(d)))
            * (1.0 - smoothstep(wid * 0.5 - 1.0, wid * 0.5 + 1.0, abs(zg - zc)));
    if (m > veh) { veh = m; vehT = uVeh2[i].y; }
  }
  T = mix(T, vehT, veh);

  // ── 表示：温度をモノクロの階調1本に落とす。色は「しきい値を超えた」印だけ ──
  float g = clamp((T - 4.0) / 26.0, 0.0, 1.0);
  g = pow(g, 1.15);
  col = vec3(g);

  float hot = smoothstep(26.0, 44.0, T);
  col = mix(col, C_YEL, hot * 0.86);
  float vhot = smoothstep(96.0, 168.0, T);
  col = mix(col, C_RED, vhot * 0.92);

  // センサのノイズ（読み出し縞と粒）。行ごとに独立に乗るのも線走査の癖。
  float grain = (h21(gl_FragCoord.xy + vec2(mod(uT * 61.0, 733.0))) - 0.5) * 0.035;
  float rowfp = (h21(vec2(3.0, floor(q.x * 640.0))) - 0.5) * 0.020; // 列ごとの固定パターン
  col += grain + rowfp;

  // ── 目盛：縦軸は秒、横軸はメートル ───────────────────────────────
  float secs = age;
  float tick = abs(fract(secs) - 0.0);
  float minor = step(abs(fract(secs * 5.0) - 0.0), 0.012 * 5.0);
  if (q.x < 0.018) col = mix(col, C_CYA, minor * 0.55);
  if (q.x < 0.030 && tick < 0.010) col = mix(col, C_CYA, 0.85);

  // across-track の目盛（上端）。0 が直下点。
  float mAcross = (q.x - 0.5) * 2.0 * uAlt * tan(uHalfFov);
  float atick = step(abs(fract(mAcross / 25.0 + 0.5) - 0.5), 0.02);
  if (q.y > 0.988) col = mix(col, C_CYA, atick * 0.7);
  if (q.y > 0.982 && abs(q.x - 0.5) < 0.0012) col = mix(col, C_CYA, 0.9);

  // 検知枠（くすぶりを囲む1本の細枠）
  float fq = max(abs(fc.x) / 9.5, abs(fc.y) / 9.5);
  if (fq > 0.90 && fq < 1.0) col = mix(col, C_RED, 0.75);

  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`
