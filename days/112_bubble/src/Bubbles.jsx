import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Vector2, Vector3, Vector4 } from 'three'
import { RAMP } from './ramp.js'

// 二つの泡が重なる所だけ曲がる縁（the rim that bends where two bubbles meet）
//
// 全画面の板1枚。座標は ref.png と同じ「1440×900 の画面 px・y は下向き」で考える（縦を 900 に合わせ、横は中央から伸ばす）。
// 上の泡 U と下の泡 L は画面の円を球として解くインポスター。
// L の中では、U の縁は実測の曲線 U'（8 次式）として見える。1つの中心からの屈折の拡大では当てられなかった（NOTES.md）。
// U' の上側のうち L の縁の内側の輪（ρ > ρc）の外を切る＝右で U 字に折り返す「レンズ形の領域 A」。
// A の縁だけを RGB でわずかに違う大きさで解き、虹の滲みにする。
// 色は sRGB のまま書き出す（colorspace_fragment を入れない＝R3F の色変換を通さない・Day 109 の罠）。

const vert = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`

const frag = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform vec2 uRes;
uniform float uTime;
uniform vec2 uPtr;
uniform vec3 uRamp[90];
uniform vec3 uU;      // 上の泡：中心 xy・半径
uniform vec3 uL;      // 下の泡
uniform vec4 uA;      // ρc 左・ρc 右・角の丸み・A の縁の滲みの幅

vec3 bg(float y) {
  float f = clamp(y / 10.0, 0.0, 89.0);
  int i = int(floor(f));
  int j = min(i + 1, 89);
  return mix(uRamp[i], uRamp[j], fract(f));
}

// 泡の膜の陰：d は縁からの符号付き距離（内が負）。暗くする量を返す（R を一番強く落とす＝青緑に沈む）
float band(float d) {
  if (d < 0.0) return 0.62 * exp(d / 7.0) + 0.16 * exp(d / 30.0) + 0.03;
  return 0.72 * exp(-(d * d) / 2.0);
}
const vec3 W = vec3(1.0, 0.62, 0.70);
// 細い線だけの版（奥の帯は band と同じ＝切り替えの境目に筋を出さない）
float bandThin(float d) {
  if (d < 0.0) return 0.25 * exp(d / 1.2) + 0.06 * exp(d / 30.0) + 0.03;
  return 0.25 * exp(-(d * d) / 0.8);
}

float smax(float a, float b, float k) {
  float h = clamp(0.5 - 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) + k * h * (1.0 - h);
}

// L の中で見える U の縁 U'：ref.png の暗い線 25 点（x=245〜975）に当てた 8 次式（最大誤差 1.6 px）。上が内側
float yc(float x) {
  float u = clamp((x - 700.0) / 300.0, -1.57, 1.0);
  float y = -41.7946;
  y = y * u - 71.7924; y = y * u + 55.8644; y = y * u + 63.6995; y = y * u - 37.9103;
  y = y * u - 22.6967; y = y * u - 67.2592; y = y * u + 1.6667;  y = y * u + 739.8757;
  return y;
}
float sdUp(vec2 p) {
  float y = yc(p.x);
  float dy = (yc(p.x + 1.0) - yc(p.x - 1.0)) * 0.5;
  return (y - p.y) * -1.0 / sqrt(1.0 + dy * dy);
}

void main() {
  float sc = uRes.y / 900.0;
  vec2 fc = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 p = (fc - vec2(uRes.x * 0.5, 0.0)) / sc + vec2(720.0, 0.0);

  float br = 1.0 + 0.004 * sin(uTime * 0.45);
  vec2 cU = uU.xy;                 float rU = uU.z * br;
  vec2 cL = uL.xy + uPtr * 12.0;   float rL = uL.z * (2.0 - br);

  vec3 col = bg(p.y);
  float dL = length(p - cL) - rL;

  if (dL > 0.0) {
    // L の外：U の縁と陰の帯
    float dU = length(p - cU) - rU;
    col *= 1.0 - band(dU) * W;
    // 暗い縁のすぐ外に細い明るい線
    col *= 1.0 + 0.07 * exp(-pow((dU - 3.0) / 1.5, 2.0));
  } else {
    // L の中：A（U' のうち縁から離れた所）の縁と陰の帯。RGB で大きさを少し変える
    float k = uA.w;
    vec3 kk;
    for (int c = 0; c < 3; c++) {
      // 右の折り返しほど RGB のずれを大きく（ref はここだけ虹が太い）
      vec2 tq = (p - cL) / rL;
      float kx = k + 0.006 * smoothstep(0.25, 0.48, tq.x) * exp(-pow((tq.y + 0.80) / 0.10, 2.0))
               + 0.0025 * exp(-pow((tq.x + 0.60) / 0.12, 2.0) - pow((tq.y + 0.73) / 0.10, 2.0));
      float s = 1.0 + kx * (1.0 - float(c));
      vec2 pc = cL + (p - cL) / s;
      float dUp = sdUp(pc - (cL - uL.xy));
      vec2 v = p - cL;
      vec2 nv = v / rL;
      // ρc：上と左は白い縁の ≈6 px 内側、右の折り返しへ向けて ≈25 px 内側へ離れる
      float side = smoothstep(0.15, 0.55, nv.x);
      float rc = mix(uA.x, uA.y, side);
      rc = mix(rc, 1.03, smoothstep(-0.98, -0.82, nv.y) * smoothstep(-0.1, -0.35, nv.x));   // 左下は弧が縁沿いに流れるので切らない
      rc *= rL * s;
      float dRim = length(v) - rc;
      float dA = smax(dUp, dRim, mix(uA.z, 58.0, side));
      // 縁沿い（上辺）は線を細く、陰の帯を出さない
      float top = smoothstep(4.0, -10.0, dUp - dRim) * (1.0 - smoothstep(0.35, 0.6, nv.x));
      float b = mix(band(dA), bandThin(dA), top);
      // 右の折り返しの内側に陰が溜まる
      b += 0.10 * exp(dA / 22.0) * smoothstep(0.3, 0.5, nv.x) * step(dA, 0.0);
      kk[c] = b;
    }
    col *= 1.0 - kk * W;

    // L の中は地よりわずかに明るい。縁に向かって白い霞（右ほど強い）
    vec2 n = (p - cL) / rL;
    float rim = exp(dL / 22.0);
    float rim2 = exp(dL / 60.0);
    col = mix(col, vec3(0.93, 0.97, 0.99), 0.04 + rim * (0.07 + 0.38 * max(n.x, 0.0)) + rim2 * 0.22 * max(n.x, 0.0));
    // 左の縁のすぐ内側の細い暗い線
    col *= 1.0 - 0.10 * exp(-pow((dL + 5.0) / 1.6, 2.0)) * max(-n.x, 0.0);
  }
  // L の白い縁
  col = mix(col, vec3(0.94, 1.0, 1.0), 0.97 * exp(-(dL * dL) / 2.2));

  gl_FragColor = vec4(col, 1.0);
}
`

