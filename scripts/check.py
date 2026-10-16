#!/usr/bin/env python3
# 3D Daily — 質のゲート（2026-10-14）
#
#   python3 scripts/check.py days/NNN_slug          → 🔴 が1件でもあれば exit 1（公開しない）
#
# variety-check.mjs は「昨日と違うか」しか見ない。Day 049〜103 はそれを全部通りながら、
# **10本中9本が再現元を一度も見ておらず**、12本中11本が「左上の見出し＋数値パネル＋中央に小さな3D」の
# 同じ型だった（2026-10-14 点検）。「違う」は測っていたが「良い」は誰も測っていなかった。
# このゲートは MIDDLE STUDIES II の check.py と同じ立ち位置＝**基準と並べた証拠が無ければ出さない**。
#
# 見るもの（🔴＝公開しない／⚠️＝報告に載せる）
#   ref      再現元を実機で撮ったか（ref/ref.png・空撮影でない）
#   shot     自作が描けているか（shots/mine.png・canvas が画面にある）
#   rounds   並べた1枚（shots/round-NN.png）が6枚以上あるか＝周回の機械の証拠
#   review   REVIEW.md に 周回6以上・「拡大:」2行以上・「独立レビュー:」・「止めた理由:」があるか
#   ground   地の明度が再現元と逆になっていないか（平均輝度の差）
#   layout   8×8 の明度配置が再現元とどれだけ離れているか（「見た目で再現」の数字）
#   hud      数字を含む文字要素が再現元より大きく多くないか（数値パネル型の再発防止）
#   label    作品の札（左下・3D Daily・after・fictional・一覧へのリンク）と <title> が NOTES の題と揃っているか
#            （2026-10-16：Day 105 が「知らない通販サイト」と読まれた／タブ名が途中の題のまま公開された）
#
# 🔴 0件でも数字を全部出す（数字を添えないガードは静かにオフになる＝feedback_guard_needs_counter）。
import json, re, sys
from pathlib import Path
from PIL import Image, ImageStat

day = Path(sys.argv[1]).resolve()
reds, warns, rows = [], [], []


def row(name, val, verdict=""):
    rows.append(f"  {name:<7} {val}{('  ' + verdict) if verdict else ''}")


def load(p):
    return json.loads(p.read_text()) if p.exists() else None


def grid(p, n=8):
    im = Image.open(p).convert("L").resize((1440, 900)).resize((n, n), Image.BILINEAR)
    return list(im.getdata())


notes = (day / "NOTES.md").read_text() if (day / "NOTES.md").exists() else ""

# --- ref
rj, rp = load(day / "ref/ref.json"), day / "ref/ref.png"
if not (rj and rp.exists() and rj.get("ok")):
    reds.append("ref: 再現元を撮っていない（node scripts/shoot.mjs ref <URL> <日>）")
    row("ref", "なし", "🔴")
else:
    row("ref", f"{rj['url']}  lumaStd={rj['lumaStd']}  canvas={rj['canvas']}  文字{rj['textBlocks']}（数字{rj['digitBlocks']}）")

# --- shot
mj, mp = load(day / "shots/mine.json"), day / "shots/mine.png"
if not (mj and mp.exists() and mj.get("ok")):
    reds.append("shot: 自作を撮っていない／空（node scripts/shoot.mjs mine <日>）")
    row("shot", "なし", "🔴")
else:
    v = "🔴" if mj["canvas"] < 0.2 else ""
    if v:
        reds.append(f"shot: canvas が画面の {mj['canvas']*100:.0f}% しかない＝3D が主役になっていない")
    row("shot", f"lumaStd={mj['lumaStd']}  canvas={mj['canvas']}  文字{mj['textBlocks']}（数字{mj['digitBlocks']}）", v)

# --- rounds（並べた1枚の実ファイル）
rounds = sorted((day / "shots").glob("round-*.png")) if (day / "shots").exists() else []
crops = sorted((day / "shots").glob("crop-*.png")) if (day / "shots").exists() else []
v = "🔴" if len(rounds) < 6 else ""
if v:
    reds.append(f"rounds: 並べた1枚が {len(rounds)} 枚（最低6周）")
v2 = "🔴" if len(crops) < 2 else ""
if v2:
    reds.append(f"rounds: 拡大した並べ図（crop-*.png）が {len(crops)} 枚（最終判定に2枚以上）")
row("rounds", f"並べ図 {len(rounds)} 枚 ／ 拡大 {len(crops)} 枚", v or v2)

