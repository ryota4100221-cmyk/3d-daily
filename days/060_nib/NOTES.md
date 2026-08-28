<!-- TAGS
source: https://corporate.saisoncard.co.jp/company/brand/font/
subject: 文字
framing: アイレベル
ground: 明
motion: 入力駆動
palette: 2色
device: ニブの角度（the nib angle）— 字は輪郭を持たない。持っているのは骨格（線分と円弧のリスト）と、ペン先ひとつだけ。太さは w = W·|sin(φ − θ)| で毎フレーム決まる。θ を回すと同じ骨格から等幅の SAISON Sans とコントラストのついた SAISON Sans Advance が出る。太らせるのは頂点シェーダの仕事で、CPU は uNib を1つ書き換えるだけ
-->

# Day 060 — The Nib Angle

再現元: **CREDIT SAISON TYPEFACE**（クレディセゾンのコーポレートフォント紹介ページ）
https://corporate.saisoncard.co.jp/company/brand/font/

## 何を再現したか

このサイトの主題は「2つの書体」だ。Fontworks と作った **SAISON Sans**（既存ロゴタイプに従う
geometric sans）と、**SAISON Sans Advance**（同じ骨格に、カリグラフィを思わせる線幅の
ゆらぎを足したもの）。ページは A B C D E F … と字を並べた見本帳で、ジャイロで傾けると
見え方が変わる。

再現したキー演出は、この **2書体の「あいだ」** ひとつに絞った。
装置は 幾何 ではなく **シェーダ** でできている。

## 分解した装置 — ニブの角度（the nib angle）

geometric sans は「O がほぼ真円、ストロークがほぼ等幅」という書体で、つまり字は
**輪郭（outline）ではなく骨格（skeleton）＋太さ（weight）** で書ける。

- `glyphs.js` は骨格だけを持つ。A–Z を **線分と円弧のリスト**として書いた。太さは1つも入っていない。
- 太さは平筆のペン先（nib）から出す。進行方向 φ とペン先の角度 θ の差で、紙に落ちる幅が決まる：

```
w(t) = W · mix( 1 , max(|sin(φ(t) − θ)| , minW) , contrast )
```

- `contrast = 0` → どの向きでも同じ太さ = **SAISON Sans**
- `contrast = 1` → 差を全部通す = **SAISON Sans Advance** 側
- θ を回すと、同じ骨格のまま、太る場所が字の中をぐるりと移動する

頂点が持って GPU に行くのは「骨格上の点・面内法線・side(±1)・z(±1)・接線角・種別」だけで、
**太らせるのは頂点シェーダ**。だから θ を1フレームに何度動かしても、CPU が書き換えるのは
uniform 1つで、頂点バッファには1バイトも触らない。リボンは前後の面・左右の側壁・端のフタで
閉じたソリッドになっていて、傾けると厚みの側壁が出る（法線は種別から頂点シェーダで組み立てる）。

画面左の輪の中の緑の棒が、そのペン先そのもの。**装置を1つだけ画面に出す。**

## 何を捨てたか

- 実際の SAISON Sans のアウトライン（フォントは持っていないし、模写は再現ではない）
- ジャイロ入力（デスクトップなのでポインタに置き換えた。触っていない間はゆっくり自走する）
- インタビュー・沿革・スクロールの尺・和文まわり（サイト全体は作らない）
- 字形の厳密さ。ここに置いた A–Z は「幾何学サンセリフはこう組み立てられる」という骨格の主張で、
  セゾンの字形の複製ではない

## 実装メモ

- 骨格の点しか入っていない BufferGeometry は、three が計算する boundingSphere が
  太らせた後の実体より小さくなる。フラスタムカリングで消えるので手で広めに持たせた
- `ShaderMaterial` の出力は自動で sRGB に変換されないので `#include <colorspace_fragment>` を
  自分で入れ、色は `convertSRGBToLinear()` して uniform に渡す
- 端のフタは、幅が 0 に寄る向きでは自然に潰れて消える（`side: DoubleSide` ＋
  `gl_FrontFacing` で法線を反転させているので、巻き方向は気にしなくていい）
- **空カンバスのバイト閾値を貼り直した**：地がほぼ白一色なので PNG がよく縮む。
  実描画 103KB / 空カンバス 29KB。既定の 600KB のままでは毎回リトライ上限まで走る。
  `scripts/shot.mjs` の `SHOT_MIN` を 65KB にした（Day 042・057・059 に続き4度目の貼り直し）
