// rig.js — Day 075
//
// 一つの装置しか書いていない：「サイコロを、盤の升目の上で、辺をまたいで倒す」。
// それだけ。ここには「向きを選ぶ」式も「どの面を上にする」式も一行も無い。
//
// にもかかわらず、閉じた道（出発した升へ必ず帰ってくる道）を歩かせると、
// 帰ってきたときの姿勢は 24 通りのうち 12 通りにしかならない。
// 残りの 12 通りは「出にくい」のではなく、出ない。20 万本の閉路で 0 回。
//
// 理由は一行で終わる：
//   閉じた道は +x と -x が同数、+z と -z が同数 → 倒した回数は必ず偶数。
//   倒す操作は 1 回ごとにサイコロの4本の体対角線を「奇置換」する。
//   偶数回の奇置換は偶置換。だからサイコロは自分の対称群の
//   「四面体側の半分」(A4) から出られない。
//
// 盤の広さにも、道の長さにも、囲んだ面積にも、道が自分と交差するかにも依らない。
// 効いているのは「歩数の偶奇」ひとつだけ。

// ── 倒す操作＝3x3 の整数行列 ───────────────────────────────────────────
// 立方体は辺 1、y = 0 の盤の上に座っている（中心の高さは 0.5）。
// +x へ倒す = 軸 +z まわりに -90°。+z へ倒す = 軸 +x まわりに +90°。
export const DIRS = ['+x', '-x', '+z', '-z']

export const TIP = {
  '+x': [[0, 1, 0], [-1, 0, 0], [0, 0, 1]],
  '-x': [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
  '+z': [[1, 0, 0], [0, 0, -1], [0, 1, 0]],
  '-z': [[1, 0, 0], [0, 0, 1], [0, -1, 0]],
}

// 倒れる先の升。ピボットは進行方向の下の辺、回転軸はその辺に沿う。
export const MOVE = {
  '+x': { d: [1, 0], axis: [0, 0, -1], pivot: [0.5, 0] },
  '-x': { d: [-1, 0], axis: [0, 0, 1], pivot: [-0.5, 0] },
  '+z': { d: [0, 1], axis: [1, 0, 0], pivot: [0, 0.5] },
  '-z': { d: [0, -1], axis: [-1, 0, 0], pivot: [0, -0.5] },
}

const mul = (A, B) =>
  A.map((r) => [0, 1, 2].map((j) => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]))
const I3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
const key = (R) => R.flat().join(',')

// ── 24 通りの姿勢を、単位姿勢から倒し続けて数え上げる ──────────────────
// 一覧を手で書かない。倒す操作だけから閉じるところまで回して出す。
// （出てくる個数が 24 であること自体が、盤の上の操作が立方体の回転群を
//   ぜんぶ生成しているという確認になる。半分しか出ないのは「帰ってきたとき」だけ。）
export const ORIENT = []
{
  const seen = new Map()
  const q = [I3]
  seen.set(key(I3), 0)
  ORIENT.push(I3)
  while (q.length) {
    const R = q.shift()
    for (const d of DIRS) {
      const N = mul(TIP[d], R)
      if (!seen.has(key(N))) {
        seen.set(key(N), ORIENT.length)
        ORIENT.push(N)
        q.push(N)
      }
    }
  }
  // 姿勢 i から d へ倒したときの行き先（遷移表）。以降の計算は全部これ1枚で済む。
  ORIENT.NEXT = ORIENT.map((R) => DIRS.map((d) => seen.get(key(mul(TIP[d], R)))))
}
export const NEXT = ORIENT.NEXT

// 単位姿勢から最短で何手倒せばその姿勢になるか（レールはこの順に並んでいる）。
// 層の大きさは 1 / 4 / 10 / 8 / 1。帰ってこられる 12 は偶数層 1+10+1 と
// ぴったり一致し、帰ってこられない 12 は奇数層 4+8 とぴったり一致する。
// レールの縞模様は飾りではなく、証明そのもの。
export const DEPTH = (() => {
  const d = new Array(ORIENT.length).fill(-1)
  d[0] = 0
  const q = [0]
  while (q.length) {
    const a = q.shift()
    for (let k = 0; k < 4; k++) {
      const b = NEXT[a][k]
      if (d[b] < 0) { d[b] = d[a] + 1; q.push(b) }
    }
  }
  return d
})()

// ── 体対角線の置換と、その偶奇 ─────────────────────────────────────────
// サイコロの 8 隅は 4 本の体対角線に 2 つずつ属する。姿勢を1つ決めるたびに
// その 4 本が入れ替わる。この置換の符号が、帰ってこられるかどうかを決める。
export const DIAG = [[1, 1, 1], [1, 1, -1], [1, -1, 1], [1, -1, -1]]

