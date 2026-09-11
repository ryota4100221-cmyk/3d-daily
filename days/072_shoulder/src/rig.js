// Day 072 — the length the shoulder takes
//
// 中田工芸（NAKATA HANGER）が売っているのは肩の曲線そのものである。ここで
// 再現するのはその曲線1本と、そこに縫い目を沿わせた一枚の布に起きること。
// 捨てたもの：襟・袖・前立て・ボタン・針金ハンガーの下桟。今日ふたつの絵の
// あいだで変えるのは**肩線だけ**で、布も重力も乱数の種も同じものを渡す。
//
// 🔴 このファイルに「折る」「たたむ」「しわ」に相当する式は一行も無い。
//    書いてあるのは辺ごとの |xi − xj| = l0 と、重力と、曲げに抗う弱いばね。
//    肩線は斜めに落ちているので、そこに沿わせた縫い目は、材料としての長さ
//    （弧長）より狭い差し渡し（弦）に押し込まれる。伸びない布から余った長さ
//    は平面の外へ出るしかない。ひだは「余った長さが見えているだけ」。
//
// ※ 最初は棒に布を掛ける（滑車と同じ）形で書いたが、これは物理的に不安定で
//   必ず落ちる。前後の身頃がわずかでも不均等になると長いほうが勝ち、摩擦を
//   0.72 まで上げても止まらなかった（実測：620 ステップで y = −4.1 m）。
//   実物のシャツが落ちないのは肩の縫い目が肩線の上にあるからで、掛けている
//   のではなく載っている。そこを直したらそのまま今日の装置になった。

// ── 種つき乱数 ──────────────────────────────────────────────────────────
// 対称な布を対称な支えに沿わせても、対称なままではひだが立たない。核になる
// 0.2 mm 以下の揺らぎだけに使う。両方の布に同じ種を渡すので「同じ布」は
// 比喩ではなく文字どおり同じ初期条件。
export function makeRng(seed) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

// ── 肩線 ────────────────────────────────────────────────────────────────
// 中心線のサンプル列 {x,y,z,r}。r は棒の半径で、サンプルごとに変えられる。
// 木のハンガーは中央が太く先が細い。針金は端から端まで φ2.3 mm のまま。

const WOOD = {
  key: 'wood',
  halfWidth: 0.21, // 肩幅 420 mm
  drop: 0.055, // 先端までに肩線が落ちる量
  bow: 0.016, // 前方への反り（実機は体に沿わせるため反っている）
  rCenter: 0.0115, // 中央の棒半径 → 厚み 23 mm
  rTip: 0.0062, // 先端 12.4 mm
  exponent: 1.7,
}

const WIRE = {
  key: 'wire',
  halfWidth: 0.2,
  neckDrop: 0.012,
  tipDrop: 0.092, // 木より深く、そしてまっすぐ落ちる
  r: 0.00115,
  hookDrop: 0.026, // 肩先で折れてから少しだけ下がる
}

function sampleWood(n = 201) {
  const out = []
  for (let i = 0; i < n; i++) {
    const s = (i / (n - 1)) * 2 - 1 // −1 … +1
    const a = Math.abs(s)
    out.push({
      x: s * WOOD.halfWidth,
      y: -WOOD.drop * Math.pow(a, WOOD.exponent),
      z: -WOOD.bow * a * a,
      r: WOOD.rCenter + (WOOD.rTip - WOOD.rCenter) * Math.pow(a, 1.3),
    })
  }
  return out
}

function woodCaps() {
  // 先端は丸く落ちて終わる（実機の木口）。肩線そのものではないので弧長には
  // 数えない。
  const cap = []
  for (const sgn of [-1, 1]) {
    for (let i = 1; i <= 12; i++) {
      const th = (i / 12) * (Math.PI * 0.6)
      const r0 = WOOD.rTip
      cap.push({
        x: sgn * (WOOD.halfWidth + r0 * 1.3 * Math.sin(th)),
        y: -WOOD.drop - r0 * 1.3 * (1 - Math.cos(th)) - 0.005 * th,
        z: -WOOD.bow,
        r: r0 * (1 - 0.4 * (i / 12)),
      })
    }
  }
  return cap
}

