import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import {
  LAMBDAS,
  HUES,
  GROUND,
  WORLD_H,
  ROW_A_Y,
  ROW_B_Y,
  BAR_Y,
  layout,
  lightFrom,
} from './rig.js'

// The surface exists only here and in rig.js, and the two copies have to agree
// to the last bit, because the number printed on screen is computed by the JS
// copy and the thing you are looking at is drawn by this one.
const FIELD = /* glsl */ `
  float sdBox(vec2 p, vec2 b, float r){
    vec2 d = abs(p) - b + r;
    return min(max(d.x, d.y), 0.0) + length(max(d, 0.0)) - r;
  }
  float smin(float a, float b, float k){
    float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
    return mix(b, a, h) - k * h * (1.0 - h);
  }
  float fRaw(vec2 p){
    float db = sdBox(p - vec2(0.0, -0.16),  vec2(0.300, 0.500), 0.130);
    float dn = sdBox(p - vec2(0.0,  0.42),  vec2(0.115, 0.155), 0.055);
    float dc = sdBox(p - vec2(0.0,  0.655), vec2(0.155, 0.125), 0.045);
    float d  = min(smin(db, dn, 0.10), dc);
    float t  = clamp(1.0 + d / 0.32, 0.0, 1.0);
    float f  = sqrt(max(0.0, 1.0 - t * t));
    float band = (1.0 - smoothstep(0.14, 0.20, abs(p.y + 0.12)))
               * (1.0 - smoothstep(0.20, 0.27, abs(p.x)));
    f -= 0.085 * band * f;
    f += 0.035 * (1.0 - smoothstep(0.0, 0.03, dc)) * sin(58.0 * p.x);
    return 0.42 * f;
  }
`

const VERT = /* glsl */ `
  varying vec2 vP;
  uniform float uAsp;
  void main(){
    vP = (uv * 2.0 - 1.0) * vec2(1.0, uAsp);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

// Nothing in here flattens anything. The flattening is what G⁻ᵀ does to b and
// the matching lamp is what G does to s; the row is the consequence.
const FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vP;
  uniform float uAsp;
  uniform float uLambda;
  uniform vec3  uS;
  uniform float uMode;
  uniform float uGround;
  ${FIELD}
  const float E = 0.0035;

  void main(){
    vec2 p = vP * 0.68;      // the relief's own units; 1.0 is the tile half-width
    vec2 g = vec2(
      fRaw(p + vec2(E, 0.0)) - fRaw(p - vec2(E, 0.0)),
      fRaw(p + vec2(0.0, E)) - fRaw(p - vec2(0.0, E))
    ) / (2.0 * E);

    float I;
    if (uMode < 0.5) {
      // the albedo-scaled unit normal of the ORIGINAL surface, then G⁻ᵀ / G
      float N = sqrt(1.0 + dot(g, g));
      vec3 b  = vec3(-g.x, -g.y, 1.0) / N;
      vec3 bb = vec3(b.x, b.y, b.z / uLambda);
      vec3 ss = vec3(uS.x, uS.y, uLambda * uS.z);
      I = max(0.0, dot(bb, ss));
    } else {
      // the same six objects, one lamp, one paint — the naive reading
      vec2  gb = uLambda * g;
      float NB = sqrt(1.0 + dot(gb, gb));
      I = max(0.0, dot(vec3(-gb.x, -gb.y, 1.0) / NB, uS));
    }

    float q  = I / max(uS.z, 1e-4);                 // the flat rim is q = 1
    float qs = q <= 1.0 ? q : 1.0 + (q - 1.0) / (1.0 + 0.82 * (q - 1.0));
    vec3  col = vec3(uGround * qs);
    col += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
    gl_FragColor = vec4(col, 1.0);
  }
`

function Frame({ light }) {
  const { size, camera } = useThree()
  const L = useMemo(() => layout(size.width, size.height), [size.width, size.height])

  camera.zoom = size.height / WORLD_H
  camera.updateProjectionMatrix()

  const mats = useMemo(
    () =>
      [0, 1].flatMap((mode) =>
        LAMBDAS.map(
          (lam) =>
            new THREE.ShaderMaterial({
              vertexShader: VERT,
              fragmentShader: FRAG,
              uniforms: {
                uLambda: { value: lam },
                uS: { value: new THREE.Vector3(...lightFrom(2.36, 0.56)) },
                uMode: { value: mode },
                uGround: { value: GROUND },
                uAsp: { value: 1.34 },
              },
            })
        )
      ),
    []
  )

  for (const m of mats) m.uniforms.uAsp.value = L.tileH / L.tile

  useFrame(() => {
    const s = lightFrom(light.current.az, light.current.el)
    for (const m of mats) m.uniforms.uS.value.set(s[0], s[1], s[2])
  })

  const geo = useMemo(() => new THREE.PlaneGeometry(1, 1), [])

  return (
    <group>
      {LAMBDAS.map((lam, i) => (
        <group key={i}>
          <mesh
            geometry={geo}
            material={mats[i]}
            position={[L.cx[i], ROW_A_Y, 0]}
            scale={[L.tile, L.tileH, 1]}
          />
          <mesh
            geometry={geo}
            material={mats[LAMBDAS.length + i]}
            position={[L.cx[i], ROW_B_Y, 0]}
            scale={[L.tile, L.tileH, 1]}
          />

          {/* the only colour in the frame: how deep the object above actually
              is. Split cap / body, because the six bottles in the source are. */}
          <mesh position={[L.cx[i] - L.tile / 2 + (L.tile * lam * 0.2) / 2, BAR_Y, 0]}>
            <planeGeometry args={[L.tile * lam * 0.2, 0.052]} />
            <meshBasicMaterial color={HUES[i][1]} toneMapped={false} />
          </mesh>
          <mesh
            position={[L.cx[i] - L.tile / 2 + L.tile * lam * 0.2 + (L.tile * lam * 0.8) / 2, BAR_Y, 0]}
          >
            <planeGeometry args={[L.tile * lam * 0.8, 0.052]} />
            <meshBasicMaterial color={HUES[i][0]} toneMapped={false} />
          </mesh>

          {/* where the bar would end if the object were not flattened */}
          <mesh position={[L.cx[i], BAR_Y - 0.062, 0]}>
            <planeGeometry args={[L.tile, 0.006]} />
            <meshBasicMaterial color="#7C7C7C" toneMapped={false} />
          </mesh>
        </group>
      ))}
    </group>
  )
}

export default function Scene({ light }) {
  return <Frame light={light} />
}
