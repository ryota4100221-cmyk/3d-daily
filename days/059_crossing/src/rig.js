// Day 059 — 交差の投影 / the crossing projection
//
// 再現元 : 中央大学 スポーツ情報学部（仮称）特設サイト  https://sdb.chuo-u.ac.jp/
// 装置   : 1つの点群を、2つのカメラで同時に描く。
//
// あのサイトの公開されている設計原則は2行しかない。
//   ①「データから立ち上がる幾何学的な形態」
//   ②「青と赤のグラデーションで、スポーツ領域とビジネス領域の交差を表す」
// ②を「2色を並べて中間色で繋ぐ」と読むと、ただのグラデーションになる。
// ここでは②を **投影のグラデーション** として読み直した。
//
//   青 = データ = 正投影（測る目。奥行きを持たない。32本が1枚の図に重なる）
//   赤 = スポーツ = 透視投影（見る目。奥行きを持つ。32本が扇に開く）
//
// 頂点は1つ。クリップ座標を2本計算して、そのあいだを w で mix する。
// だから画面の左半分と右半分は「別の絵」ではなく、同じ5120点の同じ瞬間で、
// 継ぎ目は線ではなく勾配になる。交差を色で言うのではなく、見え方で言う。
//
// このファイルには three のオブジェクトを1つも作らない。表と、式と、文字列だけ。

export const TRACES = 32
export const SAMPLES = 160
export const COUNT = TRACES * SAMPLES

export const SPAN_X = 2.34 // 横（時間軸）の半幅
export const SPAN_Z = 0.098 // トレース間の奥行き
export const AMP = 0.88 // 計測値の振れ幅

const TAU = Math.PI * 2

// ── 表 ────────────────────────────────────────────────────────────────
// 幾何は「表の見え方」でしかない。実体はこの Float32Array 1本で、
// 点も線も同じ配列のビューを見ている。表を 0 で埋めれば絵は水平線1本に潰れる。
export function makeTable() {
  const t = {
    val: new Float32Array(COUNT), // 0..1 の計測値
    pos: new Float32Array(COUNT * 3), // 表から起こした頂点
    rate: new Float32Array(TRACES),
    rate2: new Float32Array(TRACES),
    lag: new Float32Array(TRACES),
    gain: new Float32Array(TRACES),
    base: new Float32Array(TRACES),
    z: new Float32Array(TRACES),
    mean: 0,
    peak: 0,
  }
  // 決定的な擬似乱数（毎朝同じ表が出るように）。
  let s = 0x5d1b3
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
  for (let k = 0; k < TRACES; k++) {
    t.rate[k] = 2.4 + Math.floor(rnd() * 7) * 0.5 // 歩調。整数倍にしないと図が濁る
    t.rate2[k] = 0.7 + rnd() * 1.6
    t.lag[k] = rnd()
    t.gain[k] = 0.62 + rnd() * 0.38
    t.base[k] = (k / (TRACES - 1) - 0.5) * 0.11
    t.z[k] = (k - (TRACES - 1) / 2) * SPAN_Z
  }
  return t
}

// 1フレームぶん、表を測り直す。
// 波形は正弦ではなく「接地のある波形」にしてある——立脚で跳ね、遊脚で沈む。
// 正弦のままだと32本が綺麗に重なりすぎて、正投影側が図ではなく模様になる。
export function fillTable(t, time) {
  let sum = 0
  let peak = 0
  for (let k = 0; k < TRACES; k++) {
    const ph = time * 0.42 + t.lag[k]
    const g = t.gain[k]
    for (let i = 0; i < SAMPLES; i++) {
      const u = i / (SAMPLES - 1)
      const s = Math.sin(TAU * (u * t.rate[k] - ph))
      const s2 = Math.sin(TAU * (u * t.rate2[k] + ph * 0.63))
      const strike = Math.pow(Math.max(0, s), 1.7) - 0.28 * Math.max(0, -s)
      let v = 0.5 + 0.5 * (g * strike + 0.2 * s2)
      v = v < 0 ? 0 : v > 1 ? 1 : v
      const n = k * SAMPLES + i
      t.val[n] = v
      t.pos[n * 3] = (u - 0.5) * 2 * SPAN_X
      t.pos[n * 3 + 1] = t.base[k] + (v - 0.5) * AMP
      t.pos[n * 3 + 2] = t.z[k]
      sum += v
      if (v > peak) peak = v
    }
  }
  t.mean = sum / COUNT
  t.peak = peak
}

// 折れ線は点と同じ配列を index で舐めるだけ。頂点は増えない。
export function traceIndex() {
  const idx = new Uint32Array(TRACES * (SAMPLES - 1) * 2)
  let p = 0
  for (let k = 0; k < TRACES; k++) {
    const off = k * SAMPLES
    for (let i = 0; i < SAMPLES - 1; i++) {
      idx[p++] = off + i
      idx[p++] = off + i + 1
    }
  }
  return idx
}

