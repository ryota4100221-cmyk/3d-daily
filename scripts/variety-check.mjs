#!/usr/bin/env node
// variety-check.mjs — その日の1本が「昨日の続き」になっていないかを機械で測る。
//
// なぜ在るか（2026-08-17）:
//   Day 031〜048 の18日間、難易度は毎日★5と報告されていたが、実際に画面に映る
//   rig.js は Day 039 から10日間 md5 完全一致、Scene.jsx は Day 038 から11日間
//   差分0行だった。★は「難しさ」を測っていて「違い」を測っていなかった。
//   測っていない軸には必ず寄る。だからここで違いのほうを測る。
//
// 使い方:
//   node scripts/variety-check.mjs                 # 最新の day を見る
//   node scripts/variety-check.mjs days/049_xxx    # 指定した day を見る
//
// 終了コード: 0 = 合格 / 1 = 不合格（🔴が1件以上）
// 🔴0件のときも必ず件数と数字を出す（数字を添えないガードは静かにオフになる）。

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readPng } from './png.mjs'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const DAYS = join(ROOT, 'days')

// ── 閾値 ────────────────────────────────────────────────────────────────
// 片側だけ締めると必ずその方向へ振り切れるので、上限と下限を両方持つ。
//
// 較正（2026-08-17・Day001〜048 全日で実測した「直近7日でいちばん近い日との距離」）:
//   Day 003〜030  0.084 〜 0.599   健全にばらついていた期間
//   Day 031       0.096            ← ここから崩れ始める
//   Day 038〜042  0.058 〜 0.087
//   Day 043〜047  0.014 0.002 0.021 0.006 0.005   ← ほぼ同一画像
// 静止画1枚では「動きが主役の日」を区別できない（Day 010 スクロールは 0.028 だが
// 別作品だった）。そこで中間帯は落とさず、**理由を書かせる**。
const TH = {
  imageDistFail: 0.06, // これ未満は弁解の余地なく同じ絵 → 🔴
  imageDistJustify: 0.14, // 0.06〜0.14 は SAMEISH の記載が要る（無ければ🔴）
  imageDistMax: 0.92, // これを超えると別物すぎ＝トンマナを捨てた疑い（⚠️のみ）
  axisRepeat: 5, // 直近7日で同じタグ値が何回出たら偏りとみなすか
  minPreviewBytes: 60_000, // 空カンバスの preview は極端に小さい（1600x1000 で約28KB）
}

// 毎日書き直す前提のファイル（前日と同一なら不合格）
const AUTHORED = ['src/rig.js', 'src/Scene.jsx', 'src/App.jsx']

// ── 日フォルダの列挙 ────────────────────────────────────────────────────
const dayDirs = readdirSync(DAYS)
  .filter((d) => /^\d{3}_/.test(d) && statSync(join(DAYS, d)).isDirectory())
  .sort()

const target = process.argv[2]
  ? basename(process.argv[2].replace(/\/+$/, ''))
  : dayDirs[dayDirs.length - 1]

const idx = dayDirs.indexOf(target)
if (idx < 0) {
  console.error(`✗ 見つからない: ${target}`)
  process.exit(1)
}
const dir = join(DAYS, target)
const prev = idx > 0 ? join(DAYS, dayDirs[idx - 1]) : null
const recent = dayDirs.slice(Math.max(0, idx - 7), idx) // 直近7日

const fails = []
const warns = []
const lines = []

// ── 1. TAGS ブロック ────────────────────────────────────────────────────
const AXES = ['source', 'subject', 'framing', 'ground', 'motion', 'palette', 'device']

function readTags(d) {
  const p = join(DAYS, d, 'NOTES.md')
  if (!existsSync(p)) return null
  const m = readFileSync(p, 'utf8').match(/<!--\s*TAGS([\s\S]*?)-->/)
  if (!m) return null
  const tags = {}
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^\s*(\w+)\s*:\s*(.+?)\s*$/)
    if (kv) tags[kv[1]] = kv[2]
  }
  return tags
}

const tags = readTags(target)
if (!tags) {
  fails.push('NOTES.md に TAGS ブロックが無い（CURRICULUM.md の書式で必須）')
} else {
  const missing = AXES.filter((a) => !tags[a])
  if (missing.length) fails.push(`TAGS に欠けている軸: ${missing.join(', ')}`)
  lines.push(`  タグ: ${AXES.filter((a) => tags[a]).map((a) => `${a}=${tags[a]}`).join(' / ')}`)
}

