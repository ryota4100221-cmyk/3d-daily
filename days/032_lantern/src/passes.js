import * as THREE from 'three'
import { LIGHT, LAMP } from './palette.js'
import { VOLUME_GLSL, froxelReadUniforms } from './froxel.js'

/**
 * Day 032 — the rest of the pipeline.
 *
 *   makeLightDepthMaterial  pass 0: the scene from the light's point of view as
 *                           *linear* distance. Day 031's, unchanged, and now
 *                           read once per froxel instead of 19 million times.
 *   makeGBufferMaterial     pass 1: MRT normal+depth and velocity+id, previous
 *                           matrix per object and per instance (Day 030).
 *   makeCompositeMaterial   pass 4: one trilinear read of the froxel volume.
 *                           The bilateral upsample that Day 031 needed is gone —
 *                           see the note on the function.
 *   makeGlassMaterial       pass 5, new today: a forward-rendered transparent
 *                           surface inside a deferred renderer, applying the
 *                           medium at *its own* depth.
 *   makeTaaMaterial         pass 6: Halton jitter, YCoCg variance clipping.
 *   makePresentMaterial     pass 7: motion blur, grade, the only pass on canvas.
 */

// ---------------------------------------------------------------------------
// shared GLSL
// ---------------------------------------------------------------------------

const RECON = /* glsl */ `
  uniform float uFar;
  uniform float uTanHalf;
  uniform float uAspect;
  uniform vec2 uJitter;

  vec3 viewRay(vec2 uv) {
    vec2 c = uv - uJitter;
    return vec3(
      (c.x * 2.0 - 1.0) * uTanHalf * uAspect,
      (c.y * 2.0 - 1.0) * uTanHalf,
      -1.0
    );
  }
`

const HASH = /* glsl */ `
  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
`

const YCOCG = /* glsl */ `
  vec3 rgb2ycocg(vec3 c) {
    return vec3(
       0.25 * c.r + 0.5 * c.g + 0.25 * c.b,
       0.5  * c.r             - 0.5  * c.b,
      -0.25 * c.r + 0.5 * c.g - 0.25 * c.b
    );
  }
  vec3 ycocg2rgb(vec3 c) {
    return vec3(c.x + c.y - c.z, c.x + c.z, c.x - c.y - c.z);
  }
`

const REVTONE = /* glsl */ `
  float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
  vec3 toneIn(vec3 c)  { return c / (1.0 + lum(c)); }
  vec3 toneOut(vec3 c) { return c / max(1.0 - lum(c), 1e-4); }
`

const FS_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

// the light-space shadow test, in world units — shared by the glass, which is
// the one surface in the piece that three's own shadow machinery never sees
const LIGHT_VIS = /* glsl */ `
  uniform sampler2D uLightDepth;
  uniform mat4 uLightVP;
  uniform mat4 uLightView;
  uniform float uLightFar;
  uniform float uLightBias;

  float lightVis(vec3 p) {
    vec4 lp = uLightVP * vec4(p, 1.0);
    vec2 luv = lp.xy / lp.w * 0.5 + 0.5;
    if (luv.x < 0.0 || luv.x > 1.0 || luv.y < 0.0 || luv.y > 1.0) return 1.0;
    float d = -(uLightView * vec4(p, 1.0)).z;
    float m = texture2D(uLightDepth, luv).r * uLightFar;
    return step(d - uLightBias, m);
  }
`

// ---------------------------------------------------------------------------
// pass 0 — light-space depth
// ---------------------------------------------------------------------------

