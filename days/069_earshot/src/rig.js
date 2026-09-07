// Day 069 — 聞こえる距離（the hearing radius）
//
// 再現元 The Vanishing Song / honeyeater.org（豪州国立大学 × タロンガ動物園）。
// 主題は「歌が消えていく」。ただしこの装置は、鳥から歌を引き算しない。
// 鳥は1羽も減らないし、位置も動かないし、学習の規則も最後まで同じ1本。
// 変わるのは **誰の声が誰に届くか** だけ——半径 r ひとつ。
//
// 書いてあるのは3つだけ:
//   ① 集団       150個の点（2021年に野生に残っていた雄の数）。位置は固定。
//   ② 聞こえる辺 |xi − xj| < r の対にだけ辺を張る。これが「歌の通り道」。
//   ③ 学習       毎ステップ、聞こえる相手の**円周平均**へ寄せる。＋自分の癖 bias[i]。
//
// 「地域の規範」「方言」「別の種の歌」と書いた行は1行も無い。それでも r を
// 下げると、規範は割れて、いくつかは黙る。割っているのは鳥ではなく
// **グラフの連結成分**で、規範が保たれていたのは集団が自分の誤差を
// 平均できるほど大きかったからにすぎない（bias の平均は N が大きいほど 0 に近い）。
//
// 実測の的（Crates et al. 2021, Proc. R. Soc. B / Sci. Rep.）:
//   野生の雄 ≈150羽 ／ 27% が地域の規範と違う歌 ／ 12% は自種の歌を1つも歌えず
//   他種の歌を歌う（＝密度が特に低い場所の個体）。
//   この3つの数字に当たるように r を置いた。

export const N_MALES = 150 // 2021年に野生に残っていた雄の推定数
const STEPS = 240 // 1つの r につき必ずこの回数だけ回す（rAF の回数に依存させない）
const LEARN = 0.34 // 聞いた平均へ寄る率
const BIAS = 0.0045 // 写し取りの癖。1羽ぶんの誤差（この値と r=2.60 で 27% ＼ 12% に当たる）
const FOREIGN = 0.055 // 誰も聞こえない個体が隣の別種へ引かれる率
const TOL = 0.45 // 「規範と同じ歌」と見なす角度差（rad, ≈26°）

function mulberry32(a) {
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function gauss(rnd) {
  // Box–Muller。群れは一様には散らない——散らばり方が壊れ方を決めるので、
  // ここだけは実物に寄せて塊で置く（箱型ユーカリ林の残存パッチ）。
  const u = Math.max(1e-9, rnd())
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd())
}

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a))

// ── ① 集団 ─────────────────────────────────────────────────────────────
// 位置・癖・隣の別種の歌。ここから先、この3つは一度も書き換えない。
export function buildPopulation() {
  const rnd = mulberry32(0x5eed19)
  const pos = new Float32Array(N_MALES * 3)
  const bias = new Float32Array(N_MALES)
  const foreign = new Float32Array(N_MALES)

  // 9つの残存パッチ + はぐれ。パッチの大きさは揃えない。
  const clumps = []
  for (let c = 0; c < 9; c++) {
    clumps.push({
      x: (rnd() - 0.5) * 54,
      z: (rnd() - 0.5) * 34,
      s: 1.5 + rnd() * 2.8,
      w: 0.4 + rnd(),
    })
  }
  const wsum = clumps.reduce((a, c) => a + c.w, 0)

  for (let i = 0; i < N_MALES; i++) {
    let x, z
    if (rnd() < 0.17) {
      // はぐれ個体。これが 12% を作るのではなく、r が下がったとき最初に
      // 切れるのがここ、というだけ。
      x = (rnd() - 0.5) * 66
      z = (rnd() - 0.5) * 42
    } else {
      let pick = rnd() * wsum
      let c = clumps[0]
      for (const k of clumps) {
        pick -= k.w
        if (pick <= 0) {
          c = k
          break
        }
      }
      x = c.x + gauss(rnd) * c.s
      z = c.z + gauss(rnd) * c.s
    }
    x = Math.max(-36, Math.min(36, x))
    z = Math.max(-23, Math.min(23, z))
    // 樹冠。高さは歌に関与しない（届く／届かないは水平距離だけで決める）が、
    // 起伏が無いと辺がただの平面図になって、これが森だと分からない。
    const y = 1.0 + 4.4 * (0.5 + 0.5 * Math.sin(x * 0.21) * Math.cos(z * 0.27)) + rnd() * 1.1

    pos[i * 3] = x
    pos[i * 3 + 1] = y
    pos[i * 3 + 2] = z
    bias[i] = gauss(rnd) // 写し取りの癖（＝1羽ぶんの誤差）
    foreign[i] = wrap(rnd() * Math.PI * 2) // 隣に住んでいる別種の歌
  }
  return { pos, bias, foreign }
}