function sampleWire(n = 161) {
  const out = []
  for (let i = 0; i < n; i++) {
    const s = (i / (n - 1)) * 2 - 1
    const a = Math.abs(s)
    out.push({
      x: s * WIRE.halfWidth,
      y: -WIRE.neckDrop - (WIRE.tipDrop - WIRE.neckDrop) * a, // 直線。角は角のまま
      z: 0,
      r: WIRE.r,
    })
  }
  return out
}

function wireCaps() {
  const cap = []
  for (const sgn of [-1, 1]) {
    for (let i = 1; i <= 26; i++) {
      const t = i / 26
      cap.push({
        x: sgn * (WIRE.halfWidth - 0.009 * t * t),
        y: -WIRE.tipDrop - WIRE.hookDrop * t,
        z: 0,
        r: WIRE.r,
      })
    }
  }
  return cap
}

// フック（首から上の針金）。布には触れないが、描くときに要る。
export function hookPath(kind) {
  const y0 = kind === 'wire' ? -WIRE.neckDrop : 0
  const pts = []
  for (let i = 0; i <= 48; i++) {
    const t = i / 48
    if (t < 0.4) {
      pts.push([0, y0 + (t / 0.4) * 0.05, 0])
    } else {
      const th = ((t - 0.4) / 0.6) * Math.PI * 1.55
      const R = 0.021
      pts.push([R * Math.sin(th), y0 + 0.05 + R * (1 - Math.cos(th)), 0])
    }
  }
  return pts
}

export function makeSupport(kind) {
  const shoulder = kind === 'wood' ? sampleWood() : sampleWire()
  const caps = kind === 'wood' ? woodCaps() : wireCaps()
  const samples = shoulder.concat(caps)

  // 肩線の弧長と、それが占める差し渡し（弦）。今日の入力はこの2つの差。
  const cum = new Float64Array(shoulder.length)
  for (let i = 1; i < shoulder.length; i++) {
    const a = shoulder[i - 1]
    const b = shoulder[i]
    cum[i] = cum[i - 1] + Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z)
  }
  const arc = cum[cum.length - 1]
  const span = Math.abs(shoulder[shoulder.length - 1].x - shoulder[0].x)

  // 弧長 s（中央を 0、左右に ±）で肩線を引く。縫い目はこれで置く：
  // 縫い目の点どうしは弧長で正確に du 離れている ＝ 上端は伸びも縮みもしない。
  const half = arc / 2
  const atArc = (s) => {
    const target = s + half
    if (target <= 0 || target >= arc) {
      const e = target <= 0 ? 0 : shoulder.length - 1
      const e2 = target <= 0 ? 1 : shoulder.length - 2
      const a = shoulder[e]
      const b = shoulder[e2]
      const L = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) || 1
      const over = target <= 0 ? -target : target - arc
      return {
        x: a.x - ((b.x - a.x) / L) * over,
        y: a.y - ((b.y - a.y) / L) * over,
        z: a.z - ((b.z - a.z) / L) * over,
        r: a.r,
        beyond: true,
      }
    }
    let lo = 0
    let hi = shoulder.length - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (cum[mid] <= target) lo = mid
      else hi = mid
    }
    const g = (target - cum[lo]) / (cum[hi] - cum[lo] || 1)
    const a = shoulder[lo]
    const b = shoulder[hi]
    return {
      x: a.x + (b.x - a.x) * g,
      y: a.y + (b.y - a.y) * g,
      z: a.z + (b.z - a.z) * g,
      r: a.r + (b.r - a.r) * g,
      beyond: false,
    }
  }

  // 空間ハッシュ（毎ステップ全サンプルを舐めると 1 フレームが数十 ms になる）
  const CELL = 0.028
  const grid = new Map()
  const key = (i, j, k) => (i * 73856093) ^ (j * 19349663) ^ (k * 83492791)
  samples.forEach((s, idx) => {
    const h = key(
      Math.floor(s.x / CELL),
      Math.floor(s.y / CELL),
      Math.floor(s.z / CELL)
    )
    let b = grid.get(h)
    if (!b) grid.set(h, (b = []))
    b.push(idx)
  })

  return { kind, samples, shoulder, caps, grid, CELL, key, arc, span, half, atArc }
}

