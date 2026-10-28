import { useMemo } from 'react'
import { useThree } from '@react-three/fiber'

// 地・星・惑星を1枚のシェーダで描く。座標は 1440×900 の画面 px（上が 0）。
// 惑星の縁は ref.png から当てはめた楕円（中心 (400,1408)・半径 1020×760）＝球の透視像をそのまま楕円の球として解く
const frag = /* glsl */ `
precision highp float;
uniform vec2 uRes;
uniform float uTime;
varying vec2 vUv;

float hash(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
float fbm(vec2 p){ float s=0., a=.5; for(int i=0;i<5;i++){ s+=a*noise(p); p*=2.03; a*=.5; } return s; }

void main(){
  float k = 1440. / uRes.x;
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) * k;   // 画面 px（1440 基準）

  // 地：上 #010307 → 下へ少しだけ紺
  vec3 col = mix(vec3(1.,3.,8.), vec3(3.,6.,13.), smoothstep(0., 600., p.y)) / 255.;

  // 星：3 px の升に1つ、まれに点
  vec2 cell = floor(p / 3.);
  float h = hash(cell);
  if (h > 0.9972) {
    float b = hash(cell + 7.1);
    vec2 o = vec2(hash(cell + 1.3), hash(cell + 2.9)) * 1.6 + 0.7;
    float d = length(p - cell * 3. - o);
    float sz = 0.6 + 2.2 * pow(hash(cell + 4.4), 6.);
    col += vec3(0.75, 0.8, 0.9) * (0.03 + 0.75 * pow(b, 3.)) * exp(-d * d * 1.4 / (sz * sz));
  }

  // 惑星（楕円の球）
  vec2 C = vec2(400., 1408.);
  vec2 q = (p - C) / vec2(1020., 760.);
  float r = length(q);
  // 縁までの距離（px 近似）：楕円の半径方向の差に平均の半径を掛ける
  float dpx = (r - 1.) * mix(760., 1020., abs(q.x) / max(r, 1e-4));
  // 光は右奥から：縁の上で右ほど強い
  float side = smoothstep(-0.9, 0.7, q.x / max(r, 1e-4));
  if (r < 1.) {
    float nz = sqrt(1. - r * r);
    vec3 n = vec3(q.x, -q.y, nz);
    // 面：ほぼ黒にごく弱い大陸のまだら
    float m = fbm(n.xy * 9. + vec2(3.1, 1.7));
    float land = smoothstep(0.48, 0.62, m);
    // クレーターの粗い模様：細かいノイズの段差（縁の近くほど見える）
    float cr = fbm(n.xy * 28. + 11.);   // 大きめの斑
    float pits = smoothstep(0.55, 0.75, cr) - smoothstep(0.3, 0.42, cr) * 0.6;
    vec3 surf = vec3(3., 3., 4.) / 255. + land * vec3(3., 3., 3.5) / 255. + pits * vec3(6., 6., 6.) / 255. * exp(dpx / 140.) * smoothstep(0.75, 0.1, abs(q.x));
    surf *= 0.6 + 0.4 * smoothstep(0., 0.6, -q.y);
    // 縁の内側の明るい帯（右ほど・内へ ~90 px で消える）
    float inner = exp(dpx / mix(22., 60., side)) * mix(0.2, 0.9, side);
    float rim = exp(dpx / 2.0) * mix(0.1, 0.45, side);   // 縁の細く鋭い線
    col = surf + vec3(56., 61., 70.) / 255. * inner + vec3(50., 55., 62.) / 255. * rim;
  } else {
    // 大気：縁の外の灰の帯（~60 px で消える）
    float a = exp(-dpx / 38.) * mix(0.5, 0.95, side) + exp(-dpx / 160.) * 0.08 + exp(-dpx / 2.5) * 0.15 * side;
    col = col * (1. - 0.5 * min(a, 1.)) + vec3(52., 53., 55.) / 255. * a * 1.1;
  }
  // sRGB → 線形は正確な式で（pow 2.2 は暗部の直線部を潰す：地 4/255 が 0.3/255 に沈んだ）
  vec3 lo = col / 12.92, hi = pow((col + 0.055) / 1.055, vec3(2.4));
  gl_FragColor = vec4(mix(lo, hi, step(vec3(0.04045), col)), 1.);
}
`
const vert = /* glsl */ `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.9999, 1.); }
`

export default function Backdrop() {
  const size = useThree((s) => s.size)
  const dpr = useThree((s) => s.viewport.dpr)
  const uniforms = useMemo(() => ({ uRes: { value: [1, 1] }, uTime: { value: 0 } }), [])
  uniforms.uRes.value = [size.width * dpr, size.height * dpr]
  return (
    <mesh frustumCulled={false} renderOrder={-10}>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial vertexShader={vert} fragmentShader={frag} uniforms={uniforms} depthWrite={false} depthTest={false} />
    </mesh>
  )
}
