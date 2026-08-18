# 再現元の台帳（使ったURLは二度使わない）

> Day 049 以降、毎朝ここに1行足す。`scripts/variety-check.mjs` がこのファイルを grep して
> 重複を🔴で落とす。**行を消さない。**（消すと同じサイトが半年後に静かに戻ってくる）

書式：

```
| YYYY-MM-DD | Day NNN | 再現元URL | サイト名 | 分解した装置 |
```

---

| 日付 | Day | 再現元URL | サイト名 | 分解した装置 |
|------|-----|-----------|----------|---------------|
| — | — | — | — | （Day 049 からここに積む） |
| 2026-08-18 | Day 049 · days/049_vortex | https://oasiz.org/ | 株式会社OASIZ | 渦芯（vortex spine）— 接線速度が芯半径 rc で折り返す場と、それを見せる26点の尾 |
| 2026-08-19 | Day 050 · days/050_fusion | https://podium.global/ | Podium | 融合しきい値（fusion threshold）— gap が k を下回った所にだけ首が生える smin 1本 |

---

## Day 001〜048 について

Day 001〜028 はカリキュラム（自前のテーマ表）、Day 029〜048 は自前の技術スレッドで、
**外部の再現元を持たない**。だからこの台帳は空から始まる。

Day 031〜048 が18日間ずっと同じ絵になった直接の原因がこれで、
「今日は何を作るか」を自分の頭の中から出していた。頭の中から出すと、必ず昨日の隣に着地する。
外から持ってくるための台帳がこのファイル。

## 選ぶときの順番

1. **スワイプファイルDB** `collection://cc3eeeca-fb80-49fe-81c6-16bc08034563` の `深掘り済み = true` の行
   - 🔴 `query-data-sources` は1回で最大100行。行を並べると静かに打ち切られる。
     数えるときは `COUNT(*)`、候補は `WHERE` で100件未満に絞る（`has_more: true` が出たら絞り直す）
2. Awwwards / codrops / Three.js examples / Shadertoy
3. `~/projects/gallery-dig/data/deep/*.json`（ローカル実測・件数制限なし・Notionと数日ズレるので母数には使わない）