export function makeLightDepthMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uLightFar: { value: LIGHT.far } },
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      varying float vD;
      void main() {
        vec4 local = vec4(position, 1.0);
        #ifdef USE_INSTANCING
          local = instanceMatrix * local;
        #endif
        vec4 view = viewMatrix * modelMatrix * local;
        vD = -view.z;             // orthographic: this is already linear
        gl_Position = projectionMatrix * view;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform float uLightFar;
      varying float vD;
      void main() {
        gl_FragColor = vec4(clamp(vD / uLightFar, 0.0, 1.0), 0.0, 0.0, 1.0);
      }
    `,
  })
}

// ---------------------------------------------------------------------------
// pass 1 — G-buffer (GLSL3, two colour attachments)
// ---------------------------------------------------------------------------

export function makeGBufferMaterial({ far, matId = 0, instanced = false }) {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    defines: instanced ? { PREV_INSTANCE: '' } : {},
    uniforms: {
      uFar: { value: far },
      uMatId: { value: matId },
      uPrevModel: { value: new THREE.Matrix4() },
      uPrevViewProj: { value: new THREE.Matrix4() },
      uCurViewProj: { value: new THREE.Matrix4() },
    },
    vertexShader: /* glsl */ `
      uniform mat4 uPrevModel;
      uniform mat4 uPrevViewProj;
      uniform mat4 uCurViewProj;

      #ifdef PREV_INSTANCE
        attribute mat4 aPrevInstance;
      #endif

      varying vec3 vN;
      varying float vDepth;
      varying vec4 vCur;
      varying vec4 vPrev;

      void main() {
        vec4 local = vec4(position, 1.0);
        vec3 nrm = normal;

        #ifdef USE_INSTANCING
          local = instanceMatrix * local;
          nrm = normalize(mat3(instanceMatrix) * nrm);
        #endif

        vec4 world = modelMatrix * local;
        vec4 view = viewMatrix * world;
        vN = normalize(normalMatrix * nrm);
        vDepth = -view.z;

        vec4 prevLocal = vec4(position, 1.0);
        #ifdef PREV_INSTANCE
          prevLocal = aPrevInstance * prevLocal;
        #endif
        vec4 prevWorld = uPrevModel * prevLocal;

        vCur = uCurViewProj * world;        // unjittered
        vPrev = uPrevViewProj * prevWorld;  // unjittered

        gl_Position = projectionMatrix * view;  // jittered
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;

      layout(location = 0) out vec4 outNormalDepth;
      layout(location = 1) out vec4 outMotion;

      uniform float uFar;
      uniform float uMatId;

      varying vec3 vN;
      varying float vDepth;
      varying vec4 vCur;
      varying vec4 vPrev;

      void main() {
        vec3 n = normalize(vN);
        if (!gl_FrontFacing) n = -n;

        vec2 vel = vec2(0.0);
        if (vPrev.w > 1e-4 && vCur.w > 1e-4) {
          vec2 cur = vCur.xy / vCur.w;
          vec2 prv = vPrev.xy / vPrev.w;
          vel = (cur - prv) * 0.5; // NDC delta -> uv delta
        }

        outNormalDepth = vec4(n, clamp(vDepth / uFar, 0.00002, 1.0));
        outMotion = vec4(vel, uMatId, 1.0);
      }
    `,
  })
}

// ---------------------------------------------------------------------------
// pass 4 — composite
// ---------------------------------------------------------------------------

/**
 * Yesterday this pass was forty lines of bilateral upsample, and every one of
 * them existed to repair the same wound: a half-resolution 2D buffer holds one
 * answer per pixel, so four texels straddling the lip of a vessel hold "twelve
 * metres of lit haze" and "thirty centimetres of porcelain" and averaging them
 * paints a halo around every silhouette in the frame.
 *
 * All of that is gone, and not because it was optimised away. A silhouette is a
 * discontinuity in *depth*, and the volume now has a depth axis: the two texels
 * either side of the lip are not neighbours in the froxel grid, they are in
 * different slices, and the trilinear read simply never mixes them. The fix for
 * a missing dimension turned out to be the dimension.
 *
 * What is left is one read and the same two-term compositing rule that has been
 * true since Day 031: what is behind the air, dimmed by what the air absorbed,
 * plus what the air scattered toward the eye.
 */
export function makeCompositeMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...froxelReadUniforms(),
      uBeauty: { value: null },
      uGbuf: { value: null },
      uFar: { value: 80 },
      uTanHalf: { value: 0.3 },
      uAspect: { value: 1.6 },
      uJitter: { value: new THREE.Vector2() },
    },
    depthTest: false,
    depthWrite: false,
    vertexShader: FS_VERT,
    fragmentShader: /* glsl */ `
      precision highp float;
      #define TEX2D texture2D

      varying vec2 vUv;

      uniform sampler2D uBeauty;
      uniform sampler2D uGbuf;
      uniform sampler2D uVol;

      ${RECON}
      ${VOLUME_GLSL}

      void main() {
        vec3 beauty = texture2D(uBeauty, vUv).rgb;
        float ga = texture2D(uGbuf, vUv).a;
        float d = ga > 1e-5 ? ga * uFar : uFar;

        // the volume was built through an unjittered frustum — it is a property
        // of the room, not of this frame's sub-pixel offset
        vec4 vol = sampleScatter(uVol, vUv - uJitter, d);

        vec3 col = beauty * clamp(vol.a, 0.0, 1.0) + max(vol.rgb, vec3(0.0));
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  })
}

