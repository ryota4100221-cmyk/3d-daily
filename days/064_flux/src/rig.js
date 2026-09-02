// rig.js — 架構の勾配（the frame gradient）
//
// 再現元: 株式会社ANDO Imagineering Group / https://www.aig-japan.jp/
// DBの実測行が言っているのは2つ。
//   ① 業種は「構造設計から建築設計まで」の総合設計事務所
//   ② 色の運用は「地を無彩色2色（#1c1c1c / #f7f8f8）に固定し、
//      アクセントは担当を決めて1〜2色ずつ乗せる」（設計の色% 63.21・13色）
//
// この2つを1つの装置に畳む：
//   **色を選ばない。** 13色は凡例（legend）にして、力の帯域に1色ずつ担当させる。
//   何色になるかは解いた結果で決まり、こちらは1つも指定しない。
//
// 解いているものは1つだけ——スカラー場 φ。
//   膜（張力 T の面）に鉛直荷重 q が載ると  ∇²φ = −q/T。
//   ・**形** は φ そのもの（面がどうたわむか）
//   ・**色** は ∇φ（面の中を流れるせん断＝各部材が運んでいる力）
// 同じ1枚の場を2回読むだけで、形と色が両方出てくる。だから色は絵の説明ではない。
//
// 境界条件:
//   ・外周は自由端（Neumann, ∂φ/∂n = 0）＝跳ね出し。鏡像でゴースト節点を作る
//   ・柱の位置だけ φ = 0（Dirichlet）。荷重は全部この4点に集まるしかない
// 連続体では点支持は対数発散するが、格子の上では有限に収まる。
// そのとき柱の周りに出る漏斗が「力が集まる」ということの絵そのものになる。

import * as THREE from 'three'

export const N = 41 // 節点は 41×41
export const SPAN = 10 // 版面 10 単位
export const H = SPAN / (N - 1) // 格子間隔 0.25
export const NX = (N - 1) * N // X方向の部材数 1640
export const NZ = N * (N - 1) // Z方向の部材数 1640

// 柱の位置。左右対称に置くと場も対称になって「解いている」ことが絵から消えるので、
// わざと非対称に4本置く（跳ね出しの長さが4辺で全部ちがう）。
export const COLUMNS = [
  [8, 12],
  [31, 9],
  [12, 32],
  [33, 28],
]

// ── 凡例 ────────────────────────────────────────────────────────────────
// 再現元の13色のうち、無彩色2色（#1c1c1c / #f7f8f8）は地と文字に固定し、
// 有彩色10色を力の帯域に低い順で1つずつ割り当てる。並べ替えも補間もしない。
// 「アクセントはセクションごとに1〜2色だけ担当させる」を
// 「1つの色は1つの力の帯域だけを担当する」に読み替えたのがこの表。
export const BAND_HEX = [
  '#005060', // 0 いちばん力が流れていない部材
  '#105098',
  '#0050ff',
  '#8cbef9',
  '#8ceaf9',
  '#51ba95',
  '#fff100',
  '#f1b93e',
  '#ff9c7e',
  '#ff5d07', // 9 柱に取り付く部材
]
export const NBANDS = BAND_HEX.length

// 無彩色2色（再現元の地）。こちらは一度も力に触らない。
export const INK = '#1c1c1c'
export const PAPER = '#f7f8f8'

export const idx = (i, j) => j * N + i
export const gx = (i) => (i - (N - 1) / 2) * H
export const gz = (j) => (j - (N - 1) / 2) * H

export class Grillage {
  constructor() {
    this.phi = new Float64Array(N * N)
    this.q = new Float64Array(N * N)
    this.fixed = new Uint8Array(N * N)
    for (const [i, j] of COLUMNS) this.fixed[idx(i, j)] = 1

    this.fluxX = new Float32Array(NX)
    this.fluxZ = new Float32Array(NZ)
    this.bandX = new Uint8Array(NX)
    this.bandZ = new Uint8Array(NZ)

    this.q0 = 1.0 // 等分布荷重（自重）
    this.qPoint = 34 // 移動荷重の合計。等分布の総和 q0·SPAN² = 100 に対して 34%
    this.sigma = 0.42 // 移動荷重の広がり
    this.omega = 1.9 // SOR

    this.setLoad(0, 0)
    this.solve(6000) // 起動時だけ完全に収束させる
    this.computeFlux()
    this.bandEdges = this.decilesOfReference()
    this.assignBands()
    this.residual = 0
    this.peak = 0
    this.phiMax = 0
  }

  // 荷重を組み直す。q は「単位面積あたり」なので、点荷重は正規化ガウスで撒く
  // （合計が qPoint になる形で撒けば、荷重の大きさが σ に依存しない）。
  setLoad(lx, lz) {
    const { q, sigma, q0, qPoint } = this
    const inv2s2 = 1 / (2 * sigma * sigma)
    const norm = qPoint / (2 * Math.PI * sigma * sigma)
    for (let j = 0; j < N; j++) {
      const z = gz(j)
      for (let i = 0; i < N; i++) {
        const x = gx(i)
        const dx = x - lx
        const dz = z - lz
        q[idx(i, j)] = q0 + norm * Math.exp(-(dx * dx + dz * dz) * inv2s2)
      }
    }
  }

