import * as THREE from 'three'
import { FOG, LIGHT } from './palette.js'

/**
 * Day 031 — the shader half of the pipeline.
 *
 *   makeLightDepthMaterial  pass 0, new today: the scene drawn from the light's
 *                           point of view, storing *linear* light-space depth.
 *                           This is our own shadow map, and its only customer is
 *                           the ray march — which is why it is linear and why
 *                           three's packed one could not be reused.
 *   makeGBufferMaterial     pass 1: MRT normal+depth and velocity+id, with a
 *                           previous matrix per object and per instance (Day 030).
 *   makeVolumetricMaterial  pass 3, the day's argument: single-scattering
 *                           ray-marched through the light-space depth map at
 *                           half resolution, dithered, and reprojected through
 *                           the *scattering centroid* rather than the surface.
 *   makeCompositeMaterial   pass 4: depth-aware (bilateral) upsample of the
 *                           half-res volume, then beauty·T + inscatter.
 *   makeTaaMaterial         pass 5: Halton jitter, YCoCg variance clipping.
 *   makePresentMaterial     pass 6: motion blur, grade, the only pass on canvas.
 */

// ---------------------------------------------------------------------------
// shared GLSL
// ---------------------------------------------------------------------------

const RECON = /* glsl */ `
  uniform float uFar;
  uniform float uTanHalf;
  uniform float uAspect;
  uniform vec2 uJitter;

  // View-space direction for a uv, with z = -1, so that multiplying by the
  // linear view depth gives the view-space position. The jitter has to come
  // back out: the buffers were drawn through a sub-pixel-offset projection, so
  // the feature that belongs at uv is sitting at uv + jitter.
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

// An 8×8 ordered dither. A ray march is an integral estimated from N samples;
// starting every pixel's march at the same offset turns the error into rings.
// Blue noise would be better still, but a Bayer matrix costs no texture and its
// error is *structured* — which is exactly what a temporal filter is best at
// removing, because the same pixel gets a different offset every frame.
const BAYER = /* glsl */ `
  float bayer2(vec2 a) {
    a = floor(a);
    return fract(a.x * 0.5 + a.y * a.y * 0.75);
  }
  // the usual recursion: each octave contributes a quarter of the last one's
  // weight, so the 8x8 result lands in [0, 1)
  float bayer8(vec2 a) {
    return bayer2(0.25 * a) * 0.0625 + bayer2(0.5 * a) * 0.25 + bayer2(a);
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

// ---------------------------------------------------------------------------
// pass 0 — light-space depth. Our own shadow map.
// ---------------------------------------------------------------------------

/**
 * three already renders a shadow map for this light. We render a second one,
 * and the reason is not stubbornness.
 *
 * A shadow map exists to answer one question, asked once per *surface* pixel,
 * inside a lit material. The ray march asks the same question fifty-six times
 * per pixel about points that are not on any surface at all, from a shader that
 * is not a lit material and has no access to three's shadow uniforms. And three
 * packs its depth for a comparison in projected space; a march wants a plain
 * linear distance it can compare with a number it computed itself.
 *
 * So: one orthographic camera down the light direction, and one float. Clearing
 * to white means "nothing in the way as far as the eye can see", which is what
 * every texel outside a silhouette should say.
 */
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

/**
 *   location 0 : rgb = view-space normal, a = linear view depth / far
 *   location 1 : rg  = screen-space velocity (uv), b = material id, a = 1
 *
 * Unchanged in shape from Day 030: each object hands in its own previous world
 * matrix and each instance its own previous instance matrix, and both ends of
 * the velocity are measured with *unjittered* matrices so that the TAA does not
 * end up chasing its own sub-pixel offset.
 */
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
// pass 3 — volumetric single scattering, half resolution
// ---------------------------------------------------------------------------

/**
 * Everything this project has drawn for thirty days happened *on a surface*.
 * This pass is the first one about what is between them.
 *
 * March the view ray from the eye to whatever the G-buffer says it hits, and at
 * every step ask two questions: how much medium is here (density), and can the
 * light see this point (the light-space depth map). Accumulate
 *
 *     L += T · σ · vis · p(θ) · dt ,   T *= exp(-σ·dt)
 *
 * — in-scattering attenuated by everything already passed through — and hand
 * back both the light gathered and the transmittance left over.
 *
 * Three things make it affordable and three things make it not look like noise:
 *
 *   half resolution      a quarter of the pixels. The medium has no silhouette,
 *                        so it is the one signal in the frame that can be
 *                        undersampled without anyone noticing — as long as the
 *                        upsample knows about depth (see the composite).
 *   ordered dithering    each pixel starts its march at a different offset, so
 *                        56 samples per pixel behave like several hundred once
 *                        the neighbourhood and the history are counted.
 *   sampler3D noise      one texture fetch instead of eight hashes and seven
 *                        mixes, and the trilinear filter *is* the value noise.
 *
 * And the reprojection, which is the part Day 030 left as homework.
 *
 * The velocity buffer describes surfaces. The haze in front of a surface is not
 * that surface, and reprojecting it by that surface's motion vector is simply
 * the wrong answer — it is the same mistake the reflection pass made on Day 029
 * and papered over on Day 030 by letting its history go. Today it is solved
 * properly, and the fog makes it easy to solve: the medium is static in world
 * space, so *any* world point can be reprojected exactly by the previous
 * view-projection matrix. The only question is which point.
 *
 * The answer is the scattering centroid: accumulate Σ w·t / Σ w with the
 * in-scatter contribution as the weight, and you have the depth this pixel's
 * glow actually came from. Reproject that. A pixel looking through a beam
 * reprojects at the beam's distance; a pixel looking at a lit wall through clear
 * air reprojects at the wall.
 */
export function makeVolumetricMaterial() {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {
      uGbuf: { value: null },
      uLightDepth: { value: null },
      uNoise: { value: null },
      uHist: { value: null },
      uHistAux: { value: null },

      uCamWorld: { value: new THREE.Matrix4() },
      uView: { value: new THREE.Matrix4() },
      uPrevViewProj: { value: new THREE.Matrix4() },
      uPrevView: { value: new THREE.Matrix4() },
      uLightVP: { value: new THREE.Matrix4() },
      uLightView: { value: new THREE.Matrix4() },

      uFar: { value: 80 },
      uTanHalf: { value: 0.3 },
      uAspect: { value: 1.6 },
      uJitter: { value: new THREE.Vector2() },

      uLightFar: { value: LIGHT.far },
      uLightBias: { value: LIGHT.bias },
      uLightDir: { value: new THREE.Vector3(...LIGHT.dir).normalize() },
      uLightCol: { value: new THREE.Color(...LIGHT.color) },

      uDensity: { value: FOG.density },
      uFogH: { value: FOG.height },
      uFogY0: { value: FOG.y0 },
      uFogCenter: { value: new THREE.Vector2(...FOG.center) },
      uFogR: { value: new THREE.Vector2(...FOG.radius) },
      uG: { value: FOG.g },
      uScatter: { value: FOG.scatter },
      uMaxDist: { value: FOG.maxDist },

      uTime: { value: 0 },
      uFrame: { value: 0 },
      uValid: { value: 0 },
      uFeedback: { value: 0.92 },
    },
    depthTest: false,
    depthWrite: false,
    vertexShader: FS_VERT,
    fragmentShader: /* glsl */ `
      precision highp float;
      precision highp sampler3D;

      layout(location = 0) out vec4 outScatter; // rgb = in-scatter, a = transmittance
      layout(location = 1) out vec4 outAux;     // r   = scattering centroid depth

      varying vec2 vUv;

      uniform sampler2D uGbuf;
      uniform sampler2D uLightDepth;
      uniform sampler3D uNoise;
      uniform sampler2D uHist;
      uniform sampler2D uHistAux;

      uniform mat4 uCamWorld;
      uniform mat4 uView;
      uniform mat4 uPrevViewProj;
      uniform mat4 uPrevView;
      uniform mat4 uLightVP;
      uniform mat4 uLightView;

      uniform float uLightFar;
      uniform float uLightBias;
      uniform vec3 uLightDir;
      uniform vec3 uLightCol;

      uniform float uDensity;
      uniform float uFogH;
      uniform float uFogY0;
      uniform vec2 uFogCenter;
      uniform vec2 uFogR;
      uniform float uG;
      uniform float uScatter;
      uniform float uMaxDist;

      uniform float uTime;
      uniform float uFrame;
      uniform float uValid;
      uniform float uFeedback;

      ${RECON}
      ${BAYER}

      const int STEPS = 48;

      // Two octaves, two fetches. The slow drift is deliberately anisotropic:
      // haze in a still hall rises and wanders, it does not translate.
      float fogNoise(vec3 p) {
        float n1 = texture(uNoise, p * 0.055 + vec3(0.0, uTime * 0.0045, uTime * 0.011)).r;
        float n2 = texture(uNoise, p * 0.175 + vec3(uTime * 0.014, 0.0, uTime * -0.006)).r;
        return n1 * 0.68 + n2 * 0.32;
      }

      float density(vec3 p) {
        float h = exp(-max(p.y - uFogY0, 0.0) / uFogH);
        float r = length(p.xz - uFogCenter);
        // The haze has to end somewhere, and it must not end where the
        // light-space depth map does — otherwise the edge of our own shadow map
        // appears in the air as a perfectly straight line of "everything here is
        // lit". Fade the medium out well inside it.
        float edge = 1.0 - smoothstep(uFogR.x, uFogR.y, r);
        float base = uDensity * h * edge;
        // The two noise fetches are the expensive part of the inner loop, so the
        // cheap analytic factors get to veto them: a ray heading for the roof
        // spends most of its steps in air that is not there.
        if (base < 1e-5) return 0.0;
        return base * (0.42 + 1.16 * fogNoise(p));
      }

      // Henyey-Greenstein, without its 1/4π: that constant, the light's radiance
      // and the medium's albedo all collapse into uScatter, and one number that
      // can be dialled beats three that cannot.
      float phaseHG(float c, float g) {
        float g2 = g * g;
        return (1.0 - g2) / pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5);
      }

      // The comparison happens in world units, not in the [0,1] the map is
      // stored in: a bias expressed as a fraction of a 52-unit range is a bias
      // nobody can reason about, and 7cm is 7cm.
      float lightVis(vec3 p) {
        vec4 lp = uLightVP * vec4(p, 1.0);
        vec2 luv = lp.xy / lp.w * 0.5 + 0.5;
        if (luv.x < 0.0 || luv.x > 1.0 || luv.y < 0.0 || luv.y > 1.0) return 1.0;
        float d = -(uLightView * vec4(p, 1.0)).z;
        float m = texture(uLightDepth, luv).r * uLightFar;
        return step(d - uLightBias, m);
      }

      void main() {
        vec4 g = texture(uGbuf, vUv);
        float dLin = g.a > 1e-5 ? g.a * uFar : uFar;

        vec3 rv = viewRay(vUv);
        float rayLen = length(rv);              // world units per unit of depth
        vec3 dirW = normalize(mat3(uCamWorld) * rv);
        vec3 O = uCamWorld[3].xyz;

        float tMax = min(dLin * rayLen, uMaxDist);
        float dt = tMax / float(STEPS);

        // ordered dither, rotated every frame by the golden ratio so that the
        // temporal filter sees a different offset each time
        float dith = fract(bayer8(gl_FragCoord.xy) + uFrame * 0.6180339887);

        float phase = phaseHG(dot(dirW, uLightDir), uG);

        float T = 1.0;
        float acc = 0.0;
        float wSum = 0.0;
        float tSum = 0.0;
        float t = dt * dith;

        for (int i = 0; i < STEPS; i++) {
          vec3 p = O + dirW * t;
          float sig = density(p);
          if (sig > 1e-5) {
            float w = T * sig * lightVis(p) * dt;
            acc += w;
            // the depth this pixel's glow actually came from
            wSum += w;
            tSum += w * t;
            T *= exp(-sig * dt);
          }
          t += dt;
        }

        vec3 inscat = uLightCol * (acc * phase * uScatter);
        float centroidT = wSum > 1e-7 ? tSum / wSum : min(tMax, 12.0);
        // centroid depth measured in THIS camera, so next frame can compare
        float centroidD = centroidT / rayLen;

        // ---- exact reprojection ------------------------------------------
        // The medium is static in world space, so a world point is all that is
        // needed: put the centroid through last frame's view-projection and read
        // the history there. No motion vector is involved, because no surface is.
        vec3 pC = O + dirW * centroidT;
        vec4 pc = uPrevViewProj * vec4(pC, 1.0);
        vec2 prevUV = pc.xy / pc.w * 0.5 + 0.5;
        float prevD = -(uPrevView * vec4(pC, 1.0)).z;

        vec4 hist = texture(uHist, prevUV);
        float histD = texture(uHistAux, prevUV).r;

        float valid = uValid;
        if (prevUV.x < 0.0 || prevUV.x > 1.0 || prevUV.y < 0.0 || prevUV.y > 1.0) valid = 0.0;
        if (pc.w <= 0.0) valid = 0.0;
        valid *= step(abs(histD - prevD), 0.10 * prevD + 0.25);

        // A blade of light sweeping past changes a pixel's radiance without
        // changing its geometry, so depth rejection cannot see it. Reject on
        // disagreement instead: converge where the hall is quiet, snap where the
        // beam has moved on.
        float lc = dot(inscat, vec3(0.333));
        float lh = dot(hist.rgb, vec3(0.333));
        float diff = abs(lc - lh) / (lc + lh + 1e-3);
        float fb = uFeedback * valid * (1.0 - smoothstep(0.22, 0.80, diff));

        vec3 outCol = mix(inscat, hist.rgb, fb);
        float outT = mix(T, hist.a, fb);

        outScatter = vec4(max(outCol, vec3(0.0)), clamp(outT, 0.0, 1.0));
        // .g is not for us — it is for the upsample. Re-deriving "the depth this
        // half-res texel marched against" in the composite means sampling the
        // full-res G-buffer at a uv that lands exactly on a texel *boundary*,
        // where nearest filtering can round either way. Writing it down here
        // makes the bilateral weight exact instead of nearly always right.
        outAux = vec4(centroidD, dLin, 0.0, 1.0);
      }
    `,
  })
}

