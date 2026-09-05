// Headless capture, with the two failure modes this series keeps rediscovering
// written into the loop rather than into a comment.
//
//   0 bytes    Chromium refused to start. Running as root without --no-sandbox
//              does this, and it looks nothing like a render failure.
//   ~30 KB     the page started but the canvas is empty — the virtual time
//              budget expired before the first frame that had anything in it.
//              A real frame of this scene is well over a megabyte of PNG.
//
// Both are retried. Usage:
//   node scripts/shot.mjs <outDir> <query> [query ...]
// where each query is appended to the dist URL, e.g. "?t=26&pass=1".
import { spawn } from 'node:child_process'
import { mkdirSync, statSync, rmSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell'
const PORT = process.env.SHOT_PORT || '4183'
// 🔴 今日の閾値（Day 067）。地は明るいベージュ一色で、その上に蛍光の棒が
// 150本ちょっと乗るだけなので PNG は太らない。実測: 実描画 144KB /
// 空カンバス（DOM だけ残る）41KB。差は3.5倍しかないので、前日までの 150KB や
// 400KB をそのまま持ってくると実描画のほうを弾く。90KB に置いた。
//
// もう1つ、この日はバイト数では捕まらない事故を踏んだ——headless の
// virtual time では rAF が何回回るか決まらないので、「1フレームあたり9%で
// 目標へ寄せる」式の自動送りは到達点がショットごとに変わる。同じビルドから
// δ/L = 0.0050（15本座屈）と 0.0292（94本座屈）の両方が出た。閾値では
// 捕まらない（どちらも実描画）ので、App 側で自動送りの補間を外して直した。
const MIN_BYTES = Number(process.env.SHOT_MIN || 90) * 1024
// A fixed budget can be forced with SHOT_BUDGET, and Day 042 needed that: two
// renders that differ by one uniform cannot be compared on any statistic that
// noise contributes to unless they have accumulated the same number of TAA
// frames, and the retry ladder silently gives the unlucky one an extra 1.6
// seconds of convergence. Comparing anisotropy against isotropy off the default
// ladder made the isotropic build look measurably cleaner; it was just older.
const BUDGETS = process.env.SHOT_BUDGET
  ? Array(6).fill(Number(process.env.SHOT_BUDGET))
  : [11900, 13500, 16000]

const outDir = resolve(process.argv[2] || 'shots')
const queries = process.argv.slice(3)
if (queries.length === 0) queries.push('')
mkdirSync(outDir, { recursive: true })

const server = spawn('npx', ['vite', 'preview', '--port', PORT, '--strictPort'], {
  stdio: ['ignore', 'pipe', 'pipe'],
})
await new Promise((r) => setTimeout(r, 2500))

function capture(url, out, budget) {
  return new Promise((done) => {
    const p = spawn(CHROME, [
      '--no-sandbox',
      '--headless',
      '--disable-gpu',
      '--use-gl=swiftshader',
      '--enable-unsafe-swiftshader',
      '--hide-scrollbars',
      // DOM オーバーレイの数字が初期値のまま焼き付く事故（Day 050）への保険。
      // virtual time の下では text の再ラスタが最後の合成に間に合わないことがある。
      '--run-all-compositor-stages-before-draw',
      '--disable-new-content-rendering-timeout',
      '--window-size=1600,1000',
      `--screenshot=${out}`,
      `--virtual-time-budget=${budget}`,
      url,
    ])
    p.on('exit', () => done())
  })
}

let failures = 0
for (const q of queries) {
  const name = (q.replace(/[^a-z0-9]+/gi, '_') || 'base') + '.png'
  const out = join(outDir, name)
  let ok = false
  for (const budget of BUDGETS) {
    if (existsSync(out)) rmSync(out)
    await capture(`http://localhost:${PORT}/${q}`, out, budget)
    const bytes = existsSync(out) ? statSync(out).size : 0
    console.log(`${name}  budget=${budget}  ${(bytes / 1024).toFixed(0)} KB`)
    if (bytes >= MIN_BYTES) {
      ok = true
      break
    }
  }
  if (!ok) failures++
}

server.kill()
process.exit(failures > 0 ? 1 : 0)