// ── 布 ──────────────────────────────────────────────────────────────────
const G = -9.81
const THICK = 0.0012 // 生地の厚み（片側）

export function makeCloth({ support, W = 0.42, nu = 57, nv = 52, seed = 20720912 }) {
  const du = W / (nu - 1)
  const H = du * (nv - 1)
  const N = nu * nv
  const pos = new Float64Array(N * 3)
  const prev = new Float64Array(N * 3)
  const inv = new Float64Array(N).fill(1)
  const seam = new Float64Array(nu * 3) // 縫い目の固定点
  const pinned = new Uint8Array(nu)
  const rng = makeRng(seed)

  // 上端 j=0 が肩の縫い目。材料座標 s は布の中央から測った弧長で、肩線に
  // そのまま乗せる。肩線からはみ出した列（|s| > 弧長/2）は縫い目が無いので
  // 固定しない＝そこは自由に垂れる。
  let pinCount = 0
  for (let i = 0; i < nu; i++) {
    const s = (i - (nu - 1) / 2) * du
    const S = support.atArc(s)
    // 縫い目は棒の前面。針金では半径が 1.15 mm しかなく、生地の厚みぶんだけ
    // 逃がすと布と針金がほぼ同じ面に乗って、細い線が布を突き抜けて見えた。
    // 縫い代 1.5 mm を足してある（実物の縫い代とだいたい同じ）。
    const off = S.r + THICK + 0.0015
    seam[i * 3] = S.x
    seam[i * 3 + 1] = S.y + off * 0.34
    seam[i * 3 + 2] = S.z + off
    if (!S.beyond) {
      pinned[i] = 1
      pinCount++
    }
  }

  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const n = j * nu + i
      const k = i * 3
      // 真下に垂らす。ひだは初期姿勢では1本も無い。
      pos[n * 3] = seam[k] + (rng() - 0.5) * 0.00022
      pos[n * 3 + 1] = seam[k + 1] - j * du + (rng() - 0.5) * 0.00022
      pos[n * 3 + 2] = seam[k + 2] + (rng() - 0.5) * 0.00022
      prev[n * 3] = pos[n * 3]
      prev[n * 3 + 1] = pos[n * 3 + 1]
      prev[n * 3 + 2] = pos[n * 3 + 2]
      if (j === 0 && pinned[i]) inv[n] = 0
    }
  }

  // 🔴 並び順が効く。縦糸は列ごとに上から下へ並べる：布は肩で吊られている
  //    ので張力は列を下へ流れ、その順に1掃きすると鎖と同じで**その掃きだけで
  //    厳密に**満たせる。順番をばらばらにすると（最初はそうしていた）6掃きでも
  //    30% 伸びたままで、布ではなくゴムになる（実測 30.3%／400掃きでも 10.5%）。
  const vert = []
  const horiz = []
  const shear = []
  const bend = []
  const idx = (i, j) => j * nu + i
  for (let i = 0; i < nu; i++) for (let j = 0; j + 1 < nv; j++) vert.push(idx(i, j), idx(i, j + 1))
  for (let j = 0; j < nv; j++) for (let i = 0; i + 1 < nu; i++) horiz.push(idx(i, j), idx(i + 1, j))
  for (let j = 0; j + 1 < nv; j++) {
    for (let i = 0; i + 1 < nu; i++) {
      shear.push(idx(i, j), idx(i + 1, j + 1))
      shear.push(idx(i + 1, j), idx(i, j + 1))
    }
  }
  for (let j = 0; j < nv; j++) for (let i = 0; i + 2 < nu; i++) bend.push(idx(i, j), idx(i + 2, j))
  for (let i = 0; i < nu; i++) for (let j = 0; j + 2 < nv; j++) bend.push(idx(i, j), idx(i, j + 2))
  // 遠い側の曲げ（4目とび）。これが無いと、ひだの波長が格子の目そのものに
  // 張りついてしまい、布ではなく薄紙になる。生地の「腰」はここに入っている。
  const bend4 = []
  for (let j = 0; j < nv; j++) for (let i = 0; i + 4 < nu; i++) bend4.push(idx(i, j), idx(i + 4, j))
  for (let i = 0; i < nu; i++) for (let j = 0; j + 4 < nv; j++) bend4.push(idx(i, j), idx(i, j + 4))
  const struct = vert.concat(horiz)

  return {
    support,
    nu,
    nv,
    du,
    W,
    H,
    N,
    pos,
    prev,
    inv,
    seam,
    pinned,
    pinCount,
    pinnedArc: pinCount > 1 ? (pinCount - 1) * du : 0,
    vert: Int32Array.from(vert),
    horiz: Int32Array.from(horiz),
    struct: Int32Array.from(struct),
    shear: Int32Array.from(shear),
    bend: Int32Array.from(bend),
    bend4: Int32Array.from(bend4),
    restShear: du * Math.SQRT2,
    restBend: du * 2,
    restBend4: du * 4,
    t: 0,
    contacts: 0,
  }
}

