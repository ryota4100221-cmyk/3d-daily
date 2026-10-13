#!/bin/zsh
# 3D Daily 制作ジョブ（launchd: com.monaka.3d-daily が 火・木・土 2:00 JST に起動／4:30 がキャッチアップ）
# 2026-10-14：クラウドルーティン（毎朝4:20・trig_01DnQoEmP7ZwvzcrTWdsiJxM）からローカルへ移した（Ryota決定）。
#
# なぜローカルか：クラウドは WebFetch が 403 で、Day 094〜103 の10本中9本が**再現元を一度も見ずに**
# DB の文字情報だけで「再現」していた。12本中11本が「見出し＋数値パネル＋中央に小さな3D」の同じ型。
# MIDDLE STUDIES II と同じく「再現元を実機で撮る→並べる→最低6周→独立レビュー」をやるには
# ブラウザ（本物の Chrome）が要る。週3本にしたのは、その周回の時間を取るため（量より周回）。
#
# 🔴 このリポは ~/projects（Drive外）。launchd は Drive の中身を読めない（reference_launchd_cannot_read_drive）。
#    手順の正典 RUN.md もこのリポに置く。CEO/ 配下を読ませない。

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
export LANG="ja_JP.UTF-8"
REPO="$HOME/projects/3d-daily"

CLAUDE_BIN=""
for _c in "$(command -v claude 2>/dev/null || true)" \
          /opt/homebrew/bin/claude \
          "$HOME/.local/bin/claude" \
          /opt/homebrew/lib/node_modules/@anthropic-ai/claude-code/bin/claude.exe; do
  if [ -n "$_c" ] && [ -x "$_c" ]; then CLAUDE_BIN="$_c"; break; fi
done
[ -n "$CLAUDE_BIN" ] || CLAUDE_BIN="/opt/homebrew/bin/claude"

# Webhook はリポの外から読む（このリポは GitHub に push する＝直書きすると Push Protection で止まる）
[ -f "$HOME/.config/monaka/slack.env" ] && source "$HOME/.config/monaka/slack.env"
export SLACK_WEBHOOK="${SLACK_WEBHOOK_NIPPO:-}"   # #mona-日報（クラウド時代と同じ報告先）

LOG_DIR="$REPO/logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/$(TZ=Asia/Tokyo date +%F).log"

notify() {
  local payload
  [ -z "$SLACK_WEBHOOK" ] && { echo "[$(date)] SLACK_WEBHOOK empty — notify skipped" >> "$LOG_FILE"; return 1; }
  payload=$(printf '%s' "$1" | python3 -c 'import json,sys; print(json.dumps({"text": sys.stdin.read()}))')
  curl -sS -m 15 -X POST -H 'Content-type: application/json' --data "$payload" "$SLACK_WEBHOOK" >/dev/null 2>&1
}
# 合図は「最後の空でない行が、ちょうどその語だけ」（MIDDLE STUDIES II 007：説明文中の語で完走と誤判定した）
last_is() {
  [[ "$(grep -v '^[[:space:]]*$' "$2" | tail -1 | tr -d '[:space:]*`')" == "$1" ]]
}

# 今日すでに完走していたら何もしない（4:30 のキャッチアップが二重制作しないため）
if [[ -z "${D3_FORCE:-}" ]] && grep -q "=== done (exit 0" "$LOG_FILE" 2>/dev/null; then
  echo "[$(date)] already succeeded today — skip" >> "$LOG_FILE"; exit 0
fi
# 制作日ガード：火(2)・木(4)・土(6) 以外は作らない。手で作らせるときは D3_FORCE=1
DOW="$(TZ=Asia/Tokyo date +%u)"
if [[ "$DOW" != (2|4|6) && -z "${D3_FORCE:-}" ]]; then
  echo "[$(date)] not a production day (dow=$DOW) — skip" >> "$LOG_FILE"; exit 0