// ── 2. 再現元URLの重復 ──────────────────────────────────────────────────
const srcPath = join(ROOT, 'SOURCES.md')
const sourcesTxt = existsSync(srcPath) ? readFileSync(srcPath, 'utf8') : ''
if (tags?.source) {
  const url = tags.source.trim().replace(/\/+$/, '')
  // 自分の行（= 今日の day 名を含む行）は除いて数える
  const hits = sourcesTxt
    .split('\n')
    .filter((l) => l.includes(url) && !l.includes(target)).length
  lines.push(`  再現元URLの過去出現: ${hits} 件`)
  if (hits > 0) fails.push(`再現元URLが SOURCES.md に既にある（${hits}件）: ${url}`)
} else {
  lines.push('  再現元URLの過去出現: 判定不能（source タグ無し）')
}

// ── 3. 直近7日とのタグ重複 ──────────────────────────────────────────────
const recentTags = recent.map((d) => ({ d, t: readTags(d) })).filter((x) => x.t)
const KEY4 = ['subject', 'framing', 'ground', 'motion']
if (tags && recentTags.length) {
  const twins = recentTags.filter((x) => KEY4.every((k) => x.t[k] === tags[k]))
  lines.push(`  直近${recentTags.length}日で4軸すべて一致: ${twins.length} 件`)
  if (twins.length) fails.push(`4軸(${KEY4.join('/')})が完全一致する日がある: ${twins.map((x) => x.d).join(', ')}`)

  for (const k of KEY4) {
    const n = recentTags.filter((x) => x.t[k] === tags[k]).length + 1
    if (n >= TH.axisRepeat) warns.push(`${k}=${tags[k]} が直近${recentTags.length + 1}日で ${n} 回（偏り）`)
  }
} else {
  lines.push(`  直近7日で4軸すべて一致: 判定不能（比較できるタグ付きの日 ${recentTags.length} 件）`)
}

// ── 4. 手で書くファイルが前日と同一でないか ─────────────────────────────
function md5(p) {
  return existsSync(p) ? createHash('md5').update(readFileSync(p)).digest('hex') : null
}
if (prev) {
  const same = []
  for (const f of AUTHORED) {
    const a = md5(join(dir, f))
    const b = md5(join(prev, f))
    if (a && b && a === b) same.push(f)
  }
  lines.push(`  前日と md5 一致の作品ファイル: ${same.length} / ${AUTHORED.length} 件`)
  if (same.length) fails.push(`前日からコピーされたまま: ${same.join(', ')}（src/ はコピーせず書き直す）`)
} else {
  lines.push('  前日と md5 一致の作品ファイル: 判定不能（前日なし）')
}

// ── 5. preview の画像距離 ───────────────────────────────────────────────
// 8x8 に平均縮小した RGB と 16bin の輝度ヒストグラムを、正規化 L1 距離で比べる。
function signature(p) {
  const { w, h, bpp, px } = readPng(p)
  const G = 8
  const cell = new Float64Array(G * G * 3)
  const cnt = new Float64Array(G * G)
  const hist = new Float64Array(16)
  for (let y = 0; y < h; y++) {
    const gy = Math.min(G - 1, (y * G / h) | 0)
    for (let x = 0; x < w; x++) {
      const gx = Math.min(G - 1, (x * G / w) | 0)
      const i = (y * w + x) * bpp
      const r = px[i], g = px[i + 1], b = px[i + 2]
      const c = (gy * G + gx) * 3
      cell[c] += r; cell[c + 1] += g; cell[c + 2] += b
      cnt[gy * G + gx]++
      hist[Math.min(15, ((0.2126 * r + 0.7152 * g + 0.0722 * b) / 16) | 0)]++
    }
  }
  for (let i = 0; i < G * G; i++) {
    const n = cnt[i] || 1
    cell[i * 3] /= n * 255; cell[i * 3 + 1] /= n * 255; cell[i * 3 + 2] /= n * 255
  }
  const tot = w * h
  for (let i = 0; i < 16; i++) hist[i] /= tot
  return { cell, hist }
}

function distance(a, b) {
  let dc = 0
  for (let i = 0; i < a.cell.length; i++) dc += Math.abs(a.cell[i] - b.cell[i])
  dc /= a.cell.length
  let dh = 0
  for (let i = 0; i < 16; i++) dh += Math.abs(a.hist[i] - b.hist[i])
  dh /= 2 // 全変動距離を 0..1 に
  return 0.5 * dc + 0.5 * dh
}