# --- REVIEW.md
rv = (day / "REVIEW.md").read_text() if (day / "REVIEW.md").exists() else ""
n_round = len(re.findall(r"^##\s*Round\s*\d+", rv, re.M))
n_zoom = len(re.findall(r"^\s*[-*]?\s*拡大:", rv, re.M))
indep = re.search(r"^\s*[-*]?\s*独立レビュー:\s*(.+)$", rv, re.M)
stop = re.search(r"^\s*[-*]?\s*止めた理由:\s*(.+)$", rv, re.M)
miss = []
if n_round < 6: miss.append(f"Round {n_round}/6")
if n_zoom < 2: miss.append(f"拡大: {n_zoom}/2")
if not indep: miss.append("独立レビュー: なし")
if not stop: miss.append("止めた理由: なし")
if miss:
    reds.append("review: " + " ／ ".join(miss))
row("review", f"Round {n_round} ／ 拡大 {n_zoom} ／ 独立 {'あり' if indep else 'なし'} ／ 止め {'あり' if stop else 'なし'}", "🔴" if miss else "")
if indep:
    m = re.search(r"(\d+(?:\.\d+)?)\s*/\s*10", indep.group(1))
    if m and float(m.group(1)) < 6:
        warns.append(f"review: 独立レビューが {m.group(1)}/10（6未満）。出すが、報告で正直に書く")

# --- ground / layout / hud（再現元と自作の両方があるときだけ）
if rp.exists() and mp.exists():
    gr, gm = grid(rp), grid(mp)
    lr = sum(gr) / len(gr)
    lm = sum(gm) / len(gm)
    d = abs(lr - lm)
    ok_ground = "<!-- GROUND:" in notes
    v = ""
    if d > 90 and not ok_ground:
        v = "🔴"
        reds.append(f"ground: 地の明度が再現元と逆（平均輝度 {lr:.0f} → {lm:.0f}）。意図なら NOTES に <!-- GROUND: 理由 -->")
    row("ground", f"再現元 {lr:.0f} ／ 自作 {lm:.0f}（差 {d:.0f}）", v or ("（理由あり）" if ok_ground and d > 90 else ""))
    # 8×8 の明度配置の距離（0=同じ配置・1=正反対）。平均を引いて「どこが明るいか」だけ比べる
    cr = [x - lr for x in gr]
    cm = [x - lm for x in gm]
    dist = sum(abs(a - b) for a, b in zip(cr, cm)) / len(cr) / 255
    row("layout", f"明度配置の距離 {dist:.3f}（旧方式 096〜103 は 0.055〜0.119／新方式 104 は 0.015）", "⚠️" if dist > 0.25 else "")
    if dist > 0.25:
        warns.append(f"layout: 明度配置が再現元から遠い（{dist:.3f}）。構図を再現元に寄せたか REVIEW で確認")

if rj and mj:
    extra = mj["digitBlocks"] - rj["digitBlocks"]
    ok_hud = "<!-- HUD:" in notes
    v = ""
    if extra > 3 and not ok_hud:
        v = "🔴"
        reds.append(f"hud: 数字を含む文字要素が再現元より {extra} 個多い＝数値パネル型。再現元に無い計測表示は画面から外す（NOTES に書く）。意図なら <!-- HUD: 理由 -->")
    row("hud", f"数字を含む文字要素 再現元 {rj['digitBlocks']} ／ 自作 {mj['digitBlocks']}", v)

# --- label（作品の札と <title>）
src = "\n".join(f.read_text() for f in (day / "src").glob("*.jsx")) if (day / "src").exists() else ""
html = (day / "index.html").read_text() if (day / "index.html").exists() else ""
tm = re.search(r"<title>([^<]*)</title>", html)
title = tm.group(1) if tm else ""
hm = re.search(r"^# Day \d+ — (.+?)[（(]after", notes, re.M)
theme = hm.group(1).strip() if hm else ""
need = {
    "札の className=\"credit\"": 'className="credit"' in src,
    "札に 3D Daily": "3D Daily" in src,
    "札に after <サイト名>": re.search(r"after [A-Z0-9]", src) is not None,
    "札に fictional": "fictional" in src,
    "札から一覧へ href=\"../../\"": 'href="../../"' in src,
    "<title> が 3D Daily — Day": title.startswith("3D Daily — Day"),
    "<title> に NOTES の題": bool(theme) and theme in title,
}
miss = [k for k, ok in need.items() if not ok]
if miss:
    reds.append("label: 作品の札／タブ名が足りない → " + "、".join(miss) + "（RUN.md §4「作品の札」）")
row("label", f"{len(need) - len(miss)}/{len(need)}  title=「{title}」 題=「{theme or '見出しから取れず'}」", "🔴" if miss else "")

print(f"3D Daily check — {day.name}")
print("\n".join(rows))
print(f"→ 🔴{len(reds)}件 ⚠️{len(warns)}件")
for r in reds:
    print("🔴 " + r)
for w in warns:
    print("⚠️ " + w)
sys.exit(1 if reds else 0)
