// rig.js — Day 049 · 渦芯 (vortex spine)
//
// 再現元: 株式会社OASIZ https://oasiz.org/
//   白に近い地 #F4F4F4 に、蛍光グリーン #00F04B のパーティクルが渦を1つだけ描く。
//   線は緑〜シアン〜黄のグラデーション。地は色を持たない。
//
// 再現するのは「渦が1つある」ことではなく、**渦の芯**。
// 渦らしさは回転そのものではなく、接線速度が芯半径 rc で折り返すことから出る:
//
//   Lamb–Oseen:  vθ(r) = (Γ / 2πr) · (1 − exp(−r²/rc²))
//
//   r ≪ rc  →  vθ ∝ r          剛体回転。芯の中では「渦」が見えない（模様が動かない）
//   r ＝ rc →  vθ が最大        ここが尾のいちばん伸びる輪
//   r ≫ rc  →  vθ ∝ 1/r        外は差動回転。腕が巻かれて螺旋になるのはここ
//
// だから「渦」は一様な回転では出ない。速度が折り返す半径が要る。
// この rig はその1本の式と、それを見えるようにする尾（14点の履歴）だけでできている。
//
// three.js に依存しない。Scene.jsx が返り値のバッファをそのまま attribute に流す。

// ── 見た目の定数 ────────────────────────────────────────────────────────
export const GROUND = [0.957, 0.957, 0.957] // #F4F4F4 — 尾はこの色へ溶けて消える

// 緑 → シアン → 黄。速さで引く（遅い外周が緑、芯へ落ちて速くなるほど黄）
const RAMP = [
  [0.0, [0.0, 0.941, 0.294]], // #00F04B
  [0.72, [0.0, 0.816, 0.941]], // #00D0F0
  [1.0, [0.941, 0.878, 0.0]], // #F0E000
]

export const RC_PRESETS = [0.3, 0.62, 1.1] // 1 / 2 / 3 キー

// ── 場のパラメータ ──────────────────────────────────────────────────────
export const PARAMS = {
  gamma: 13.5, // 循環 Γ — 小さいと外周が回らず、吸い込みだけが残って「放射状の雨」になる
  inflow: 0.9, // 半径方向の吸い込み（強すぎると腕が巻かれる前に芯へ着く）
  updraft: 0.22, // 芯の上昇流（大きいと竜巻の煙突になる。渦盤にしたいので浅く）
  sink: 0.03, // 芯の外のゆるい沈降
  eddy: 0.13, // 定在渦（軸対称を壊す揺らぎ）の振幅
  spawnR: [1.05, 2.25], // 供給リング
  spawnY: [-0.26, 0.26],
  killY: 0.52,
  killR: 0.19, // 芯に詰まると団子になるので、早めに抜く
  life: 13.0,
  arms: 5, // 供給する筋の本数
  armSpin: 0.32, // 供給角がゆっくり回る速さ（筋の入り口が動く）
  armSpread: 0.5, // 1本の筋の角の広がり
  speedRange: [0.3, 3.4], // 色を引く速さの範囲
  colorGamma: 2.6, // 色は速さの非線形写像。ほとんどを緑に残し、芯だけシアン→黄へ振る
  histDt: 1 / 34, // 履歴を刻む間隔（フレームレートに依らせない）
}

// ── 接線速度（この1行が今日の装置） ─────────────────────────────────────
export function vTheta(r, rc, gamma = PARAMS.gamma) {
  if (r < 1e-4) return 0
  return (gamma / (2 * Math.PI * r)) * (1 - Math.exp(-(r * r) / (rc * rc)))
}

function ramp(t, out) {
  const u = t < 0 ? 0 : t > 1 ? 1 : t
  let i = 0
  while (i < RAMP.length - 2 && u > RAMP[i + 1][0]) i++
  const [a, ca] = RAMP[i]
  const [b, cb] = RAMP[i + 1]
  const f = (u - a) / (b - a)
  out[0] = ca[0] + (cb[0] - ca[0]) * f
  out[1] = ca[1] + (cb[1] - ca[1]) * f
  out[2] = ca[2] + (cb[2] - ca[2]) * f
  return out
}

