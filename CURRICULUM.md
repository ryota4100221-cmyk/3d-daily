# 3D Daily — Curriculum（段階的高度化ロードマップ）

> 毎朝のエージェントはこの表を上から順に消化する。
> 各週でテーマの「層」が一段深くなる。完了済みは `PROGRESS.md` を見て判断し、**未完の一番若い番号**に取り組む。
> 1日1テーマ。React Three Fiber (R3F) + Vite。Awwwards水準のビジュアルを常に意識する。

凡例: ⭐ = 難易度（1〜5）

## WEEK 1 — Foundations（形・素材・光）⭐1〜2
1. ⭐1 プリミティブ群 — box/sphere/torus/icosahedron を整然と配置、ライティング3点
2. ⭐1 マテリアル比較 — standard / physical / toon を並べ、metalness/roughnessグリッド
3. ⭐2 環境光とHDRI — Environment preset で反射、金属球のスタジオ撮影風
4. ⭐2 影と床 — ContactShadows / AccumulativeShadows、白基調の余白構図
5. ⭐2 インスタンシング入門 — InstancedMesh で1000個のオブジェクトを格子状に
6. ⭐2 タイポグラフィ3D — Text3D（英語ベース）+ 余白、monaka design.らしいミニマル構図
7. 週次まとめ — Week1で一番良かった表現を1つ磨き直す

## WEEK 2 — Motion & Interaction（動きと対話）⭐2〜3
8. ⭐2 useFrame基礎 — 回転・浮遊・呼吸するアニメーション
9. ⭐3 マウス追従 — ポインタでカメラ/オブジェクトが反応、視差
10. ⭐3 スクロール連動 — ScrollControls でシーンが展開する1ページ体験
11. ⭐3 物理 — @react-three/rapier で落下・衝突・積み上げ
12. ⭐3 パーティクル — Points で粒子フィールド、マウスで乱れる
13. ⭐3 モーフ/補間 — geometry間トランジション、lerp/damp
14. 週次まとめ — Week2のインタラクションを1つ完成度高く

## WEEK 3 — Shaders（GLSL）⭐3〜4
15. ⭐3 shaderMaterial入門 — uv可視化、時間uniformで色を流す
16. ⭐4 頂点シェーダ変位 — sin波・ノイズで面を歪ませる
17. ⭐4 フラグメントノイズ — simplex/perlinノイズのグラデーション
18. ⭐4 フレネル — リムライト/ガラス質感の縁光り
19. ⭐4 ディゾルブ/ホログラム — アルファとノイズで出現演出
20. ⭐4 流体/墨流し風 — ink-lab系の表現（移流・拡散の擬似）
21. 週次まとめ — Week3のシェーダを1つ作品レベルに

## WEEK 4 — Composition & Polish（演出と仕上げ）⭐4〜5
22. ⭐4 ポストプロセス — Bloom / DOF / Vignette / Noise の重ね方
23. ⭐4 カラーグレーディング — トーンマッピングとLUT風、世界観の統一
24. ⭐5 シーン構築 — 上記を組み合わせた「世界」を1つ（ライティング+シェーダ+ポスプロ）
25. ⭐5 ローディング/トランジション — シーン遷移の演出設計
26. ⭐5 サウンド連動 — md-playerの知見を活かし音に反応するビジュアル（任意）
27. ⭐5 Awwwards再現 — 受賞サイトのキー演出を1つ分解して再現
28. 月次まとめ — この4週で最高の1本を選び、ポートフォリオ品質まで磨く

## 29日目以降 — ループ＆深化
- 上記テーマを「より高い難易度の変奏」で再訪する。
- 毎回「前回の自分より1つ新しい技法 or 1段高い完成度」を必ず入れる。
- ネタ切れ時は国内外ギャラリー（Awwwards / codrops / Three.js examples / shadertoy）から1件分解して再現。