const applyM = (R, v) => [0, 1, 2].map((i) => R[i][0] * v[0] + R[i][1] * v[1] + R[i][2] * v[2])

export function diagPerm(R) {
  return DIAG.map((d) => {
    const w = applyM(R, d)
    return DIAG.findIndex((e) => e.every((c, i) => c === w[i]) || e.every((c, i) => c === -w[i]))
  })
}

function permSign(p) {
  let s = 1
  for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) if (p[i] > p[j]) s = -s
  return s
}

// 24 のうちどれが偶置換側（= 帰ってこられる 12）か
export const EVEN = ORIENT.map((R) => permSign(diagPerm(R)) === 1)

// 倒す操作それ自体は 4 方向とも奇置換。これが全部の根拠。
export const TIP_IS_ODD = DIRS.every((d) => permSign(diagPerm(TIP[d])) === -1)

// 世界座標の隅 c に来ているのは、体のどの対角線か（グリフの色分けに使う）
export function cornerDiag(R, c) {
  const b = [0, 1, 2].map((i) => R[0][i] * c[0] + R[1][i] * c[1] + R[2][i] * c[2]) // Rᵀc
  return DIAG.findIndex((e) => e.every((v, i) => v === b[i]) || e.every((v, i) => v === -b[i]))
}

// ── 盤と、その上の閉じた道 ─────────────────────────────────────────────
export const FIELD = { w: 6, h: 4, home: [2, 2] }

// 出発した升へ必ず帰ってくる道を1本引く。
// 自分と交差してよい。単純多角形である必要も、面積が整数である必要も無い。
// （この「何でもいい」が効いている。効いているのは歩数の偶奇だけなので。）
export function makeRoute(rand = Math.random) {
  const [hx, hz] = FIELD.home
  for (let attempt = 0; attempt < 60; attempt++) {
    let x = hx
    let z = hz
    const mv = []
    let last = null
    const n = 9 + ((rand() * 9) | 0)
    for (let i = 0; i < n; i++) {
      const cand = DIRS.filter((d) => {
        const nx = x + MOVE[d].d[0]
        const nz = z + MOVE[d].d[1]
        if (nx < 0 || nx >= FIELD.w || nz < 0 || nz >= FIELD.h) return false
        return d !== last // 来た道をすぐ戻ると絵にならない
      })
      const pool = cand.length ? cand : DIRS.filter((d) => {
        const nx = x + MOVE[d].d[0]
        const nz = z + MOVE[d].d[1]
        return nx >= 0 && nx < FIELD.w && nz >= 0 && nz < FIELD.h
      })
      const d = pool[(rand() * pool.length) | 0]
      mv.push(d)
      x += MOVE[d].d[0]
      z += MOVE[d].d[1]
      last = d === '+x' ? '-x' : d === '-x' ? '+x' : d === '+z' ? '-z' : '+z'
    }
    // 家まで戻す（ここも普通の一手ずつ。特別な操作は無い）
    while (x > hx) { mv.push('-x'); x-- }
    while (x < hx) { mv.push('+x'); x++ }
    while (z > hz) { mv.push('-z'); z-- }
    while (z < hz) { mv.push('+z'); z++ }
    if (mv.length >= 8) return mv
  }
  return ['+x', '+z', '-x', '-z']
}

// 道を升の列に開く（盤に刷るため）
export function routeCells(mv) {
  let [x, z] = FIELD.home
  const cells = [[x, z]]
  for (const d of mv) {
    x += MOVE[d].d[0]
    z += MOVE[d].d[1]
    cells.push([x, z])
  }
  return cells
}

// ── 国勢調査：閉路を大量に歩かせて、帰着姿勢を数える ───────────────────
// 描くより先に数える。絵が主張していることは、この表がそのまま言っていること。
export function census(routes = 20000, seed = 20260915) {
  let s = seed >>> 0
  const rand = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
  const tally = new Array(24).fill(0)
  let tips = 0
  for (let r = 0; r < routes; r++) {
    const mv = makeRoute(rand)
    let o = 0
    for (const d of mv) o = NEXT[o][DIRS.indexOf(d)]
    tally[o]++
    tips += mv.length
  }
  const reached = tally.filter((n) => n > 0).length
  return {
    routes,
    tips,
    tally,
    reached,
    never: 24 - reached,
    // 到達したものが本当に偶置換側と一致しているか（＝主張の検算）
    exactlyEvenHalf: tally.every((n, i) => (n > 0) === EVEN[i]),
  }
}
