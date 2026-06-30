// 3D Daily — ギャラリーindex生成
// _site/ に置かれた各日ビルドを走査し、トップページ index.html を作る。
// 使い方: node scripts/build-gallery.mjs <repoRoot> <siteDir>
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const repoRoot = process.argv[2] || '.'
const siteDir = process.argv[3] || join(repoRoot, '_site')

const daysDir = join(repoRoot, 'days')
const dayDirs = existsSync(daysDir)
  ? readdirSync(daysDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && /^\d{3}_/.test(d.name))
      .map((d) => d.name)
  : []

// PROGRESS.md の表から folder -> {date, theme} を引く
const progress = {}
const progressPath = join(repoRoot, 'PROGRESS.md')
if (existsSync(progressPath)) {
  for (const line of readFileSync(progressPath, 'utf8').split('\n')) {
    const cells = line.split('|').map((c) => c.trim())
    // | date | no | theme | folder | note |
    if (cells.length >= 6 && /^\d{4}-\d{2}-\d{2}$/.test(cells[1])) {
      const folder = (cells[4] || '').replace(/^days\//, '')
      if (folder) progress[folder] = { date: cells[1], theme: cells[3] }
    }
  }
}

function titleOf(folder) {
  const notes = join(daysDir, folder, 'NOTES.md')
  if (existsSync(notes)) {
    const m = readFileSync(notes, 'utf8').match(/^#\s+(.+)$/m)
    if (m) return m[1].replace(/（R3F）|\(R3F\)/g, '').trim()
  }
  return folder.replace(/^\d{3}_/, '').replace(/-/g, ' ')
}

const items = dayDirs
  .map((folder) => {
    const no = folder.slice(0, 3)
    const meta = progress[folder] || {}
    const hasPreview = existsSync(join(siteDir, 'days', folder, 'preview.png'))
    return {
      folder,
      no,
      title: titleOf(folder),
      date: meta.date || '',
      theme: meta.theme || '',
      hasPreview,
    }
  })
  .sort((a, b) => b.no.localeCompare(a.no))

const cards = items
  .map(
    (it) => `
      <a class="card" href="./days/${it.folder}/">
        <div class="thumb">
          ${
            it.hasPreview
              ? `<img loading="lazy" src="./days/${it.folder}/preview.png" alt="${it.title}" />`
              : `<div class="noimg">no preview</div>`
          }
        </div>
        <div class="meta">
          <span class="no">DAY ${it.no}</span>
          <span class="title">${it.title}</span>
          <span class="date">${it.date}</span>
        </div>
      </a>`
  )
  .join('\n')

const count = items.length
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>3D Daily — monaka design.</title>
<meta name="description" content="Daily React Three Fiber experiments. One piece every morning." />
<style>
  :root{ --bg:#f1efea; --ink:#1a1a1a; --sub:#8a8780; --line:#e2dfd8; --accent:#c0492a; }
  *{ box-sizing:border-box; margin:0; padding:0; }
  html{ -webkit-font-smoothing:antialiased; }
  body{ background:var(--bg); color:var(--ink);
    font-family:'Inter',system-ui,-apple-system,'Helvetica Neue',sans-serif; }
  .wrap{ max-width:1320px; margin:0 auto; padding:clamp(40px,8vw,120px) clamp(24px,5vw,72px); }
  header{ display:flex; justify-content:space-between; align-items:baseline;
    padding-bottom:48px; border-bottom:1px solid var(--line); flex-wrap:wrap; gap:16px; }
  .brand{ font-size:13px; letter-spacing:.28em; text-transform:uppercase; color:var(--sub); }
  h1{ font-size:clamp(40px,8vw,96px); font-weight:600; letter-spacing:-.03em; line-height:.95; margin-top:24px; }
  h1 em{ font-style:italic; color:var(--sub); font-weight:400; }
  .lede{ margin-top:20px; max-width:46ch; color:var(--sub); font-size:15px; line-height:1.6; }
  .count{ font-size:13px; letter-spacing:.18em; text-transform:uppercase; color:var(--sub); }
  .grid{ margin-top:64px; display:grid; gap:clamp(20px,3vw,40px);
    grid-template-columns:repeat(auto-fill,minmax(300px,1fr)); }
  .card{ text-decoration:none; color:inherit; display:block; }
  .thumb{ aspect-ratio:16/10; background:#e8e5df; border:1px solid var(--line);
    overflow:hidden; border-radius:2px; transition:transform .4s ease, box-shadow .4s ease; }
  .card:hover .thumb{ transform:translateY(-4px); box-shadow:0 18px 40px rgba(0,0,0,.08); }
  .thumb img{ width:100%; height:100%; object-fit:cover; display:block; }
  .noimg{ width:100%; height:100%; display:grid; place-items:center;
    color:var(--sub); font-size:12px; letter-spacing:.2em; text-transform:uppercase; }
  .meta{ margin-top:14px; display:flex; flex-direction:column; gap:3px; }
  .meta .no{ font-size:11px; letter-spacing:.22em; color:var(--sub); }
  .meta .title{ font-size:16px; font-weight:500; letter-spacing:-.01em; }
  .meta .date{ font-size:12px; color:var(--sub); }
  footer{ margin-top:96px; padding-top:32px; border-top:1px solid var(--line);
    display:flex; justify-content:space-between; color:var(--sub); font-size:12px;
    letter-spacing:.06em; flex-wrap:wrap; gap:12px; }
  footer a{ color:var(--sub); }
  .empty{ margin-top:64px; color:var(--sub); }
</style>
</head>
<body>
  <div class="wrap">
    <header>
      <div>
        <div class="brand">monaka design.</div>
        <h1>3D <em>Daily</em></h1>
        <p class="lede">React Three Fiber の実験を毎朝1本。基礎から段階的に難易度を上げていく、自動生成のスケッチ集。</p>
      </div>
      <div class="count">${count} ${count === 1 ? 'piece' : 'pieces'}</div>
    </header>
    ${count ? `<main class="grid">${cards}\n    </main>` : `<p class="empty">まだ作品がありません。</p>`}
    <footer>
      <span>Designing the Middle of Your Story.</span>
      <a href="https://github.com/ryota4100221-cmyk/3d-daily">github.com/ryota4100221-cmyk/3d-daily</a>
    </footer>
  </div>
</body>
</html>
`

writeFileSync(join(siteDir, 'index.html'), html)
console.log(`gallery: ${count} pieces -> ${join(siteDir, 'index.html')}`)
