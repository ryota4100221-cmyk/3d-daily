# Day 013 — Morph / interpolation（geometry間トランジション）★★★

## 狙い
Week2の「モーフ/補間」。**1つの物体が形を変え続ける**——球 → 角丸キューブ → ジェム → 花（ブルーム）→ リップルを、切り替えではなく**連続補間**で往来させる。lerp/damp をジオメトリそのものに適用し、静物なのに終わらない一本のオブジェクトにする。

## 使った技法（前日までより1段新しい所）
- **真の morph targets（初）**：単一の indexed icosphere（`IcosahedronGeometry(1,5)` を `mergeVertices` で共有頂点化）に `geometry.morphAttributes.position` を4本仕込む。各ターゲットは単位球の頂点方向 n を形状関数で写像し、**base からの差分（delta）**として格納（`morphTargetsRelative = true`）。
- **morph NORMALS も同梱**：ターゲット絶対位置で一時ジオメトリを組んで `computeVertexNormals` → base normal との差分を `morphAttributes.normal` に格納。これで**補間の全中間フレームでライティングが破綻しない**（法線が形に追従する）。ここが「1段高い完成度」の肝。
- **damped influence cursor**：`morphTargetInfluences` を現在フォームの one-hot ベクトルへ `MathUtils.damp` で寄せる。フォーム間の中間（例 cube 0.5 / gem 0.5）が自然なブレンド形になり、"never stops interpolating" を体現。
- 形状関数：p-norm 超楕円体（e=4 角丸キューブ / e=1.55 ジェム）、球面角の低周波うねり（ブルーム）、極方向の正弦リング（リップル）。すべて手続き生成・オフライン安全。
- 手続きグラデ環境（canvas → `PMREMGenerator`）で clearcoat に上品な映り込み。HDRIフェッチ無しでオフライン安全。`meshPhysical`（clearcoat + sheen）でポーセリン/石質感。
- 影付きディレクショナル + 温色リム、`shadowMaterial` の設置面で浮遊感のあるソフトシャドウ。ポインタ視差 + 緩い自転 + 微呼吸スケール。

## ハマり所（記録）
- **R3F罠**：`<mesh>` は先に生成→後から geometry を代入するので `Mesh.updateMorphTargets()` が走らず `morphTargetInfluences` が undefined のまま。three の `WebGLMorphtargets.update` が `.length` を読んで**毎フレーム例外→3D全消え**（ビルドは通るのに白画面）。対策：`morphTargetInfluences={[0,0,0,0]}` を prop で明示的に初期化（+ 保険で useEffect の `updateMorphTargets()`）。ヘッドレス実描画チェックで検知できた（ビルド成功≠描画成功）。

## 次に試したいこと
- morph を GPU 頂点シェーダに移し、ターゲット数を増やして per-vertex に別々のタイミングで到着させる（波状モーフ）。
- ポインタで能動的にフォームを選ぶ / スクロールで章立て遷移（Day010の応用）。
- Week3のシェーダに入るので、morph の境目に薄いフレネル・リムやディゾルブ演出を重ねる。