fi
LOCK="/tmp/3d-daily.lock"
if ! mkdir "$LOCK" 2>/dev/null; then echo "[$(date)] already running, skip" >> "$LOG_FILE"; exit 0; fi
trap 'rmdir "$LOCK"' EXIT

if ! head -c 1 "$REPO/RUN.md" >/dev/null 2>&1; then
  echo "[$(date)] ABORT: RUN.md unreadable" >> "$LOG_FILE"; exit 1
fi
cd "$REPO" || exit 1
git fetch -q origin main && git checkout -q main && git merge -q --ff-only origin/main 2>>"$LOG_FILE"

echo "[$(date)] === 3D Daily start ===" >> "$LOG_FILE"
OUT_TMP="$(mktemp /tmp/3d-daily-out.XXXXXX)"
PROMPT="まず「$REPO/RUN.md」を読み、その手順に厳密に従って今日の3D Dailyを1本、制作・点検・公開・記録まで完走して。🔴 これは無人の夜間実行で、人は見ていない。質問しない・確認を待たない・ターンを途中で終えない。Slack は環境変数ではなくこの Webhook へ curl で送る：$SLACK_WEBHOOK 。止まるときは RUN.md「止まるとき」のとおり Slack に理由を送ってから終わる。完走したときだけ、最後の行に D3_OK とだけ書く（説明文の中に D3_OK と書かない）。"

MAX_ATTEMPTS=6
attempt=1
RC=1
while (( attempt <= MAX_ATTEMPTS )); do
  echo "[$(date)] --- attempt $attempt/$MAX_ATTEMPTS ---" >> "$LOG_FILE"
  caffeinate -i "$CLAUDE_BIN" -p "$PROMPT" --model claude-opus-5-5 --dangerously-skip-permissions > "$OUT_TMP" 2>&1
  RC=$?
  cat "$OUT_TMP" >> "$LOG_FILE"
  # 成功の判定を失敗の判定より先に置く（本文中の「session limit」に誤爆しないため・順序が仕様）
  if (( RC == 0 )) && last_is D3_OK "$OUT_TMP"; then
    echo "[$(date)] D3_OK 確認 — 完走" >> "$LOG_FILE"; break
  fi
  if grep -qiE "You.?ve hit your [a-z]+ limit|usage limit reached|rate limit exceeded" "$OUT_TMP" \
     || tail -n 3 "$OUT_TMP" | grep -qiE "session limit|usage limit|rate limit"; then
    echo "[$(date)] usage limit hit — sleeping 60min" >> "$LOG_FILE"; sleep 3600; (( attempt++ )); continue
  fi
  if (( RC != 0 )) && grep -qiE "internal error|EPERM|timed out|timeout|ECONNRESET|ETIMEDOUT|ENOTFOUND|network error|fetch failed|connection closed|connection reset|overloaded" "$OUT_TMP"; then
    echo "[$(date)] transient error — sleeping 5min" >> "$LOG_FILE"; sleep 300; (( attempt++ )); continue
  fi
  # exit 0 を信用しない：完走の証拠が無ければ印を置く（毎朝8:45の日次点検が拾う）
  if (( RC == 0 )); then
    echo "[$(date)] exit 0 だが D3_OK が無い" >> "$LOG_FILE"
    touch "$LOG_DIR/INCOMPLETE-$(TZ=Asia/Tokyo date +%F)"
    RC=3
  fi
  break
done

if (( RC != 0 )); then
  notify "🔴 3D Daily（$(TZ=Asia/Tokyo date +%F)）を完走できませんでした
原因：exit $RC（$attempt 回試行）
ログ末尾：
\`\`\`$(tail -n 6 "$LOG_FILE")\`\`\`
手動再実行：D3_FORCE=1 zsh ~/projects/3d-daily/scripts/daily.sh"
fi
rm -f "$OUT_TMP"
echo "[$(date)] === done (exit $RC, attempts $attempt) ===" >> "$LOG_FILE"
