import { useMemo, useRef, useEffect } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { BALL_COUNT, K_PRESETS, K_DEFAULT, writeBalls, neckReport, ndcToPlane } from './rig.js'

const EYE_Z = 4.2
const FOV = 35

// ── 全画面1枚のフラグメントで、SDF をレイマーチする ───────────────────────
// 今日はメッシュを1つも置いていない（板1枚だけ）。塊の形は距離関数の中にしかない。

const VERT = /* glsl */ `
  void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`

const FRAG = /* glsl */ `
  precision highp float;
  #define NB ${BALL_COUNT}

  uniform vec2  uRes;
  uniform float uTime;
  uniform float uK;
  uniform vec4  uBalls[NB];   // xyz = 中心, w = 半径

  // 融合しきい値。k が距離のものさしで、これ1本で「2つ」と「1つ」が分かれる。
  float smin(float a, float b, float k) {
    float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
    return mix(b, a, h) - k * h * (1.0 - h);
  }

  float map(vec3 p) {
    float k = max(uK, 1e-3);
    float d = length(p - uBalls[0].xyz) - uBalls[0].w;
    for (int i = 1; i < NB; i++) {
      float di = length(p - uBalls[i].xyz) - uBalls[i].w;
      d = smin(d, di, k);
    }
    return d;
  }

  vec3 calcNormal(vec3 p) {
    vec2 e = vec2(1.0, -1.0) * 0.0015;
    return normalize(
      e.xyy * map(p + e.xyy) + e.yyx * map(p + e.yyx) +
      e.yxy * map(p + e.yxy) + e.xxx * map(p + e.xxx));
  }

  // 塊の内側にだけ色がある（再現元は実写を数枚クリッピングして覗かせている）。
  // 写真は持っていないので、走路（レーン）の手続きテクスチャに置き換えた。
  vec3 innerWorld(vec2 q, float t) {
    vec3 dark  = vec3(0.035, 0.033, 0.032);
    vec3 ember = vec3(0.93, 0.40, 0.17);

    float y = q.y * 4.2 - t * 0.16;
    float band = smoothstep(0.42, 0.34, abs(fract(y) - 0.5));       // レーン
    float hair = smoothstep(0.026, 0.0, abs(fract(y * 3.0) - 0.5) - 0.462); // 分離線
    float run  = smoothstep(0.88, 1.0, sin(q.x * 1.5 - t * 0.7) * 0.5 + 0.5);

    vec3 c = mix(dark, ember * 0.46, band * 0.62);
    c += ember * hair * 0.13;
    c += ember * run * 0.14;
    return c;
  }

  void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;

    vec3 ro = vec3(0.0, 0.0, ${EYE_Z.toFixed(2)});
    vec3 rd = normalize(vec3(uv * 0.6307, -1.0));   // 垂直画角 35°

    // 紙。ほぼ白、上をわずかに明るく。
    vec3 paper = mix(vec3(0.930, 0.927, 0.920), vec3(0.972, 0.969, 0.963),
                     clamp(uv.y * 0.9 + 0.62, 0.0, 1.0));

    // 接地しない影。塊の少し後ろの面で距離関数を切って、右下へずらして敷く。
    // （sample 点をずらす向きと影が動く向きは逆。最初 +x/-y にして左上へ出した）
    float tp = (ro.z + 0.40) / max(-rd.z, 1e-4);
    float sd = map(ro + rd * tp + vec3(-0.15, 0.19, 0.0));
    paper *= 1.0 - 0.14 * (1.0 - smoothstep(-0.04, 0.52, sd));

    // ── march ───────────────────────────────────────────────────────────
    float t = 0.0;
    float dmin = 1e9;
    bool hit = false;
    for (int i = 0; i < 110; i++) {
      float d = map(ro + rd * t);
      dmin = min(dmin, d);
      if (d < 0.0015) { hit = true; break; }
      t += d * 0.9;
      if (t > 8.0) break;
    }

    // 縁は必ず暗いので、当たらなかった画素も「縁の色」で羽根を作れば済む。
    vec3 surf = vec3(0.085, 0.082, 0.080);
    float cov = hit ? 1.0 : 1.0 - smoothstep(0.0, 0.010, dmin);

    if (hit) {
      vec3 p = ro + rd * t;
      vec3 n = calcNormal(p);
      vec3 L = normalize(vec3(-0.55, 0.78, 0.62));

      float dif  = clamp(dot(n, L), 0.0, 1.0);
      float face = clamp(dot(n, -rd), 0.0, 1.0);   // 1 = こちらを真正面から向いた面

      // 窓は「正面を向いているところ」にしか開かない。塊そのものは黒〜グレーで、
      // 色は覗いた中にしか無い（再現元がそうなっている）。
      // 最初これを fresnel の逆で書いたら、面のほぼ全部が窓になって
      // オレンジの豆が1つ出てきた。開き方が緩いと、窓は窓でなくなる。
      float win = smoothstep(0.62, 0.98, face);

      vec3 refr  = refract(rd, n, 0.74);
      vec3 inner = innerWorld(p.xy * 0.85 + refr.xy * 0.55, uTime);
      inner *= 0.42 + 0.78 * face;   // 窓の縁へ向かって内側も沈む（貼り絵にしない）
      vec3 shell = vec3(0.062, 0.060, 0.058)
                 + vec3(0.26, 0.253, 0.243) * dif * dif
                 + vec3(0.10, 0.098, 0.095) * pow(1.0 - face, 3.0);

      float spec = pow(clamp(dot(reflect(-L, n), -rd), 0.0, 1.0), 54.0);

      vec3 c = mix(shell, inner, win * 0.92);
      c += vec3(0.95, 0.94, 0.92) * spec * 0.62;
      c += vec3(0.30, 0.295, 0.29) * pow(1.0 - face, 5.0) * 0.7;   // 縁の起こし
      surf = c;
    }

    vec3 col = mix(paper, surf, cov);

    // 紙の粒子。時間に依存させない（ちらつくと紙に見えない）。
    float g = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
    col += (g - 0.5) * 0.013;

    gl_FragColor = vec4(col, 1.0);
  }
`

