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
| 2026-07-09 | 009 | Week2・マウス追従/Attend（★3） | days/009_pointer | 場全体がカーソルに“注意を向ける”1,564本ロッドのInstancedMesh(1ドロー) / raycast→y=0平面でNDCポインタを実ワールド座標に変換(奥行き獲得) / dampで重み付き追従(delta習慣を入力へ転用) / per-instanceでリーン軸cross(up,dir)＋Gaussian近接度exp(-d²/2σ²)を計算し行列と色を毎フレーム書込 / 近いほど倒れ・伸び・テラコッタに色づく / ジオメトリを根元へtranslateしピボットを地面に / OrbitControls廃止しカメラをポインタ視差に / 奥はフォグに溶ける果てなき原 / 手続きIBLで高キー・オフライン安全 |
| 2026-07-10 | 010 | Week2・スクロール連動/Ascend（★3） | days/010_scroll | ScrollControls＋useScroll().offsetを“単一0..1のタイムライン”に据えキーフレーム化カメラ飛行を毎フレーム補間 / 1,120本の放射状バーをInstancedMeshで螺旋(helix)に巻いた“塔” / スクロール波面front=f(offset)が塔を昇り、下はsmoothstepでsettle・波面はGaussianで暖色bloom・上は休眠(scale0)——行列と色を波面基準で毎フレーム書込(Day009の応用) / スクロールを戻すと正確に解体(トリガーでなくトランスポート) / カメラ高さと波面高さを同式frontOfで結び章が変わっても構図安定 / <Scroll html>でDOM章を3Dと一体スクロール / 手続きIBLのみでオフライン安全・troika Text不使用で白画面回避 |
| 2026-07-11 | 011 | Week2・物理/Repose（★3） | days/011_physics | @react-three/rapier物理(WASM base64インライン→オフライン安全)で丸フォームが浅い皿へ落下・衝突・スタックする“終わらない静物” / 命令的リサイクリングプール——N=40 bodyを1つのuseFrameからRapier API(setTranslation/setLinvel/setGravityScale/sleep/applyImpulse)で駆動し最古parkをspawn・容量到達(LIVE=22)で最古liveをretire(フェード→park)しシミュを有界かつ無限に保つ / コライダは固定サイズ・見た目メッシュのscaleのみdampでイン/アウトしテレポートを隠蔽 / クリックでraycast→ワールド点(Day009流用)を種にexp(-d²/2σ²)ガウス重みのインパルスで山を突き上げ=ポインタを“力”へ / 固定timeStep=1/60＋厚床スラブ＋ccdでトンネリング対策(可変timeStepは低FPSで床貫通したため撤去) / スポーンはelapsedTimeでウォールクロック管理しフレーム落ち耐性 / 手続きIBLのみ・troika Text不使用で白画面回避 |
