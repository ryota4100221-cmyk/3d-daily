// rig.js — Day 080 · 布のコンパス法（Tchebyshev net draping）
//
// ここには「布」も「重力」も「曲げ剛性」も「衝突」も書いていない。
// 書いてあるのは次の一行だけ:
//
//     次の交点 = 体の表面の上で、左隣からちょうど a、下隣からちょうど a の点
//
// 糸は伸びない。交点はピン留めで、自由なのは**経糸と緯糸のなす角 ω** だけ。
// これが Tchebyshev net（チェビシェフ網）で、仕立て屋が型紙を当てるときの
// 「コンパス法」そのもの。状態も時間積分も緩和反復も持たない——ある節点は
// その左隣と下隣だけで完全に決まる。
//
// ここから勝手に落ちてくるもの:
//   ① 辺長は例外なく a（最大誤差 1e-9 台）。拘束ソルバではなく作図で伸びない
//   ② ω は sine-Gordon 方程式 ∂²ω/∂u∂v = −K·sin ω に従う。誰も書いていない
//   ③ ∫∫K dA = ω(M,0) + ω(0,N) − ω(0,0) − ω(M,N)（四隅の角だけで面積分が出る）
//   ④ 平らな所（K=0）では ω は 1 度も動かない＝**歪みは曲がっている所にしか出ない**
//   ⑤ 織物はせん断が或る角度で固まる（shear locking）。そこで布は止まる。
//      止まる場所を決めているのは布ではなく**体の曲率**である＝ダーツの位置

// ── 体（ボディ / トルソー） ──────────────────────────────────────────
// 節（ノット）を持つスプラインだと曲率 K が節で飛ぶので、profile は
// ガウス関数の和＝C^∞ で作る。微分は全部解析的に取れる。
// 半幅 A(u)（左右）と 半奥行 B(u)（前後）。u=0 が腰、u=1 が首。
const WID = [
  [0.270, 0.03, 0.30], // 腰まわり
  [0.255, 0.70, 0.27], // 胸〜肋
  [-0.070, 1.05, 0.22], // 首へ絞る
]
const DEP = [
  [0.170, 0.02, 0.31],
  [0.185, 0.72, 0.24],
  [-0.052, 1.05, 0.22],
]
const WID0 = 0.085
const DEP0 = 0.070
const HGT = 1.15 // H(u) = HGT · u

// A / A' / A'' / B / B' / B'' を exp 6回で一度に出して u でキャッシュする。
// （素直に書くと Newton の1反復で exp を18回叩いて 60fps に届かなかった）
const P = { u: NaN, A: 0, Ad: 0, Add: 0, B: 0, Bd: 0, Bdd: 0 }
function prof(u) {
  if (u === P.u) return P
  let a = WID0, a1 = 0, a2 = 0, b = DEP0, b1 = 0, b2 = 0
  for (let t = 0; t < 3; t++) {
    let [k, c, w] = WID[t]
    let z = (u - c) / w, g = k * Math.exp(-(z * z))
    a += g; a1 += (-2 * z / w) * g; a2 += ((4 * z * z - 2) / (w * w)) * g
    ;[k, c, w] = DEP[t]
    z = (u - c) / w
    g = k * Math.exp(-(z * z))
    b += g; b1 += (-2 * z / w) * g; b2 += ((4 * z * z - 2) / (w * w)) * g
  }
  P.u = u; P.A = a; P.Ad = a1; P.Add = a2; P.B = b; P.Bd = b1; P.Bdd = b2
  return P
}
export const A = (u) => prof(u).A
export const B = (u) => prof(u).B

// v = 0 が中心前（center front）。x=0 は鏡映面なので v=0 の子午線は測地線。
export function surf(u, v, out) {
  const p = prof(u)
  out[0] = p.A * Math.sin(v)
  out[1] = HGT * u
  out[2] = p.B * Math.cos(v)
  return out
}
function surfU(u, v, out) {
  const p = prof(u)
  out[0] = p.Ad * Math.sin(v)
  out[1] = HGT
  out[2] = p.Bd * Math.cos(v)
  return out
}
function surfV(u, v, out) {
  const p = prof(u)
  out[0] = p.A * Math.cos(v)
  out[1] = 0
  out[2] = -p.B * Math.sin(v)
  return out
}

