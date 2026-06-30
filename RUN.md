# 3D Daily — 毎朝の実行手順（エージェント用）

毎朝7時、まっさらなセッションでこの手順を完走する。目的は **Claude Codeで作る3Dの質を毎日1段ずつ上げる**こと。

## 手順

1. `~/projects/3d-daily/PROGRESS.md` を読み、最後に完了したNo.を確認 → **次の番号**を決める（初回はNo.1）。
2. `~/projects/3d-daily/CURRICULUM.md` で今日のテーマと難易度を確認。
3. 作業フォルダを作る: `~/projects/3d-daily/days/NNN_<slug>/`（例: `001_primitives`）。
   - 初回のみ、共通のViteテンプレを作る。2回目以降は前日フォルダをコピーして流用してよい。
   - スタック: **Vite + React + @react-three/fiber + @react-three/drei**（必要に応じ drei/rapier/postprocessing を追加）。
4. 今日のテーマを実装する。守ること:
   - **Awwwards水準のビジュアル**を狙う。配色は洗練・余白・ミニマル（monaka design.のトンマナ）。英語ベースのタイポを多用。
   - 「前日までの自分」より **1つ新しい技法 or 1段高い完成度** を必ず入れる。
   - 各日フォルダに `NOTES.md` を残す（狙い・使った技法・次に試したいこと）。
5. **ビルド確認まで行う**（`npm install && npm run build`）。エラーが出たら直す。
   - ⚠️ デプロイはしない（「デプロイして」と明示されるまで）。ローカルビルド成功で完了とみなす。
6. プレビュー画像を1枚撮る（任意・可能なら）。`npm run dev` を立ち上げ headless で screenshot、`preview.png` として日フォルダに保存。難しければスキップ可。
7. `PROGRESS.md` に1行追記（日付・No.・テーマ・フォルダ・学んだ技法）。
8. **Slackに今日の成果を報告**（DM `@自分` または #general 等、運用に合わせる）。フォーマット:
   ```
   🎨 今日の3D — Day NNN / ⭐難易度
   テーマ: <テーマ名>
   新しく入れた技法: <一言>
   場所: ~/projects/3d-daily/days/NNN_xxx/
   起動: cd して npm run dev で確認できます
   ```
   プレビューが撮れていれば画像も添付。
9. **Notion「デザインインプット（自動収集）」DBに1行追記**（データソース `collection://e7229880-2f1c-456f-873e-f8fe3d6cb36d` / ページID `4c5856ef07fb4842859bde72076addee`）。
   - タイトル = `Day NNN — <テーマ名>（R3F）`
   - 種別 = `3D Daily`（既存selectオプション）
   - 日付 = 今日
   - 使用技術 = 今日の主な技法（例: R3F / InstancedMesh / GLSLシェーダ）
   - 参照URL = `https://github.com/ryota4100221-cmyk/3d-daily/tree/main/days/NNN_xxx`
   - 参照サイト = 参考にしたサイト名（あれば）
   - 本文 = 今日の狙い・学び・次に試したいこと（数行）

## 原則
- 1回の起動で1テーマ。完走できなくても、できたところまでコミット相当の状態で残し、PROGRESS/Slackに「途中・残タスク」を明記。
- 量より「毎日1段上げる」。安易な使い回しはしない。
- 不明点で止まらない。判断はその場で最善を選び、メモに残す。
