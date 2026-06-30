# Day 001 — Primitive Forms（R3F）

⭐ 難易度: 1 / WEEK 1 — Foundations

## 狙い
3D Daily の初日。土台となる Vite + React + @react-three/fiber + @react-three/drei の
共通テンプレを立て、4つの基本プリミティブ（box / sphere / torus / icosahedron）を
整然と一列に並べる。テーマは「形そのものの美しさ」を、余白・洗練・ミニマル
（monaka design. のトンマナ）で見せること。

## 使った技法
- **3点ライティング**: key（暖色・影を落とす）/ fill（やや冷たい補助光）/ rim・back
  （背景の紙色からシルエットを分離する逆光）の古典的セットアップ。
- **シャドウ設計**: directionalLight + `shadow-mapSize 2048` + 明示的な
  `orthographicCamera` shadow-camera、`shadow-bias` でアクネ抑制。床は
  `shadowMaterial`（透明・影だけ受ける）にして紙のような軽さを保つ。
- **マテリアルの対比**: graphite / terracotta accent / stone(metal寄り) / bone(flatShading)
  で素材差を出しつつ、配色は1アクセント（テラコッタ球）に絞る。
- **構図**: カメラをやや引き・見下ろし、被写体を上半分の帯に、英語タイポ
  「Primitive *Forms*」を左下に置いて余白を最大化。fog で奥行きを締める。
- **HTMLオーバーレイ**: Inter / 大きめのトラッキングでミニマルな見出し・メタ情報。
- OrbitControls（damping・pan無効・角度/距離クランプ）で軽い回遊性。

## 学んだこと
- 初日の「1段の質」は派手な技法ではなく、ライティングと余白・タイポの設計で出せる。
- 文字とオブジェクトの衝突は構図を濁す。被写体は上の帯、タイポは下、で分離するのが効く。

## 次に試したいこと（Day 002 へ）
- マテリアル比較（standard / physical / toon）と metalness/roughness グリッド。
- Environment / HDRI による反射の導入で、金属表現をスタジオ撮影風に。
- Text3D（drei）でタイポ自体を3D化する選択肢も検討。

## 確認方法
```
cd days/001_primitives
npm install
npm run dev
```
ビルド確認: `npm run build`（成功）。`preview.png` に静止画あり。