// 外向き法線（布を厚みのぶんだけ浮かせるのに使う。解は必ず素の面 S 上で解く）
export function normalAt(u, v, out) {
  const su = surfU(u, v, [0, 0, 0])
  const sv = surfV(u, v, [0, 0, 0])
  // n = sv × su にすると外向きになる（v=0, u中央で +z 側）
  let nx = sv[1] * su[2] - sv[2] * su[1]
  let ny = sv[2] * su[0] - sv[0] * su[2]
  let nz = sv[0] * su[1] - sv[1] * su[0]
  const l = Math.hypot(nx, ny, nz) || 1
  out[0] = nx / l; out[1] = ny / l; out[2] = nz / l
  return out
}

// ガウス曲率 K(u,v)。第一・第二基本形式から解析的に。
export function gaussK(u, v) {
  const s = Math.sin(v), c = Math.cos(v)
  const p = prof(u)
  const a = p.A, b = p.B, a1 = p.Ad, b1 = p.Bd, a2 = p.Add, b2 = p.Bdd
  const Su = [a1 * s, HGT, b1 * c]
  const Sv = [a * c, 0, -b * s]
  const Suu = [a2 * s, 0, b2 * c]
  const Suv = [a1 * c, 0, -b1 * s]
  const Svv = [-a * s, 0, -b * c]
  let nx = Sv[1] * Su[2] - Sv[2] * Su[1]
  let ny = Sv[2] * Su[0] - Sv[0] * Su[2]
  let nz = Sv[0] * Su[1] - Sv[1] * Su[0]
  const nl = Math.hypot(nx, ny, nz) || 1
  nx /= nl; ny /= nl; nz /= nl
  const dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2]
  const E = dot(Su, Su), F = dot(Su, Sv), Gg = dot(Sv, Sv)
  const L = Suu[0] * nx + Suu[1] * ny + Suu[2] * nz
  const M = Suv[0] * nx + Suv[1] * ny + Suv[2] * nz
  const N = Svv[0] * nx + Svv[1] * ny + Svv[2] * nz
  return (L * N - M * M) / (E * Gg - F * F)
}

// ── 網の寸法 ──────────────────────────────────────────────────────────
export const A_SPACING = 0.033 // 糸の間隔（＝1目の一辺。これが唯一の布の物性）
export const NW = 26 // 経糸方向 ±
export const NJ = 24 // 緯糸方向 ±
export const CLOTH_LIFT = 0.005 // 布の厚みぶん面から浮かせる（解には効かない）
// 織物は或るせん断角で目が詰まって動かなくなる（shear locking）。
// 平織で概ね ±40° 前後。ここを超えた目は「布がもう行けない」ので描かない。
export const SHEAR_LOCK = 40 * Math.PI / 180

// 網の定義域＝ボディの定義域。ここがズレると布が台の外へ出る。
export const UMIN = -0.02
export const UMAX = 1.10
const COLS = 2 * NJ + 1
const ROWS = 2 * NW + 1
export const NODES = ROWS * COLS
export const idx = (i, j) => (i + NW) * COLS + (j + NJ)

export const pos = new Float32Array(NODES * 3) // 描画用（法線方向に浮かせた後）
export const raw = new Float64Array(NODES * 3) // 素の面 S 上の位置（距離はこれで測る）
export const par = new Float64Array(NODES * 2) // (u, v)
export const alive = new Uint8Array(NODES)
export const omega = new Float64Array(NODES) // 経糸と緯糸のなす角

// ── 1本目の軸：中心前の子午線（v=0）。鏡映面なので測地線 ────────────
// 2本目の軸：u=u0 の水平線（バストライン）。型紙の「横地」がここを走る。
function stepMeridian(u0, dir, a) {
  // |S(u,0) − S(u0,0)| = a を u について解く（単調なので二分法で確実に）
  const p0 = surf(u0, 0, [0, 0, 0])
  const d = (u) => {
    const p = surf(u, 0, [0, 0, 0])
    return Math.hypot(p[0] - p0[0], p[1] - p0[1], p[2] - p0[2]) - a
  }
  const step = (a / HGT) * 0.5
  let lo = u0, hi = u0 + dir * step
  let k = 0
  while (d(hi) < 0) {
    if (k++ > 80 || hi < UMIN || hi > UMAX) return null
    hi += dir * step
  }
  for (let it = 0; it < 60; it++) {
    const m = 0.5 * (lo + hi)
    if (d(m) < 0) lo = m; else hi = m
  }
  return 0.5 * (lo + hi)
}

