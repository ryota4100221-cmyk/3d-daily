import * as THREE from 'three'

// The two shaders that carry the whole effect.
//
// vertex   — velocity-driven ripple + shear. At rest the plane is essentially
//            flat; the faster the gallery travels, the more it folds and skews.
//            This is the move the reference sites are known for: the *image*
//            reacts to scroll speed, not just its position.
// fragment — object-fit:cover UV remap, speed-scaled chromatic aberration,
//            distance-to-centre dissolve into the paper background, and the
//            staggered reveal.

const vert = /* glsl */ `
  uniform float uTime;
  uniform float uSpeed;        // |velocity|, normalised 0..1
  uniform float uSpeedSigned;  // signed velocity, -1..1
  uniform float uReveal;       // 0..1 intro

  varying vec2 vUv;
  varying float vFold;

  void main() {
    vUv = uv;
    vec3 p = position;   // unit plane: -0.5 .. 0.5, scaled by the mesh

    // travelling fold — two crossed waves so it never reads as a flag
    float w = sin(p.x * 7.0 + uTime * 0.9) * 0.6
            + cos(p.y * 4.6 - uTime * 0.6) * 0.6;
    float amp = 0.02 + uSpeed * 0.26;
    p.z += w * amp;

    // shear: the far edge lags behind the near edge while the strip moves
    p.x += uSpeedSigned * 0.16 * (p.y * 2.0);

    // reveal rises out of the surface
    p.z -= (1.0 - uReveal) * 0.9;

    vFold = w * amp;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`

const frag = /* glsl */ `
  uniform sampler2D uTex;
  uniform vec2 uPlaneSize;
  uniform vec2 uImageSize;
  uniform float uSpeed;
  uniform float uSpeedSigned;
  uniform float uDim;      // 0 at centre stage, 1 at the wings
  uniform float uReveal;
  uniform float uFocus;    // 1 when this plate holds the centre
  uniform vec3  uPaper;

  varying vec2 vUv;
  varying float vFold;

  vec3 toLinear(vec3 c) { return pow(c, vec3(2.2)); }

  void main() {
    // ---- object-fit: cover -------------------------------------------------
    // keeps the 3:4 plate un-squashed on a plane of any aspect
    float pr = uPlaneSize.x / uPlaneSize.y;
    float ir = uImageSize.x / uImageSize.y;
    vec2 ratio = vec2(min(pr / ir, 1.0), min((1.0 / pr) / (1.0 / ir), 1.0));
    vec2 uv = vec2(
      vUv.x * ratio.x + (1.0 - ratio.x) * 0.5,
      vUv.y * ratio.y + (1.0 - ratio.y) * 0.5
    );

    // ---- speed-scaled chromatic aberration ---------------------------------
    // quadratic, not linear: a linear ramp turned every ordinary drag into a
    // rainbow. Squaring keeps the split invisible at browsing speed and lets it
    // bloom only on a hard flick — which is the whole point of the effect.
    float a = uSpeedSigned * abs(uSpeedSigned) * 0.011;
    float r = texture2D(uTex, uv - vec2(a, 0.0)).r;
    float g = texture2D(uTex, uv).g;
    float b = texture2D(uTex, uv + vec2(a, 0.0)).b;
    vec3 col = toLinear(vec3(r, g, b));

    // ---- lighting from the fold --------------------------------------------
    // the geometric ripple is echoed in tone so the fold is legible even on a
    // flat-lit unlit material
    col *= 1.0 + vFold * 0.9;

    // held plate lifts a touch; the wings sit back
    col *= mix(0.94, 1.04, uFocus);

    // ---- plate vignette ----------------------------------------------------
    vec2 q = vUv - 0.5;
    float vig = 1.0 - dot(q, q) * 0.35;
    col *= vig;

    // ---- dissolve into the room --------------------------------------------
    vec3 paper = toLinear(uPaper);
    float fade = uDim * uDim * 0.95;
    col = mix(col, paper, fade);
    col = mix(paper, col, smoothstep(0.0, 1.0, uReveal));

    gl_FragColor = vec4(col, 1.0);
  }
`

export function makePlateMaterial(texture, planeSize, imageSize, paper) {
  return new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    // opaque on purpose: everything fades by mixing toward the paper colour, so
    // there is no transparency sorting and no white-screen risk (Day 019).
    transparent: false,
    side: THREE.DoubleSide,
    uniforms: {
      uTex: { value: texture },
      uPlaneSize: { value: new THREE.Vector2(...planeSize) },
      uImageSize: { value: new THREE.Vector2(...imageSize) },
      uTime: { value: 0 },
      uSpeed: { value: 0 },
      uSpeedSigned: { value: 0 },
      uDim: { value: 0 },
      uReveal: { value: 0 },
      uFocus: { value: 0 },
      uPaper: { value: new THREE.Color(paper) },
    },
  })
}
