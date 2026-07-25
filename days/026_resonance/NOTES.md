# Day 026 — サウンド連動 / Resonance（★5）

Week 4 の任意テーマ「サウンド連動」。25日間ずっと入力は **ポインタ**だった
（light / force / focus / grade / sun / director）。今日はじめて **音そのものを入力**にした。
生成的なアンビエントを WebAudio でその場合成し、その FFT スペクトルで 3D を駆動する。

## 狙い
- 音に反応するビジュアル。だが mp3 を fetch せず **100% オフライン・アセットゼロ**で成立させる
  （headless ビルド／GitHub Pages でそのまま動く）。→ 音楽自体を WebAudio グラフで合成。
- monaka のトンマナ（紙・墨・テラコッタ / 余白 / 英語タイポ）を崩さず、
  「生成的な楽譜が物質になる」静かなヒーロー構図に。

## 新しく入れた技法（前日までの自分から1段）
1. **生成的 WebAudio エンジン（`audio.js`）が“音源”** — A1 マイナーペンタトニックの
   アルペジオ＋ドローンパッド＋やわらかいキック。**先読みスケジューラ**（A Tale of Two Clocks 方式、
   `currentTime + 0.18` 先までノートを予約）でクリック無しに音を並べ、フィードバックディレイ2本の
   簡易アルゴリズミック・リバーブで空気を足す。**24日間の“ポインタ＝入力”から“音＝入力”への転換。**
2. **`AnalyserNode` の FFT（fftSize 2048）を毎フレーム解析** → 対数カーブで 96 bin に
   ダウンサンプル、bass/mid/treble 3 帯域＋レベルを平滑化、**bass のオンセット差分で beat パルス**を検出。
3. **スペクトルが形になる** — 96本のロッドを 1 ドロー `InstancedMesh` で円環に配置し、
   高さ＝各周波数 bin、大きい bin ほどテラコッタに温める（Day005/009/014 のインスタンス系譜を
   “音の入力”で駆動）。中央の共鳴体は頂点シェーダで **fBm＋bass 変位＋beat リップル**、
   面法線は `dFdx/dFdy` によるスクリーン空間微分で**変位後サーフェスから再構築**（Day016 の解析法線を
   派生に置換）＋フレネル・テラコッタ縁光り（Day018）。
4. **オフライン安全＆常時生きてる**：音が無い時（headless／ジェスチャ前）は
   合成スペクトルにフォールバックし、シーンが死なない。ポスプロは不使用—— beat のブルームは
   加算ブレンドのグローsprite（`<Canvas flat>` + 手動sRGBのシェーダと色空間が一貫）。
5. **ポインタは“指揮者”に降格**：x→テンポ、y→ブライトネス（lowpass cutoff）。主役は音。

## 罠 / メモ
- `<color attach="background">` と `<fog attach="fog">` は **scene の直下**に置かないと効かない。
  `<group>` の中に入れると group に attach され no-op → 背景が黒くなった。フラグメント直下に出して解決。
- drei `ContactShadows` が swiftshader で**不透明なグレーの床面**として描かれ、紙に浮く monaka 感が崩壊。
  → 自前の**アルファ放射グラデ平面（NormalBlending）**の“接地プール”に置換。予測可能で軽い。
- `<boxGeometry onUpdate={g=>g.translate(...)}>` は onUpdate が繰り返し発火してロッドが毎回上へ
  累積移動 → `useMemo` で **一度だけ** translate した geometry を `instancedMesh args` に渡す形へ。
- headless swiftshader は **virtual-time を長く**すると（10s+）コンテキストが不安定で空カンバス化。
  6–8s の窓で実描画を確実に捕捉（実 GPU の GitHub Pages では非再現）。gate/scene 両方で確認済み。

## 次に試したいこと
- 実オーディオ入力（マイク or ファイル）へ切替可能に、`getUserMedia` の許可フローと合わせて。
- スペクトルを円環だけでなく**中央体のディスプレイスメントにも**周波数ごとに割り当て（音の“地形”）。
- Week4 の締め（Day027 Awwwards 再現 / Day028 月次ベスト）に向け、この音×形をポスプロ（bloom/DOF）と統合。
