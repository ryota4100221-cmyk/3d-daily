# 3D Daily — 進捗ログ

> 完了した日をここに1行ずつ追記する。毎朝のエージェントは「最後の行」を見て次の番号を判断する。

| 日付 | No. | テーマ | フォルダ | 学んだ技法 / 一言 |
|------|-----|--------|----------|-------------------|
| 2026-06-30 | 001 | プリミティブ群（★1） | days/001_primitives | 3点ライティング / shadowMaterialの床 / マテリアル対比 / ミニマル英語タイポ構図 |
| 2026-07-01 | 002 | マテリアル比較（★1） | days/002_materials | Lightformer手続きIBL / physical clearcoat / toon gradientMap自作 / metalness×roughnessグリッド / drei Text(ローカルフォント同梱) |
| 2026-07-02 | 003 | 環境光とHDRI（★2） | days/003_environment | Environment preset(HDRI/IBL) / ErrorBoundary+Suspenseで手続きスタジオへ堅牢フォールバック / MeshReflectorMaterial鏡面フロア / ターンテーブル自動回転 / 高キー環境でクローム物撮り |
| 2026-07-03 | 004 | 影と床（★2） | days/004_shadows | AccumulativeShadows+RandomizedLight(8灯を時間蓄積した物理的ペナンブラ) / 静物は完全静止・動きはスローカメラのみ / 低いraking lightで余白へ伸びる影 / マット石膏マテリアル / 手続きIBLのみでHDRIフェッチ廃止 |
| 2026-07-04 | 005 | インスタンシング入門（★2） | days/005_instancing | InstancedMesh 1ドローで2,304本のピラー / useFrameで毎フレームsetMatrixAt+setColorAt / ガウス×正弦の放射状ウェーブ / per-instanceカラーで高さ→トーン / scratch使い回しでGC回避 / 静的データはuseMemo / ContactShadowsで接地 |
| 2026-07-05 | 006 | タイポグラフィ3D（★2） | days/006_typography | Text3D(押し出し+面取り)で"TYPE"を主役化 / typeface JSONのha(advance)から手動グリフレイアウト / 1文字=1 Text3Dでper-glyphフロート(位相ずらし正弦) / 弱いヨー・スウェイ / ローカル書体JSON(CDN禁) / meshPhysical陶器質感 / camera距離×fov×語幅で余白設計 |
| 2026-07-06 | 007 | Week1まとめ・Flow Field（★2） | days/007_flowfield | Day005を1段磨き直し / 依存ゼロfBm value-noise(整数ハッシュ+quintic)で有機的な流れ場 / 勾配2点サンプルでper-instanceヨー→流れのgrain / 高さ・色・回転をper-instance書込(1ドロー) / 円形プレート+smoothstepエッジフェード / capsuleブレード / hemisphereライト+emissive輝度フロアでハイキー堅牢化(IBL非依存) / ほぼ俯瞰の地形図構図 |
| 2026-07-08 | 008 | Week2・useFrame基礎/Breathe（★2） | days/008_useframe | モーションを回転・浮遊・呼吸の3チャンネルに分解 / delta累積回転でフレームレート非依存の角速度(elapsedTime依存のDay007から前進) / 位相オフセット正弦で浮遊・呼吸が列を伝うtravelling wave / THREE.MathUtils.dampで登場イージング＆スウェイ(非依存) / 外group=浮遊+呼吸/内mesh=回転の入れ子でモーション非干渉 / meshPhysical共用でテラコッタ球のみclearcoat / 手続きIBLで高キー・オフライン安全 |