  // ∇²φ = −q を SOR で解く。外周は鏡像（自由端）、柱は φ=0 で固定。
  solve(sweeps) {
    const { phi, q, fixed, omega } = this
    const h2 = H * H
    for (let s = 0; s < sweeps; s++) {
      for (let j = 0; j < N; j++) {
        const jm = j > 0 ? j - 1 : 1
        const jp = j < N - 1 ? j + 1 : N - 2
        for (let i = 0; i < N; i++) {
          const id = idx(i, j)
          if (fixed[id]) continue
          const im = i > 0 ? i - 1 : 1
          const ip = i < N - 1 ? i + 1 : N - 2
          const sum =
            phi[idx(im, j)] + phi[idx(ip, j)] + phi[idx(i, jm)] + phi[idx(i, jp)]
          const next = (sum + h2 * q[id]) * 0.25
          phi[id] += omega * (next - phi[id])
        }
      }
    }
  }

  // 収束の度合いを画面に出すため、残差 max|∇²φ + q|·h² を測る。
  measure() {
    const { phi, q, fixed } = this
    const h2 = H * H
    let r = 0
    let pm = 0
    for (let j = 0; j < N; j++) {
      const jm = j > 0 ? j - 1 : 1
      const jp = j < N - 1 ? j + 1 : N - 2
      for (let i = 0; i < N; i++) {
        const id = idx(i, j)
        if (phi[id] > pm) pm = phi[id]
        if (fixed[id]) continue
        const im = i > 0 ? i - 1 : 1
        const ip = i < N - 1 ? i + 1 : N - 2
        const lap =
          phi[idx(im, j)] + phi[idx(ip, j)] + phi[idx(i, jm)] + phi[idx(i, jp)] -
          4 * phi[id]
        const res = Math.abs(lap + h2 * q[id])
        if (res > r) r = res
      }
    }
    this.residual = r
    this.phiMax = pm
  }

  // 部材が運んでいる力 = T·∂φ/∂s（T=1）。格子の上ではただの前進差分。
  computeFlux() {
    const { phi, fluxX, fluxZ } = this
    const inv = 1 / H
    let peak = 0
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N - 1; i++) {
        const f = (phi[idx(i + 1, j)] - phi[idx(i, j)]) * inv
        fluxX[j * (N - 1) + i] = f
        const a = f < 0 ? -f : f
        if (a > peak) peak = a
      }
    }
    for (let j = 0; j < N - 1; j++) {
      for (let i = 0; i < N; i++) {
        const f = (phi[idx(i, j + 1)] - phi[idx(i, j)]) * inv
        fluxZ[j * N + i] = f
        const a = f < 0 ? -f : f
        if (a > peak) peak = a
      }
    }
    this.peak = peak
  }

  // 帯の境界を「基準解＝移動荷重を版面の中央に停めた荷重ケース」の十分位で決める。
  // 力の絶対値で等間隔に切ると、柱に取り付く数十本だけが暖色に振り切れて、
  // 残り3200本が全部いちばん低い帯に落ちる——凡例が10色あるのに2色しか出てこない。
  // 十分位で切れば、基準の状態でどの色もちょうど1割ずつ受け持つ。
  // 荷重が動いた分だけ部材が帯をまたぐので、色の変化がそのまま「力の移動」になる。
  decilesOfReference() {
    const saveQ = Float64Array.from(this.q)
    const savePhi = Float64Array.from(this.phi)
    this.setLoad(0, 0)
    this.solve(6000)
    this.computeFlux()

    const all = new Float64Array(NX + NZ)
    for (let k = 0; k < NX; k++) all[k] = Math.abs(this.fluxX[k])
    for (let k = 0; k < NZ; k++) all[NX + k] = Math.abs(this.fluxZ[k])
    all.sort()
    const edges = new Float64Array(NBANDS - 1)
    for (let b = 1; b < NBANDS; b++) {
      edges[b - 1] = all[Math.floor((all.length * b) / NBANDS)]
    }

    this.q.set(saveQ)
    this.phi.set(savePhi)
    this.computeFlux()
    return edges
  }

  bandOf(v) {
    const a = v < 0 ? -v : v
    const e = this.bandEdges
    let b = 0
    while (b < NBANDS - 1 && a >= e[b]) b++
    return b
  }

  assignBands() {
    const { fluxX, fluxZ, bandX, bandZ } = this
    for (let k = 0; k < NX; k++) bandX[k] = this.bandOf(fluxX[k])
    for (let k = 0; k < NZ; k++) bandZ[k] = this.bandOf(fluxZ[k])
  }

  step(lx, lz, sweeps = 150) {
    this.setLoad(lx, lz)
    this.solve(sweeps) // 前フレームの解から温めて回すので、これで足りる
    this.computeFlux()
    this.assignBands()
    this.measure()
  }
}

// ── 移動荷重の経路 ──────────────────────────────────────────────────────
// 周期が通約でない2本のサインを重ねる。閉じないので、同じ配色が二度出ない。
export function loadPath(t) {
  return [
    3.15 * Math.sin(t * 0.163) + 1.15 * Math.sin(t * 0.094 + 1.1),
    3.15 * Math.cos(t * 0.128 + 0.4) + 1.15 * Math.sin(t * 0.199),
  ]
}

// 凡例の色を線形（three の作業色空間）にしておく。instanceColor は生の float を
// 読むので、ここで sRGB → linear を通しておかないと版面の色が全部くすむ。
export const BAND_LINEAR = BAND_HEX.map((h) => {
  const c = new THREE.Color(h)
  return [c.r, c.g, c.b]
})