// ---------------------------------------------------------------------------
// pass 5 — the glass. A forward pass inside a deferred renderer.
// ---------------------------------------------------------------------------

/**
 * Four days of deferred rendering (Days 028-031) and not one transparent
 * surface, because a G-buffer holds exactly one surface per pixel and glass is
 * the case where that is a lie.
 *
 * The volume is what makes it affordable. Ordering aside, the hard part of fogged
 * transparency is that the glass needs to know how much air is in front of *it* —
 * a different quantity from the air in front of the wall behind it — and a
 * screen-space ray march has no way to answer that without marching again. One
 * trilinear read into the froxel grid answers it exactly.
 *
 * Compositing, derived rather than tuned. With C the already-composited scene
 * behind this surface, L and T the in-scatter and transmittance from the eye to
 * *this* surface, and `transmit` how much of what is behind survives the glass:
 *
 *     final = L + T·surface + transmit·(C - L)
 *           = transmit·C  +  [ L·(1 - transmit) + T·surface ]
 *
 * which is exactly premultiplied-alpha blending with alpha = 1 - transmit. So it
 * costs one blend mode, no read-back of the destination, and it nests correctly:
 * drawing back faces and then front faces composites two glass layers in the
 * right order with no depth buffer and no sorting.
 *
 * The depth test is a texture fetch and a discard. The HDR target has no depth
 * attachment, and does not need one — the G-buffer already knows what is in
 * front, in linear units, and comparing against it is one line.
 */
