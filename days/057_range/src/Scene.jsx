import { useMemo, useRef, useLayoutEffect } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import {
  R_EARTH,
  R_ORBIT,
  SV_COUNT,
  PLANE_COUNT,
  TRACKED,
  makeConstellation,
  svPosition,
  planeRing,
  receiverAt,
  selectTracked,
  solveFix,
  waveRadius,
  epochOf,
  toLatLon,
  pool,
} from './rig.js'

// ── 色 ────────────────────────────────────────────────────────────────
// 再現元の実測から。ターコイズ #30C8C8 を地に通し、文字は白、差し色は赤1色だけ。
// 球はその同系で2段深く落とす（#147E96 → #38B4C0）。地と球を同じ明度にすると
// 円盤の輪郭が消えて、輪がどこを這っているのか読めなくなる。
export const SKY = '#30c8c8'
const GLOBE_DEEP = new THREE.Color('#0f6f86')
const GLOBE_LIT = new THREE.Color('#3ab8c4')
const INK = new THREE.Color('#ffffff')
const FIX_RED = new THREE.Color('#ff0000')

const params = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams()
const FROZEN = params.has('t') ? Number(params.get('t')) : null
const T0 = 2.9 // ライブ表示は「輪が出そろった辺り」から始める

// 毎フレーム作り直される唯一の共有状態。位置は入っていない——
// 入っているのは衛星の座標と、輪の角半径と、そこから解き直した交点だけ。
const STATE = {
  t: 0,
  epoch: -1,
  tin: 0,
  tracked: [],
  radii: [],
  arrived: 0,
  fix: null,
  sigma: 1,
  fixAmt: 0,
  rx: new THREE.Vector3(1, 0, 0),
  visible: 0,
}

const svs = makeConstellation()
const scratch = pool(64)

// カメラがどの点を正面から見ているか。受信機はここから 0.42rad 以内に立てる
// （裏側に立たれると輪が球の向こうへ回り込んで、交わりが1枚の絵にならない）
const VIEW_CENTER = new THREE.Vector3(0.08, 0.84, 0.53).normalize()

function step(t) {
  STATE.t = t
  const { epoch, tin } = epochOf(t)
  STATE.epoch = epoch
  STATE.tin = tin
  scratch.reset()
  const rx = receiverAt(epoch, VIEW_CENTER)
  STATE.rx.copy(rx)
  const tracked = selectTracked(svs, t, rx, scratch)
  STATE.tracked = tracked
  STATE.radii = waveRadius(tracked, tin)
  STATE.arrived = tracked.filter((c, i) => STATE.radii[i] >= c.ang - 1e-6).length

  // 何機見えているか（地平線より上）
  scratch.reset()
  let vis = 0
  for (const sv of svs) {
    const p = svPosition(sv, t, scratch.next())
    if (p.clone().normalize().dot(rx) > Math.cos(1.42)) vis++
  }
  STATE.visible = vis

  const sol = solveFix(tracked, STATE.radii)
  STATE.fix = sol ? sol.p : null
  STATE.sigma = sol ? sol.sigma : 1
  // 交点は「最後の1機が届いた瞬間」にだけ点灯する。残差が消えることが点灯の条件で、
  // 時間で点けているのではない。
  const lock = STATE.arrived >= Math.min(TRACKED, tracked.length) ? 1 : 0
  const fade = 1 - THREE.MathUtils.smoothstep(tin, 5.35, 6.15)
  STATE.fixAmt = lock * fade
}

function Driver() {
  useFrame(({ clock }) => step(FROZEN !== null ? FROZEN : clock.elapsedTime + T0))
  return null
}

