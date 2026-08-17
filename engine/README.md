# engine/ — Day 031〜048 で積んだ描画エンジン（卒業済み・棚に置いてある）

> 2026-08-17 に `days/048_plumb/src/` からスナップショットとして切り出した。
> **これは「毎朝の主題」ではない。必要になった日に引き出す棚である。**

## なぜ棚に上げたか

Day 031 から Day 048 まで18日連続で、この1本の技術スレッドだけを掘っていた。
その結果、**実際に画面に映るもの（`rig.js`）が Day 039 から Day 048 まで10日間 md5 完全一致**、
`Scene.jsx` は Day 038 から11日間 1バイトも変わっていない。毎朝変わっていたのは
`ltc.js` / `passes.js` / `shadow.js` の中の**誤差の小数点以下**だけだった。

エンジンとしては本物なので捨てない。ただし**毎朝の献立からは外す**。

## 何が入っているか

| ファイル | 中身 | 由来 |
|---|---|---|
| `Pipeline.jsx` | deferred のパス構成（G-buffer → shadow → volume → composite → TAA → present） | Day 036 |
| `passes.js` | 各パスのマテリアル生成（G-buffer / composite / motes / TAA / present） | Day 031〜 |
| `shadow.js` | 面積光源の PCSS・異方性ペナンブラ・IGN ディザ | Day 036〜037 |
| `ltc.js` | Linearly Transformed Cosines（多角形光源の解析積分・GGX ローブ） | Day 038 |
| `glass.js` | 窓テクスチャの ripmap / ペイン被覆率 / プリマルチプライド開口 | Day 040〜046 |
| `footprint.js` | 異方性フットプリントの支持・面積・傾き（Langevin 中心） | Day 042〜048 |
| `area.js` | 面光源 BRDF・soft terminator | Day 037 |
| `froxel.js` | froxel ボリューメトリック（注入・スキャン・多重散乱・位相関数） | Day 031〜035 |
| `visfit.js` | 遮蔽可視性の当てはめ（クリップ率・エッジ） | Day 047 |
| `noise.js` | 3D value-noise ボリューム | Day 031 |
| `palette.js` | ⚠️ 混在。`FROXEL` / `ATLAS` / `SCAN_STEPS` はエンジン設定、`LIGHT` / `WINDOW` / `SURF` は**あの作品固有の値** | — |

## 使い方 — 🔴 相対 import しない。必要なファイルだけ `src/` にコピーする

```bash
# 例：ボリューメトリックだけ要る日
cp ../../engine/froxel.js  ../../engine/noise.js  src/
```

そして **その日に本当に使うものだけ**を持ってくる（全部コピーしない）。

### なぜ import ではなくコピーなのか（2026-08-17 実測）

`days/NNN/src/` から `../../../engine/` を相対 import すると、**`npm run build` は通るのに
`npm run dev` で画面が出ない**。実際に Vite 5.4.21 で測ったら2段構えで落ちた：

```
① /@fs/…/engine/noise.js  →  403 Restricted
   （Vite の server.fs.strict。日フォルダがプロジェクトルートなので、その外は配信しない）

② server.fs.allow を足して 403 を消すと、今度は 500
   Failed to resolve import "three" from "../../engine/noise.js"
   （engine/ に node_modules が無く、Node は importer から上へ辿るので
     days/NNN/node_modules を見に行かない）
```

ビルドは Rollup がバンドルするので通ってしまう＝**ビルド成功≠描画成功**の典型で、
`preview.png` が空カンバスになって初めて気づく。毎朝の自動ルーティンにこれを踏ませない。

コピーしてよいのは**この棚のファイルだけ**。🔴 **`Scene.jsx` / `rig.js` / `App.jsx`
（＝その日の作品そのもの）は絶対にコピーしない。毎日白紙から書く。**
Day 031〜048 が18日間同じ絵になったのは、まさにそこをコピーしていたから。

**`palette.js` を持ってきた日は、`LIGHT` / `WINDOW` / `SURF` を必ずその日の値に書き直す。**
そのままだと Day 048 の暗い部屋と窓がそのまま出てくる（＝また同じ絵になる）。

## 使うときの1条件

🔴 **エンジンを使ってよいのは、その日の主役がエンジンでないときだけ。**
「LTC の誤差をあと0.5%下げる」は主役にならない。それをやりたくなったら、
それは daily ではなく別トラック（`~/projects/monaka-gl` 側）の仕事。

## 動作確認

このスナップショットは `days/048_plumb` が `npm run build` を通った状態そのもの。
engine 単体のビルドはない（各 day のビルドで検証する）。