// 織物は「伸びない／せん断は緩い／曲げにはほとんど抗わない」。この3つの比が
// ひだの本数と、ひだが下まで届く距離を決める。値は布の性格であって絵の都合
// ではない。
const K_STRUCT = 1.0
const K_SHEAR = 0.45
const K_BEND = 0.30
const K_BEND4 = 0.16
const STRUCT_PASSES = 3

function solve(c, list, rest, k, backward) {
  const { pos, inv } = c
  const n = list.length
  for (let q = 0; q < n; q += 2) {
    const e = backward ? n - 2 - q : q
    const a = list[e] * 3
    const b = list[e + 1] * 3
    const dx = pos[b] - pos[a]
    const dy = pos[b + 1] - pos[a + 1]
    const dz = pos[b + 2] - pos[a + 2]
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz)
    if (d < 1e-9) continue
    const wa = inv[list[e]]
    const wb = inv[list[e + 1]]
    const wsum = wa + wb
    if (wsum === 0) continue
    const s = ((d - rest) / d) * (k / wsum)
    pos[a] += dx * s * wa
    pos[a + 1] += dy * s * wa
    pos[a + 2] += dz * s * wa
    pos[b] -= dx * s * wb
    pos[b + 1] -= dy * s * wb
    pos[b + 2] -= dz * s * wb
  }
}

// 伸びの頭打ち（Long Range Attachment）。ある粒子が縫い目からどれだけ離れ
// られるかは、そこまでの布地の長さ j·du で決まっていて、それ以上は物理的に
// あり得ない。縫い目から直接その距離で丸めるので、列を1本ずつたどる必要が
// 無く、1掃きで大域的に効く。**縮む側には触らない**——布は引けば伸びないが、
// 押せば必ず座屈する。
//
// ここが今日の主張の本体なので、隣どうしの距離を対称に分け合う掃きだけで
// 済ませるとどうなるかは実測した：60 個ぶら下がった列の張力が上まで戻らず、
// 縦糸が平均 8.4%・最大 21% 伸びたまま止まる（＝布ではなくゴム）。逆に列を
// 下へたどって厳密に置き直す（FTL）と横糸のほうが壊れ、平均 34.6% で布が
// 暴れた。丸めるだけのこれが、いちばん静かに効く。
const MAX_STRAIN = 0.002
function lra(c) {
  const { pos, nu, nv, du, seam } = c
  for (let i = 0; i < nu; i++) {
    const sx = seam[i * 3]
    const sy = seam[i * 3 + 1]
    const sz = seam[i * 3 + 2]
    for (let j = 1; j < nv; j++) {
      const p = (j * nu + i) * 3
      const max = j * du * (1 + MAX_STRAIN)
      const dx = pos[p] - sx
      const dy = pos[p + 1] - sy
      const dz = pos[p + 2] - sz
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz)
      if (d <= max || d < 1e-9) continue
      const f = max / d
      pos[p] = sx + dx * f
      pos[p + 1] = sy + dy * f
      pos[p + 2] = sz + dz * f
    }
  }
}

