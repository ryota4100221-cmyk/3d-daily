import { useMemo, useRef, useLayoutEffect } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { AIM, ALPHA, B_HOLD, B_MAX, COLOR, FIT, RHO, SWEEP, buildRods } from './rig.js'

// 棒は E を通る直線の上にしか置かない。だから頂点シェーダは何もしていない——
// 「点に見える」ほうは幾何が済ませてある。ここでやるのは、棒の手前端から
// 奥端へ落ちる明るさだけ。E に立っているときは手前端の蓋しか見えないので、
// この減衰は**基線が開いてはじめて画面に出てくる**。
const VERT = /* glsl */ `
  attribute vec3 aColor;
  varying vec3 vCol;
  varying float vT;
  void main() {
    vT = position.y + 0.5;           // 0 = 手前端, 1 = 奥端
    vCol = aColor;
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  }
`

const FRAG = /* glsl */ `
  precision highp float;
  varying vec3 vCol;
  varying float vT;
  void main() {
    float k = mix(1.0, 0.085, pow(vT, 0.62));
    gl_FragColor = vec4(vCol * k, 1.0);
  }
`

export default function Scene({ readout }) {
  const { camera, size } = useThree()
  const mesh = useRef()
  const pointer = useRef({ active: false, x: 0, y: 0 })

  const rods = useMemo(() => buildRods(), [])

  const geometry = useMemo(() => {
    const g = new THREE.CylinderGeometry(1, 1, 1, 8, 1, false)
    const col = new Float32Array(rods.count * 3)
    const c = new THREE.Color()
    for (let i = 0; i < rods.count; i++) {
      c.set(COLOR[rods.letter[i]])
      col[i * 3] = c.r
      col[i * 3 + 1] = c.g
      col[i * 3 + 2] = c.b
    }
    g.setAttribute('aColor', new THREE.InstancedBufferAttribute(col, 3))
    return g
  }, [rods])

  const material = useMemo(
    () => new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG }),
    []
  )

  // 姿勢は一度だけ書いて、以後1フレームも触らない。
  useLayoutEffect(() => {
    const o = new THREE.Object3D()
    const up = new THREE.Vector3(0, 1, 0)
    const axis = new THREE.Vector3()
    const q = new THREE.Quaternion()
    for (let i = 0; i < rods.count; i++) {
      const u = rods.u[i]
      const v = rods.v[i]
      const d = rods.depth[i]
      const L = ALPHA * d
      const sec = Math.sqrt(1 + u * u + v * v) // 視線長 / z深さ
      axis.set(u, v, -1).normalize()
      q.setFromUnitVectors(up, axis)
      const mid = d + L * 0.5
      o.position.set(mid * u, mid * v, -mid)
      o.quaternion.copy(q)
      // 半径は視線長に比例させる。そうしないと5文字の太さが画面上で揃わない。
      o.scale.set(RHO * d * sec, L * sec, RHO * d * sec)
      o.updateMatrix()
      mesh.current.setMatrixAt(i, o.matrix)
    }
    mesh.current.instanceMatrix.needsUpdate = true
  }, [rods])

  useLayoutEffect(() => {
    const onMove = (e) => {
      pointer.current.active = true
      pointer.current.x = (e.clientX / window.innerWidth) * 2 - 1
      pointer.current.y = -((e.clientY / window.innerHeight) * 2 - 1)
    }
    const onLeave = () => {
      pointer.current.active = false
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerleave', onLeave)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerleave', onLeave)
    }
  }, [])

  // 語の半幅は面の上で 0.615 と決まっている。画角のほうを幅に合わせる——
  // 縦長の窓で GUNZE が画面の外へ出ていたら、この日の主張は一度も見えない。
  useLayoutEffect(() => {
    const aspect = size.width / Math.max(1, size.height)
    camera.fov = Math.min(86, 2 * THREE.MathUtils.radToDeg(Math.atan(FIT / aspect)))
    camera.updateProjectionMatrix()
  }, [size, camera])

  const aim = useMemo(() => new THREE.Vector3(0, 0, -AIM), [])
  const state = useRef({ b: B_MAX, phi: 0.62 })

  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    const p = pointer.current

    let b
    let phi
    if (p.active) {
      // カーソルを画面の中心へ置くと b = 0 ——**そこが E** で、そこだけで字が読める。
      const r = Math.min(1, Math.hypot(p.x, p.y * 0.9))
      b = r * r * B_MAX
      phi = Math.atan2(p.y, p.x)
    } else if (t < SWEEP) {
      // 起動直後に一度だけ端まで振って戻す。読める／読めないの幅を先に見せる。
      b = B_MAX * (0.5 + 0.5 * Math.cos((2 * Math.PI * t) / SWEEP))
      phi = 0.62 + 0.35 * Math.sin((2 * Math.PI * t) / SWEEP)
    } else {
      // 以後はここで落ち着く。撮影される1枚は必ずこの状態になる。
      b = B_HOLD * (1 + 0.06 * Math.sin((2 * Math.PI * (t - SWEEP)) / 7))
      phi = 0.62 + 0.10 * Math.sin((2 * Math.PI * (t - SWEEP)) / 11)
    }

    const s = state.current
    if (p.active) {
      // カーソルが居るときだけ追従で鈍らせる。
      let dphi = phi - s.phi
      while (dphi > Math.PI) dphi -= 2 * Math.PI
      while (dphi < -Math.PI) dphi += 2 * Math.PI
      s.b += (b - s.b) * 0.14
      s.phi += dphi * 0.14
    } else {
      // 誰も触っていないときは時刻から直に決める。**遅延を挟むと、撮った1枚が
      // その日たまたま何フレーム回ったかで変わる**（Day 050 と同じ穴）。
      s.b = b
      s.phi = phi
    }

    camera.position.set(s.b * Math.cos(s.phi), s.b * Math.sin(s.phi) * 0.55, 0)
    camera.lookAt(aim)
    readout.current = s.b
  })

  return (
    <instancedMesh
      ref={mesh}
      args={[geometry, material, rods.count]}
      frustumCulled={false}
    />
  )
}
