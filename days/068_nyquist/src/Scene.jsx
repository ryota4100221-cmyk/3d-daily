// Scene.jsx — Day 068
//
// ここには構図しか無い。何が映るかは rig.js の3行（信号・標本器・表示）で
// 決まっていて、このファイルは「どこから見るか」と「毎フレーム uPhase を
// 進める」以外のことをしない。
//
// カメラを俯角ではなく **広角で低めに置いた** のは、偽の中心が5×5に並ぶことを
// 見せたいのに真上から見ると平面図（＝ただの図版）になるから。手前のタイルが
// 大きく、奥が潰れることで「これは点の集まりで出来ている」ことが絵の側から
// 読める。奥行きの霧は地の色へ寄せて、場の端を作らない。

import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Vector2 } from 'three'
import { makeFloor, makeLattice, phaseAt } from './rig.js'

export default function Scene({ time, filtered }) {
  const { camera } = useThree()
  const lattice = useMemo(() => makeLattice(), [])
  const floor = useMemo(() => makeFloor(), [])
  const phase = useRef(new Vector2())

  useEffect(() => {
    // 1回目は (0, 7.4, 17.2) / fov 52 で、手前の偽の中心3つが画面下辺で
    // 断ち切られ、左下の実測値と右下の注記がそのタイルの上に乗った
    // （RUN.md が Day 027 で書いている「構図は実描画でしか分からない」）。
    // 仰角を上げて距離を取り、場の footprint を画面の中帯に収める。
    // さらに、場を画面の右へ 2.2 だけ寄せてある。左の1列（見出し・リード・
    // 実測値）が地の上だけを通るようにするため。カメラは動かさずに被写体を
    // ずらしたので、板をわずかに左手から見ることになり、遠近も少し効く。
    camera.fov = 44
    camera.position.set(0.0, 12.9, 15.4)
    camera.lookAt(0.9, -0.5, -0.35)
    camera.updateProjectionMatrix()
  }, [camera])

  useEffect(() => {
    lattice.material.uniforms.uFilter.value = filtered ? 1 : 0
  }, [lattice, filtered])

  useFrame((state) => {
    // 🔴 時刻は必ず外から来た1つの値で決める。Day 067 で踏んだ穴がこれで、
    // 「1フレームあたり何%寄せる」式の補間は rAF の回数に依存するので、
    // headless の virtual time では同じビルドから別の絵が撮れてしまう。
    // ここは t → uPhase の純粋な関数しかない（?t= で完全に固定できる）。
    const t = time ?? state.clock.getElapsedTime()
    lattice.material.uniforms.uPhase.value.copy(phaseAt(t, phase.current))
  })

  return (
    <group position={[2.2, 0, 0]}>
      <primitive object={floor} />
      <primitive object={lattice} />
    </group>
  )
}
