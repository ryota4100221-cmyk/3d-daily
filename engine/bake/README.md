# engine/bake — Blender で光を焼いて、Web で「素材の色 × 焼いた光」として動かす

> 2026-10-25、`~/projects/bake-lab`（Study 01・4周）から切り出した。Ryota決定「道具として使いたい」。
> **これも棚である。再現元が「光が主役」のときだけ引き出す。焼けるから題材を選ぶ、はしない（RUN.md 手順1の禁則）。**

## 何ができるか（実測）

- Cycles の間接光・柔らかい影・色のにじみを、**ライト0灯**で Web に出す。Bake Lab の部屋（19物体・2状態）で **M1 1440×900 60fps**・glb 9.5MB＋ライトマップ 0.7MB
- **光の状態を何個でも**焼いて、スクロールで混ぜる（昼→夜・消灯→点灯・晴れ→曇り）。リアルタイム計算では重くて出せない「同じ空間の光の移ろい」
- **焼いた光を持った粒**に、表面からほどける（`bakedPoints`）。17万粒・60fps（Bake Lab 4周目「Apart」）

## 使いどころ / 使わないところ

| 向く再現元 | 向かない再現元 |
|---|---|
| 室内・建築・ジオラマ・展示空間（光と影が主役） | 物が常に動く・変形する（焼いた影が置き去りになる） |
| 製品の静物（接地影・面のグラデーションを Cycles 品質で） | 鏡面・ガラス・水が主役（焼けるのは拡散だけ。鏡面は環境マップ頼み） |
| 時刻・照明が変わる演出 | 手続き生成で毎フレーム形が変わるもの |

## 手順（日フォルダ `days/NNN_x/` で）

1. **`blender/build.py` を白紙から書く**（`src/` と同じく前日からコピーしない）。シーンを組み、印を3つ付ける：
   - `scene['bake_states'] = 'day,night'`（省略時 `main` の1状態）
   - ライト物体に `obj['state'] = 'day'`。空は `scene['world_<状態>'] = [r, g, b, 強さ]`
   - 細かい小物（葉・本・器）に `obj['bake'] = 'vertex'`／焼かない物に `'skip'`
   - 実例＝`example/build_example.py`（床・壁・箱・球・太陽＝昼・電球＝夜）
2. `Blender -b --factory-startup -P days/NNN_x/blender/build.py -- days/NNN_x/blender/scene.blend`
3. **試し焼き**：`zsh engine/bake/bake.sh days/NNN_x/blender/scene.blend days/NNN_x/public 32 200`（見本で22秒）。周回中はこれで回す
   - 🔴 **樹木など重い物を頂点に焼くと試し焼きでも長い**：Bake Lab Study 02（建物＋樹4本×8万面・2状態・夕方は面光源16灯）は **32サンプルでも9分43秒**。周回では樹を一時的に `obj['bake']='skip'` にするか、状態を1つに絞って回す
4. **本焼き**：`... public 256 400`（Bake Lab の規模で約9〜11分）。公開前に1回
5. `cp engine/bake/baked.js days/NNN_x/src/` して使う（🔴 相対 import は dev で 403→500）：

```js
import { applyBaked, rig, bakedPoints } from './baked.js'
const BASE = import.meta.env.BASE_URL
const manifest = await (await fetch(`${BASE}lm/manifest.json`)).json()
const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(`${BASE}scene.glb`)
const baked = applyBaked(gltf.scene, manifest, { base: BASE })
const parts = rig(gltf.scene)            // 振り付けは parts[名前]（親）を動かす
baked.blend('day', 'night', k)           // 毎フレームでよい
scene.environment = ...                  // 鏡面だけここから（拡散の IBL は baked.js が外す）
```

- 出力：`public/scene.glb`・`public/lm/<物体>_<状態>.webp`・`public/lm/manifest.json`（光源の位置も入る＝電球の芯を three 側で置ける）。圧縮前の原本は `days/NNN_x/.bake-raw/`（**gitignore に足す**）
- vite の `build.target` は `'esnext'`（トップレベル await のため）
- 座標：Blender (x, y, z) → three (x, z, −y)

## 🔴 踏んだ罠（Bake Lab 1〜4周目・すべて実測）

1. **glTF 読み込み物体は `rotation_mode='QUATERNION'`**＝`rotation_euler` を書いても回らない。1周目は家具が1つも回っていなかった → `o.rotation_mode = 'XYZ'` してから回す
2. build.py が回した直後の `matrix_world` は古い → bake.py が `view_layer.update()` 済み（自前で位置を読むときも同じ）
3. **Boolean の後**は空のマテリアル枠が先頭に残る → `materials.clear()` してから append・全面 `material_index = 0`
4. 細かい物をライトマップにすると島が数 texel に潰れる → `obj['bake']='vertex'`
5. **meshopt の量子化**はノードに戻しの scale を載せる → ノードの scale を触ると縮んで浮く → `rig()` の親を動かす
6. `gltf-transform optimize` は物体を結合して名前が消える → bake.sh は webp と meshopt だけ
7. glTF 書き出しの WEBP は一部失敗して参照だけ残る（GLTFLoader が `reading 'uri'`）→ AUTO で出して後で webp
8. **白い面の暗い状態**は 256 サンプルの粒が砂に見える → bake.sh が暗い状態だけ中央値＋ぼかし
9. **`gl_PointSize = 0` では点は消えない（M1 / ANGLE Metal は最小1px）**。隠したつもりの17万粒が全面に乗り、独立レビューで「ノイズで失格級」と書かれた → `bakedPoints` は clip の外へ出す＋章の外は `setVisible(false)`
10. 粒を明るい地に出すと霧にしか見えない → 散っている間は `baked.gain` と空を落とす（Bake Lab は ×0.1・#2a2e36）

## Bake Lab で分かった天井（使う前に読む）

減点潰し・素材を1系統に・章ごとのカメラ・状態が変わる章（分解→粒→再構築）の4周で、独立レビューは **4.5→4.5→4.6→4.6**。
**このラインは品質の床を上げる道具で、天井は題材と素材の入口で決まる**（CC0 家具の小部屋では、何を足しても 4.6）。
焼けば良くなる、ではない。再現元の題材・素材に寄せたうえで、光の質を Cycles 水準に上げるために使う。
