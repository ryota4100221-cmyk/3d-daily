// rig.js — Day 051 / Ribbon
//
// 再現元は Penguin Capital（https://www.penguin-capital.co.jp/）のFV。
// 黒地 #000000 に、白いリボン状の3Dオブジェクトが1本だけ置いてある。差し色は無い。
//
// あの帯を見て「形が複雑だ」と思うのは、たぶん間違っている。帯は
//
//     曲線 P(s)   ＋   その曲線に沿ったロール角 φ(s)
//
// の2つしか持っていない。明るい所と消える所を決めているのは形ではなく φ のほうで、
// 幅 w は最後まで一定のままである。ここが今日分解する装置（= ロール露光）。
//
// このファイルが持つのは3つ:
//   1. 閉じた空間曲線
//   2. その上の回転最小フレーム（RMF・二重反射法）
//   3. 閉じた曲線でフレームが一周して戻ってこない分（ホロノミー）の後始末
//
// 3 が要る理由は「閉じた曲線だから」で、これを入れないと帯の継ぎ目に
// ねじれが1本残る。逆にこれを入れると「turns が整数なら帯は閉じ、半整数なら
// メビウスになる」が正確に成り立つ（M キーで切り替わるのがそれ）。

import * as THREE from 'three'

export const TAU = Math.PI * 2

// ── 1. 曲線 ───────────────────────────────────────────────────────────
// 一本の帯として読めることを優先した閉曲線。長い横のスイープが1回、
// その途中で手前と奥に1回ずつ抜ける。結び目にはしない（結ぶと「帯」ではなく
// 「knot のデモ」になる）。
export function curve(t, out = new THREE.Vector3()) {
  return out.set(
    3.05 * Math.sin(t) + 0.22 * Math.sin(3 * t),
    1.16 * Math.sin(2 * t + 0.55) - 0.10 * Math.sin(4 * t),
    1.62 * Math.cos(t) + 0.44 * Math.cos(3 * t)
  )
}