// ── ② 聞こえる辺 ────────────────────────────────────────────────────────
function audible(pop, r) {
  const { pos } = pop
  const r2 = r * r
  const deg = new Int32Array(N_MALES)
  const head = new Int32Array(N_MALES).fill(-1)
  const nextIdx = []
  const nbr = []
  const pairs = []
  for (let i = 0; i < N_MALES; i++) {
    for (let j = i + 1; j < N_MALES; j++) {
      const dx = pos[i * 3] - pos[j * 3]
      const dz = pos[i * 3 + 2] - pos[j * 3 + 2]
      if (dx * dx + dz * dz > r2) continue
      pairs.push(i, j)
      deg[i]++
      deg[j]++
      nbr.push(j)
      nextIdx.push(head[i])
      head[i] = nbr.length - 1
      nbr.push(i)
      nextIdx.push(head[j])
      head[j] = nbr.length - 1
    }
  }
  return { pairs, deg, head, nbr, nextIdx }
}

function components(pairs) {
  const parent = new Int32Array(N_MALES)
  for (let i = 0; i < N_MALES; i++) parent[i] = i
  const find = (a) => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]]
      a = parent[a]
    }
    return a
  }
  for (let k = 0; k < pairs.length; k += 2) {
    const a = find(pairs[k])
    const b = find(pairs[k + 1])
    if (a !== b) parent[a] = b
  }
  const comp = new Int32Array(N_MALES)
  const sizes = new Map()
  for (let i = 0; i < N_MALES; i++) {
    const root = find(i)
    comp[i] = root
    sizes.set(root, (sizes.get(root) || 0) + 1)
  }
  return { comp, sizes }
}

// ── ③ 学習 ──────────────────────────────────────────────────────────────
// r ごとに毎回 θ0 から STEPS 回。時間ではなく回数で回すので、同じ r なら
// 何度撮っても同じ絵になる（Day 067 で rAF 依存の自動送りに刺された）。
export function simulate(pop, r) {
  const { bias, foreign } = pop
  const { pairs, deg, head, nbr, nextIdx } = audible(pop, r)
  const theta = new Float64Array(N_MALES) // 全員が同じ1つの歌から始める
  const next = new Float64Array(N_MALES)

  for (let s = 0; s < STEPS; s++) {
    for (let i = 0; i < N_MALES; i++) {
      if (deg[i] === 0) {
        // 誰も聞こえない。癖は平均されず、隣の別種の歌に引かれていく。
        next[i] = wrap(theta[i] + BIAS * bias[i] * 6 + FOREIGN * wrap(foreign[i] - theta[i]))
        continue
      }
      let sc = Math.cos(theta[i])
      let ss = Math.sin(theta[i])
      for (let e = head[i]; e !== -1; e = nextIdx[e]) {
        const j = nbr[e]
        sc += Math.cos(theta[j])
        ss += Math.sin(theta[j])
      }
      const mean = Math.atan2(ss, sc)
      next[i] = wrap(theta[i] + LEARN * wrap(mean - theta[i]) + BIAS * bias[i])
    }
    theta.set(next)
  }

  // 「地域の規範」は最大の連結成分の円周平均。定義を外から与えていない
  // ——いちばん大きな塊が持っている歌が規範、というだけ。
  const { comp, sizes } = components(pairs)
  let biggest = -1
  let bigN = 0
  for (const [root, n] of sizes) if (n > bigN) ((bigN = n), (biggest = root))
  let nc = 0
  let ns = 0
  for (let i = 0; i < N_MALES; i++) {
    if (comp[i] !== biggest) continue
    nc += Math.cos(theta[i])
    ns += Math.sin(theta[i])
  }
  const norm = Math.atan2(ns, nc)

  // 0 = 規範を歌う / 1 = 規範から外れた歌 / 2 = 自種の歌を1つも歌えない
  const cls = new Uint8Array(N_MALES)
  let atypical = 0
  let mute = 0
  for (let i = 0; i < N_MALES; i++) {
    if (deg[i] === 0) {
      cls[i] = 2
      mute++
      atypical++
    } else if (Math.abs(wrap(theta[i] - norm)) > TOL) {
      cls[i] = 1
      atypical++
    }
  }

  return {
    theta,
    deg,
    cls,
    pairs,
    comp,
    norm,
    stats: {
      r,
      edges: pairs.length / 2,
      components: sizes.size,
      largest: bigN,
      atypical,
      mute,
      normSingers: N_MALES - atypical,
      atypicalPct: (100 * atypical) / N_MALES,
      mutePct: (100 * mute) / N_MALES,
    },
  }
}