// ── 球 ────────────────────────────────────────────────────────────────
const VERT = /* glsl */ `
  varying vec3 vP;
  varying vec3 vN;
  void main() {
    vP = normalize(position);
    vN = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const FRAG = /* glsl */ `
  precision highp float;
  varying vec3 vP;
  varying vec3 vN;

  uniform vec3  uDeep;
  uniform vec3  uLit;
  uniform vec3  uInk;
  uniform vec3  uRed;
  uniform vec3  uSub[4];
  uniform float uRad[4];
  uniform float uArr[4];
  uniform float uCount;
  uniform vec3  uFix;
  uniform float uFixAmt;

  vec3 S(vec3 c) { return pow(c, vec3(2.2)); }        // sRGB literal → linear

  // 角距離。dot をそのままクランプしないと極付近で NaN が出る
  float ang(vec3 a, vec3 b) { return acos(clamp(dot(a, b), -1.0, 1.0)); }

  // 太さを画面上でほぼ一定に保つ線。fwidth を使わないと極側だけ線が太る
  float band(float d, float r, float k) {
    float w = fwidth(d) * k + 0.0021;
    return 1.0 - smoothstep(0.0, w, abs(d - r));
  }

  void main() {
    vec3 p = normalize(vP);
    float lat = asin(clamp(p.y, -1.0, 1.0));
    float lon = atan(p.z, p.x);

    // 地：北西から当てた半ランバート1灯ぶんだけ。ライトオブジェクトは置かない
    float lam = dot(normalize(vN), normalize(vec3(-0.45, 0.72, 0.52)));
    float sh = smoothstep(-0.85, 1.0, lam);
    vec3 col = mix(S(uDeep), S(uLit), sh);

    // 経緯線 15°。極では経線が寄って潰れるので緯度で殺す
    float latLine = band(fract(lat / radians(15.0) + 0.5) - 0.5, 0.0, 1.0);
    float lonStep = fract(lon / radians(15.0) + 0.5) - 0.5;
    float lonLine = band(lonStep, 0.0, 1.0) * (1.0 - smoothstep(0.62, 1.02, abs(lat)));
    float grat = max(latLine * 0.55, lonLine * 0.42);
    col = mix(col, S(uInk), grat * 0.19);

    // 赤道だけ1段強く（球の向きが読めなくなるのを防ぐ）
    col = mix(col, S(uInk), band(lat, 0.0, 1.2) * 0.30);

    // ── 距離の輪 ──────────────────────────────────────────────────
    float line = 0.0;
    float swept = 0.0;
    float hub = 0.0;
    for (int i = 0; i < 4; i++) {
      if (float(i) >= uCount) break;
      float d = ang(p, uSub[i]);
      float r = uRad[i];
      // 波面が通り過ぎた側をごく薄く塗る。輪が「広がった跡」を持つと、
      // 止まっている輪と伸びている輪が静止画1枚でも見分けられる
      swept += smoothstep(r, r - 0.035, d) * 0.55;
      line = max(line, band(d, r, 1.15) * mix(0.62, 1.0, uArr[i]));
      // 輪の中心＝副衛星点。小さな十字で置く
      hub = max(hub, band(d, 0.0, 1.0) * 1.0);
      hub = max(hub, (1.0 - smoothstep(0.0, 0.030, d)) * band(d, 0.024, 1.2));
    }
    col = mix(col, S(uLit) * 1.22, clamp(swept, 0.0, 1.0) * 0.20);
    col = mix(col, S(uInk), clamp(line, 0.0, 1.0) * 0.92);
    col = mix(col, S(uInk), clamp(hub, 0.0, 1.0) * 0.85);

    // ── 交点 ─────────────────────────────────────────────────────
    if (uFixAmt > 0.001) {
      float d = ang(p, uFix);
      // 交点は「輪の交わり」であって物ではないので、面ではなく細い輪と芯だけで置く
      float ring = band(d, 0.062, 1.3);
      float core = 1.0 - smoothstep(0.009, 0.014, d);
      col = mix(col, S(uRed), clamp(max(ring, core), 0.0, 1.0) * uFixAmt);
    }

    // 縁：円盤の輪郭を白1本で締める。地色と球色が同系なので、これが無いと
    // 上端で球と空が溶ける
    float rim = 1.0 - abs(dot(normalize(vN), vec3(0.0, 0.0, 1.0)));
    col = mix(col, S(uInk), smoothstep(0.86, 0.999, rim) * 0.55);
    col *= mix(1.0, 0.90, smoothstep(0.55, 0.98, rim));

    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`

function Globe() {
  const mat = useRef()
  const uniforms = useMemo(
    () => ({
      uDeep: { value: GLOBE_DEEP },
      uLit: { value: GLOBE_LIT },
      uInk: { value: INK },
      uRed: { value: FIX_RED },
      uSub: { value: Array.from({ length: 4 }, () => new THREE.Vector3(0, 1, 0)) },
      uRad: { value: [0, 0, 0, 0] },
      uArr: { value: [0, 0, 0, 0] },
      uCount: { value: 0 },
      uFix: { value: new THREE.Vector3(0, 1, 0) },
      uFixAmt: { value: 0 },
    }),
    []
  )

  useFrame(() => {
    const u = uniforms
    const n = Math.min(TRACKED, STATE.tracked.length)
    u.uCount.value = n
    for (let i = 0; i < 4; i++) {
      if (i < n) {
        u.uSub.value[i].copy(STATE.tracked[i].sub)
        u.uRad.value[i] = STATE.radii[i]
        u.uArr.value[i] = STATE.radii[i] >= STATE.tracked[i].ang - 1e-6 ? 1 : 0
      } else {
        u.uRad.value[i] = -1
        u.uArr.value[i] = 0
      }
    }
    if (STATE.fix) u.uFix.value.copy(STATE.fix)
    u.uFixAmt.value = STATE.fixAmt
  })

  return (
    <mesh>
      <sphereGeometry args={[R_EARTH, 192, 128]} />
      <shaderMaterial ref={mat} vertexShader={VERT} fragmentShader={FRAG} uniforms={uniforms} />
    </mesh>
  )
}

// ── 軌道面 6本 ────────────────────────────────────────────────────────
function Orbits() {
  const geos = useMemo(
    () =>
      Array.from({ length: PLANE_COUNT }, (_, p) =>
        new THREE.BufferGeometry().setFromPoints(planeRing((p / PLANE_COUNT) * Math.PI * 2))
      ),
    []
  )
  return (
    <group>
      {geos.map((g, i) => (
        <lineLoop key={i} geometry={g}>
          <lineBasicMaterial color={INK} transparent opacity={0.19} depthWrite={false} />
        </lineLoop>
      ))}
    </group>
  )
}

// ── 衛星 24機 ─────────────────────────────────────────────────────────
function Satellites() {
  const all = useRef()
  const hot = useRef()
  const allGeo = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SV_COUNT * 3), 3))
    return g
  }, [])
  const hotGeo = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRACKED * 3), 3))
    return g
  }, [])
  const p = useMemo(() => new THREE.Vector3(), [])

  useFrame(() => {
    const a = allGeo.attributes.position
    for (let i = 0; i < SV_COUNT; i++) {
      svPosition(svs[i], STATE.t, p)
      a.setXYZ(i, p.x, p.y, p.z)
    }
    a.needsUpdate = true

    const h = hotGeo.attributes.position
    for (let i = 0; i < TRACKED; i++) {
      const c = STATE.tracked[i]
      if (c) h.setXYZ(i, c.pos.x, c.pos.y, c.pos.z)
      else h.setXYZ(i, 0, 0, 0)
    }
    h.needsUpdate = true
  })

  return (
    <group>
      <points ref={all} geometry={allGeo}>
        <pointsMaterial color={INK} size={7} sizeAttenuation={false} transparent opacity={0.88} />
      </points>
      <points ref={hot} geometry={hotGeo}>
        <pointsMaterial color={INK} size={13} sizeAttenuation={false} />
      </points>
    </group>
  )
}

// ── 追尾中の4機から副衛星点へ落とす線 ────────────────────────────────
function DropLines() {
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRACKED * 2 * 3), 3))
    return g
  }, [])
  useFrame(() => {
    const a = geo.attributes.position
    for (let i = 0; i < TRACKED; i++) {
      const c = STATE.tracked[i]
      if (!c) {
        a.setXYZ(i * 2, 0, 0, 0)
        a.setXYZ(i * 2 + 1, 0, 0, 0)
        continue
      }
      a.setXYZ(i * 2, c.pos.x, c.pos.y, c.pos.z)
      a.setXYZ(i * 2 + 1, c.sub.x * R_EARTH * 1.001, c.sub.y * R_EARTH * 1.001, c.sub.z * R_EARTH * 1.001)
    }
    a.needsUpdate = true
  })
  return (
    <lineSegments geometry={geo}>
      <lineBasicMaterial color={INK} transparent opacity={0.5} depthWrite={false} />
    </lineSegments>
  )
}

// ── 望遠ぎみの俯瞰 ────────────────────────────────────────────────────
function Rig() {
  const { camera } = useThree()
  useLayoutEffect(() => {
    // 見下ろし 58°。真上（Day 055 でやった）でも水平（アイレベル）でもない角度に
    // 置くと、輪が球の丸みに沿って歪むのが1枚で読める
    const el = (58 * Math.PI) / 180
    const d = 5.02
    const base = new THREE.Vector3(0.32, Math.sin(el) * d, Math.cos(el) * d)
    camera.up.set(0, 1, 0)
    camera.position.copy(base)
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld()
    // 球を画面の右へ寄せる。カメラと注視点を同じベクトルだけ平行移動すると
    // 視線方向が1度も変わらないまま、球だけが画面上を動く（lookAt をずらすと
    // 視線が回って輪の歪み方まで変わってしまう）
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0)
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1)
    const shift = new THREE.Vector3()
      .addScaledVector(right, -1.02)
      .addScaledVector(up, -0.02)
    camera.position.copy(base).add(shift)
    camera.lookAt(shift)
    camera.updateProjectionMatrix()
    camera.updateMatrixWorld()
    // 受信機を置いてよい範囲の中心＝カメラの真正面に来る地表の点
    VIEW_CENTER.copy(camera.position).normalize()
  }, [camera])
  return null
}

// ── DOM の数字（state にはしない）──────────────────────────────────────
// Day 050 / Day 056 で2度やった事故：virtual time の下で React のスケジューラが
// 回りきらず、オーバーレイの数字が初期値のまま焼き付く。ref で textContent を直接書く。
function Telemetry({ refs }) {
  useFrame(() => {
    const n = Math.min(TRACKED, STATE.tracked.length)
    if (refs.arrived.current) refs.arrived.current.textContent = `${String(STATE.arrived).padStart(2, '0')} / ${String(n).padStart(2, '0')}`
    if (refs.visible.current) refs.visible.current.textContent = `${String(STATE.visible).padStart(2, '0')} / ${SV_COUNT}`
    if (refs.sigma.current)
      refs.sigma.current.textContent = STATE.fixAmt > 0.5 ? '0.00000' : STATE.sigma.toFixed(5)
    if (refs.fix.current) {
      if (STATE.fixAmt > 0.5 && STATE.fix) {
        const { lat, lon } = toLatLon(STATE.fix)
        refs.fix.current.textContent = `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'N' : 'S'}  ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? 'E' : 'W'}`
      } else {
        refs.fix.current.textContent = '— — . — —   — — . — —'
      }
    }
    if (refs.radii.current) {
      refs.radii.current.textContent = STATE.radii
        .map((r, i) => (STATE.tracked[i] ? (r * 6371).toFixed(0).padStart(5, ' ') : '  ---'))
        .join('  ')
    }
    if (refs.epoch.current) refs.epoch.current.textContent = String(STATE.epoch % 1000).padStart(3, '0')
  })
  return null
}

export default function Scene({ refs }) {
  return (
    <>
      <Driver />
      <Rig />
      <Globe />
      <Orbits />
      <DropLines />
      <Satellites />
      <Telemetry refs={refs} />
    </>
  )
}
