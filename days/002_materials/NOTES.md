# Day 002 — Material Studies（R3F）

⭐ 難易度: 1 / WEEK 1 — Foundations

## 狙い
Day 001 の「形」に続き、今日は **マテリアル（陰影モデル）そのもの** を主題にする。
カリキュラム No.2「standard / physical / toon を並べ、metalness/roughness グリッド」を、
スペックシートのような editorial 構図で見せる。左に3つの陰影モデルの比較列、
右に metalness × roughness の 5×5 スタディ。配色・余白は monaka design. のトンマナを継承。

## 前日からの「1段」
Day 001 は3点ライティング + shadowMaterial の床だけだった。今日は反射を扱うために
**IBL（イメージベースドライティング）** を導入し、material の差が「ちゃんと読める」ところまで持ち上げた。

## 使った技法（新規）
- **手続き的スタジオ環境（Lightformer × Environment）**: HDRI ファイルを外部から取得せず、
  `<Environment>` の中に rect / circle の `Lightformer` を配置して反射ソースを自作。
  オフラインでも動き、製品撮影のような映り込みを完全にコントロールできる。
- **meshPhysicalMaterial の clearcoat**: clearcoat=1 / clearcoatRoughness=0.12 + sheen で
  「漆・車塗装」的な二層ハイライト。standard との差を一目で出す。
- **meshToonMaterial + 自作 gradientMap**: 4段の 1D `DataTexture`（RedFormat・NearestFilter）を
  ランプとして渡し、光を硬いバンドに量子化。セルシェードの階調を手で設計。
- **metalness × roughness グリッド**: 5×5 を `useMemo` でパラメトリック生成。
  横=roughness、縦=metalness。PBR を最短で読むための古典的スタディ。
- **3Dタイポグラフィ（drei `Text` / troika）**: 軸ラベル "ROUGHNESS →" "METALNESS ↑"、
  モデル名 STANDARD / PHYSICAL / TOON をシーン内に英語タイポで配置。
- **ContactShadows**: 全体を1枚のソフトな接地影で束ね、紙のような軽さを維持。

## 学んだこと / 判断メモ
- drei `Text`（troika）は **デフォルトフォントを CDN から fetch** し、これが `<Canvas>` の
  Suspense 境界を巻き込んで止めるため、フォント取得が失敗するとシーン全体が真っ白になる。
  → Liberation Sans を **使用グリフ（ASCII + 矢印）だけにサブセット**し、`data:` URI として
  JS に埋め込んで `font={fontUrl}` で渡す。約9KB・ネットワーク非依存・バイナリ資産ゼロで堅牢。
  （`pyftsubset --unicodes=U+0020-007E,U+2190-2193` でサブセット化）
- toon は色が暗すぎるとバンドが見えない。中間トーン（warm gray）にしてセル階調を可視化。
- 比較は「色を固定して陰影モデルだけ変える」のが本来は最も厳密。今回は editorial さ優先で
  physical をテラコッタにしてアクセントを残した（standard=stone / toon=warm gray）。

## 次に試したいこと（Day 003 へ）
- 本物の HDRI（Environment preset）で反射の質をさらに上げ、金属球のスタジオ撮影風を詰める。
- AccumulativeShadows / ContactShadows の質感比較、白基調の余白構図（カリキュラム No.4 の布石）。
- gradientMap の段数・配色を変えたトゥーンのバリエーション。

## 確認方法
```
cd days/002_materials
npm install
npm run dev
```
ビルド確認: `npm run build`（成功 / 620 modules）。`preview.png` に静止画あり（drag で周回可）。