function stepParallel(u0, v0, dir, a) {
  const p0 = surf(u0, v0, [0, 0, 0])
  const d = (v) => {
    const p = surf(u0, v, [0, 0, 0])
    return Math.hypot(p[0] - p0[0], p[1] - p0[1], p[2] - p0[2]) - a
  }
  const r = Math.max(A(u0), B(u0))
  let lo = v0, hi = v0 + dir * (a / r) * 3
  let k = 0
  while (d(hi) < 0 && k++ < 40) hi += dir * (a / r)
  for (let it = 0; it < 60; it++) {
    const m = 0.5 * (lo + hi)
    if (d(m) < 0) lo = m; else hi = m
  }
  return 0.5 * (lo + hi)
}

// ── 内側の節点：2球と面の交点（＝コンパスを2回置く） ─────────────────
// 未知数は (u,v) の2つ、式も2つ。前の目の平行四辺形を初期値にすると
// 2つある根のうち「対角の親から遠いほう」が自動的に選ばれる。
const _p = [0, 0, 0], _su = [0, 0, 0], _sv = [0, 0, 0]
function solveNode(gu, gv, ax, ay, az, bx, by, bz, a2) {
  let u = gu, v = gv
  for (let it = 0; it < 12; it++) {
    surf(u, v, _p); surfU(u, v, _su); surfV(u, v, _sv)
    const dax = _p[0] - ax, day = _p[1] - ay, daz = _p[2] - az
    const dbx = _p[0] - bx, dby = _p[1] - by, dbz = _p[2] - bz
    const r1 = dax * dax + day * day + daz * daz - a2
    const r2 = dbx * dbx + dby * dby + dbz * dbz - a2
    const j11 = 2 * (dax * _su[0] + day * _su[1] + daz * _su[2])
    const j12 = 2 * (dax * _sv[0] + day * _sv[1] + daz * _sv[2])
    const j21 = 2 * (dbx * _su[0] + dby * _su[1] + dbz * _su[2])
    const j22 = 2 * (dbx * _sv[0] + dby * _sv[1] + dbz * _sv[2])
    const det = j11 * j22 - j12 * j21
    if (!(Math.abs(det) > 1e-14)) return null
    const du = (j22 * r1 - j12 * r2) / det
    const dv = (-j21 * r1 + j11 * r2) / det
    u -= du; v -= dv
    if (u < UMIN || u > UMAX) return null
    if (Math.abs(du) + Math.abs(dv) < 1e-13) break
  }
  surf(u, v, _p)
  const e1 = Math.hypot(_p[0] - ax, _p[1] - ay, _p[2] - az) - Math.sqrt(a2)
  const e2 = Math.hypot(_p[0] - bx, _p[1] - by, _p[2] - bz) - Math.sqrt(a2)
  if (Math.abs(e1) > 1e-7 || Math.abs(e2) > 1e-7) return null
  return [u, v]
}

function place(i, j, u, v) {
  const n = idx(i, j)
  surf(u, v, _p)
  raw[n * 3] = _p[0]; raw[n * 3 + 1] = _p[1]; raw[n * 3 + 2] = _p[2]
  normalAt(u, v, _su)
  pos[n * 3] = _p[0] + CLOTH_LIFT * _su[0]
  pos[n * 3 + 1] = _p[1] + CLOTH_LIFT * _su[1]
  pos[n * 3 + 2] = _p[2] + CLOTH_LIFT * _su[2]
  par[n * 2] = u; par[n * 2 + 1] = v
  alive[n] = 1
}