// ---------------------------------------------------------------------------
// pass 4 — composite: depth-aware upsample, then apply the medium
// ---------------------------------------------------------------------------

/**
 * Half a resolution has to be paid back somewhere, and this is where.
 *
 * A plain bilinear upsample of the volume would be fine everywhere except the
 * one place anybody looks: a silhouette. Four half-res texels straddling the lip
 * of the vessel hold two completely different answers — twelve metres of lit
 * haze on one side, thirty centimetres of porcelain on the other — and averaging
 * them draws a bright halo around every edge in the frame.
 *
 * So weight each of the four taps by how well its depth agrees with this pixel's
 * depth, on top of the usual bilinear weight. Each tap's depth is read from the
 * volumetric pass's own second attachment rather than re-derived from the
 * G-buffer: a half-res texel centre lands exactly on a *boundary* between two
 * full-res texels, and nearest filtering there is a coin toss. Writing the value
 * down in the pass that used it makes the weight exact.
 */
export function makeCompositeMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uBeauty: { value: null },
      uGbuf: { value: null },
      uVol: { value: null },
      uVolAux: { value: null },
      uHalfRes: { value: new THREE.Vector2(800, 500) },
      uFar: { value: 80 },
      uTanHalf: { value: 0.3 },
      uAspect: { value: 1.6 },
      uJitter: { value: new THREE.Vector2() },
      uDepthSigma: { value: 2.4 },
    },
    depthTest: false,
    depthWrite: false,
    vertexShader: FS_VERT,
    fragmentShader: /* glsl */ `
      precision highp float;

      varying vec2 vUv;

      uniform sampler2D uBeauty;
      uniform sampler2D uGbuf;
      uniform sampler2D uVol;
      uniform sampler2D uVolAux;
      uniform vec2 uHalfRes;
      uniform float uDepthSigma;

      ${RECON}

      void main() {
        vec3 beauty = texture2D(uBeauty, vUv).rgb;
        float ga = texture2D(uGbuf, vUv).a;
        float dF = ga > 1e-5 ? ga * uFar : uFar;

        // the four half-res texels around this pixel
        vec2 c = vUv * uHalfRes - 0.5;
        vec2 base = floor(c);
        vec2 f = c - base;

        vec4 sum = vec4(0.0);
        float wsum = 0.0;
        for (int j = 0; j < 2; j++) {
          for (int i = 0; i < 2; i++) {
            vec2 huv = (base + vec2(float(i), float(j)) + 0.5) / uHalfRes;
            float bw = (i == 0 ? 1.0 - f.x : f.x) * (j == 0 ? 1.0 - f.y : f.y);
            float dH = texture2D(uVolAux, huv).g;
            float w = bw * exp(-abs(dH - dF) * uDepthSigma) + 1e-4;
            sum += texture2D(uVol, huv) * w;
            wsum += w;
          }
        }
        vec4 vol = sum / wsum;

        // the medium, applied: what is behind it, dimmed by what it absorbed,
        // plus what it scattered toward the eye
        vec3 col = beauty * clamp(vol.a, 0.0, 1.0) + max(vol.rgb, vec3(0.0));

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  })
}

// ---------------------------------------------------------------------------
// pass 5 — TAA resolve
// ---------------------------------------------------------------------------

/**
 * Unchanged from Day 030, and that is the point: it has become the platform.
 * Halton(2,3) sub-pixel jitter, reprojection through the velocity buffer, depth
 * rejection, and YCoCg variance clipping along the segment from the neighbourhood
 * mean toward the history.
 *
 * It earns its keep twice today. The obvious job is anti-aliasing twenty-six fin
 * silhouettes and 220 sub-pixel dust motes with one sample per pixel. The less
 * obvious one: the volumetric pass has its own history, but a *second* filter on
 * top of it is what finally kills the residual dither pattern in the beams.
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
// pass 6 — present: motion blur, then the grade. The only pass on the canvas.
// ---------------------------------------------------------------------------

export function makePresentMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: null }, // TAA output
      uRaw: { value: null }, // composite output, pre-TAA
      uBeauty: { value: null },
      uGbuf: { value: null },
      uMotion: { value: null },
      uVol: { value: null },
      uLightDepth: { value: null },
      uRes: { value: new THREE.Vector2(1600, 1000) },
      uVelScale: { value: 1.5 },
      uMaxBlur: { value: 55.0 },
      uTime: { value: 0 },
      uFrame: { value: 0 },
      uMode: { value: 0 },
      uReveal: { value: 0 },
      uExposure: { value: 1.42 },
    },
    depthTest: false,
    depthWrite: false,
    vertexShader: FS_VERT,
    fragmentShader: /* glsl */ `
      precision highp float;

      varying vec2 vUv;

      uniform sampler2D uColor;
      uniform sampler2D uRaw;
      uniform sampler2D uBeauty;
      uniform sampler2D uGbuf;
      uniform sampler2D uMotion;
      uniform sampler2D uVol;
      uniform sampler2D uLightDepth;
      uniform vec2 uRes;
      uniform float uVelScale;
      uniform float uMaxBlur;
      uniform float uTime;
      uniform float uFrame;
      uniform float uMode;
      uniform float uReveal;
      uniform float uExposure;

      ${HASH}

      vec2 velPx(vec2 uv) {
        return texture2D(uMotion, uv).rg * uVelScale * uRes;
      }

      // Day 030's gather, kept: a still pixel beside a fast edge has to be
      // allowed to receive a smear it is not making, and every tap is weighted by
      // whether the surface there actually sweeps far enough to reach here.
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
        vec3 col;

        if (uMode < 0.5) {
          col = motionBlur(uColor, vUv);                    // 1 · composite
        } else if (uMode < 1.5) {
          col = texture2D(uBeauty, vUv).rgb;                // 2 · beauty, no fog
        } else if (uMode < 2.5) {
          col = pow(texture2D(uGbuf, vUv).rgb * 0.5 + 0.5, vec3(2.2));
        } else if (uMode < 3.5) {                           // 4 · velocity
          vec2 v = texture2D(uMotion, vUv).rg * 150.0;
          col = pow(clamp(vec3(0.5 + v.x, 0.5 + v.y, 0.5), 0.0, 1.0), vec3(2.2));
        } else if (uMode < 4.5) {                           // 5 · in-scatter only
          col = texture2D(uVol, vUv).rgb;
        } else if (uMode < 5.5) {                           // 6 · transmittance
          col = pow(vec3(texture2D(uVol, vUv).a), vec3(2.2));
        } else if (uMode < 6.5) {                           // 7 · light-space depth
          float d = texture2D(uLightDepth, vUv).r;
          col = pow(vec3(1.0 - d), vec3(2.2));
        } else {
          col = motionBlur(uRaw, vUv);                      // 8 · TAA off
        }

        // ---- grade ---------------------------------------------------------
        col *= uExposure;
        col = aces(col);

        float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
        vec3 shadow = vec3(0.005, 0.008, 0.016);
        vec3 high = vec3(0.026, 0.013, -0.014);
        col += shadow * (1.0 - smoothstep(0.0, 0.55, l));
        col += high * smoothstep(0.35, 1.0, l);
        col = clamp(col, 0.0, 1.0);

        // ---- opening: an aperture, opening ---------------------------------
        // Day 030 wiped in from the left. Today the piece is named after a hole
        // that opens, so the reveal is a horizontal slot that widens from the
        // centre line — the same shape as the thing the light comes through.
        float band = smoothstep(0.0, 1.0, uReveal);
        float hh = band * 0.80;
        float open = 1.0 - smoothstep(hh - 0.10, hh, abs(vUv.y - 0.5));
        col = mix(vec3(0.021, 0.024, 0.031), col, clamp(open, 0.0, 1.0));

        // ---- grain + vignette ---------------------------------------------
        float g = hash12(gl_FragCoord.xy + vec2(floor(uTime * 24.0)));
        col += (g - 0.5) * 0.016;

        vec2 q = vUv - 0.5;
        col *= 1.0 - dot(q, q) * 0.34;

        gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
      }
    `,
  })
}