function collide(c, mu) {
  const { pos, prev, support, inv } = c
  const { samples, grid, CELL, key } = support
  let hits = 0
  for (let n = 0; n < c.N; n++) {
    if (inv[n] === 0) continue
    const p = n * 3
    const x = pos[p]
    const y = pos[p + 1]
    const z = pos[p + 2]
    const ci = Math.floor(x / CELL)
    const cj = Math.floor(y / CELL)
    const ck = Math.floor(z / CELL)
    let best = -1
    let bestD = Infinity
    for (let a = -1; a <= 1; a++)
      for (let b = -1; b <= 1; b++)
        for (let d2 = -1; d2 <= 1; d2++) {
          const bucket = grid.get(key(ci + a, cj + b, ck + d2))
          if (!bucket) continue
          for (let q = 0; q < bucket.length; q++) {
            const s = samples[bucket[q]]
            const dd = (x - s.x) * (x - s.x) + (y - s.y) * (y - s.y) + (z - s.z) * (z - s.z)
            if (dd < bestD) {
              bestD = dd
              best = bucket[q]
            }
          }
        }
    if (best < 0) continue
    const s = samples[best]
    const need = s.r + THICK
    const dist = Math.sqrt(bestD)
    if (dist >= need || dist < 1e-9) continue
    hits++
    const nx = (x - s.x) / dist
    const ny = (y - s.y) / dist
    const nz = (z - s.z) / dist
    const push = need - dist
    pos[p] += nx * push
    pos[p + 1] += ny * push
    pos[p + 2] += nz * push
    // クーロン摩擦の位置版：接線方向の滑りを μ×押し出し量で頭打ちにする。
    let tx = pos[p] - prev[p]
    let ty = pos[p + 1] - prev[p + 1]
    let tz = pos[p + 2] - prev[p + 2]
    const dot = tx * nx + ty * ny + tz * nz
    tx -= dot * nx
    ty -= dot * ny
    tz -= dot * nz
    const tl = Math.hypot(tx, ty, tz)
    if (tl > 1e-12) {
      const hold = Math.max(0, 1 - Math.min(1, (mu * push) / tl))
      prev[p] += tx * hold
      prev[p + 1] += ty * hold
      prev[p + 2] += tz * hold
    }
  }
  c.contacts = hits
}

export function substep(c, dt, damp, wind, mu) {
  const { pos, prev, inv } = c
  for (let n = 0; n < c.N; n++) {
    const p = n * 3
    if (inv[n] === 0) continue
    const vx = (pos[p] - prev[p]) * damp
    const vy = (pos[p + 1] - prev[p + 1]) * damp
    const vz = (pos[p + 2] - prev[p + 2]) * damp
    prev[p] = pos[p]
    prev[p + 1] = pos[p + 1]
    prev[p + 2] = pos[p + 2]
    pos[p] += vx + wind[0] * dt * dt
    pos[p + 1] += vy + (G + wind[1]) * dt * dt
    pos[p + 2] += vz + wind[2] * dt * dt
  }
  // 伸びない糸は張力を遠くまで一瞬で伝える。Gauss–Seidel の1掃きは1行ぶんしか
  // 伝えないので、掃きが足りないと「局所的には伸びていないのに全体としては
  // 落ちていく」嘘の挙動になる。前向き・後ろ向きを交互に掛ける。
  for (let it = 0; it < STRUCT_PASSES; it++) {
    solve(c, c.vert, c.du, K_STRUCT, false) // 上から下へ＝吊られている向き
    solve(c, c.horiz, c.du, K_STRUCT, it % 2 === 1)
    if (it < 2) solve(c, c.shear, c.restShear, K_SHEAR, it % 2 === 1)
  }
  for (let it = 0; it < 2; it++) {
    solve(c, c.bend, c.restBend, K_BEND, it % 2 === 1)
    solve(c, c.bend4, c.restBend4, K_BEND4, it % 2 === 1)
  }
  for (let it = 0; it < 3; it++) {
    lra(c)
    solve(c, c.vert, c.du, K_STRUCT, false)
    solve(c, c.horiz, c.du, K_STRUCT, it % 2 === 0)
  }
  lra(c)
  collide(c, mu)
}

