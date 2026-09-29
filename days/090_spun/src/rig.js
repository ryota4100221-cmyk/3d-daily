// rig.js — Day 090 · The Star in the Spun Steel
//
// Spun stainless is scratched in circles: the lathe leaves one groove per turn,
// so at every point the groove runs along the circumference. The only thing
// this file knows about the steel is that direction,
//
//     T(p) = normalize(-p.z, 0, p.x)        (object space, axis = +Y)
//
// and Ward's anisotropic lobe, which is narrow along T and wide across it.
// Nowhere below is there a line, a star or a cross being drawn. A highlight can
// only live where H·T ≈ 0, i.e. where the groove is perpendicular to the half
// vector — and on a disc of circumferential grooves that set is the diameter
// pointing along H. So the highlight is a straight bar through the centre that
// turns with the lamp. Make the lobe round (uIso = 1) and the same lamp gives a
// dot.
import * as THREE from 'three'

// Ward roughness. Along the groove the surface is nearly mirror; across it the
// scratches fan the micro-normals out.
export const ALPHA_T = 0.035
export const ALPHA_B = 0.75
export const ALPHA_ISO = 0.05

const lin = (hex) => new THREE.Color(hex) // THREE.Color converts sRGB hex → linear

export const PALETTE = {
  ground: '#F8F4EC', // 生成り — the site's ground (45.1%)
  olive: '#686858',
  rust: '#885838',
}

const vert = /* glsl */ `
  varying vec3 vW;
  varying vec3 vN;
  varying vec3 vT;
  varying float vR;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    vN = normalize(mat3(modelMatrix) * normal);
    // the groove: circumferential about the object's own Y axis
    vec3 t = vec3(-position.z, 0.0, position.x);
    vT = mat3(modelMatrix) * (length(t) > 1e-5 ? normalize(t) : vec3(1.0, 0.0, 0.0));
    vR = length(position.xz);
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`

const frag = /* glsl */ `
  uniform vec3 uL;
  uniform vec3 uLc;
  uniform float uIso;
  uniform float uAT;
  uniform float uAB;
  uniform float uAI;
  uniform vec3 uGround;
  uniform vec3 uOlive;
  varying vec3 vW;
  varying vec3 vN;
  varying vec3 vT;
  varying float vR;

  // the room the steel reflects: a cream ceiling, a darker olive floor,
  // one long window strip — enough for the metal to read as metal
  vec3 room(vec3 r) {
    float up = smoothstep(-0.35, 0.45, r.y);
    vec3 c = mix(mix(uOlive, uGround, 0.45), uGround * 1.02, up);
    float win = smoothstep(0.06, 0.0, abs(r.x + 0.35)) * smoothstep(0.1, 0.5, r.y);
    return c + win * 0.35;
  }

  float hash(float x) { return fract(sin(x * 91.3458) * 47453.5453); }

  void main() {
    vec3 N = normalize(vN);
    if (!gl_FrontFacing) N = -N;
    vec3 T = normalize(vT - N * dot(vT, N));
    vec3 B = cross(N, T);
    vec3 V = normalize(cameraPosition - vW);
    vec3 L = normalize(uL);
    vec3 H = normalize(L + V);

    float nl = max(dot(N, L), 0.0);
    float nv = max(dot(N, V), 1e-3);
    float nh = max(dot(N, H), 1e-3);

    float aT = mix(uAT, uAI, uIso);
    float aB = mix(uAB, uAI, uIso);
    float ht = dot(H, T) / aT;
    float hb = dot(H, B) / aB;
    float ward = exp(-(ht * ht + hb * hb) / (nh * nh))
               / (4.0 * 3.14159265 * aT * aB * sqrt(max(nl * nv, 1e-4)));
    vec3 spec = uLc * ward * nl;

    // one groove per turn: a faint ring-to-ring variation in polish
    float ring = hash(floor(vR * 260.0));
    float grain = mix(0.94, 1.04, ring * (1.0 - uIso));

    vec3 F0 = vec3(0.56, 0.57, 0.58);
    float fres = pow(1.0 - nv, 5.0);
    vec3 F = F0 + (1.0 - F0) * fres;
    vec3 R = reflect(-V, N);
    vec3 env = room(R) * F * 0.78 * grain;

    vec3 col = env + spec * F;
    col = col / (1.0 + col * 0.35);          // soft shoulder
    gl_FragColor = vec4(pow(col, vec3(1.0 / 2.2)), 1.0);
  }
`

export function makeSteel() {
  return new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    side: THREE.DoubleSide,
    uniforms: {
      uL: { value: new THREE.Vector3(0.6, 0.7, 0.3) },
      uLc: { value: lin('#fff3e2').multiplyScalar(1.5) },
      uIso: { value: 0 },
      uAT: { value: ALPHA_T },
      uAB: { value: ALPHA_B },
      uAI: { value: ALPHA_ISO },
      uGround: { value: lin(PALETTE.ground) },
      uOlive: { value: lin(PALETTE.olive) },
    },
  })
}

// The lamp: an azimuth that the pointer drags, an elevation that stays put.
export function lampDir(azimuth, elevation = 0.92) {
  return new THREE.Vector3(
    Math.cos(elevation) * Math.cos(azimuth),
    Math.sin(elevation),
    Math.cos(elevation) * Math.sin(azimuth),
  )
}

// CPU check of the claim, on the flat face of the lid (normal +Y, grooves
// circumferential about `centre`). Walk a ring of radius r in 3600 steps,
// evaluate the same Ward lobe the shader does, report where it peaks and
// where the half vector at that point says the bar should be.
export function measureBar(L, camPos, centre, r = 0.9, steps = 3600) {
  let best = -1
  let bestPhi = 0
  const V = new THREE.Vector3()
  const H = new THREE.Vector3()
  const p = new THREE.Vector3()
  for (let i = 0; i < steps; i++) {
    const phi = (i / steps) * Math.PI * 2
    p.set(centre.x + r * Math.cos(phi), centre.y, centre.z + r * Math.sin(phi))
    V.subVectors(camPos, p).normalize()
    H.addVectors(L, V).normalize()
    const T = [-Math.sin(phi), 0, Math.cos(phi)]
    const Bv = [Math.cos(phi), 0, Math.sin(phi)] // N × T with N = +Y (sign irrelevant, squared)
    const ht = (H.x * T[0] + H.z * T[2]) / ALPHA_T
    const hb = (H.x * Bv[0] + H.z * Bv[2]) / ALPHA_B
    const nh = Math.max(H.y, 1e-3)
    const w = Math.exp(-(ht * ht + hb * hb) / (nh * nh))
    if (w > best) {
      best = w
      bestPhi = phi
    }
  }
  // prediction: the diameter along H's horizontal part, taken at the peak point
  p.set(centre.x + r * Math.cos(bestPhi), centre.y, centre.z + r * Math.sin(bestPhi))
  V.subVectors(camPos, p).normalize()
  H.addVectors(L, V).normalize()
  const phiH = Math.atan2(H.z, H.x)
  let d = Math.atan2(Math.sin(bestPhi - phiH), Math.cos(bestPhi - phiH))
  // a diameter has two ends; fold the far end onto the near one
  if (Math.abs(d) > Math.PI / 2) d = d - Math.sign(d) * Math.PI
  return { peak: bestPhi, phiH, delta: d, stepDeg: 360 / steps }
}