function Fusion({ onReport }) {
  const { size, viewport } = useThree()
  const mat = useRef()
  const buf = useMemo(() => new Float32Array(BALL_COUNT * 4), [])
  const held = useRef(null) // ポインタが一度でも動くまで null（＝ idlePath が走る）
  const smooth = useRef([0, 0, 0])
  // ?k=0|1|2 で初期のしきい値を選べる。キー操作のできない headless から
  // 3つの状態（離れる／首／1つの塊）を撮って確かめるために付けた。
  const kIndex = useRef(
    (() => {
      // ?k= が無いとき get() は null を返し、Number(null) は 0 になる。
      // これを弾かずに書いたら、既定が k=0.06（7個バラバラ）になった1枚を撮った。
      const raw = new URLSearchParams(window.location.search).get('k')
      if (raw === null) return K_DEFAULT
      const q = Number(raw)
      return Number.isInteger(q) && q >= 0 && q < K_PRESETS.length ? q : K_DEFAULT
    })()
  )
  const clock = useRef(6.0) // 途中から始める。t=0 は7個が整列していて塊にならない
  const tick = useRef(0)

  const uniforms = useMemo(
    () => ({
      uRes: { value: new THREE.Vector2(1, 1) },
      uTime: { value: 0 },
      uK: { value: K_PRESETS[K_DEFAULT] },
      uBalls: { value: buf },
    }),
    [buf]
  )

  useEffect(() => {
    const aspect = size.width / size.height
    const onMove = (e) => {
      const ndcX = (e.clientX / window.innerWidth) * 2 - 1
      const ndcY = -((e.clientY / window.innerHeight) * 2 - 1)
      held.current = ndcToPlane(ndcX * 0.92, ndcY * 0.92, aspect, EYE_Z, FOV)
    }
    const onLeave = () => { held.current = null }
    const onKey = (e) => {
      const i = ['1', '2', '3'].indexOf(e.key)
      if (i >= 0) kIndex.current = i
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerleave', onLeave)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerleave', onLeave)
      window.removeEventListener('keydown', onKey)
    }
  }, [size.width, size.height])

  useFrame((state, delta) => {
    // headless の --virtual-time-budget 下では delta が潰れたり跳ねたりする。
    // Day 049 で「発達していない絵」を1枚撮った原因がこれなので外れ値を殺す。
    const dt = delta > 0.0005 && delta < 0.2 ? delta : 1 / 60
    clock.current += dt

    const k = K_PRESETS[kIndex.current]
    writeBalls(buf, clock.current, held.current, smooth.current)

    const u = mat.current.uniforms
    u.uTime.value = clock.current
    u.uK.value = k
    u.uRes.value.set(size.width * viewport.dpr, size.height * viewport.dpr)
    u.uBalls.needsUpdate = true

    if (++tick.current % 6 === 0) {
      const r = neckReport(buf, k)
      onReport({ k, ...r, held: held.current !== null })
    }
  })

  return (
    <mesh frustumCulled={false}>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial ref={mat} vertexShader={VERT} fragmentShader={FRAG} uniforms={uniforms} />
    </mesh>
  )
}

export default function Scene({ onReport }) {
  return (
    <Canvas
      flat
      dpr={[1, 2]}
      gl={{ antialias: false, alpha: false }}
      camera={{ position: [0, 0, 1] }}
    >
      <color attach="background" args={['#f5f4f0']} />
      <Fusion onReport={onReport} />
    </Canvas>
  )
}
