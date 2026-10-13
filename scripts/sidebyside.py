#!/usr/bin/env python3
# 3D Daily — 再現元と自作を同じ高さで並べる（2026-10-14 MIDDLE STUDIES II から移植）
#
#   python3 scripts/sidebyside.py <基準.png> <test.png> <出力.png>
#   python3 scripts/sidebyside.py <基準.png> <test.png> <出力.png> --crop 基準x0,y0,x1,y1 自作x0,y0,x1,y1
#       ↑ 割合（0〜1）で部分を切り出して並べる。**最終判定で「見劣りしない」と書く箇所は必ずこれで見る**
#         （2026-09-23 II 001：全体図で「奥の1本がボケて主役が立つ」と判定したが、実際のボケは弱かった。
#          縮小した全体図では、ボケ・質感・接地の影のような細部の差は見えない）
#
# 🔴 自己レビューは必ずこの1枚を Read して行う。自作だけを見ると、何周回しても
#    「前の周よりは良い」しか判定できない（第1期が89作かけて学んだこと）。
import sys
from PIL import Image, ImageDraw, ImageStat

ref, mine, out = sys.argv[1:4]
crops = None
if "--crop" in sys.argv:
    i = sys.argv.index("--crop")
    crops = [tuple(float(v) for v in sys.argv[i + k].split(",")) for k in (1, 2)]
H = 1100
ims = []
for p in (ref, mine):
    im = Image.open(p).convert("RGB")
    if crops:
        x0, y0, x1, y1 = crops[len(ims)]
        im = im.crop((round(im.width * x0), round(im.height * y0), round(im.width * x1), round(im.height * y1)))
    # 🔴 空の撮影を弾く（2026-09-23 実測：Behance の検索ページは headless で真っ白に写った）。
    #    白紙と並べても「見劣りしない」と判定できてしまう＝基準が無いのと同じ。
    st = ImageStat.Stat(im.convert("L").resize((200, 200)))
    if st.stddev[0] < 4:
        sys.exit(f"🔴 {p} がほぼ一色（輝度std {st.stddev[0]:.1f}）＝撮れていない。og:image か作品画像のURLを直接渡して撮り直す")
    ims.append(im.resize((round(im.width * H / im.height), H)))
gap = 24
W = sum(i.width for i in ims) + gap * 3
canvas = Image.new("RGB", (W, H + gap * 2 + 28), (24, 24, 24))
x = gap
d = ImageDraw.Draw(canvas)
for lab, im in zip(("REFERENCE", "MINE"), ims):
    canvas.paste(im, (x, gap + 28))
    d.text((x, gap), lab, fill=(200, 200, 200))
    x += im.width + gap
canvas.save(out)
print(">> saved", out, canvas.size)