const CELLS = (2 * NW) * (2 * NJ)
const cellOK = new Uint8Array(CELLS)
const reach = new Uint8Array(CELLS)
const stack = new Int32Array(CELLS * 2 + 8)
const DI = [1, -1, 0, 0]
const DJ = [0, 0, 1, -1]
const cidx = (i, j) => (i + NW) * (2 * NJ) + (j + NJ)
export { reach, cidx }

// ── 1フレーム分の作図。戻り値は「測った数」だけ。 ─────────────────────
export function drape(u0) {
  const a = A_SPACING, a2 = a * a
  alive.fill(0)

  // 軸1：中心前（地の目 / grain line）
  place(0, 0, u0, 0)
  for (const dir of [1, -1]) {
    let u = u0
    for (let k = 1; k <= NW; k++) {
      const nu = stepMeridian(u, dir, a)
      if (nu === null) break
      place(dir * k, 0, nu, 0)
      u = nu
    }
  }
  // 軸2：バストライン（横地 / cross-grain）
  for (const dir of [1, -1]) {
    let v = 0
    for (let k = 1; k <= NJ; k++) {
      const nv = stepParallel(u0, v, dir, a)
      if (nv === null) break
      place(0, dir * k, u0, nv)
      v = nv
    }
  }

  // 4つの象限を埋める
  let maxEdgeErr = 0
  for (const si of [1, -1]) {
    for (const sj of [1, -1]) {
      for (let ai = 1; ai <= NW; ai++) {
        for (let aj = 1; aj <= NJ; aj++) {
          const i = si * ai, j = sj * aj
          const nA = idx(i - si, j), nB = idx(i, j - sj), nC = idx(i - si, j - sj)
          if (!alive[nA] || !alive[nB] || !alive[nC]) continue
          const gu = par[nA * 2] + par[nB * 2] - par[nC * 2]
          const gv = par[nA * 2 + 1] + par[nB * 2 + 1] - par[nC * 2 + 1]
          const r = solveNode(
            gu, gv,
            raw[nA * 3], raw[nA * 3 + 1], raw[nA * 3 + 2],
            raw[nB * 3], raw[nB * 3 + 1], raw[nB * 3 + 2],
            a2
          )
          if (!r) continue
          place(i, j, r[0], r[1])
          const n = idx(i, j)
          for (const m of [nA, nB]) {
            const e = Math.hypot(
              raw[n * 3] - raw[m * 3],
              raw[n * 3 + 1] - raw[m * 3 + 1],
              raw[n * 3 + 2] - raw[m * 3 + 2]
            )
            maxEdgeErr = Math.max(maxEdgeErr, Math.abs(e - a))
          }
        }
      }
    }
  }

  // ω：各節点で「経糸方向の辺」と「緯糸方向の辺」のなす角
  omega.fill(NaN)
  for (let i = -NW; i < NW; i++) {
    for (let j = -NJ; j < NJ; j++) {
      const n = idx(i, j), nI = idx(i + 1, j), nJ2 = idx(i, j + 1)
      if (!alive[n] || !alive[nI] || !alive[nJ2]) continue
      const ux = raw[nI * 3] - raw[n * 3], uy = raw[nI * 3 + 1] - raw[n * 3 + 1], uz = raw[nI * 3 + 2] - raw[n * 3 + 2]
      const vx = raw[nJ2 * 3] - raw[n * 3], vy = raw[nJ2 * 3 + 1] - raw[n * 3 + 1], vz = raw[nJ2 * 3 + 2] - raw[n * 3 + 2]
      const d = (ux * vx + uy * vy + uz * vz) / (Math.hypot(ux, uy, uz) * Math.hypot(vx, vy, vz))
      omega[n] = Math.acos(Math.max(-1, Math.min(1, d)))
    }
  }

  // 目（セル）の生死。① 4隅が生きている ② せん断が lock を超えていない
  // 布は繋がっていないと存在できないので、原点の目から連結成分だけを取る。
  const CW = 2 * NW, CH = 2 * NJ
  cellOK.fill(0)
  let lockedCount = 0, okCount = 0
  for (let i = -NW; i < NW; i++) {
    for (let j = -NJ; j < NJ; j++) {
      const n = idx(i, j)
      if (!alive[n] || !alive[idx(i + 1, j)] || !alive[idx(i, j + 1)] || !alive[idx(i + 1, j + 1)]) continue
      const w = omega[n]
      if (!Number.isFinite(w)) continue
      okCount++
      if (Math.abs(w - Math.PI / 2) > SHEAR_LOCK) { lockedCount++; continue }
      cellOK[cidx(i, j)] = 1
    }
  }

  // 原点から連結成分を取る（4近傍）
  reach.fill(0)
  let sp = 0
  if (cellOK[cidx(0, 0)]) { reach[cidx(0, 0)] = 1; stack[sp++] = 0; stack[sp++] = 0 }
  while (sp) {
    const j = stack[--sp], i = stack[--sp]
    for (let d = 0; d < 4; d++) {
      const ni = i + DI[d], nj = j + DJ[d]
      if (ni < -NW || ni >= NW || nj < -NJ || nj >= NJ) continue
      const c = cidx(ni, nj)
      if (reach[c] || !cellOK[c]) continue
      reach[c] = 1
      stack[sp++] = ni; stack[sp++] = nj
    }
  }

  // 届いた範囲での最大せん断と、その外側で最初に止まった帯（＝ダーツの位置）
  let maxShear = 0, covered = 0
  for (let i = -NW; i < NW; i++) {
    for (let j = -NJ; j < NJ; j++) {
      if (!reach[cidx(i, j)]) continue
      covered++
      maxShear = Math.max(maxShear, Math.abs(omega[idx(i, j)] - Math.PI / 2))
    }
  }

  return { CW, CH, maxEdgeErr, maxShear, covered, okCount, lockedCount }
}