export function makeGlassMaterial({ side = THREE.FrontSide } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...froxelReadUniforms(),
      uGbuf: { value: null },
      uLightDepth: { value: null },
      uLightVP: { value: new THREE.Matrix4() },
      uLightView: { value: new THREE.Matrix4() },
      uLightFar: { value: LIGHT.far },
      uLightBias: { value: LIGHT.bias + 0.05 },
      uLightDir: { value: new THREE.Vector3(...LIGHT.dir).normalize() },
      uLightCol: { value: new THREE.Color(...LIGHT.color) },
      uCamPos: { value: new THREE.Vector3() },
      uRes: { value: new THREE.Vector2(1600, 1000) },
      uFar: { value: 80 },
      uJitter: { value: new THREE.Vector2() },
      uTransmit: { value: 0.945 },
      uTint: { value: new THREE.Color(0.60, 0.74, 0.94) },
      uGloss: { value: 220.0 },
      uSpecK: { value: 2.6 },
      uRim: { value: 0.52 },
    },
    side,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    vertexShader: /* glsl */ `
      varying vec3 vW;
      varying vec3 vN;
      varying float vD;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vW = world.xyz;
        vN = normalize(mat3(modelMatrix) * normal);
        vec4 view = viewMatrix * world;
        vD = -view.z;
        gl_Position = projectionMatrix * view;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      #define TEX2D texture2D

      varying vec3 vW;
      varying vec3 vN;
      varying float vD;

      uniform sampler2D uGbuf;
      uniform sampler2D uVol;
      uniform vec3 uLightDir;
      uniform vec3 uLightCol;
      uniform vec3 uCamPos;
      uniform vec2 uRes;
      uniform vec2 uJitter;
      uniform float uFar;
      uniform float uTransmit;
      uniform vec3 uTint;
      uniform float uGloss;
      uniform float uSpecK;
      uniform float uRim;

      ${VOLUME_GLSL}
      ${LIGHT_VIS}

      void main() {
        vec2 uv = gl_FragCoord.xy / uRes;

        // the depth test, by hand
        float ga = texture2D(uGbuf, uv).a;
        float dG = ga > 1e-5 ? ga * uFar : uFar;
        if (vD > dG) discard;

        vec3 N = normalize(vN);
        vec3 V = normalize(uCamPos - vW);
        // Face the normal at the viewer using the view vector, NOT
        // gl_FrontFacing. three renders the BackSide draw by flipping the
        // winding order (frontFace(CW)) rather than by changing which triangles
        // are "front", so gl_FrontFacing reports *true* for exactly the faces
        // whose normals point away. Trusting it pinned the far wall's fresnel at
        // 1 across its whole silhouette, and a glass tube whose fresnel is 1
        // everywhere is a tin can.
        if (dot(N, V) < 0.0) N = -N;
        float ndv = clamp(dot(N, V), 0.0, 1.0);
        float F = 0.04 + 0.96 * pow(1.0 - ndv, 5.0);

        // grazing angles reflect nearly everything, which is the entire reason a
        // clear glass tube is visible at all: its silhouette is its edge lit
        float transmit = mix(uTransmit, 0.12, F);

        // Gated on the key actually being on this side of the sheet. Ungated,
        // the half-vector for a light behind the surface is normalize(L + V)
        // with L ~ -V — a normalize of very nearly zero.
        vec3 surf = vec3(0.0);
        if (dot(N, uLightDir) > 0.0) {
          vec3 H = normalize(uLightDir + V);
          surf += uLightCol * (pow(max(dot(N, H), 0.0), uGloss) * uSpecK * lightVis(vW));
        }

        // No specular for the lamp, and the render is why. A point light sitting
        // on the axis of its own tube is, for the far wall, almost exactly
        // behind the viewer: the half-vector lines up with the normal across the
        // *whole* wall at once, so a Blinn lobe stops being a highlight and
        // becomes a flat wash. It turned the cylinder into a milk bottle. What
        // the lamp is actually doing to this glass is lighting the air on both
        // sides of it, which the volume already knows, and the fresnel edge —
        // which is the only place a clear tube is ever visible anyway.
        surf += uTint * (pow(1.0 - ndv, 3.2) * uRim);

        vec4 vol = sampleScatter(uVol, uv - uJitter, vD);
        vec3 Lt = max(vol.rgb, vec3(0.0));
        float Tt = clamp(vol.a, 0.0, 1.0);

        gl_FragColor = vec4(Lt * (1.0 - transmit) + Tt * surf, 1.0 - transmit);
      }
    `,
  })
}

// ---------------------------------------------------------------------------
// pass 6 — TAA resolve
// ---------------------------------------------------------------------------

/**
 * Day 030's, unchanged for a third day, which is what a platform looks like.
 *
 * It has one new customer: the glass is drawn before this pass, so its silhouette
 * gets anti-aliased with everything else. It also has one new lie to live with —
 * the glass writes no velocity, so its pixels reproject along whatever is behind
 * them. The variance clip keeps that honest at this camera speed; the proper fix
 * is a velocity write for transparents, and it is tomorrow's problem.
 */