const myPng = join(dir, 'preview.png')
if (!existsSync(myPng)) {
  fails.push('preview.png が無い（実描画を撮っていない＝構図は検証できていない）')
  lines.push('  画像距離: 判定不能（preview.png 無し）')
} else {
  const bytes = statSync(myPng).size
  lines.push(`  preview.png: ${(bytes / 1024).toFixed(0)} KB`)
  if (bytes < TH.minPreviewBytes) fails.push(`preview.png が小さすぎる（${bytes}B）＝空カンバスの疑い。撮り直す`)

  let mine = null
  try {
    mine = signature(myPng)
  } catch (e) {
    warns.push(`preview.png を読めなかった: ${e.message}`)
  }
  if (mine) {
    const ds = []
    for (const d of recent) {
      const p = join(DAYS, d, 'preview.png')
      if (!existsSync(p)) continue
      try {
        ds.push({ d, v: distance(mine, signature(p)) })
      } catch {}
    }
    if (ds.length) {
      ds.sort((a, b) => a.v - b.v)
      const near = ds[0]
      lines.push(
        `  画像距離（直近${ds.length}日中いちばん近い日）: ${near.v.toFixed(3)} … ${near.d}` +
          `　[🔴<${TH.imageDistFail} / 要弁明<${TH.imageDistJustify}]`
      )
      lines.push(`    全比較: ${ds.map((x) => `${x.d.slice(0, 3)}=${x.v.toFixed(3)}`).join('  ')}`)

      if (near.v < TH.imageDistFail) {
        fails.push(`絵が同じ（距離 ${near.v.toFixed(3)} < ${TH.imageDistFail}）: ${near.d}。作り直す`)
      } else if (near.v < TH.imageDistJustify) {
        // 静止画が近いこと自体は罪ではない（動きが主役の日がある）。
        // ただし黙って通すと Day 031〜048 が再演される。理由の明記を要求する。
        const notes = existsSync(join(dir, 'NOTES.md')) ? readFileSync(join(dir, 'NOTES.md'), 'utf8') : ''
        const m = notes.match(/<!--\s*SAMEISH:\s*(.+?)\s*-->/)
        if (m) {
          lines.push(`    弁明: ${m[1]}`)
          warns.push(`静止画が ${near.d} に近い（${near.v.toFixed(3)}）。弁明あり＝通過`)
        } else {
          fails.push(
            `静止画が ${near.d} に近い（${near.v.toFixed(3)}）のに理由が書かれていない。` +
              `動きが主役なら NOTES.md に <!-- SAMEISH: 理由 --> を書く。書けないなら作り直す`
          )
        }
      }

      if (ds[ds.length - 1].v > TH.imageDistMax)
        warns.push(`直近7日と離れすぎ（距離 ${ds[ds.length - 1].v.toFixed(3)} > ${TH.imageDistMax}）＝トンマナを捨てていないか目で見る`)
    } else {
      lines.push('  画像距離: 判定不能（比較できる preview が直近7日に無い）')
    }
  }
}

// ── 6. 品質側の下限（違いだけ追うと壊れるので反対側も測る） ─────────────
const built = existsSync(join(dir, 'dist', 'index.html'))
lines.push(`  ビルド成果物(dist/index.html): ${built ? 'あり' : 'なし'}`)
if (!built) warns.push('dist/ が無い（npm run build を通していない可能性）')

const notesLen = existsSync(join(dir, 'NOTES.md')) ? readFileSync(join(dir, 'NOTES.md'), 'utf8').length : 0
lines.push(`  NOTES.md: ${notesLen} 文字`)
if (notesLen < 400) warns.push('NOTES.md が短い（何を分解して何を捨てたかが書けていない）')

// ── 出力 ────────────────────────────────────────────────────────────────
console.log(`\n■ variety-check — ${target}`)
console.log(lines.join('\n'))
console.log(`\n  🔴 不合格 ${fails.length} 件 / ⚠️ 警告 ${warns.length} 件`)
for (const f of fails) console.log(`  🔴 ${f}`)
for (const w of warns) console.log(`  ⚠️ ${w}`)
if (!fails.length && !warns.length) console.log('  （指摘なし）')
console.log()

process.exit(fails.length ? 1 : 0)
