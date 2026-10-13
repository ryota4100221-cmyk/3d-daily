// Re-measures the constants baked into src/rig.js and the census in NOTES.md.
import * as R from '../src/rig.js'
const d = R.derive()
console.log(d)
const m = R.buildMesh()
const ball = Math.PI / 6
console.log('volume', R.volume(m).toFixed(5), '/ ball', ball.toFixed(5), '=', (R.volume(m) / ball).toFixed(4))
console.log('volume ungleich', R.volume(m, 'pos2').toFixed(5))
console.log('mesh census gleich', R.census(m, 'pos', 3000))
console.log('mesh census ungleich', R.census(m, 'pos2', 3000))
// analytic width over 200k random directions
let lo = 9, hi = -9, lo2 = 9, hi2 = -9
for (let i = 0; i < 200000; i++) {
  const u = [Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5]
  const w = R.plates(...u, 0).width, w2 = R.plates(...u, 1).width
  lo = Math.min(lo, w); hi = Math.max(hi, w); lo2 = Math.min(lo2, w2); hi2 = Math.max(hi2, w2)
}
console.log('analytic width gleich', lo, hi, 'spread', hi - lo)
console.log('analytic width ungleich', lo2, hi2, 'spread', hi2 - lo2)
