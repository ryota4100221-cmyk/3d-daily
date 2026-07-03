# Day 005 — Instancing · Kinetic Field（R3F）

難易度: ★★ / テーマ: インスタンシング入門 — InstancedMesh で 2,304 個を格子状に

## 狙い
Week1 前半の「静物」から一転、**大量の同一形状を 1 ドローコールで動かす**回へ。
48×48＝2,304 本のスレンダーな石膏ピラーを格子に並べ、中心から外へ伝わる**放射状の波**で
砂丘のように起伏させる。色は greige→bone の 2 ストップだけに絞り、動きが
「面の上を掃く光」に見えるようにした（monaka 的ミニマル・ほぼモノクローム）。

## 使った技法
- **★ `InstancedMesh`（今日の新技法）**：2,304 個を **1 つの draw call** で描画。
  R3F では `<instancedMesh args={[undefined, undefined, count]}>` に geometry/material を
  子で渡す。全体像がたった 1 メッシュなのが要点。
- **毎フレームの per-instance 行列書き換え**：`useFrame` 内で `Object3D` の
  scratch を使い回し、各インスタンスの position/scale を計算 → `setMatrixAt(i, matrix)` →
  最後に `instanceMatrix.needsUpdate = true`。ピラーは高さ 1 の box を **Y だけスケール**し、
  接地させるため `position.y = h/2`。
- **per-instance カラー（`setColorAt` / `instanceColor`）**：高さに応じて LOW→HIGH を
  `Color.lerp` し、波の山＝明・谷＝暗のトーンを付けた。`instanceColor.needsUpdate` も毎フレーム。
- **波の設計**：`env = exp(-r²/2σ²)`（中心ほど大きく振れるガウス）× `sin(t - r·freq)`
  （外へ進む正弦波）。端も `0.32 + 0.68·env` で最低限リップルさせ、フィールド全体が生きる。
- **パフォーマンスの肝＝scratch 使い回し**：`Object3D`/`Color` を useFrame の外で 1 個だけ生成。
  2,304×60fps で毎回 `new` すると GC が破綻する。「ジオメトリはタダ、per-frame の簿記で勝負が決まる」。
- **接地**：2,300 個の動く影に shadow map を払わず、スクリーン空間 `ContactShadows` で床に定着。
- Day003 の教訓どおり **手続き IBL（Lightformer 3 灯）のみ**でオフライン安全に。

## 学び
- InstancedMesh は「1 ドローで N 個」だけでなく、**per-instance の matrix/color を毎フレーム
  更新する**ところまでやって初めて“動く群”になる。ネックは描画ではなく CPU 側の行列計算・
  転送なので、scratch 使い回しと「静的データ（x,z,r）は useMemo で 1 回だけ」の分離が効く。
- トーンを高さに連動させると、動きが**光のスウィープ**として読める。色を増やさず陰影だけで
  情報量を出すのが monaka 的で、Awwwards 系のミニマル物量表現に近づく。
- ヘッドレス確認：ソフトウェア GL だと 2× スケールの `screenshot` 読み戻しが重く 30s で
  タイムアウト → DSF=1 + timeout 延長で解決。Google Fonts の外部読込は networkidle を
  妨げるので route で abort。ビルド成功≠描画成功を今日も実写で担保（波のクレーター確認）。

## 次に試したいこと
- Week2（useFrame/マウス追従/スクロール）へ：波の中心を**ポインタ追従**にして対話化。
- per-instance の回転も足し、起き上がり/倒れのモーフ的トランジション。
- `InstancedBufferAttribute` を直接使った GPU 寄りの制御、あるいは頂点シェーダで波を計算して
  CPU 負荷をゼロに（Week3 のシェーダ回への布石）。
- 数を 1 万本規模に上げて LOD/フラスタムの限界を測る。
