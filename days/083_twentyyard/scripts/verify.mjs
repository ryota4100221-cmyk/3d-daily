// verify.mjs — NOTES に載せる数字を CPU float64 でその場で出す。
// 「装置が本当にそう言っているか」を、絵とは別の経路で1回だけ確かめる。
import { BALL, WALL, bendRadius, kick, zAtX, integrate, inkColumn } from '../src/rig.js'

const f = (x, n = 4) => x.toFixed(n)
const pct = (x, n = 2) => (100 * x).toFixed(n) + '%'
const deg = (r) => (r * 180) / Math.PI

const R = bendRadius(BALL)
console.log('■ 曲げ長さ R = 2m/(ρ A C_L)')
console.log(`  m=${BALL.m} kg  r=${BALL.r} m  ρ=${BALL.rho}  C_L=${BALL.CL}  →  R = ${f(R, 3)} m`)
console.log('  式に |v| も ω も入っていない。それがこの日ぜんぶの根っこ。\n')

console.log('■ 1. 形は蹴りの強さを覚えていない（抗力込みで積分）')
{
  const Lx = kick(R, 2 * WALL).Lx
  const ref = integrate({ v0: 26, L: Lx })
  let worst = 0
  let worstV = 0
  let tSlow = 0
  let tFast = 0
  for (const v0 of [16, 20, 24, 28, 32, 36]) {
    const g = integrate({ v0, L: Lx })
    let d = 0
    for (let i = 0; i < g.zs.length; i++) d = Math.max(d, Math.abs(g.zs[i] - ref.zs[i]))
    console.log(
      `    v0=${String(v0).padStart(2)} m/s   飛翔 ${f(g.t, 4)} s   着弾 z=${f(g.zs[g.zs.length - 1], 12)} m   |Δz|max=${d.toExponential(2)} m`
    )
    if (d > worst) { worst = d; worstV = v0 }
    if (v0 === 16) tSlow = g.t
    if (v0 === 36) tFast = g.t
  }
  console.log(`    → 蹴り出しを 16→36 m/s（${f(36 / 16, 2)}倍）振っても、軌跡のずれは最大 ${worst.toExponential(2)} m（v0=${worstV}）`)
  console.log(`      飛翔時間は ${f(tSlow, 3)} s → ${f(tFast, 3)} s（${f(tSlow / tFast, 2)}倍）動く。`)
  console.log('      動くのは「いつ」だけ。「どこ」は 1 nm も動かない（残りは RK4 の打ち切り誤差）。\n')
}

console.log('■ 2. 積分（抗力あり）と厳密円弧の一致')
{
  const Lx = kick(R, 2 * WALL).Lx
  const g = integrate({ v0: 26, L: Lx })
  let d = 0
  for (let i = 0; i < g.xs.length; i++) d = Math.max(d, Math.abs(g.zs[i] - zAtX(R, g.xs[i])))
  console.log(`    RK4(dt=2e-5, C_D=${BALL.CD}) vs z(x)=R(1−√(1−(x/R)²))   |Δ|max = ${d.toExponential(2)} m`)
  console.log('    抗力は |v| を削るが曲率 1/R に |v| は残っていない。だから円弧のまま。\n')
}

console.log('■ 3. 二十ヤードの穴 — 壁が弦の中点に立つ距離')
console.log('     C(m)    u=9.144/C    弦からの離れ: 壁 / 最大      壁/最大      壁で済んだ曲がり(厳密/放物線)')
for (const C of [12, 14, 16, 18.288, 20, 22, 25, 28, 32]) {
  const k = kick(R, C)
  const tag = Math.abs(C - 2 * WALL) < 1e-12 ? '   ← 9.144 × 2' : ''
  console.log(
    `    ${String(C).padStart(6)}    ${f(k.u, 4)}      ${f(k.clearWall, 4)} m / ${f(k.sagitta, 4)} m` +
      `    ${pct(k.clearFrac, 3).padStart(8)}      ${pct(k.doneAtWall).padStart(7)} / ${pct(k.doneAtWallParabola).padStart(7)}${tag}`
  )
}
{
  const k = kick(R, 2 * WALL)
  console.log('')
  console.log(`    C = 2 × 9.144 = ${f(2 * WALL, 3)} m のとき`)
  console.log(`      壁の弦上位置 ξ_wall = ${k.xiWall.toExponential(2)} m ＝ 弦の中点そのもの`)
  console.log(`      壁での離れ          = ${f(k.clearWall, 15)} m`)
  console.log(`      離れの最大値        = ${f(k.sagitta, 15)} m`)
  console.log(`      差                  = ${Math.abs(k.sagitta - k.clearWall).toExponential(2)} m`)
  console.log(`      ＝ 壁は、ボールが狙い線から逃げきっている、ちょうどその点に立っている。`)
  console.log('')
  console.log(`      弧の中心角 φ        = ${f(deg(k.phi), 4)}°`)
  console.log(`      蹴り出しの外し角    = φ/2 = ${f(deg(k.aimOff), 4)}°（着弾角も同じ・接弦角）`)
  console.log(`      総曲がり幅 Y        = ${f(k.Y, 4)} m`)
  console.log(`      離れ/Y              = ${pct(k.sagFrac, 3)}（放物線近似の予言は厳密に 25%）`)
  console.log(`      壁で済んだ曲がり    = ${pct(k.doneAtWall)}（放物線近似 u² = ${pct(k.doneAtWallParabola)}）`)
  console.log(`      キーパーが壁で接線を引くと ${f(k.predicted, 3)} m と読み、Y の ${pct(k.keeperShort)} 足りない`)
  console.log(`      （放物線近似の予言は「残りの二乗」(1−u)² = ${pct((1 - k.u) ** 2)}）\n`)
}