export default function Bubbles({ pointer }) {
  const { size, gl } = useThree()
  const mat = useRef()
  const uniforms = useMemo(() => {
    const ramp = []
    for (let i = 0; i < 90; i++) ramp.push(new Vector3(RAMP[i * 3], RAMP[i * 3 + 1], RAMP[i * 3 + 2]))
    return {
      uRes: { value: new Vector2(1, 1) },
      uTime: { value: 0 },
      uPtr: { value: new Vector2() },
      uRamp: { value: ramp },
      uU: { value: new Vector3(711.3, 123.8, 615.6) },
      uL: { value: new Vector3(711.8, 1081.6, 557.8) },
      uA: { value: new Vector4(0.989, 0.952, 30, 0.0025) },
    }
  }, [])

  useFrame((state, dt) => {
    const u = mat.current.uniforms
    const pr = gl.getPixelRatio()
    u.uRes.value.set(size.width * pr, size.height * pr)
    u.uTime.value += dt
    u.uPtr.value.x += (pointer.x - u.uPtr.value.x) * 0.04
    u.uPtr.value.y += (pointer.y - u.uPtr.value.y) * 0.04
  })

  return (
    <mesh frustumCulled={false}>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial ref={mat} vertexShader={vert} fragmentShader={frag} uniforms={uniforms} depthTest={false} depthWrite={false} />
    </mesh>
  )
}