// ── 検算：∫∫K dA を「四隅の角」だけで言い当てられるか ────────────────
// sine-Gordon ∂²ω/∂u∂v = −K sin ω を格子1つぶん積分すると
//   ∫∫K dA = ω(M,0) + ω(0,N) − ω(0,0) − ω(M,N)
// になる。左辺は面の曲率（布を1枚も知らない量）、右辺は網の四隅の角だけ。
// 一致したら、この rig は sine-Gordon を一行も書かずに解いていることになる。
export function gaussBonnet() {
  // ++ 象限のなかで四隅まで生きている最大の矩形を自分で探す（u0 が動くと
  // 届く範囲が変わるので、検算の窓も一緒に動かさないと null しか返らない）
  // 窓は首から下（u ≤ 1.00）に限る。首では A(u) が 0.09 まで細るので
  // 糸の間隔 a=0.033 に対して a/R ≈ 0.37 ＝ 面の曲がりに対して網が粗すぎ、
  // 左辺の求積誤差だけで検算が 200% ずれる（実測）。検算の限界であって
  // 恒等式の限界ではないので、窓のほうを曲率に見合う所へ寄せる。
  let M = 0, N = 0
  outer: for (let m = Math.min(NW - 1, 18); m >= 5; m--) {
    for (let n = Math.min(NJ - 1, 18); n >= 5; n--) {
      let ok = true
      for (let i = 0; i <= m && ok; i++)
        for (let j = 0; j <= n && ok; j++) {
          const q = idx(i, j)
          if (!alive[q] || !Number.isFinite(omega[q]) || par[q * 2] > 1.0) ok = false
        }
      if (ok) { M = m; N = n; break outer }
    }
  }
  if (!M) return null
  let lhs = 0
  for (let i = 0; i < M; i++) {
    for (let j = 0; j < N; j++) {
      // 目の4隅で平均する（左下1点の抜き取りだと誤差が O(a) 残って
      // 首まわりのように K が速く変わる所で検算が意味を失う）
      let K = 0, sw = 0
      for (const [di, dj] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const m = idx(i + di, j + dj)
        K += gaussK(par[m * 2], par[m * 2 + 1])
        sw += Number.isFinite(omega[m]) ? Math.sin(omega[m]) : Math.sin(omega[idx(i, j)])
      }
      lhs += (K / 4) * A_SPACING * A_SPACING * (sw / 4)
    }
  }
  const w = (i, j) => omega[idx(i, j)]
  const rhs = w(M, 0) + w(0, N) - w(0, 0) - w(M, N)
  return { lhs, rhs, M, N }
}
