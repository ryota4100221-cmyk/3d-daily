// rig.js — Day 068
//
// 被写体は「格子」ひとつ。ここには「リング」も「偽の中心」も1行も書いていない。
// 書いたのは次の3つだけで、絵に出るものは全部その帰結でしかない。
//
//   ① 信号   s(x,y) = ½ + ½·cos( a·(x²+y²) )        連続。どこでも定義されている
//   ② 標本器 一辺 p の正方格子。各タイルは自分の中心の1点だけを読む
//   ③ 表示   読んだ値をそのままタイルの高さと色にする（補間も平均も一切しない）
//
// ①は原点から離れるほど密になる信号（zone plate / chirp）で、位置 s における
// 空間周波数ベクトルは
//
//   g(s) = ∇φ / 2π = a·s / π      [cycles / 長さ]
//
// ②は周期 p の格子なので、逆格子ベクトル (2π/p)·(m,n) の分だけ周波数を
// 引き算した成分と区別が付かない。つまり g·p が整数ベクトルに一致する場所では
// 「再構成された周波数がゼロ」になる ＝ そこに **本物とまったく同じ見た目の
// 中心が生える**。その位置は
//
//   x = π·m / (a·p),  y = π·n / (a·p)        m,n ∈ ℤ
//
// で、間隔 G = π/(a·p) の正方格子になる。信号は丸いのに、偽の中心は四角く並ぶ
// ——並べているのが信号ではなく標本器のほうだから。サイト名の PIXEL × PIXEL が
// そのまま式になっている（ピクセルとピクセルの積＝逆格子）。
//
// ナイキストの壁も同じ式から落ちてくる。第一ブリルアンゾーンの境界
// max(|qx|,|qy|) = ½（q = g·p）より内側だけが本当のことを言っていて、外は嘘。
// **壁は正方形**で、これも信号ではなく格子の対称性のほう。
//
// 動きについて：格子は1ミリも動かさない。動かすのは標本点の「p 未満のずれ」
// uPhase だけ（センサが1画素以下だけ揺れる、に相当）。すると
// 次数 (m,n) の偽の中心は位相 2π(m·δx + n·δy)/p を受け取るので、
// **次数の大きい偽ほど速く脈打ち、次数 (0,0)＝本物だけが止まっている。**
// 画面の中で唯一動かない中心が、唯一の本物。それが今日の全部。

import {
  Color,
  DoubleSide,
  BoxGeometry,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  Sphere,
  Vector2,
  Vector3,
} from 'three'

// PIXEL × PIXEL 2026 の実測値（スワイプファイルDB）。
// bodyBg #18103F ／ アクセント #FF2F9B・#5B02FF・#5323B4 ／ 実測アクセントの
// 上位に出てくる #00D0E0。文字 #FFFFFF。
// 🔴 FVの設計色% は 0（全編でも 4.17%）＝ **地は色を持たない**。
// だから有彩色はタイルの面積の数%しか塗らない。これは装飾の話ではなく、
// 再現元の運用ルールをそのまま持ってきた制約。
export const PAL = {
  ground: '#18103F', // 地（濃紫）
  floor: '#0D0A24', // 台。地より一段沈める
  indigo: '#5323B4', // 正しく読めている領域の高い所
  violet: '#5B02FF',
  pink: '#FF2F9B', // 偽の中心にだけ出る蛍光
  cyan: '#00D0E0', // ナイキストの壁（正方形）の毛髪線
  paper: '#FFFFFF',
}

// 場の定数。ここを触ると絵が全部変わる、という意味で唯一の設計値。
// 🔴 1回目の実描画は span=12 / n=168 で撮った。式は正しく、偽の中心は
// きちんと 5×5 に並んだ——**並びすぎた。** 25個が全部小さく、本物の中心
// （＝止まっている1個）が奥の豆粒になり、「壁の内側では正しく読めている」
// という肝心の主張が画面に出なかった。数を減らして大きく見せる方に倒す。
// 3×3 の9個なら、中央の本物と、その隣に生えた偽が同じ大きさで並ぶ。
export const FIELD = {
  n: 132, // 一辺のタイル数
  span: 7.0, // 場の半幅
  height: 0.62, // 値 1 のときのタイルの高さ
  fill: 0.86, // タイルの占有率（残りが目地）
}
FIELD.pitch = (2 * FIELD.span) / FIELD.n

// 偽の中心の間隔 G から chirp 定数 a を逆に引く。
// 「a をいくつにするか」より「偽の中心を何個画面に入れるか」で決めたいので、
// 設計値のほうを G に置いて a = π/(G·p) で求める。G = 4.6 なら
// [-12,12] に m,n ∈ {-2..2} の 5×5 ＝ 25 個（うち1個だけが本物）。
export const GHOST_SPACING = 4.6
FIELD.chirp = Math.PI / (GHOST_SPACING * FIELD.pitch)

