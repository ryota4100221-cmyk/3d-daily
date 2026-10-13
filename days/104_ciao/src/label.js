// ラベル1枚（缶の胴の展開図）。横 2048 = 円周、縦は正方画素になるよう 4.54/(2π)·2048。
// 正面の中心が u=0.5。ref の缶を角度に直した位置（NOTES.md）に置く。
export const LW = 2048, LH = 1530
const css = (c, k = 1) => `rgb(${c.map((v) => Math.round(Math.min(1, v * k) * 255)).join(',')})`

export function drawLabel(canvas, rough, col) {
  const g = canvas.getContext('2d'), r = rough.getContext('2d')
  // 地：味の色を深く沈めた藍（ref の暗部 #12082a は照明込み）
  const base = [col[0] * 0.24 + 0.02, col[1] * 0.04 + 0.003, col[2] * 0.3 + 0.03]
  g.fillStyle = css(base); g.fillRect(0, 0, LW, LH)
  // roughness(G) / metalness(B)：印刷面は半艶・非金属
  r.fillStyle = 'rgb(0,230,8)'; r.fillRect(0, 0, LW, LH)

  // HALF（架空の銘柄）：縦に巨大、時計回りに90°、上から読む。銀の箔
  const ciao = (ctx, fill) => {
    ctx.save(); ctx.translate(1075, 665); ctx.rotate(Math.PI / 2); ctx.transform(1, 0, 0.9, 1, 0, 0)
    ctx.font = 'italic 900 580px Archivo'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillStyle = fill; ctx.fillText('HALF', 0, 30, 1270); ctx.restore()
  }
  // 箔：左上が明るく右下へ沈む明暗＋横のヘアライン（箔の抜きの中だけに描くため一旦別の canvas へ）
  const fc = document.createElement('canvas'); fc.width = LW; fc.height = LH
  const f = fc.getContext('2d')
  const foil = f.createLinearGradient(800, 0, 1350, LH)
  foil.addColorStop(0, '#e6e6ec'); foil.addColorStop(0.45, '#b4b4bc'); foil.addColorStop(0.75, '#8e8e98'); foil.addColorStop(1, '#c2c2c8')
  ciao(f, foil)
  f.globalCompositeOperation = 'source-atop'
  let seed = 7
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  for (let y = 0; y < LH; y += 2) {
    f.fillStyle = rnd() < 0.5 ? `rgba(255,255,255,${0.05 + rnd() * 0.08})` : `rgba(0,0,0,${0.04 + rnd() * 0.08})`
    f.fillRect(0, y, LW, 1 + (rnd() < 0.3))
  }
  g.drawImage(fc, 0, 0)
  ciao(r, 'rgb(0,90,128)')

  // GOÛT DOUBLE：左の縦書き（暗い紫）
  g.save(); g.translate(650, 850); g.rotate(Math.PI / 2)
  g.font = 'italic 900 64px Archivo'; g.textAlign = 'center'; g.textBaseline = 'middle'
  g.fillStyle = css(base, 1.9); g.fillText('GOÛT CALME', 0, 0); g.restore()

  // TONIC：横、味の色の中明度
  g.font = 'italic 900 140px Archivo'; g.fontStretch = 'expanded'; g.textAlign = 'center'; g.textBaseline = 'alphabetic'
  const tg = g.createLinearGradient(0, 1335, 0, 1440)
  tg.addColorStop(0, css(col.map((v) => v * 0.9 + 0.08))); tg.addColorStop(1, css(col.map((v) => v * 0.6 + 0.03)))
  g.fillStyle = tg; g.fillText('TONIC', 1024, 1438, 560); g.fontStretch = 'normal'
  g.font = '600 34px Inter'; g.fillStyle = '#e8e6ef'; g.fillText('250ml | Half Sugar', 1024, 1490)
}
