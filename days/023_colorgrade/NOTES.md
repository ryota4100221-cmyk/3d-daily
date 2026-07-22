# Day 023 — Week 4 · Color Grading "Chroma"

**難易度 ★★★★ / テーマ: カラーグレーディング（トーンマッピング + LUT風 + 世界観の統一）**

公開デモ:
https://ryota4100221-cmyk.github.io/3d-daily/days/023_colorgrade/

## 狙い
「同じシーンでも、グレード（カラーグレーディング）ひとつで世界観がまるごと変わる」ことを1本で示す。
被写体（磁器の静物＋テラコッタの残り火）は完全に中立・不変。ドラマはすべて**グレーディング・パス**の中にある。
Day 022 が既製のエフェクト部品＋レンダラ標準ACESに乗っかっていたのに対し、今日は**トーンマップそのものを自作パスが所有する**（`toneMapping: NoToneMapping`）——これが一段の前進。

## 新しく入れた技法
- **カスタム postprocessing Effect（`Effect` サブクラス）で色調全体を1パスに集約**（既製の`<Bloom>`等を並べたDay022から前進）。GLSLの`mainImage`内で表示変換をまるごと実行:
  - `exposure`（stops, `exp2`）→ `white balance`（チャンネルゲイン）→ **ACESトーンマップ（Narkowicz fit, HDR→表示リニア[0,1]）** → `contrast`（ピボット）→ **lift / gamma / gain**（カラリストのトリム）→ `saturation`（luma基準）→ **split-toning**（luma重みでシャドウ/ハイライトに別々の色相を注入）
  - これは**創作LUT（.cube）が焼き込んでいる処理そのもの**をライブ・パラメトリックに保ったもの。「LUT風」を本物のグレード演算で実現。
- **pointer-as-GRADE**（22日連続の pointer-as-light / force / focus に続く新インタラクション）。pointer.x を3つの完成グレード軸 [0..2] にマップし、全パラメータをdampで補間 → 世界が**切替でなく溶暗（dissolve）**で移る:
  - **Bone**（clean・warm neutral）/ **Amber**（golden hour・teal–orange）/ **Nocturne**（cool・quiet・matte）
- レンダラは `NoToneMapping`。合成順は **Bloom(HDR) → Grade(トーンマップ+ルック) → Vignette → Grain**。Bloomは残り火（emissive>1）だけを閾値で拾い、そのハイライトをグレードのハイライトtintが色づける。
- `?grade=0..2` のディープリンクで任意の世界を固定表示（共有可能／スクショ検証用）。

## 実装メモ / 罠
- **JSXを`.js`で書くとViteが変換せず`Expression expected`**。`GradeEffect.js`→`.jsx`にリネームし、`Scene`/`App`のimport拡張子も`.jsx`へ修正して解決。
- **二重トーンマップの回避が肝**。既製ACES（レンダラ）を切り、自作パスがexposure→WB後にACES fitを適用して表示リニア[0,1]を出力。合成器の最後にsRGB OETFが1回だけ乗る（three標準の流儀に一致）。
- スプリットトーンは`pow(luma, balance)`と`pow(1-luma, balance)`の重みで、シャドウ色とハイライト色が中間調で喧嘩しないようにした。
- 環境反射は drei `Environment`＋`Lightformer`の手続きスタジオ（`frames={1}`で1回だけベイク）。HDRIフェッチ無し＝オフライン安全。troika Text不使用で白画面リスク無し。
- headless_shell（swiftshader, 11–12s）で実描画確認。3グレードのスクショで背景ペーパーがwarm→cool へ確実に転ぶこと（＝世界観の統一）を確認。

## 次に試したいこと
- グレードを**実際の3D LUT（`DataTexture3D`）にベイク**して`tetrahedral`補間サンプル、`.cube`読込対応（本物のLUTワークフロー）。
- **luma keyではなく色相/彩度キー**のセカンダリ（skin/sky限定グレードのような選択的補正）。
- グレードとシーン内容の連動（Nocturneでフォグを伸ばす等、Day 024「シーン構築」への布石）。
