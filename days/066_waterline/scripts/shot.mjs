// Headless capture.
//
// Day 066 の実測: 従来の headless_shell（--screenshot=… --virtual-time-budget=…）は
// この日のシーンで 3回に2回 空カンバス（24KB）を返した。同じ budget で 73KB → 24KB と
// 揺れるので、バイト数のリトライだけでは救えない（大きいほうも中身は空だった）。
// Playwright の chromium は実時間で待てるので、そちらへ替えた。
// 空カンバスの保険（バイト数の下限）はそのまま残してある。
//
//   node scripts/shot.mjs <outDir> [query ...]
import { spawn } from 'node:child_process'
import { mkdirSync, statSync, existsSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs'

const PORT = process.env.SHOT_PORT || '4183'
// この日の実測: 実描画 78〜106KB / 空カンバス（DOMだけ）24KB。
// 地が2色のベタなので PNG がよく縮む——過去の日の 400KB 閾値をそのまま持ってくると
// 正しい絵を空カンバス扱いで捨てる。閾値は毎日この2つを測ってから置くこと。
const MIN_BYTES = Number(process.env.SHOT_MIN || 55) * 1024
// 描き始めてから何秒後の1枚を撮るか。泳者が水面をまたいだ状態で止めたい。
const WAITS = process.env.SHOT_WAIT ? [Number(process.env.SHOT_WAIT)] : [12000, 15000, 18000]

const outDir = resolve(process.argv[2] || 'shots')
const queries = process.argv.slice(3)
if (queries.length === 0) queries.push('')
mkdirSync(outDir, { recursive: true })

const server = spawn('npx', ['vite', 'preview', '--port', PORT, '--strictPort'], {
  stdio: ['ignore', 'pipe', 'pipe'],
})
await new Promise((r) => setTimeout(r, 3000))

const browser = await chromium.launch({
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
})

let failures = 0
for (const q of queries) {
  const name = (q.replace(/[^a-z0-9]+/gi, '_') || 'base') + '.png'
  const out = join(outDir, name)
  let ok = false
  for (const wait of WAITS) {
    if (existsSync(out)) rmSync(out)
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
    page.on('pageerror', (e) => console.log('  [pageerror]', e.message.slice(0, 400)))
    await page.goto(`http://localhost:${PORT}/${q}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(wait)
    await page.screenshot({ path: out })
    await page.close()
    const bytes = existsSync(out) ? statSync(out).size : 0
    console.log(`${name}  wait=${wait}ms  ${(bytes / 1024).toFixed(0)} KB`)
    if (bytes >= MIN_BYTES) {
      ok = true
      break
    }
  }
  if (!ok) failures++
}

await browser.close()
server.kill()
process.exit(failures > 0 ? 1 : 0)