// 図の罫線。トレースの後ろに立てた1枚の面で、正投影側では方眼、
// 透視投影側では奥へ逃げる。罫線も同じ mix を通るので、図が空間に化ける瞬間が
// 目盛りのほうにも起きる。ここを別処理にすると、装置が1つでなくなる。
export function ruleGeometry() {
  const pos = []
  const val = []
  const z = -1.22
  const rows = 5
  const cols = 9
  for (let r = 0; r < rows; r++) {
    const y = (r / (rows - 1) - 0.5) * 1.02
    pos.push(-SPAN_X, y, z, SPAN_X, y, z)
    val.push(0.35, 0.35)
  }
  for (let c = 0; c < cols; c++) {
    const x = (c / (cols - 1) - 0.5) * 2 * SPAN_X
    pos.push(x, -0.51, z, x, 0.51, z)
    val.push(0.28, 0.28)
  }
  return { pos: new Float32Array(pos), val: new Float32Array(val) }
}

// ── 時間帯連動 ─────────────────────────────────────────────────────────
// 再現元の「同じURLが時刻で違って見える」を、色ではなく交差の位置に効かせた。
// 交差点は1日かけて画面を1往復する。朝は交差が右に寄って画面の大半が図（青）になり、
// 夕方には左へ抜けて大半が空間（赤）になる。見るたびに別の絵が出る理由がこれ。
// 時計は実行環境のローカルではなく JST に固定する。クラウドで撮ると UTC になり、
// 「日本の朝」のはずの絵が「日本の夜」で出てくる（この連載で1度やった事故）。
export function jstSeconds(now = new Date()) {
  return (((now.getTime() / 1000 + 9 * 3600) % 86400) + 86400) % 86400
}

export function dayPhase(now = new Date()) {
  return jstSeconds(now) / 86400
}

// 交差点は1日で往って還ってくる。端に停めないのは構図の都合で、
// 片側が消えた瞬間、この装置は「2つのカメラ」ではなく「1つのカメラ」に戻ってしまうから。
export function crossingX(phase) {
  return 0.74 * Math.sin(Math.PI * 2 * phase)
}

// ── シェーダ ───────────────────────────────────────────────────────────
// 装置の全部がこの11行に入っている。
//   wp   … ワールド座標（1つしかない）
//   cO   … 正投影のクリップ座標
//   cP   … 透視投影のクリップ座標（three が組み立てた組み込み行列）
//   w    … 交差の重み。x だけの関数で、時刻でずれる
//   mix(cO, cP, w) … 継ぎ目のない乗り換え。w は同次座標ごと混ざるので、
//                    透視除算の前に「半分だけ奥行きを持つ点」が作れる
export const VERT = /* glsl */ `
attribute float aVal;
uniform mat4 uOrthoVP;
uniform float uCrossX;
uniform float uCrossK;
uniform float uSize;
uniform float uPix;
varying float vW;
varying float vVal;

void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  float w = smoothstep(uCrossX - uCrossK, uCrossX + uCrossK, wp.x);
  vec4 cO = uOrthoVP * wp;
  vec4 cP = projectionMatrix * viewMatrix * wp;
  gl_Position = mix(cO, cP, w);
  // 点の大きさは書いていない。同次 w がそのまま遠近になる（正投影側は w=1 で一定）
  gl_PointSize = uSize * uPix / max(0.34, gl_Position.w);
  vW = w;
  vVal = aVal;
}
`

export const FRAG_POINTS = /* glsl */ `
precision highp float;
uniform vec3 uCold;
uniform vec3 uWarm;
uniform float uOpacity;
varying float vW;
varying float vVal;

void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = dot(d, d) * 4.0;
  if (r > 1.0) discard;
  float a = smoothstep(1.0, 0.34, r);
  vec3 c = mix(uCold, uWarm, smoothstep(0.10, 0.90, vW));
  c *= 0.30 + 0.70 * vVal;
  c += vec3(0.62, 0.66, 0.72) * pow(vVal, 7.0);
  gl_FragColor = vec4(c, a * uOpacity);
}
`

export const FRAG_LINES = /* glsl */ `
precision highp float;
uniform vec3 uCold;
uniform vec3 uWarm;
uniform float uOpacity;
varying float vW;
varying float vVal;

void main() {
  vec3 c = mix(uCold, uWarm, smoothstep(0.10, 0.90, vW));
  c *= 0.24 + 0.76 * vVal;
  gl_FragColor = vec4(c, uOpacity * (0.30 + 0.70 * vVal));
}
`
