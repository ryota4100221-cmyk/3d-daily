# Day 006 — Typography · Letterform（R3F）

難易度: ★★ / テーマ: タイポグラフィ3D — Text3D（英語ベース）+ 余白、monaka 的ミニマル構図

## 狙い
これまで（Day002）文字は troika `<Text>` の**平面ラベル**として脇役だった。今日は主役を
**本物の押し出し立体タイポ**に。短い一語 “TYPE” を、面取り付きの `Text3D`（three の
TextGeometry）で彫刻のように立ち上げ、余白をたっぷり取った editorial なワードマークにした。
配色はボーン（ほぼ白）1 色に絞り、面取りエッジを走るソフトなリムだけで立体を読ませる（monaka 的抑制）。

## 使った技法
- **★ `Text3D`（今日の新技法）**：drei の `Text3D` に `bevelEnabled` / `bevelThickness` /
  `bevelSize` / `bevelSegments` / `height`（押し出し深さ）を与え、**面取り付きの押し出し文字**を生成。
  面はマット、面取りだけ光を拾う設定で「色ではなく光で形を読む」ミニマル。
- **★ 字形メトリクスからの手動レイアウト（1 段上の完成度）**：フォントを `FontLoader` で
  自前ロードし、`font.data.glyphs[ch].ha`（各字の horizontal advance）と `font.data.resolution`
  から**実寸の送り幅**を算出。`advance × (size/resolution)` を累積して各グリフの x を決め、
  トラッキングを足して中央寄せ。目分量ではなく**書体設計者の詰め**でレイアウトしている。
  → 一語を1メッシュにせず**1文字＝1 Text3D** に分割したのがポイント。
- **per-glyph フロート（動きの新規性）**：グリフごとに位相をずらした `useFrame` の正弦で
  y と rotation.x を微揺れ。x は固定なのでカーニングは崩れず、ワードマークだけが呼吸する。
  全体は `sin(t·0.18)·0.16` の**弱いヨー・スウェイ**（フルスピンはしない editorial 抑制）。
- **ローカル書体 JSON**：three 同梱の `helvetiker_regular.typeface.json` を `public/` に置き、
  `import.meta.env.BASE_URL + ...` で読む。**CDN フェッチ厳禁**（Suspense が刺さって Canvas が
  真っ白になる RUN.md の罠）。ライセンスも同梱。
- **素材**：`meshPhysicalMaterial`（clearcoat 0.55 / roughness 0.42 / metalness 0）で
  陶器のような弱い艶。面取りが手続き IBL を拾う。
- **接地・光**：Day003–005 の文法を継続。手続き Lightformer スタジオ（オフライン安全な IBL）＋
  低いレイキング directional で押し出し側面をモデリング、`ContactShadows` で床に定着。

## 学び
- `Text3D` は「文字を置く」だけなら一語をそのまま渡せば済むが、**1 文字ずつアニメートしたい**
  瞬間にレイアウトを自分で持つ必要が出る。typeface JSON が **advance 幅を持っている**ことを
  使えば、レンダリングを待たずに正確な字送りが組める（非同期フォントロードの二段階測定を回避）。
- 立体タイポは大きくしすぎると即フレーム外に溢れる。**camera 距離 × fov × 語幅**の三点で
  余白を設計するのが Awwwards 的ミニマルの肝。size 2.6→1.7、camera z 11 / fov 30 で
  「一語＋広い余白」に着地。ヘッドレス実写で溢れを検出→是正（ビルド成功≠構図成功）。
- ほぼ白 1 色でも、面取り＋レイキング光＋接地影の三点で立体は十分読める。色を足さないほど
  タイポの骨格そのものが主役になり、monaka のトーンに寄る。

## 次に試したいこと
- Week2 本番へ：`ScrollControls` で単語が組み上がる/ばらける**スクロール連動**、または
  ポインタで各グリフが視差する**マウス追従**。
- 面取りエッジに沿った**リム/フレネル**（Week3 シェーダの布石）でエッジ光をさらに演出。
- `MeshTransmissionMaterial` でガラス製の文字、あるいは押し出しを厚くして**サイド面に別マテリアル**
  （前面ボーン・側面メタル）の 2 マテリアル Text3D。
- 可変フォント風に **height/bevel を時間でモーフ**させ、彫りの深さ自体をアニメートする。
