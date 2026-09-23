// verify.mjs — NOTES の数字を CPU float64 のラスタで出す（絵とは別の経路）。
import { R, WEIGHTS, layout, inkO, inkL, counterO, measureWord, measureO } from '../src/rig.js'
const f = (x, n = 4) => x.toFixed(n)
console.log('■ o の墨 = 4πRr（カウンターが開いている間）／ π(R+r)²（閉じた後）')
for (const w of WEIGHTS) {
  const m = measureO(w.r)
  const e = inkO(w.r)
  console.log(`  ${w.name.padEnd(11)} r=${f(w.r)}  raster=${f(m, 5)}  exact=${f(e, 5)}  rel.err=${((m - e) / e).toExponential(2)}  counter=${f(counterO(w.r), 4)}`)
}
console.log('\n■ 語 "bold" の閉じたカウンターの数（flood fill）')
for (const w of WEIGHTS) {
  const m = measureWord(w.r, 0.005)
  console.log(`  ${w.name.padEnd(11)} r=${f(w.r)}  counters=${m.counters}  counterArea=${f(m.counterArea, 4)} (3×π(R−r)²=${f(3 * counterO(w.r), 4)})  ink=${f(m.ink, 4)}  width=${f(m.width, 3)}`)
}
console.log('\n■ 閉じる重さを二分探索（語全体の counters が 3→0 になる r）')
{
  let lo = 0.3, hi = 0.6
  for (let k = 0; k < 14; k++) {
    const mid = (lo + hi) / 2
    const c = measureWord(mid, 0.004).counters
    if (c > 0) lo = mid; else hi = mid
  }
  console.log(`  r* ∈ [${f(lo, 5)}, ${f(hi, 5)}]   R = ${R}`)
}
console.log('\n■ l の墨 = 2rh + πr²')
for (const w of [WEIGHTS[0], WEIGHTS[5], WEIGHTS[9]]) console.log(`  r=${f(w.r)}  ${f(inkL(w.r), 5)}`)
