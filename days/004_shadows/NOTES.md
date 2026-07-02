# Day 004 — Cast Shadows · Ground（R3F）

難易度: ★★ / テーマ: 影と床 — 白基調・余白のミニマル静物

## 狙い
「影そのものを主役にした」白 on 白の石膏静物。色数をほぼ捨て（bone / greige /
graphite の 1 アクセントのみ）、紙色の床に落ちる**やわらかい影の階調**で画をもたせる。
monaka 的な余白・非対称配置で、球・アーチ・キューブの 3 つを離して置く。

## 使った技法
- **★ drei `AccumulativeShadows` + `RandomizedLight`（今日の新技法）**
  Day001 のハードな directionalLight 影・Day003 のスクリーン空間 `ContactShadows` から
  一段進めて、**ランダムに散らした複数ライト位置から何フレームにも渡って影を焼き込む**
  手法に。`temporal frames={120}` で 8 灯（`amount=8`）の shadow map を時間方向に
  蓄積 → 接地点は締まり遠ざかるほど滲む、**物理的にそれらしいペナンブラ**が得られる。
  ライトは後方右・低め（`position=[5,4.5,-4]`, `radius=3.5`）に置いて、
  手前の**余白へ長く伸びる影**を作った（影を落とすための負のスペース設計）。
- **静物＝完全静止**という判断：`AccumulativeShadows` は蓄積するので、被写体が動くと
  影がスミアする。あえて Float 等の動きを外して**影を最高にシャープ**にし、
  「動き」は `OrbitControls autoRotate` の**ゆっくりしたカメラ周回**だけに担わせた
  （カメラは影の蓄積を壊さない）。ここが Day003 の回転テーブルからの発想の反転。
- **手続き IBL のみ（外部 HDRI フェッチを廃止）**：Day003 で HDRI の CDN 遮断＝破綻点だと
  学んだので、今日は `Lightformer` 3 灯（overhead key + 冷暖サイド fill）だけの
  オフライン安全な env に。フェッチが無い＝真っ白クラッシュのリスクも無いので
  EnvBoundary は不要にできた（堅牢性を構成レベルで担保）。
- **マット石膏マテリアル**：`meshStandardMaterial roughness≈0.9 / metalness=0`。
  Day002/003 の金属・クロームから真逆へ振り、影が“物理的に効く”下地にした。

## 学び
- `AccumulativeShadows` の質は **ライトの高さ・radius** でほぼ決まる。真上＋大 radius だと
  影が被写体直下に潰れて薄く見えない。**低い raking light + 控えめ radius** で
  余白に伸ばすと一気に静物写真のように締まる（1 回目のショットで薄すぎ→調整で解決）。
- 蓄積系の影は「静止画・スローカメラ」の作品と相性が抜群。動くシーンには
  `ContactShadows`/`SoftShadows`、静物には `AccumulativeShadows`、と使い分けが見えた。
- ビルド成功≠描画成功。ヘッドレス Chrome の実写確認で「影が薄い」ことに気づけた（RUN.md の教訓通り）。

## 次に試したいこと
- `SoftShadows`（PCSS 風・リアルタイムで動く被写体でも柔らかい影）との比較。
- ローカル `.hdr` を `public/` 同梱で本物 IBL（CDN 非依存）にし、環境反射も足す。
- Week2 に向けて、被写体をゆっくり呼吸させつつ影は `ContactShadows` に切替える動的版。
- 影の色を無彩ではなく env の補色でわずかに色づけ（写真的なカラーキャスト）。