const NOWIND = [0, 0, 0]

// 初期の落ち着き。重い減衰で粗く沈めてから、実時間の刻みに戻して仕上げる。
// ここを frame ループに逃がすと preview が「沈む途中」を撮る。
export function settle(c, coarse = 420, fine = 230) {
  for (let i = 0; i < coarse; i++) substep(c, 1 / 200, 0.965, NOWIND, 0.5)
  for (let i = 0; i < fine; i++) substep(c, 1 / 320, 0.993, NOWIND, 0.5)
}

// 呼吸。掛かった布はまったく静止しない。ただし 0.3 m/s² まで上げたら 16 秒で
// 布が膨らみ、伸びが 8.2% まで戻った（実測）。重力の 1% 未満に落としてある。
export function breathe(t) {
  const a = 0.075
  return [
    a * Math.sin(0.31 * t + 0.7 * Math.sin(0.17 * t)),
    0,
    a * 0.8 * Math.cos(0.23 * t + 1.1),
  ]
}

// 刻みは実時間ではなく固定にする。ブラウザの 1 フレームは 2 枚ぶんの布で
// 20 fps 前後まで落ちるので、dt をそのまま割ると刻みが settle の 2.7 倍になり、
// 伸びが 3.4% → 8.4% へ戻った（実測）。呼吸は遅くていいが布は伸びては困る。
export function advance(c, dt, steps = 4) {
  const h = 1 / 280
  for (let i = 0; i < steps; i++) {
    c.t += h
    substep(c, h, 0.9945, breathe(c.t), 0.5)
  }
}

