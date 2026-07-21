# Day 022 — Week 4 · Post-processing "Aperture" (★4)

**テーマ:** ポストプロセス — Bloom / Depth of Field / Vignette / Film Grain の重ね方
(Curriculum Week 4-22)

## 狙い
Week 3までは「シーンそのもの」を作ってきた（形・素材・光、そしてGLSLで面や体積を描いた）。Week 4は**フレームを仕上げる**週。今日の主役はシーンではなく**コンポジタ**。ごく普通のライティング付き three.js ジオメトリ（磁器のペブル群＋数個のテラコッタの残り火が霞へ後退する静物）を組み、レンダリング後のHDRフレームを一連のフルスクリーンパスに通す。

## 新しく入れた技法（前日からの前進）
- **EffectComposer スタック（`@react-three/postprocessing`）— 本プロジェクト初のポストプロセス。** 21日間シェーダで「1パスで全部やる」方向に来たが、今日は逆に**描いた後の合成**で画を作る。
  - **Depth of Field**：深度バッファ基準の本物のボケ。フォーカス面だけがシャープで他は溶ける。**カーソルがフォーカス面を奥行き方向にラック（pointer-as-focus）**——21日続いた pointer-as-light / pointer-as-force に対する新しいインタラクション。`dofRef.current.target` を毎フレーム damp した world 点で `.copy()` してオートフォーカスを走らせる（再レンダーせず effect を直接ミューテート）。
  - **Bloom（mipmapBlur + luminanceThreshold 0.92）**：残り火だけ `emissiveIntensity` で 1.0 を超えさせ、閾値を越えた残り火のみが HDR で滲む。磁器はマットのまま。
  - **Vignette**：四隅を落として静物を写真のように縁取る。
  - **Film Grain（Noise, OVERLAY blend）**：紙のフラットさを崩し、bloom と bokeh を1枚の写真として統一。
- **合成順序が肝**：DoF と Bloom は HDR で走らせ、その後 vignette / grain で仕上げる。レンダラは ACES トーンマップを維持（emissive > 1 が bloom するため）。

## 学び / ハマり
- **ACES が中間調を潰す**：磁器色 `#ece6da` を控えめライトで当てたら、ACES トーンマップで沈んで「泥っぽい茶」に見えた（初回render）。色じゃなく**照度不足**が原因。hemi 0.55→1.05・key 1.7→2.7・前方フィル追加・材質色 `#f3eee5` へ持ち上げて、狙い通りの発光する骨色磁器に。高キーを出すには「材質を明るく」より「光を足す」方が効く。
- **swiftshader の警告**：ヘッドレス実描画で `glBlitFramebuffer: Read and write depth stencil attachments cannot be the same image` が出るが、これは DoF の深度パスと ANGLE/swiftshader の相性による既知ノイズで、実描画は正常（bloom・bokeh・grain すべて出ている）。実機WebGLでは出ない。
- **構図**：初回は近景の大玉が中央〜左下に被さって見出しを潰した。レイアウトの x を +0.9 / y を +0.55 バイアスして質量を右上へ寄せ、左下の見出し余白を確保（021 と同じ「ヒーローは中央右、タイポは左下」の型）。
- troika Text 不使用・全手続き生成・オフライン安全。headless_shell swiftshader 実描画 12s で bloom/bokeh/vignette/grain を確認。

## 次に試したいこと（Week 4 の続き）
- Day 023 カラーグレーディング：トーンマッピング比較＋LUT風（`LUT`/`HueSaturation`/`BrightnessContrast` エフェクト）で世界観のトーンを統一。
- Selective Bloom（`SelectiveBloom` / layers）で残り火だけを厳密に選択し、磁器ハイライトの巻き込みをゼロに。
- DoF の `target` を実オブジェクトに追従させる autofocus（近くのペブルに吸着）や、被写界深度メーターのHUD可視化。
- Bloom の kernel サイズ・dirt テクスチャ、TiltShift でミニチュア感。
