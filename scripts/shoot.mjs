// 3D Daily — 再現元と自作を「同じ条件で」撮る（2026-10-14）
//
//   node scripts/shoot.mjs ref  <URL>     <日フォルダ>      → <日>/ref/ref.png  ＋ ref.json
//   node scripts/shoot.mjs mine <日フォルダ> [?query] [名前] → <日>/shots/<名前>.png ＋ .json（既定 名前=mine）
//
// なぜ在るか：Day 049〜103 はクラウド実行で WebFetch が 403 になり、**10本中9本が再現元を一度も見ずに**
// DB の文字情報だけで「再現」していた。見ていないものには寄せられない。MIDDLE STUDIES II と同じく、
// 再現元を実機で撮って自作と並べるところから始める。
//
// - 撮影は本物の Chrome（channel:'chrome'）。Playwright 既定のソフト描画は sticky な WebGL を透明に撮る
//   （reference_headless_sticky_webgl・2026-10-01 fluid-mv で実測）
// - 🔴 --mute-audio 必須。ヘッドレスでも音は Ryota の Mac のスピーカーから出る（feedback_mute_headless_tests）
// - 1440×900・dpr 1。再現元と自作を同じ判型で撮らないと sidebyside の比較が成立しない
// - 空撮影（輝度がほぼ一色）は失敗として扱い、待ち時間を伸ばして撮り直す
// - .json に DOM の実測を残す（canvas の占有率・数字を含む文字要素の数）。check.mjs がこれを読む
//
// 🔴 ref/ は .gitignore 済み。**他人のサイトのスクショを public に出さない**（GitHub Pages は公開）。
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'

const require = createRequire(`${homedir()}/projects/video-lab/package.json`)
const { chromium } = require('playwright')

const [mode, a, b, c] = process.argv.slice(2)
if (!['ref', 'mine'].includes(mode) || !a) {
  console.error('usage: node scripts/shoot.mjs ref <URL> <dayDir> | mine <dayDir> [?query] [name]')
  process.exit(2)
}
const W = 1440, H = 900
const WAITS = [6000, 9000, 13000]

let url, outPng, server
if (mode === 'ref') {
  if (!b) { console.error('ref には日フォルダが要る'); process.exit(2) }
  url = a
  mkdirSync(join(resolve(b), 'ref'), { recursive: true })
  outPng = join(resolve(b), 'ref', 'ref.png')
} else {
  const day = resolve(a)
  if (!existsSync(join(day, 'dist', 'index.html'))) { console.error(`🔴 ${day}/dist が無い。先に npm run build`); process.exit(1) }
  const port = String(4300 + Math.floor(Math.random() * 500))
  server = spawn('npx', ['vite', 'preview', '--port', port, '--strictPort', '--base', '/'], { cwd: day, stdio: 'ignore' })
  await new Promise((r) => setTimeout(r, 3000))
  url = `http://localhost:${port}/${b || ''}`
  mkdirSync(join(day, 'shots'), { recursive: true })
  outPng = join(day, 'shots', `${c || 'mine'}.png`)
}

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--mute-audio', '--hide-scrollbars', '--ignore-gpu-blocklist', '--enable-webgl'],
})
let ok = false, stats = null
try {
  for (const wait of WAITS) {
    const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })
    // networkidle は回り続ける WebGL では来ない。load＋待ち時間で撮る
    await page.goto(url, { waitUntil: 'load', timeout: 60000 }).catch(() => {})
    await page.waitForTimeout(wait)
    await page.screenshot({ path: outPng })
    stats = await page.evaluate(() => {
      const vw = innerWidth, vh = innerHeight
      const vis = (el) => {
        const r = el.getBoundingClientRect(), s = getComputedStyle(el)
        return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < vh && r.left < vw &&
          s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05
      }
      let canvas = 0
      for (const cv of document.querySelectorAll('canvas')) {
        if (!vis(cv)) continue
        const r = cv.getBoundingClientRect()
        const w = Math.max(0, Math.min(vw, r.right) - Math.max(0, r.left))
        const h = Math.max(0, Math.min(vh, r.bottom) - Math.max(0, r.top))
        canvas = Math.max(canvas, (w * h) / (vw * vh))
      }
      // 「見える文字の塊」＝直下にテキストノードを持つ要素（style/script は除く＝textContent の罠）
      let blocks = 0, digitBlocks = 0, chars = 0
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
      const seen = new Set()
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const el = n.parentElement
        if (!el || seen.has(el) || /^(STYLE|SCRIPT|NOSCRIPT|TEMPLATE)$/.test(el.tagName)) continue
        const t = n.textContent.trim()
        if (!t || !vis(el)) continue
        seen.add(el)
        blocks++
        chars += t.length
        if (/\d/.test(t)) digitBlocks++
      }
      return { canvas: +canvas.toFixed(3), textBlocks: blocks, digitBlocks, textChars: chars, title: document.title }
    })
    await page.close()
    // 空撮影の判定は画素で行う（バイト数は地の色で大きく揺れる＝Day103の白地で実測）
    const { execFileSync } = await import('node:child_process')
    const std = Number(execFileSync('python3', ['-c',
      'import sys;from PIL import Image,ImageStat;print(ImageStat.Stat(Image.open(sys.argv[1]).convert("L").resize((200,200))).stddev[0])',
      outPng]).toString())
    stats.lumaStd = +std.toFixed(2)
    console.log(`${outPng}  wait=${wait}ms  lumaStd=${stats.lumaStd}  canvas=${stats.canvas}  text=${stats.textBlocks}（数字${stats.digitBlocks}）`)
    if (std >= 4) { ok = true; break }
  }
} finally {
  await browser.close()
  server?.kill()
}
stats.url = url
stats.ok = ok
writeFileSync(outPng.replace(/\.png$/, '.json'), JSON.stringify(stats, null, 2))
if (!ok) {
  console.error(`🔴 ほぼ一色しか撮れていない（${outPng}）。${mode === 'ref' ? 'og:image か作品動画のURLを探す／別の再現元を選ぶ' : 'Canvas が描けていない＝ビルドは通っても描画が失敗している'}`)
  process.exit(1)
}