// ナイキスト半径 ＝ 壁の正方形の半幅。G/2 に一致する（式の上で当たり前）。
export const NYQUIST = Math.PI / (2 * FIELD.chirp * FIELD.pitch)

const COMMON = /* glsl */ `
  #define PI 3.141592653589793
  uniform float uPitch;
  uniform float uSpan;
  uniform float uChirp;
  uniform float uHeight;
  uniform float uFill;
  uniform vec2  uPhase;    // 標本点の p 未満のずれ。これだけが時間で動く
  uniform float uFilter;   // 1 なら点で読まず、タイルの面で平均する（比較用）
`

// 信号そのもの。連続関数で、格子とは何の関係もない。
const SIGNAL = /* glsl */ `
  float signalAt(vec2 s) {
    return 0.5 + 0.5 * cos(uChirp * dot(s, s));
  }

  // 面で平均した版。解析的には出せないので 4x4 の重み無し平均で近似する。
  // これは「装置を外したらどう見えるか」を示すためだけに在る。
  float signalBoxFiltered(vec2 s, float w) {
    float acc = 0.0;
    for (int j = 0; j < 4; j++) {
      for (int i = 0; i < 4; i++) {
        vec2 o = (vec2(float(i), float(j)) + 0.5) / 4.0 - 0.5;
        acc += signalAt(s + o * w);
      }
    }
    return acc / 16.0;
  }
`

const VERT = /* glsl */ `
  ${COMMON}
  ${SIGNAL}

  attribute vec2 aCell;

  varying float vVal;
  varying float vFold;
  varying float vWall;
  varying vec3  vNrm;
  varying float vDepth;

  void main() {
    // タイルが「描かれる」場所。ここは絶対に動かさない。
    vec2 base = (aCell + 0.5) * uPitch - uSpan;
    // タイルが「読む」場所。base から p 未満だけずれている。
    vec2 s = base + uPhase;

    float v = uFilter > 0.5
      ? signalBoxFiltered(s, uPitch)
      : signalAt(s);

    // その読み取り点における信号の局所周波数ベクトル（cycles / 長さ）を
    // 格子周期で無次元化したもの。q が整数ベクトルなら再構成周波数はゼロ。
    vec2 q = uChirp * s * uPitch / PI;
    vec2 fold = q - floor(q + 0.5);       // 最近傍整数までの距離 [-.5,.5]
    vFold = length(fold);

    // 第一ブリルアンゾーンの境界。信号は丸いのに、これは正方形。
    float bz = max(abs(q.x), abs(q.y));
    vWall = smoothstep(0.035, 0.0, abs(bz - 0.5));

    vVal = v;
    vNrm = normal;

    vec3 p = position;
    p.xz *= uPitch * uFill;
    p.y  *= max(v * uHeight, 0.006);      // 値ゼロでも板は残す（目地が消えないように）
    p.x  += base.x;
    p.z  += base.y;

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`

const FRAG = /* glsl */ `
  ${COMMON}

  uniform vec3 uGround;
  uniform vec3 uIndigo;
  uniform vec3 uViolet;
  uniform vec3 uPink;
  uniform vec3 uCyan;
  uniform float uFogNear;
  uniform float uFogFar;

  varying float vVal;
  varying float vFold;
  varying float vWall;
  varying vec3  vNrm;
  varying float vDepth;

  void main() {
    // ライトオブジェクトは0個。面の向きを1本の定数ベクトルで読むだけ。
    vec3 n = normalize(vNrm);
    float lam = 0.30 + 0.70 * max(dot(n, normalize(vec3(0.32, 0.90, 0.29))), 0.0);
    lam *= 1.0 - 0.16 * max(-n.z, 0.0);   // 手前を向いた面をわずかに沈める

    // 正しく読めている所は地の紫のまま。彩度を持たせない。
    // 🔴 色空間を直した3回目で、この係数が効きすぎて場が一面の紫になった
    // （高彩度画素が30%。再現元は設計の色 4.17%、FVに至っては 0%）。
    // 地の色に寄せて、有彩色は下の focus にだけ働かせる。
    vec3 col = mix(uGround, uIndigo * 0.58, vVal * vVal);

    // 再構成周波数がゼロに落ちた所＝中心。**本物と偽の区別はしていない。**
    // 区別が付かないことがこの絵の主張なので、色にも区別させない。
    float focus = smoothstep(0.30, 0.03, vFold);
    col = mix(col, mix(uViolet, uPink, vVal), focus);

    col *= lam;
    col += uCyan * vWall * 0.34;          // 壁の毛髪線

    // 🔴 霧の行き先は地の色そのものにする。1回目は uGround*0.62 に寄せたので、
    // 奥のタイルが背景より暗くなり、場の外周に「板の縁」が1本出てしまった
    // （台の面も同じ理由で遠くに硬いエッジを引いていた）。
    float fog = smoothstep(uFogNear, uFogFar, vDepth);
    col = mix(col, uGround, fog);

    gl_FragColor = vec4(col, 1.0);
    // 🔴 これが無いと全部リニアのまま出る。ShaderMaterial は three が
    // 自動で色空間変換を挿してくれない（挿さるのは組み込みマテリアルだけ）。
    // 2回目の実描画で地が #18103F ではなく **#02010d** になっていて気付いた。
    // ビルドも描画も通るので、画面を測るまで分からない種類の間違い。
    #include <colorspace_fragment>
  }
`