// ── 測る ────────────────────────────────────────────────────────────────
// 入力：肩線の弧長と弦の差＝肩が奪う長さ。これは幾何で、布が来る前に決まる。
// 出力：その余りがどこまで下に残るか。行ごとに奥行きの振れ幅を測り、1.2 mm
// を切った最初の行までの距離を「ひだが届いた距離」と呼ぶ。
export function measure(c) {
  const { pos, nu, nv, du, pinned, pinCount, pinnedArc } = c

  let i0 = 0
  let i1 = nu - 1
  while (i0 < nu && !pinned[i0]) i0++
  while (i1 > 0 && !pinned[i1]) i1--

  // 行の「ひだの深さ」。奥行き z をそのまま測ると、布全体がゆるく反っている
  // ぶんまで数えてしまう。x の2次式を最小二乗で当てて引き、その残差の振れ幅
  // だけを見る＝大きな反りは形、残差がひだ。
  const rowDepth = (j) => {
    let n = 0
    let sx = 0
    let sx2 = 0
    let sx3 = 0
    let sx4 = 0
    let sz = 0
    let sxz = 0
    let sx2z = 0
    let minX = Infinity
    let maxX = -Infinity
    for (let i = i0; i <= i1; i++) {
      const p = (j * nu + i) * 3
      const x = pos[p]
      const z = pos[p + 2]
      n++
      sx += x
      sx2 += x * x
      sx3 += x * x * x
      sx4 += x * x * x * x
      sz += z
      sxz += x * z
      sx2z += x * x * z
      if (x < minX) minX = x
      if (x > maxX) maxX = x
    }
    // 3x3 の正規方程式をガウス消去で解く
    const M = [
      [n, sx, sx2, sz],
      [sx, sx2, sx3, sxz],
      [sx2, sx3, sx4, sx2z],
    ]
    for (let c0 = 0; c0 < 3; c0++) {
      let piv = c0
      for (let r = c0 + 1; r < 3; r++) if (Math.abs(M[r][c0]) > Math.abs(M[piv][c0])) piv = r
      const t = M[c0]
      M[c0] = M[piv]
      M[piv] = t
      const d = M[c0][c0] || 1e-12
      for (let r = 0; r < 3; r++) {
        if (r === c0) continue
        const f = M[r][c0] / d
        for (let cc = c0; cc < 4; cc++) M[r][cc] -= f * M[c0][cc]
      }
    }
    const a0 = M[0][3] / (M[0][0] || 1e-12)
    const a1 = M[1][3] / (M[1][1] || 1e-12)
    const a2 = M[2][3] / (M[2][2] || 1e-12)
    let mn = Infinity
    let mx = -Infinity
    for (let i = i0; i <= i1; i++) {
      const p = (j * nu + i) * 3
      const x = pos[p]
      const res = pos[p + 2] - (a0 + a1 * x + a2 * x * x)
      if (res < mn) mn = res
      if (res > mx) mx = res
    }
    let fullMin = Infinity
    let fullMax = -Infinity
    for (let i = 0; i < nu; i++) {
      const p = (j * nu + i) * 3
      if (pos[p] < fullMin) fullMin = pos[p]
      if (pos[p] > fullMax) fullMax = pos[p]
    }
    return { amp: mx - mn, span: maxX - minX, full: fullMax - fullMin }
  }

  // ひだの本数は肩から 120 mm 下の行で数える（縫い目の直下は棒の影響が残る）
  const jCount = Math.min(nv - 1, Math.round(0.12 / du))
  let folds = 0
  {
    const zs = []
    for (let i = i0; i <= i1; i++) zs.push(pos[(jCount * nu + i) * 3 + 2])
    for (let i = 1; i < zs.length - 1; i++) {
      const a = zs[i] - zs[i - 1]
      const b = zs[i + 1] - zs[i]
      if (a * b < 0 && Math.abs(zs[i] - (zs[i - 1] + zs[i + 1]) / 2) > 0.0007) folds++
    }
  }

  let reach = (nv - 1) * du
  const profile = []
  for (let j = 0; j < nv; j++) {
    const r = rowDepth(j)
    profile.push(r.amp)
    if (j > 4 && r.amp < 0.0012 && reach === (nv - 1) * du) reach = j * du
  }

  // 伸びの実測。「布は伸びない」が守られているかを毎フレーム数える。
  let worst = 0
  let sum = 0
  let cnt = 0
  for (let e = 0; e < c.struct.length; e += 2) {
    const a = c.struct[e] * 3
    const b = c.struct[e + 1] * 3
    const d = Math.hypot(pos[b] - pos[a], pos[b + 1] - pos[a + 1], pos[b + 2] - pos[a + 2])
    const s = Math.abs(d / du - 1)
    sum += s
    cnt++
    if (s > worst) worst = s
  }

  const seamSpan = rowDepth(0).span
  return {
    pinnedArc, // 肩線に沿わされた布の長さ
    seamSpan, // それが占める差し渡し
    taken: pinnedArc - seamSpan, // 肩が奪った長さ
    folds,
    reach, // ひだが下まで届いた距離
    hemSpan: rowDepth(nv - 1).full,
    hemAmp: profile[nv - 1],
    stretch: worst,
    stretchMean: sum / cnt,
    contacts: c.contacts,
    arc: c.support.arc,
    chord: c.support.span,
    profile,
  }
}
