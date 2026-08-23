// rig.js — Day 055 / ALBEDO LOCK
//
// 再現元は CLEND (https://clend.jp/)。あのサイトのFVで起きていることは1つで、
// **ボトルが背景とまったく同じグレーで塗られている**。製品が色を持たない。
// だから形は「色の差」ではなく「返ってきた光」だけで読むことになる。
//
// ここではその規則をコードの側に持ち込む。アルベドは下の定数1つしかなく、
// 地も物もこれを共有する。各パーツに許された自由は roughness だけ。
// 色は ACCENT だけが例外で、これは「触れる場所」にしか乗らない（CLEND では
// 蛍光イエローがナビの現在地と Online Store ボタンにしか乗っていない）。

import * as THREE from 'three'

// ── 唯一のアルベド。地も物もこれ。ここを書き換えると全部が一緒に動く ──────
export const ALBEDO = '#999593'
// ── 触れる場所にだけ乗る色。それ以外のどこにも使わない ────────────────────
export const ACCENT = '#EBFF00'
export const INK = '#1d1c1a'

// ── 静物の配置 ─────────────────────────────────────────────────────────────
// 3段の flat-lay。段は z = -1.55 / 0.05 / 1.55（画面上で等間隔になる値）。
//
// 🔴 ここで1回作り直している。最初は円柱・箱・円盤を立てて置いていたが、
// **水平な面は真上から見ると必ず消えた**。アルベドが1つしかない以上、
// 水平な天面と水平な地は、法線も材質も同じで、どんな光を当てても同じ値を返す。
// 影と輪郭しか残らず、CAP と SLAB と DISC は3回とも幽霊になった。
// だから今日の静物には水平な面が1つも無い。全部が曲がっている。
// 曲率だけが、同じ色の物と地を分ける。
//
// もう1つの実測: rough が 0.45 を超えると面が環境の平均を返しはじめ、
// 曲がっていてもコントラストが消える。上限は 0.42 で止めてある。
export const PIECES = [
  // pos の y は接地面。blob は球を潰したもので、scl の y 成分が高さになる。
  { code: '01', name: 'VESSEL', kind: 'capsule', len: 2.40, rad: 0.52, pos: [-1.95, 0.520, -1.55], rot: [0, 0, Math.PI / 2], rough: 0.16, hx: 1.72, hz: 0.52 },
  { code: '02', name: 'RING',   kind: 'torus',   rad: 0.60, tube: 0.13, pos: [1.05, 0.130, -1.55], rot: [-Math.PI / 2, 0, 0], rough: 0.30, hx: 0.73, hz: 0.73 },
  { code: '03', name: 'CAP',    kind: 'blob',    rad: 0.62, scl: [1.00, 0.62, 1.00], pos: [2.95, 0.384, -1.55], rot: [0, 0, 0], rough: 0.34, hx: 0.62, hz: 0.62 },
  { code: '04', name: 'BODY',   kind: 'cyl',     rad: 0.55, h: 2.30,    pos: [-2.37, 0.550, 0.05], rot: [0, 0, Math.PI / 2], rough: 0.10, hx: 1.15, hz: 0.55 },
  { code: '05', name: 'DOME',   kind: 'sphere',  rad: 0.50,             pos: [-0.17, 0.500, 0.05], rot: [0, 0, 0], rough: 0.12, hx: 0.50, hz: 0.50 },
  { code: '06', name: 'SLAB',   kind: 'blob',    rad: 1.00, scl: [0.98, 0.30, 0.52], pos: [2.30, 0.300, 0.05], rot: [0, -0.10, 0], rough: 0.38, hx: 0.98, hz: 0.52 },
  { code: '07', name: 'STEM',   kind: 'capsule', len: 2.20, rad: 0.30, pos: [-1.75, 0.300, 1.55], rot: [0, 0, Math.PI / 2], rough: 0.22, hx: 1.40, hz: 0.30 },
  { code: '08', name: 'PEBBLE', kind: 'blob',    rad: 0.62, scl: [1.00, 0.30, 1.00], pos: [1.20, 0.186, 1.55], rot: [0, 0, 0], rough: 0.42, hx: 0.62, hz: 0.62 },
  { code: '09', name: 'PEARL',  kind: 'sphere',  rad: 0.30,             pos: [2.95, 0.300, 1.55], rot: [0, 0, 0], rough: 0.10, hx: 0.30, hz: 0.30 },
]

// ── 光のほうを動かす ───────────────────────────────────────────────────────
// アルベドを固定した瞬間、動かして意味があるものは物ではなく光だけになる。
// 4枚の面光源（drei の Lightformer）を環境マップに焼き、それを反射させる。
// key は長い帯で、これが各パーツの上を舐めていくハイライトの正体。
// edge は左から立てた縦の帯で、球と円柱の縁だけを拾う。
// sweep は手前の低い帯。fill は真上の大判で、影が潰れないための床。
export function lightPlan(t) {
  return {
    key: [3.60 * Math.sin(t * 0.190), 7.60, -1.20 + 2.40 * Math.cos(t * 0.190)],
    edge: [-5.20 + 1.60 * Math.cos(t * 0.130), 4.20, 2.60 * Math.sin(t * 0.110)],
    sweep: [2.00 * Math.cos(t * 0.310 + 1.20), 3.00, 5.40],
    fill: [0, 12, 0],
  }
}

// ── 触れる場所のしるし ─────────────────────────────────────────────────────
// 選んだパーツの外接矩形の4隅に、L字の目印を置く。丸で囲うと細長い
// パーツで嘘になるので、角のほうを差す。地面から 4mm 浮かせる。
export function bracketBars(p, arm = 0.26, gap = 0.16, w = 0.035) {
  const hx = p.hx + gap
  const hz = p.hz + gap
  const y = 0.004
  const bars = []
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      // x方向の腕
      bars.push({ pos: [p.pos[0] + sx * (hx - arm / 2), y, p.pos[2] + sz * hz], size: [arm, w] })
      // z方向の腕
      bars.push({ pos: [p.pos[0] + sx * hx, y, p.pos[2] + sz * (hz - arm / 2)], size: [w, arm] })
    }
  }
  return bars
}

// ── 地のざらつき ───────────────────────────────────────────────────────────
// アルベドが1つしかないので、地は完全に均一な面になる。均一な面は
// グラデーションの帯（バンディング）が出るし、写真としても死ぬ。
// roughness だけを微妙に散らして、色は1ミリも動かさずに面を生かす。
export function makeGrain(size = 256, seed = 20260824) {
  let s = seed >>> 0
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
  const data = new Uint8Array(size * size * 4)
  for (let i = 0; i < size * size; i++) {
    const v = 152 + ((rnd() * 34) | 0)
    data[i * 4] = v
    data[i * 4 + 1] = v
    data[i * 4 + 2] = v
    data[i * 4 + 3] = 255
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(9, 9)
  tex.needsUpdate = true
  return tex
}
