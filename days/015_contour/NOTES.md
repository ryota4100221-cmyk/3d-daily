# Day 015 — Week 3 · Shaders "Contour"

**難易度 ★★★ / テーマ: shaderMaterial 入門（uv 可視化・時間 uniform で色を流す）**

## 狙い
Week3（GLSL）の初日。画面全体を **たった1枚のフラグメントシェーダ**で描く。
ノイズの高さ場を等高線（isolines）に切り出した「動く地形図」を、紙のトーン・大きな英語タイポ・
余白の monaka 系構図で仕上げる。ジオメトリもライトもテクスチャも使わず、**全ピクセルが数式**。
Day012 の生 `THREE.ShaderMaterial`（`<points>` の GPU パーティクル）から一歩進め、
今回は **drei の宣言的 `shaderMaterial` ヘルパ + `extend`** でカスタムマテリアルをコンポーネント化
（`<contourMaterial />`）したのが今週の新技法。

## 使った技法
- **drei `shaderMaterial` + `extend`（新技法）**: `shaderMaterial(uniforms, vert, frag)` でマテリアルクラスを生成し、
  `extend({ ContourMaterial })` で JSX 要素 `<contourMaterial ref={...} uTime uAspect uPointer uHover />` として宣言的に使う。
  uniform 名がそのまま props/フィールドになるので、生 ShaderMaterial の `uniforms.uX.value = ...` より読みやすく R3F らしい。
- **フルスクリーン・クリップ空間クアッド**: `planeGeometry(2,2)` を頂点シェーダで `gl_Position = vec4(position.xy, 0, 1)` に
  直接置き、**カメラを完全に無視**して常に画面を覆う。`frustumCulled={false}` でカリング回避。
- **等高線（contour isolines）+ 導関数アンチエイリアス**: 依存ゼロの値ノイズ fBm（hash→quintic→5 オクターブ）を高さ場 `field` とし、
  `f = field·DENSITY` の整数レベルへの距離を `fwidth(f)`（画面空間の導関数）で正規化して `smoothstep` で細線化。
  ピクセル密度に依らず一定太さの滑らかな線になる（`extensions.derivatives` を有効化）。5 本ごとに太い主曲線。
- **時間 uniform で流す**: `uTime` でサンプル座標をゆっくり回転＋ドリフトさせ、地形が潮のように動く。
- **ポインタでドメインワープ（Day008/009 の damp を GLSL へ）**: NDC ポインタをアスペクト空間に直し `THREE.MathUtils.damp` で
  平滑化して uniform 化。シェーダ内でカーソル周辺のサンプル座標を放射状に押し出し（`exp(-d²/σ²)`）、等高線が**割れて**、
  近傍の線を**テラコッタに温める**。カーソルを離すと `uHover` が damp で 0 に戻り自然復元（ステートレス）。
- **紙の質感**: 高さ場の勾配から擬似法線を作りエンボス風のレリーフ陰影、微細グレイン、ソフトなビネット。
- **色管理**: `<Canvas flat>`（トーンマッピング無効）で紙色を正確に。sRGB パレットをシェーダ内で `pow(2.2)` して線形空間で合成・出力。
- **オフライン安全**: フェッチ無し・ノイズインライン・troika Text 不使用（白画面トラップ回避）。

## ハマり / 学び（重要）
- **テンプレートリテラル内 GLSL のバッククォート禁止**: GLSL を `/* glsl */\`...\`` で書いているため、コメント中に
  `` `flat` `` のようなバッククォートを入れると**そこで文字列が閉じて** esbuild が構文エラー（`Expected ";"`）。
  → コメントからバッククォートを除去。
- **ヘッドレスは old headless 廃止**: `chrome-linux/chrome` は `--headless=old` 廃止で即終了。
  → `chromium_headless_shell-*/chrome-linux/headless_shell` を `executablePath` に使うと安定。実描画で isolines と warp を確認。
- ビルド成功≠描画成功。今回もヘッドレスで2枚（flow / warp）撮り、テラコッタの温まりと放射ワープが出ることを確認した。

## 次に試したいこと（Week3 の続き）
- Day016（頂点シェーダ変位）: この高さ場を実ジオメトリに載せ、面を sin 波／ノイズで歪ませて立体の地形に。
- 主曲線に沿った標高ラベル（数値タイポ）や、等高線の"色流し"を uv 依存で。
- ポインタワープを curl 場と組み合わせ、線が渦を巻く演出へ。
