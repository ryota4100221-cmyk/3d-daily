#!/bin/zsh
# engine/bake — 焼き → 書き出し → 圧縮 → webp まで1本で（2026-10-25・Bake Lab の final_bake.sh を汎用化）
#   zsh engine/bake/bake.sh <scene.blend> <出力フォルダ（例 days/NNN_x/public）> [samples=256] [density=400]
# 実測（Bake Lab・M1・256サンプル・density 400・2状態・19物体）：約9〜11分。小さなシーンなら1分前後
# 🔴 gltf-transform は optimize を使わない（join で物体が結合され、振り付けに使う名前が消える）。webp → meshopt の2手だけ
# 🔴 meshopt の量子化はノードに戻しの scale/移動を載せる＝three 側でノードの scale を直接いじると壊れる（baked.js の rig() で親を挟む）
set -e
BLEND=${1:?scene.blend}
OUT=${2:?出力フォルダ}
S=${3:-256}
D=${4:-400}
B=/Applications/Blender.app/Contents/MacOS/Blender
HERE=${0:A:h}
RAW=$OUT/../.bake-raw          # 圧縮前の原本（gitignore 推奨・公開しない）
# 🔴 焼きは一時フォルダに出し、全部できてから公開フォルダへ差し替える（2026-10-25 Study 02 で、焼きが途中で止まり
#    先に消した lm/ が半端なまま＝ manifest が無くページが真っ白、しかも `| tail` で終了コードが 0 に見えた）
TMP=$OUT/../.bake-tmp
mkdir -p "$OUT" "$RAW"
rm -rf "$TMP" && mkdir -p "$TMP"
if ! $B -b "$BLEND" -P "$HERE/bake.py" -- "$TMP" $S $D > "$RAW/bake.log" 2>&1 || ! grep -q '^DONE' "$RAW/bake.log"; then
  echo "🔴 焼きが完走しなかった（公開フォルダは前の焼きのまま）。ログ末尾："; tail -15 "$RAW/bake.log"; exit 1
fi
grep -E "RES|BAKED|DONE" "$RAW/bake.log"

mv "$TMP/scene.glb" "$RAW/scene.glb"
npx -y @gltf-transform/cli@4 webp "$RAW/scene.glb" "$RAW/scene.webp.glb" --quality 88 >/dev/null
npx -y @gltf-transform/cli@4 meshopt "$RAW/scene.webp.glb" "$TMP/scene.glb" >/dev/null

# ライトマップは PNG → webp q92。暗い状態（夜）は 256 サンプルの粒が白い壁で砂に見える → 中央値＋ぼかしで均す（Bake Lab 3周目）
# どの状態を均すかは manifest の p99_5（明るさ）が低い方＝ 平均 p99_5 が 1.0 未満の状態
rm -rf "$RAW/lm" && mkdir -p "$RAW/lm"
python3 - "$TMP" "$RAW" <<'PY'
import sys, json, glob, os, shutil
from PIL import Image, ImageFilter
out, raw = sys.argv[1:3]
m = json.load(open(os.path.join(out, 'lm', 'manifest.json')))
dark = []
for st in m['states']:
    v = [o[st]['p99_5'] for o in m['objects'].values() if o.get('kind') == 'map' and st in o]
    if v and sum(v) / len(v) < 1.0:
        dark.append(st)
for f in glob.glob(os.path.join(out, 'lm', '*.png')):
    im = Image.open(f).convert('RGB')
    if any(f.endswith(f'_{st}.png') for st in dark):
        im = im.filter(ImageFilter.MedianFilter(5)).filter(ImageFilter.GaussianBlur(1.6))
    im.save(f[:-4] + '.webp', 'WEBP', quality=92, method=6)
    shutil.move(f, os.path.join(raw, 'lm', os.path.basename(f)))
print('webp', len(glob.glob(os.path.join(out, 'lm', '*.webp'))), '均した状態', dark or 'なし')
PY
# ここまで来たら差し替える
rm -rf "$OUT/lm" && mv "$TMP/lm" "$OUT/lm" && mv "$TMP/scene.glb" "$OUT/scene.glb" && rm -rf "$TMP"
du -sh "$OUT/scene.glb" "$OUT/lm"
