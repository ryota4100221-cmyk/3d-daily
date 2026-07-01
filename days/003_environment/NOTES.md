# Day 003 — Environment · HDRI Reflections（R3F）

難易度: ★★ / テーマ: 環境光とHDRI — スタジオ撮影風の金属

## 狙い
「表面に映り込む“環境そのもの”」を主役にした、スタジオ物撮り風の1カット。
image-based lighting（IBL）で磨いた金属を照らし、鏡面フロアに立たせる。
配色は monaka 的な紙色（#eceae5）+ クローム/ブラス/グラファイトの3素材、
英語タイポは HTML オーバーレイで最小限に（troika の font 罠を回避）。

## 使った技法
- **drei `Environment preset="studio"`** による本物のHDRI（IBL）— これが今日の新テーマ。
- **エラー境界 + Suspense フォールバック（`EnvBoundary.jsx`）** ← 今日の“1段高い完成度”。
  R3F v8 は Canvas 直下を自動 Suspense しないうえ、`<Environment preset>` の
  HDRI フェッチが**失敗すると promise が reject → 描画中に throw → Canvas ツリーごと
  アンマウント**して真っ白になる。preset を「Suspense（読込中）」と
  「ErrorBoundary（失敗時）」の両方で**手続き的スタジオ（Lightformer 群）に
  フォールバック**させ、オフライン/CDNブロックでもシーンが絶対に暗転しない設計にした。
  （実際この環境ではHDRIのCDNが遮断され、フォールバックが正しく発火することを
  ヘッドレスChromeのスクショで確認済み。）
- **`MeshReflectorMaterial`** による実時間の反射フロア（planar mirror + blur + depth）。
  Day001/002 の shadow 床・ContactShadows から一段進めた鏡面フロア。
- **ターンテーブル自動回転 + `OrbitControls autoRotate`**：環境が表面を流れていく様を見せる。
- 手続きスタジオは「高キー明るめのグレー基調 + オーバーヘッドsoftbox + サイドfill +
  リムストリップ + 暗い床half」で構成。クロームが“黒い球”ではなく
  上品なシルバーに映るよう、環境ベースを暗い void ではなく**明るい高キー**にした。

## 学び
- クロームの見え方は 100% 環境依存。暗いスタジオ背景 → 黒い球、明るい高キー → シルバー。
  紙色の上では後者が圧倒的に品よく馴染む。
- HDRI プリセットは便利だが**外部フェッチ＝破綻点**。作品として堅牢にするなら
  必ずフォールバック経路を用意する（今日の EnvBoundary パターンは今後も流用する）。

## 次に試したいこと
- ローカル `.hdr` を `public/` に同梱して `Environment files=` で読む（CDN非依存の本物HDRI）。
- `MeshRefractionMaterial` / `MeshTransmissionMaterial` でガラス素材の環境屈折。
- postprocessing の軽い Bloom + トーンマッピングでハイライトを締める（Week4 先取り）。
- 背景に blur した HDRI を薄く敷いて奥行きを出す版も試す（紙色ミニマル版との比較）。