// ── 2+3. フレーム ─────────────────────────────────────────────────────
// 二重反射法（Wang et al. 2008）。接線が回った分だけ参照ベクトルを2回の鏡映で
// 運ぶので、Frenet のように変曲点で法線が飛ばない。1サンプルあたり内積6回。
//
// 戻り値の R は「閉じるように後始末した」参照ベクトル。生の RMF は一周すると
// 角度 theta だけずれて戻ってくる（= holonomy）。そのずれを弧長に比例して
// 引き算して均すと、R(0) と R(L) が一致する。
export function buildFrames(N = 1500) {
  const P = new Float32Array(N * 3)
  const T = new Float32Array(N * 3)
  const R = new Float32Array(N * 3)
  const S = new Float32Array(N) // 正規化弧長 0..1

  const p = new THREE.Vector3()
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()

  // 点
  for (let i = 0; i < N; i++) {
    curve((i / N) * TAU, p)
    P[i * 3] = p.x; P[i * 3 + 1] = p.y; P[i * 3 + 2] = p.z
  }

  // 接線（中心差分・閉じているので端も巻く）
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N
    const k = (i - 1 + N) % N
    a.set(P[j * 3] - P[k * 3], P[j * 3 + 1] - P[k * 3 + 1], P[j * 3 + 2] - P[k * 3 + 2]).normalize()
    T[i * 3] = a.x; T[i * 3 + 1] = a.y; T[i * 3 + 2] = a.z
  }

  // 弧長
  let L = 0
  for (let i = 0; i < N; i++) {
    S[i] = L
    const j = (i + 1) % N
    L += Math.hypot(P[j * 3] - P[i * 3], P[j * 3 + 1] - P[i * 3 + 1], P[j * 3 + 2] - P[i * 3 + 2])
  }
  for (let i = 0; i < N; i++) S[i] /= L

  // 初期参照ベクトル（接線に直交する適当な1本）
  const t0 = new THREE.Vector3(T[0], T[1], T[2])
  const r0 = new THREE.Vector3(0, 1, 0)
  if (Math.abs(r0.dot(t0)) > 0.9) r0.set(1, 0, 0)
  r0.addScaledVector(t0, -r0.dot(t0)).normalize()
  R[0] = r0.x; R[1] = r0.y; R[2] = r0.z

  // 二重反射。i → i+1 を N 回まわして、最後にもう一周分（0 へ戻る辺）だけ
  // 余計に運び、その結果と R(0) の角度差を holonomy とする。
  const ri = new THREE.Vector3()
  const ti = new THREE.Vector3()
  const tj = new THREE.Vector3()
  const v1 = new THREE.Vector3()
  const v2 = new THREE.Vector3()
  const rL = new THREE.Vector3()
  const tL = new THREE.Vector3()

  const step = (i, j, rin, rout) => {
    ri.copy(rin)
    ti.set(T[i * 3], T[i * 3 + 1], T[i * 3 + 2])
    tj.set(T[j * 3], T[j * 3 + 1], T[j * 3 + 2])
    v1.set(P[j * 3] - P[i * 3], P[j * 3 + 1] - P[i * 3 + 1], P[j * 3 + 2] - P[i * 3 + 2])
    const c1 = v1.dot(v1) || 1e-12
    rL.copy(ri).addScaledVector(v1, (-2 / c1) * v1.dot(ri)) // 1回目の鏡映
    tL.copy(ti).addScaledVector(v1, (-2 / c1) * v1.dot(ti))
    v2.copy(tj).sub(tL)
    const c2 = v2.dot(v2) || 1e-12
    rout.copy(rL).addScaledVector(v2, (-2 / c2) * v2.dot(rL)) // 2回目の鏡映
    rout.normalize()
  }

  const cur = new THREE.Vector3().copy(r0)
  const nxt = new THREE.Vector3()
  for (let i = 0; i < N - 1; i++) {
    step(i, i + 1, cur, nxt)
    R[(i + 1) * 3] = nxt.x; R[(i + 1) * 3 + 1] = nxt.y; R[(i + 1) * 3 + 2] = nxt.z
    cur.copy(nxt)
  }
  step(N - 1, 0, cur, nxt) // 閉じる辺をもう1歩だけ運ぶ

  // holonomy: 一周して戻ってきた nxt と r0 の、T(0) まわりの符号付き角度
  const bi0 = new THREE.Vector3().crossVectors(t0, r0)
  const theta = Math.atan2(nxt.dot(bi0), nxt.dot(r0))

  // 均す: R(s) を T(s) まわりに -theta*s だけ回す
  const q = new THREE.Quaternion()
  const rv = new THREE.Vector3()
  const tv = new THREE.Vector3()
  for (let i = 0; i < N; i++) {
    rv.set(R[i * 3], R[i * 3 + 1], R[i * 3 + 2])
    tv.set(T[i * 3], T[i * 3 + 1], T[i * 3 + 2])
    q.setFromAxisAngle(tv, -theta * S[i])
    rv.applyQuaternion(q).normalize()
    R[i * 3] = rv.x; R[i * 3 + 1] = rv.y; R[i * 3 + 2] = rv.z
  }

  return { P, T, R, S, N, length: L, holonomy: theta }
}

// ── 面 ────────────────────────────────────────────────────────────────
// 帯そのものは頂点シェーダで作る。CPU が渡すのは「曲線上の点・参照ベクトル・
// 接線・弧長・どちら側か」の5つだけで、幅方向の押し出しとロールは GPU 側でやる。
// こうしておくと turns を毎フレーム変えてもジオメトリを作り直さずに済む。
export function ribbonGeometry(f) {
  const { P, T, R, S, N } = f
  const V = N + 1 // 継ぎ目のぶん1列だけ複製する（s=1 の側）
  const pos = new Float32Array(V * 2 * 3)
  const aR = new Float32Array(V * 2 * 3)
  const aT = new Float32Array(V * 2 * 3)
  const aSide = new Float32Array(V * 2)
  const aArc = new Float32Array(V * 2)

  for (let i = 0; i < V; i++) {
    const k = i % N
    const s = i === N ? 1 : S[k]
    for (let side = 0; side < 2; side++) {
      const o = (i * 2 + side) * 3
      pos[o] = P[k * 3]; pos[o + 1] = P[k * 3 + 1]; pos[o + 2] = P[k * 3 + 2]
      aR[o] = R[k * 3]; aR[o + 1] = R[k * 3 + 1]; aR[o + 2] = R[k * 3 + 2]
      aT[o] = T[k * 3]; aT[o + 1] = T[k * 3 + 1]; aT[o + 2] = T[k * 3 + 2]
      aSide[i * 2 + side] = side === 0 ? -1 : 1
      aArc[i * 2 + side] = s
    }
  }

  const idx = new Uint32Array((V - 1) * 6)
  for (let i = 0; i < V - 1; i++) {
    const a0 = i * 2, a1 = i * 2 + 1, b0 = (i + 1) * 2, b1 = (i + 1) * 2 + 1
    const o = i * 6
    idx[o] = a0; idx[o + 1] = b0; idx[o + 2] = a1
    idx[o + 3] = a1; idx[o + 4] = b0; idx[o + 5] = b1
  }

  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('aR', new THREE.BufferAttribute(aR, 3))
  g.setAttribute('aT', new THREE.BufferAttribute(aT, 3))
  g.setAttribute('aSide', new THREE.BufferAttribute(aSide, 1))
  g.setAttribute('aArc', new THREE.BufferAttribute(aArc, 1))
  g.setIndex(new THREE.BufferAttribute(idx, 1))
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 6)
  return g
}