export function makeTaaMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uCur: { value: null },
      uHist: { value: null },
      uMotion: { value: null },
      uGbuf: { value: null },
      uTexel: { value: new THREE.Vector2(1 / 1600, 1 / 1000) },
      uRes: { value: new THREE.Vector2(1600, 1000) },
      uFar: { value: 80 },
      uValid: { value: 0 },
      uFeedback: { value: 0.93 },
      uGamma: { value: 1.20 },
    },
    depthTest: false,
    depthWrite: false,
    vertexShader: FS_VERT,
    fragmentShader: /* glsl */ `
      precision highp float;

      varying vec2 vUv;

      uniform sampler2D uCur;
      uniform sampler2D uHist;
      uniform sampler2D uMotion;
      uniform sampler2D uGbuf;
      uniform vec2 uTexel;
      uniform vec2 uRes;
      uniform float uFar;
      uniform float uValid;
      uniform float uFeedback;
      uniform float uGamma;

      ${YCOCG}
      ${REVTONE}

      vec3 clipToBox(vec3 c, vec3 e, vec3 q) {
        vec3 v = q - c;
        vec3 a = abs(v / max(e, vec3(1e-5)));
        float m = max(a.x, max(a.y, a.z));
        return m > 1.0 ? c + v / m : q;
      }

      void main() {
        vec3 cur = toneIn(texture2D(uCur, vUv).rgb);
        float gd = texture2D(uGbuf, vUv).a;
        float curD = gd > 1e-5 ? gd * uFar : uFar;

        vec3 m1 = vec3(0.0);
        vec3 m2 = vec3(0.0);
        for (int j = -1; j <= 1; j++) {
          for (int i = -1; i <= 1; i++) {
            vec3 s = rgb2ycocg(toneIn(
              texture2D(uCur, vUv + vec2(float(i), float(j)) * uTexel).rgb
            ));
            m1 += s;
            m2 += s * s;
          }
        }
        m1 /= 9.0;
        m2 /= 9.0;
        vec3 sigma = sqrt(max(m2 - m1 * m1, vec3(0.0)));
        vec3 ext = sigma * uGamma;

        vec2 vel = texture2D(uMotion, vUv).rg;
        vec2 prevUV = vUv - vel;
        vec4 h = texture2D(uHist, prevUV);

        float valid = uValid;
        if (prevUV.x < 0.0 || prevUV.x > 1.0 || prevUV.y < 0.0 || prevUV.y > 1.0) valid = 0.0;
        valid *= step(abs(h.a - curD), 0.06 * curD + 0.06);

        vec3 histY = clipToBox(m1, ext, rgb2ycocg(toneIn(h.rgb)));
        vec3 hist = ycocg2rgb(histY);

        float vpx = length(vel * uRes);
        float fb = uFeedback * valid * (1.0 - clamp(vpx / 34.0, 0.0, 0.55));

        vec3 outCol = toneOut(mix(cur, hist, fb));
        gl_FragColor = vec4(max(outCol, vec3(0.0)), curD);
      }
    `,
  })
}

// ---------------------------------------------------------------------------
// pass 7 — present: motion blur, then the grade. The only pass on the canvas.
// ---------------------------------------------------------------------------