export function makeLattice() {
  const { n, span, pitch, height, fill } = FIELD

  const box = new BoxGeometry(1, 1, 1)
  box.translate(0, 0.5, 0) // 台の上に立たせる

  const geo = new InstancedBufferGeometry()
  geo.index = box.index
  geo.attributes.position = box.attributes.position
  geo.attributes.normal = box.attributes.normal

  const cells = new Float32Array(n * n * 2)
  let k = 0
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      cells[k++] = i
      cells[k++] = j
    }
  }
  geo.setAttribute('aCell', new InstancedBufferAttribute(cells, 2))
  geo.instanceCount = n * n
  // 頂点シェーダで動かすので three には広さが伝わらない。手で球を張る。
  geo.computeBoundingSphere = () => {}
  geo.boundingSphere = new Sphere(new Vector3(0, height * 0.5, 0), span * 1.7)

  const mat = new ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uPitch: { value: pitch },
      uSpan: { value: span },
      uChirp: { value: FIELD.chirp },
      uHeight: { value: height },
      uFill: { value: fill },
      uPhase: { value: new Vector2(0, 0) },
      uFilter: { value: 0 },
      uGround: { value: new Color(PAL.ground) },
      uIndigo: { value: new Color(PAL.indigo) },
      uViolet: { value: new Color(PAL.violet) },
      uPink: { value: new Color(PAL.pink) },
      uCyan: { value: new Color(PAL.cyan) },
      uFogNear: { value: 17 },
      uFogFar: { value: 34 },
    },
  })

  const mesh = new Mesh(geo, mat)
  mesh.frustumCulled = false
  return mesh
}

// 台。タイルの根元が背景に溶けないよう、地より一段だけ沈めた面を1枚敷く。
export function makeFloor() {
  const geo = new PlaneGeometry(FIELD.span * 9, FIELD.span * 9)
  geo.rotateX(-Math.PI / 2)
  const mat = new ShaderMaterial({
    side: DoubleSide,
    vertexShader: /* glsl */ `
      varying float vD;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vD = -mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uFloor;
      uniform vec3 uGround;
      varying float vD;
      void main() {
        float fog = smoothstep(17.0, 34.0, vD);
        gl_FragColor = vec4(mix(uFloor, uGround, fog), 1.0);
        #include <colorspace_fragment>
      }
    `,
    uniforms: {
      uFloor: { value: new Color(PAL.floor) },
      uGround: { value: new Color(PAL.ground) },
    },
  })
  const mesh = new Mesh(geo, mat)
  mesh.position.y = -0.004
  return mesh
}

// 標本点の p 未満のずれ。1周期で次数(1,0)の偽がちょうど1回脈打つ。
// 方向を (1, 0.618) にしてあるのは、x だけに振ると (0,n) の偽まで
// 止まってしまい「動かない＝本物」が読めなくなるから。
const DRIFT = new Vector2(1, 0.618)
const frac = (x) => x - Math.floor(x)
export function phaseAt(t, out = new Vector2()) {
  const u = t * 0.115
  return out.set(FIELD.pitch * frac(u * DRIFT.x), FIELD.pitch * frac(u * DRIFT.y))
}

export const READOUT = {
  tiles: FIELD.n * FIELD.n,
  pitch: FIELD.pitch,
  chirp: FIELD.chirp,
  nyquist: NYQUIST,
  ghost: GHOST_SPACING,
  // [-span, span] に入る偽の中心の個数（本物を1個含む）
  centres: (2 * Math.floor(FIELD.span / GHOST_SPACING) + 1) ** 2,
}