// ── 縁 ────────────────────────────────────────────────────────────────
// 帯が真横を向くと面は1本の線に潰れて、ラスタライザからは消える。そこだけ
// 髪の毛1本の明るさを足すための polyline（左右で2本）。フラグメント側で
// 「どれだけ横を向いているか」で濃度を決めるので、正面を向いている間は出ない。
export function edgeGeometry(f, side) {
  const { P, T, R, S, N } = f
  const V = N + 1
  const pos = new Float32Array(V * 3)
  const aR = new Float32Array(V * 3)
  const aT = new Float32Array(V * 3)
  const aSide = new Float32Array(V)
  const aArc = new Float32Array(V)
  for (let i = 0; i < V; i++) {
    const k = i % N
    pos[i * 3] = P[k * 3]; pos[i * 3 + 1] = P[k * 3 + 1]; pos[i * 3 + 2] = P[k * 3 + 2]
    aR[i * 3] = R[k * 3]; aR[i * 3 + 1] = R[k * 3 + 1]; aR[i * 3 + 2] = R[k * 3 + 2]
    aT[i * 3] = T[k * 3]; aT[i * 3 + 1] = T[k * 3 + 1]; aT[i * 3 + 2] = T[k * 3 + 2]
    aSide[i] = side
    aArc[i] = i === N ? 1 : S[k]
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('aR', new THREE.BufferAttribute(aR, 3))
  g.setAttribute('aT', new THREE.BufferAttribute(aT, 3))
  g.setAttribute('aSide', new THREE.BufferAttribute(aSide, 1))
  g.setAttribute('aArc', new THREE.BufferAttribute(aArc, 1))
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 6)
  return g
}

// ── 読み出し ──────────────────────────────────────────────────────────
// 画面に出す数字はシェーダの中の量なので、同じ式を CPU でもう一度解く。
// 「いま何点が真横を向いているか」= 面法線と視線の内積が閾値未満のサンプル数。
// これがロール露光そのもの（形は一切変わっていないのに、この数だけが動く）。
const _t = new THREE.Vector3()
const _r = new THREE.Vector3()
const _b = new THREE.Vector3()
const _n = new THREE.Vector3()
const _v = new THREE.Vector3()
const _p = new THREE.Vector3()

export function edgeOnCount(f, totalRot, phase, camPos, eps = 0.085) {
  const { P, T, R, S, N } = f
  let n = 0
  for (let i = 0; i < N; i += 3) {
    const phi = phase + totalRot * S[i]
    _t.set(T[i * 3], T[i * 3 + 1], T[i * 3 + 2])
    _r.set(R[i * 3], R[i * 3 + 1], R[i * 3 + 2])
    _b.crossVectors(_t, _r)
    // 面法線 = ロールした参照ベクトルの90度先（Scene.jsx の up と同じ式）
    _n.copy(_r).multiplyScalar(-Math.sin(phi)).addScaledVector(_b, Math.cos(phi))
    _p.set(P[i * 3], P[i * 3 + 1], P[i * 3 + 2])
    _v.copy(camPos).sub(_p).normalize()
    if (Math.abs(_n.dot(_v)) < eps) n++
  }
  return n
}