export function makePresentMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...froxelReadUniforms(),
      uColor: { value: null }, // TAA output
      uRaw: { value: null }, // composite + glass, pre-TAA
      uBeauty: { value: null },
      uGbuf: { value: null },
      uMotion: { value: null },
      uLightDepth: { value: null },
      uRes: { value: new THREE.Vector2(1600, 1000) },
      uFar: { value: 80 },
      uJitter: { value: new THREE.Vector2() },
      uVelScale: { value: 1.5 },
      uMaxBlur: { value: 55.0 },
      uTime: { value: 0 },
      uFrame: { value: 0 },
      uMode: { value: 0 },
      uReveal: { value: 0 },
      uExposure: { value: 1.46 },
    },
    depthTest: false,
    depthWrite: false,
    vertexShader: FS_VERT,
    fragmentShader: /* glsl */ `
      precision highp float;
      #define TEX2D texture2D

      varying vec2 vUv;

      uniform sampler2D uColor;
      uniform sampler2D uRaw;
      uniform sampler2D uBeauty;
      uniform sampler2D uGbuf;
      uniform sampler2D uMotion;
      uniform sampler2D uVol;
      uniform sampler2D uLightDepth;
      uniform vec2 uRes;
      uniform float uFar;
      uniform vec2 uJitter;
      uniform float uVelScale;
      uniform float uMaxBlur;
      uniform float uTime;
      uniform float uFrame;
      uniform float uMode;
      uniform float uReveal;
      uniform float uExposure;

      ${HASH}
      ${VOLUME_GLSL}

      vec2 velPx(vec2 uv) {
        return texture2D(uMotion, uv).rg * uVelScale * uRes;
      }

      // Day 030's gather, kept: a still pixel beside a fast edge has to be
      // allowed to receive a smear it is not making.
      vec3 motionBlur(sampler2D src, vec2 uv) {
        vec2 vC = velPx(uv);
        vec2 vM = vC;
        float lM = length(vC);

        float ring = uMaxBlur * 0.5;
        for (int i = 0; i < 8; i++) {
          float a = (float(i) + 0.5) * 0.7853982;
          vec2 v = velPx(uv + vec2(cos(a), sin(a)) * ring / uRes);
          float l = length(v);
          if (l > lM) { lM = l; vM = v; }
        }

        if (lM < 1.2) return texture2D(src, uv).rgb;

        vec2 dir = vM * min(1.0, uMaxBlur / lM);
        float jit = hash12(gl_FragCoord.xy + vec2(uFrame, uFrame * 1.61)) - 0.5;

        vec3 acc = vec3(0.0);
        float wsum = 0.0;
        for (int i = 0; i < 23; i++) {
          float f = (float(i) + 0.5 + jit) / 23.0 - 0.5;
          vec2 opx = dir * f;
          vec2 suv = uv + opx / uRes;
          float need = length(opx);
          float reach = 0.5 * max(length(velPx(suv)), length(vC));
          float w = 1.0 - smoothstep(reach * 0.85, reach * 1.25 + 1.0, need);
          acc += texture2D(src, suv).rgb * w;
          wsum += w;
        }
        return wsum > 1e-4 ? acc / wsum : texture2D(src, uv).rgb;
      }

      vec3 aces(vec3 x) {
        return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
      }

      void main() {
        float ga = texture2D(uGbuf, vUv).a;
        float dLin = ga > 1e-5 ? ga * uFar : uFar;
        vec3 col;

        if (uMode < 0.5) {
          col = motionBlur(uColor, vUv);                    // 1 · composite
        } else if (uMode < 1.5) {
          col = texture2D(uBeauty, vUv).rgb;                // 2 · beauty, dry air
        } else if (uMode < 2.5) {
          col = pow(texture2D(uGbuf, vUv).rgb * 0.5 + 0.5, vec3(2.2));
        } else if (uMode < 3.5) {                           // 4 · velocity
          vec2 v = texture2D(uMotion, vUv).rg * 150.0;
          col = pow(clamp(vec3(0.5 + v.x, 0.5 + v.y, 0.5), 0.0, 1.0), vec3(2.2));
        } else if (uMode < 4.5) {                           // 5 · in-scatter
          col = max(sampleScatter(uVol, vUv - uJitter, dLin).rgb, vec3(0.0));
        } else if (uMode < 5.5) {                           // 6 · transmittance
          col = pow(vec3(clamp(sampleScatter(uVol, vUv - uJitter, dLin).a, 0.0, 1.0)), vec3(2.2));
        } else if (uMode < 6.5) {                           // 7 · the atlas itself
          // sixty-four slices of the room, laid out as a contact sheet. Near the
          // eye at the top left, the far wall at the bottom right.
          col = texture2D(uVol, vUv * vec2(1.0, 1.0)).rgb * 0.9;
        } else if (uMode < 7.5) {                           // 8 · light-space depth
          float d = texture2D(uLightDepth, vUv).r;
          col = pow(vec3(1.0 - d), vec3(2.2));
        } else {
          col = motionBlur(uRaw, vUv);                      // 9 · TAA off
        }

        // ---- grade ---------------------------------------------------------
        col *= uExposure;
        col = aces(col);

        float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
        // Day 031 pushed its highlights warm because its key was amber. Here the
        // highlights *are* the shafts, and warming them would put a second warm
        // light in a room that is supposed to have exactly one.
        vec3 shadow = vec3(0.004, 0.008, 0.019);
        vec3 high = vec3(0.006, 0.011, 0.016);
        col += shadow * (1.0 - smoothstep(0.0, 0.55, l));
        col += high * smoothstep(0.35, 1.0, l);
        col = clamp(col, 0.0, 1.0);

        // ---- opening: a lamp coming up -------------------------------------
        // Day 031 opened a horizontal slot, because it was named after one.
        // This one is named after a light, so the room arrives as a circle of it
        // spreading out from the lantern.
        float band = smoothstep(0.0, 1.0, uReveal);
        vec2 q = (vUv - vec2(0.615, 0.44)) * vec2(uRes.x / uRes.y, 1.0);
        float r = length(q) / 1.35;
        float open = 1.0 - smoothstep(band - 0.22, band, r);
        col = mix(vec3(0.018, 0.021, 0.028), col, clamp(open, 0.0, 1.0));

        // ---- grain + vignette ---------------------------------------------
        float g = hash12(gl_FragCoord.xy + vec2(floor(uTime * 24.0)));
        col += (g - 0.5) * 0.016;

        vec2 vq = vUv - 0.5;
        col *= 1.0 - dot(vq, vq) * 0.34;

        gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
      }
    `,
  })
}