// ── 渦のリグ ────────────────────────────────────────────────────────────
// count 個の粒を進め、1粒あたり trail 点の履歴から (trail-1) 本の線分を毎フレーム引き直す。
// 履歴はリングバッファ。再供給のときは全スロットを新しい座標で埋める
// （埋めないと、外周から画面を横切る1本の長い線が飛ぶ）。
export function createVortexRig({ count = 1700, trail = 24 } = {}) {
  const P = PARAMS
  const segs = trail - 1
  const pos = new Float32Array(count * 3)
  const vel = new Float32Array(count * 3)
  const age = new Float32Array(count)
  const hist = new Float32Array(count * trail * 3)
  const head = new Int32Array(1) // リングの書き込み位置（全粒で共有）

  const linePos = new Float32Array(count * segs * 2 * 3)
  const lineCol = new Float32Array(count * segs * 2 * 3)
  const headPos = new Float32Array(count * 3)
  const headCol = new Float32Array(count * 3)

  const core = { x: 0, z: 0 } // 芯の位置（ポインタで動く）
  const c = [0, 0, 0]
  const fade = new Float32Array(segs + 1)
  for (let k = 0; k <= segs; k++) fade[k] = Math.pow(1 - k / segs, 0.45) // 頭の側を長く濃く保つ

  let seed = 0x9e3779b9
  const rnd = () => {
    seed ^= seed << 13
    seed ^= seed >>> 17
    seed ^= seed << 5
    return ((seed >>> 0) % 100000) / 100000
  }

  let time = 0

  // 供給は一様ではなく ARMS 本の筋から入れる。一様に撒くと、差動回転が働いても
  // 密度が一様なままで腕が見えない（渦は「回っている」だけでは絵にならない）。
  // 入れる角度をゆっくり回すと、筋が芯へ落ちながら巻かれて螺旋になる。
  function spawn(i, initial) {
    const [r0, r1] = P.spawnR
    const r = initial
      ? Math.sqrt(0.06 + rnd() * (r1 * r1 - 0.06))
      : Math.sqrt(r0 * r0 + rnd() * (r1 * r1 - r0 * r0))
    const th = initial
      ? rnd() * Math.PI * 2
      : (i % P.arms) * ((Math.PI * 2) / P.arms) + time * P.armSpin + (rnd() - 0.5) * P.armSpread
    const y = P.spawnY[0] + rnd() * (P.spawnY[1] - P.spawnY[0])
    const x = Math.cos(th) * r
    const z = Math.sin(th) * r
    pos[i * 3] = x
    pos[i * 3 + 1] = y
    pos[i * 3 + 2] = z
    vel[i * 3] = vel[i * 3 + 1] = vel[i * 3 + 2] = 0
    age[i] = initial ? rnd() * P.life : 0
    // 履歴を潰す = 尾を1点に畳む（潰さないと、外周から画面を横切る線が1本飛ぶ）
    for (let k = 0; k < trail; k++) {
      const h = (i * trail + k) * 3
      hist[h] = x
      hist[h + 1] = y
      hist[h + 2] = z
    }
  }
  for (let i = 0; i < count; i++) spawn(i, true)

  let histAcc = 1e9 // 初回は必ず刻む

  function step(dt, { rc = 0.62, pointer = [0, 0], tails = true } = {}) {
    // headless の virtual time では dt が信用できない（0 に潰れる／跳ねる）。
    // 尾の長さと巻きの量は dt に直結するので、外れ値は固定ステップに落とす。
    // これを入れる前は、11.9秒の撮影で渦がほとんど発達していない1枚が撮れていた。
    const d = dt > 0.002 && dt < 0.1 ? dt : 1 / 60
    time += d
    // 尾の長さがフレームレートで変わらないように、履歴は実時間で刻む
    histAcc += d
    const tick = histAcc >= P.histDt
    if (tick) histAcc = 0

    // 芯はポインタへゆっくり寄る（渦の位置が入力で動く。回転そのものは触らない）
    core.x += (pointer[0] * 0.85 - core.x) * Math.min(1, d * 1.6)
    core.z += (-pointer[1] * 0.5 - core.z) * Math.min(1, d * 1.6)

    // 定在渦（軸対称を壊す3本の正弦）。curl ノイズの安い代用。
    const t1 = time * 0.9
    const t2 = time * 0.7
    const t3 = time * 0.6

    if (tick) head[0] = (head[0] + 1) % trail
    const h0 = head[0]
    const [s0, s1] = P.speedRange
    const invS = 1 / (s1 - s0)

    for (let i = 0; i < count; i++) {
      const p = i * 3
      const dx = pos[p] - core.x
      const dz = pos[p + 2] - core.z
      const y = pos[p + 1]
      const r = Math.hypot(dx, dz) || 1e-4

      // 接線 — 今日の装置
      const vt = vTheta(r, rc)
      let vx = (-dz / r) * vt
      let vz = (dx / r) * vt

      // 半径方向の吸い込み（外ほど効く。芯では止まる）
      const inflow = (-P.inflow * r) / (1 + r * r)
      vx += (dx / r) * inflow
      vz += (dz / r) * inflow

      // 芯の上昇流 — 落ちきった粒はここから上へ抜ける
      const g = Math.exp(-(r * r) / (2.56 * rc * rc))
      let vy = P.updraft * g - P.sink

      // 定在渦
      vx += P.eddy * Math.sin(1.7 * y + t1) * Math.cos(0.8 * dz)
      vz += P.eddy * Math.cos(1.3 * y + t2) * Math.sin(1.1 * dx)
      vy += P.eddy * 0.45 * Math.sin(0.9 * dx - t3)

      pos[p] += vx * d
      pos[p + 1] += vy * d
      pos[p + 2] += vz * d
      vel[p] = vx
      vel[p + 1] = vy
      vel[p + 2] = vz
      age[i] += d

      if (pos[p + 1] > P.killY || r < P.killR || age[i] > P.life) {
        spawn(i, false)
        continue
      }

      if (tick) {
        const hi = (i * trail + h0) * 3
        hist[hi] = pos[p]
        hist[hi + 1] = pos[p + 1]
        hist[hi + 2] = pos[p + 2]
      }
    }

    // 尾を引き直す（履歴が動いたときだけ。頭は毎フレーム動かす）
    for (let i = 0; i < count; i++) {
      const p = i * 3
      const sp = Math.hypot(vel[p], vel[p + 1], vel[p + 2])
      ramp(Math.pow(Math.max(0, Math.min(1, (sp - s0) * invS)), P.colorGamma), c)
      headPos[p] = pos[p]
      headPos[p + 1] = pos[p + 1]
      headPos[p + 2] = pos[p + 2]
      headCol[p] = c[0]
      headCol[p + 1] = c[1]
      headCol[p + 2] = c[2]

      if (!tick || !tails) continue
      for (let k = 0; k < segs; k++) {
        const a = (i * trail + ((h0 - k + trail) % trail)) * 3
        const b = (i * trail + ((h0 - k - 1 + trail) % trail)) * 3
        const o = (i * segs + k) * 6
        linePos[o] = hist[a]
        linePos[o + 1] = hist[a + 1]
        linePos[o + 2] = hist[a + 2]
        linePos[o + 3] = hist[b]
        linePos[o + 4] = hist[b + 1]
        linePos[o + 5] = hist[b + 2]
        const fa = fade[k]
        const fb = fade[k + 1]
        lineCol[o] = GROUND[0] + (c[0] - GROUND[0]) * fa
        lineCol[o + 1] = GROUND[1] + (c[1] - GROUND[1]) * fa
        lineCol[o + 2] = GROUND[2] + (c[2] - GROUND[2]) * fa
        lineCol[o + 3] = GROUND[0] + (c[0] - GROUND[0]) * fb
        lineCol[o + 4] = GROUND[1] + (c[1] - GROUND[1]) * fb
        lineCol[o + 5] = GROUND[2] + (c[2] - GROUND[2]) * fb
      }
    }
    return core
  }

  // 起動直後の1枚が「まだ発達していない渦」にならないように、
  // 尾の張り直しを飛ばして場だけ回しておく（撮影も初見も、育った渦から始まる）。
  function warm(seconds, rc) {
    const n = Math.round(seconds * 60)
    for (let i = 0; i < n; i++) step(1 / 60, { rc, tails: false })
  }

  return { count, trail, segs, linePos, lineCol, headPos, headCol, step, warm, core }
}

// 芯半径の輪（rc をそのまま画面に置く。数字ではなく輪で見せる）
export function coreRing(rc, n = 160) {
  const a = new Float32Array((n + 1) * 3)
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI * 2
    a[i * 3] = Math.cos(t) * rc
    a[i * 3 + 1] = 0
    a[i * 3 + 2] = Math.sin(t) * rc
  }
  return a
}