console.log('■ 4. 弦の中点が最大であることは近似ではない（d(ξ) = √(R²−ξ²) − k を刻む）')
{
  const C = 2 * WALL
  const half = C / 2
  const k0 = Math.sqrt(R * R - half * half)
  let best = -1
  let bestXi = 0
  for (let i = 0; i <= 2_000_000; i++) {
    const xi = -half + (2 * half * i) / 2_000_000
    const d = Math.sqrt(R * R - xi * xi) - k0
    if (d > best) { best = d; bestXi = xi }
  }
  console.log(`    ξ を ${(2 * half / 2_000_000 * 1000).toFixed(4)} mm 刻みで 200万点なめた最大は ξ = ${bestXi.toExponential(2)} m`)
  console.log(`    偶関数なので当たり前だが、当たり前であることが装置の中身。\n`)
}

console.log('■ 5. タイルの網点密度 = その列で済んでいる曲がりの割合か')
{
  const k = kick(R, 2 * WALL)
  // Scene.jsx の割り付けと同じ数字でなければ「面に刷った数字」の検算にならない
  const NX = 46
  const NZ = 14
  const X0 = -2.5
  const CELL = 0.5
  let worst = 0
  let sum = 0
  for (let i = 0; i < NX; i++) {
    const xc = X0 + (i + 0.5) * CELL
    const x = Math.min(Math.max(xc, 0), k.Lx)
    const frac = zAtX(R, x) / k.Y
    const col = inkColumn(i, NZ, frac)
    let ink = 0
    for (let j = 0; j < NZ; j++) if (col[j]) ink++
    const d = Math.abs(ink / NZ - frac)
    worst = Math.max(worst, d)
    sum += d
  }
  console.log(`    ${NX} 列 × ${NZ} 行。列ごとの |色タイル密度 − 完了率| は 平均 ${f(sum / NX, 5)} / 最大 ${f(worst, 5)}`)
  console.log(`    順位で切っているので、誤差は丸めの 1/(2·${NZ}) = ${f(0.5 / NZ, 5)} を超えない。`)
  console.log(`    （しきい値を乱数で切ると、${NZ}個しかない列では二項分布の σ ≦ ${f(0.5 / Math.sqrt(NZ), 4)} が密度の嘘になる）\n`)
}

console.log('■ 6. C = 2×9.144 でだけ現れる同一性')
{
  // 弦の中点は蹴り出しから見て弧の中心角のちょうど半分の位置なので、
  //   済んだ曲がり  = (1−cos(φ/2)) / (1−cos φ)
  //   離れ / Y      = R(1−cos(φ/2)) / (R(1−cos φ))
  // ＝ 同じ式。c = cos(φ/2) と置けば両方 1/(2(1+c)) で、φ→0 で 1/4 に落ちる。
  const k = kick(R, 2 * WALL)
  const c = Math.cos(k.phi / 2)
  const closed = 1 / (2 * (1 + c))
  console.log(`    済んだ曲がり    = ${k.doneAtWall.toFixed(15)}`)
  console.log(`    離れ / Y        = ${k.sagFrac.toFixed(15)}`)
  console.log(`    1/(2(1+cos φ/2)) = ${closed.toFixed(15)}`)
  console.log(`    三者のずれ      = ${Math.max(Math.abs(k.doneAtWall - k.sagFrac), Math.abs(k.sagFrac - closed)).toExponential(2)}`)
  console.log('    ＝ 二十ヤードでは「すでに曲がった量」と「それで買えた逃げ」が同じ数になる。')
  console.log(`    φ → 0 の極限は 1/4。今日の φ = ${((k.phi * 180) / Math.PI).toFixed(3)}° では ${(100 * closed).toFixed(3)}%。\n`)
}