// ── 描くもの ────────────────────────────────────────────────────────────
// 歌は「向き」で出す。長さでも色相でもなく向きにしたのは、揃っているか
// どうかが一目で分かるのが向きだけだから。
//
// 色は呼び出し側（Scene.jsx）から線形の三つ組で渡してもらう。ここで sRGB の
// 数値を直接置くと、ShaderMaterial には three が色空間変換を挿してくれない
// ので二重変換になる（Day 068 でこれをやって地が #18103F ではなく #02010d で出た）。

export function buildMarks(pop, sim, PALETTE) {
  const { pos } = pop
  const { theta, cls } = sim
  const positions = new Float32Array(N_MALES * 6 * 3)
  const colors = new Float32Array(N_MALES * 6 * 3)
  let p = 0
  let c = 0
  for (let i = 0; i < N_MALES; i++) {
    const x = pos[i * 3]
    const y = pos[i * 3 + 1]
    const z = pos[i * 3 + 2]
    // 自種の歌を歌えない個体だけ短い。歌が短いのではなく、
    // 「これは彼の歌ではない」と言うために形を1段だけ落としている。
    const len = (cls[i] === 2 ? 1.05 : 1.9) * 0.5
    const wid = 0.145
    const ct = Math.cos(theta[i])
    const st = Math.sin(theta[i])
    // 帯は水平面に寝かせる。長辺 = 歌の向き、短辺 = その直交。
    const ax = ct * len
    const az = st * len
    const bx = -st * wid
    const bz = ct * wid
    const q = [
      [x - ax + bx, z - az + bz],
      [x + ax + bx, z + az + bz],
      [x + ax - bx, z + az - bz],
      [x - ax - bx, z - az - bz],
    ]
    const tri = [0, 1, 2, 0, 2, 3]
    const col = cls[i] === 0 ? PALETTE.norm : cls[i] === 1 ? PALETTE.drift : PALETTE.lost
    for (const k of tri) {
      positions[p++] = q[k][0]
      positions[p++] = y
      positions[p++] = q[k][1]
      colors[c++] = col[0]
      colors[c++] = col[1]
      colors[c++] = col[2]
    }
  }
  return { positions, colors }
}

// 樹。地から樹冠の各個体まで1本ずつ。歌にも聞こえる距離にも関与しない——
// 高さを目に見せるためだけの線で、これが無いと俯瞰が平面図になる。
export function buildStems(pop) {
  const { pos } = pop
  const positions = new Float32Array(N_MALES * 2 * 3)
  for (let i = 0; i < N_MALES; i++) {
    positions[i * 6] = pos[i * 3]
    positions[i * 6 + 1] = 0
    positions[i * 6 + 2] = pos[i * 3 + 2]
    positions[i * 6 + 3] = pos[i * 3]
    positions[i * 6 + 4] = pos[i * 3 + 1] - 0.06
    positions[i * 6 + 5] = pos[i * 3 + 2]
  }
  return positions
}

export function buildEdges(pop, sim, PALETTE) {
  const { pos } = pop
  const { pairs, cls } = sim
  const n = pairs.length / 2
  const positions = new Float32Array(n * 2 * 3)
  const colors = new Float32Array(n * 2 * 3)
  const aT = new Float32Array(n * 2)
  const aSeed = new Float32Array(n * 2)
  for (let k = 0; k < n; k++) {
    const i = pairs[k * 2]
    const j = pairs[k * 2 + 1]
    // 規範どうしを結ぶ辺だけが「歌の通り道」として色を持つ。
    const carries = cls[i] === 0 && cls[j] === 0
    const col = carries ? PALETTE.carry : PALETTE.wire
    for (let e = 0; e < 2; e++) {
      const s = e === 0 ? i : j
      positions[(k * 2 + e) * 3] = pos[s * 3]
      positions[(k * 2 + e) * 3 + 1] = pos[s * 3 + 1]
      positions[(k * 2 + e) * 3 + 2] = pos[s * 3 + 2]
      colors[(k * 2 + e) * 3] = col[0]
      colors[(k * 2 + e) * 3 + 1] = col[1]
      colors[(k * 2 + e) * 3 + 2] = col[2]
      aT[k * 2 + e] = e
      aSeed[k * 2 + e] = (k % 97) / 97
    }
  }
  return { positions, colors, aT, aSeed, count: n }
}

// スクロール t（0..1）→ 聞こえる半径 r。
// t=0  「かつてはどこにでもいた」＝ 群れは1つの声の届く範囲に収まっている
// t=1   2021年の野外＝ 27% が規範から外れ、12% は自種の歌を1つも歌えない
export const R_MAX = 15.5
export const R_MIN = 2.6
export const rFromT = (t) => R_MAX + (R_MIN - R_MAX) * Math.min(1, Math.max(0, t))
