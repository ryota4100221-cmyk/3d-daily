// 融合しきい値（fusion threshold）— 今日の装置。
//
// 再現元 Podium (https://podium.global/) の FV は、白い紙の真ん中に
// 「黒〜グレーの液滴が融合した塊」が1つだけある。文字は四隅にしかない。
// 塊を塊に見せているのは球の数でも大きさでもなく、**2つの面がどれだけ
// 近づいたら1つに見えるか**という1本のしきい値 k だけ。
//
//   smin(a, b, k) = mix(b, a, h) - k·h·(1-h),  h = clamp(0.5 + 0.5(b-a)/k, 0, 1)
//
//   gap ≫ k  →  2つの球。間に何も無い
//   gap ≈ k  →  首（neck）が生える。ここだけが「融合」に見える瞬間
//   gap < 0  →  1つの塊。もう境目は無い
//
// k は「大きさ」ではなく「距離のものさし」なので、球を大きくしても融合は
// 起きない。近づける（gap を下げる）か、k を上げるかのどちらかしかない。
// この非対称が今日いちばん面白いところで、HUD はその gap を出し続ける。

export const BALL_COUNT = 7

// k のプリセット。1 / 2 / 3 キーで切り替える。
//   0.06  ほぼ生の union。7個が7個に見える
//   0.26  首が見えるいちばん良い帯
//   0.62  境目が消えて1つの塊になる（Podium の FV はこの辺り）
export const K_PRESETS = [0.06, 0.26, 0.62]
export const K_DEFAULT = 1

// 液滴。i=0 だけがポインタに引かれる「手で持っている粒」。
//
// 最初は全部を原点まわりの正弦だけで振っていたが、これだと**振れ幅で2度失敗する**。
// 小さくすると常時どれも重なって1個の豆（k を何にしても同じ絵）、大きくすると
// 群れが2つに割れて画面の真ん中が空く（再現元は「中央に1つだけ」なので別物）。
//
// 直したのは振れ幅ではなく置き方のほう。**首が出る間隔に最初から置く。**
//   gap = |ci-cj| - ri - rj
//   gap > k  離れて見える ／ 0 < gap < k  首が生える ／ gap < 0  1つの塊
// 中心に大きいのを1つ、まわりに5つを半径 0.62 の輪で置くと、
//   中心⇄輪   0.62 - 0.34 - 0.24 = 0.04   → 首
//   輪⇄隣     0.73 - 0.24 - 0.28 = 0.21   → k=0.26 でだけ首、k=0.06 では離れる
// になる。そのうえで ±0.2 だけ揺らすと、gap が k を何度もまたぐ。
const DROPS = [
  // 0: 手で持っている粒（base は使わず idlePath が入る）
  { r: 0.26, base: [0, 0, 0], amp: [0, 0, 0], frq: [0, 0, 0], phs: [0, 0, 0] },
  // 1: 芯
  { r: 0.34, base: [0.00, 0.00, 0.00], amp: [0.14, 0.12, 0.10], frq: [0.131, 0.089, 0.176], phs: [1.1, 0.3, 2.2] },
  // 2〜6: 半径 0.62 の輪（72°ずつ）。z を振って平たい花にしない
  { r: 0.24, base: [0.58, 0.21, 0.22], amp: [0.20, 0.17, 0.16], frq: [0.163, 0.241, 0.121], phs: [2.6, 1.2, 0.9] },
  { r: 0.28, base: [-0.02, 0.62, -0.18], amp: [0.18, 0.20, 0.15], frq: [0.113, 0.197, 0.229], phs: [4.0, 2.9, 1.6] },
  { r: 0.21, base: [-0.60, 0.16, 0.26], amp: [0.21, 0.18, 0.17], frq: [0.251, 0.107, 0.187], phs: [0.7, 3.4, 2.8] },
  { r: 0.26, base: [-0.36, -0.50, -0.24], amp: [0.19, 0.21, 0.14], frq: [0.181, 0.149, 0.263], phs: [3.3, 0.8, 3.9] },
  { r: 0.19, base: [0.39, -0.48, 0.10], amp: [0.22, 0.19, 0.18], frq: [0.097, 0.223, 0.157], phs: [1.9, 4.5, 0.2] },
]

// 手で持っている粒の「置き去り」の軌道。ポインタが一度も動いていない間
// （headless の撮影がまさにこれ）はこちらが走る。止めると絵が死ぬので、
// 入力が無いときのほうがむしろ大きく動かしている。
function idlePath(t, out) {
  out[0] = 0.74 * Math.sin(t * 0.19) + 0.16 * Math.sin(t * 0.53 + 1.1)
  out[1] = 0.50 * Math.sin(t * 0.27 + 2.2) + 0.13 * Math.sin(t * 0.61)
  out[2] = 0.26 * Math.sin(t * 0.23 + 0.6)
}

const tmp = [0, 0, 0]

/**
 * 時刻 t の球配置を Float32Array(BALL_COUNT*4) に書き出す（xyz + 半径）。
 * held が null でなければ i=0 をそこへ寄せる（追従は指数、1フレーム 12%）。
 */
export function writeBalls(buf, t, held, prevHeld) {
  idlePath(t, tmp)
  const target = held || tmp
  // ポインタが来た瞬間に飛ばないよう、必ず現在地から補間する
  prevHeld[0] += (target[0] - prevHeld[0]) * 0.12
  prevHeld[1] += (target[1] - prevHeld[1]) * 0.12
  prevHeld[2] += (target[2] - prevHeld[2]) * 0.12

  buf[0] = prevHeld[0]
  buf[1] = prevHeld[1]
  buf[2] = prevHeld[2]
  buf[3] = DROPS[0].r

  for (let i = 1; i < BALL_COUNT; i++) {
    const d = DROPS[i]
    const o = i * 4
    buf[o] = d.base[0] + d.amp[0] * Math.sin(d.frq[0] * t * 6.2831853 + d.phs[0])
    buf[o + 1] = d.base[1] + d.amp[1] * Math.sin(d.frq[1] * t * 6.2831853 + d.phs[1])
    buf[o + 2] = d.base[2] + d.amp[2] * Math.sin(d.frq[2] * t * 6.2831853 + d.phs[2])
    buf[o + 3] = d.r
  }
  return buf
}

/**
 * いま何組が融合しているかを数える。
 * gap = |ci-cj| - ri - rj  ＝ 面と面のすきま。
 * smin は gap が k を下回るあたりから首を作るので、それを融合と呼ぶ。
 * （厳密な閾値ではない。smin は指数的に効くので「見えるかどうか」の目安）
 */
export function neckReport(buf, k) {
  let fused = 0
  let pairs = 0
  let nearest = Infinity
  for (let i = 0; i < BALL_COUNT; i++) {
    for (let j = i + 1; j < BALL_COUNT; j++) {
      const dx = buf[i * 4] - buf[j * 4]
      const dy = buf[i * 4 + 1] - buf[j * 4 + 1]
      const dz = buf[i * 4 + 2] - buf[j * 4 + 2]
      const gap = Math.hypot(dx, dy, dz) - buf[i * 4 + 3] - buf[j * 4 + 3]
      pairs++
      if (gap < nearest) nearest = gap
      if (gap < k) fused++
    }
  }
  return { fused, pairs, nearest }
}

/** ndc(-1..1) を、塊が浮いている z=0 平面の world 座標へ。 */
export function ndcToPlane(ndcX, ndcY, aspect, eyeZ, fovDeg) {
  const halfH = Math.tan((fovDeg * Math.PI) / 360) * eyeZ
  return [ndcX * halfH * aspect, ndcY * halfH, 0]
}
