import * as THREE from 'three'
import { LIGHT, MOTES, BOUNCE, VIS, SURF, SKY_GLSL, skyUniforms } from './palette.js'
import { VOLUME_GLSL, PHASE_GLSL, froxelReadUniforms, tetraArrayGLSL } from './froxel.js'
import { SHADOW_GLSL, IGN_GLSL, shadowUniforms } from './shadow.js'
import { AREA_GLSL } from './area.js'
import { LTC_GLSL, ltcUniforms, MAX_PANES, MAX_TAPS } from './ltc.js'

/**
 * Day 037 — the rest of the pipeline, the same seven stages as yesterday.
 *
 *   makeLightDepthMaterial  pass 0: the scene from the light, as *linear*
 *                           distance. Day 031's, unchanged, and since yesterday
 *                           the only shadow map in the renderer.
 *   makeGBufferMaterial     pass 1: MRT, three attachments — normal + depth,
 *                           velocity + id, albedo + roughness.
 *   makeCompositeMaterial   pass 2, the whole of the lighting: the direct term,
 *                           the wash out of the volume, the volume along the eye
 *                           ray, and the radiosity attachment the froxel
 *                           injection reads next frame.
 *   makeMoteMaterial        pass 3: 4,500 billboards, one soft-shadow tap each.
 *   makeTaaMaterial         pass 5: Halton jitter, YCoCg variance clipping.
 *   makePresentMaterial     pass 6: motion blur, the mote layer, the grade.
 *
 * No stage arrives and none leaves. Day 039's change is again inside `direct()`,
 * and it is a deletion as much as an addition: the shadow term stops being a
 * factor *outside* the integral and becomes a weight *inside* it, one per pane.
 * The line that used to read
 *
 *     return uLightCol * (uSrcRad * vis) * (albedo * ffD + ffS);
 *
 * has lost its `vis`, because the visibility is now in the two form factors —
 * and a term that appears in both places would shadow the room twice.
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
// pass 1 — G-buffer (GLSL3, three colour attachments)
// ---------------------------------------------------------------------------

/**
 * Unchanged since yesterday, and worth one note about the roughness channel it
 * acquired then. It rode in the alpha of the albedo attachment as a convenience
 * — the composite needed to tell limewash from unpolished stone. Today it is
 * load-bearing: the anisotropic lobe's aspect ratio is `(a + theta_a/2) /
 * (a + theta_b/2)`, so how much of the source's shape a surface shows is set
 * entirely by how smooth it is. The frame has one glazed object in it for
 * exactly that reason, and this is the channel that tells the shader so.
 */
export function makeGBufferMaterial({ far, matId = 0, instanced = false, emissive = false }) {
  const defines = {}
  if (instanced) defines.PREV_INSTANCE = ''
  if (emissive) defines.EMISSIVE = ''

  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    defines,
    uniforms: {
      uFar: { value: far },
      uMatId: { value: matId },
      // Read off the object's real material when the mesh is first registered.
      // Not a texture and not a fit — this scene's surfaces are single colours,
      // so the G-buffer's albedo channel is exact rather than approximate.
      uAlbedo: { value: new THREE.Color(0, 0, 0) },
      uRough: { value: 0.85 },
      uPrevModel: { value: new THREE.Matrix4() },
      uPrevViewProj: { value: new THREE.Matrix4() },
      uCurViewProj: { value: new THREE.Matrix4() },
      ...(emissive ? skyUniforms(THREE) : {}),
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
      varying vec3 vWorld;

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
        vWorld = world.xyz;

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
      layout(location = 2) out vec4 outAlbedo;

      uniform float uFar;
      uniform float uMatId;
      uniform vec3 uAlbedo;
      uniform float uRough;

      varying vec3 vN;
      varying float vDepth;
      varying vec4 vCur;
      varying vec4 vPrev;
      varying vec3 vWorld;

      #ifdef EMISSIVE
        ${SKY_GLSL}
      #endif

      void main() {
        vec3 n = normalize(vN);
        if (!gl_FrontFacing) n = -n;

        vec2 vel = vec2(0.0);
        if (vPrev.w > 1e-4 && vCur.w > 1e-4) {
          vec2 cur = vCur.xy / vCur.w;
          vec2 prv = vPrev.xy / vPrev.w;
          vel = (cur - prv) * 0.5; // NDC delta -> uv delta
        }

        vec3 alb = uAlbedo;
        #ifdef EMISSIVE
          alb = skyAt(vWorld.xy);
        #endif

        outNormalDepth = vec4(n, clamp(vDepth / uFar, 0.00002, 1.0));
        outMotion = vec4(vel, uMatId, 1.0);
        outAlbedo = vec4(alb, uRough);
      }
    `,
  })
}

// ---------------------------------------------------------------------------
// pass 2 — composite: all of the lighting, in one shader
// ---------------------------------------------------------------------------

/**
 * Every term in the frame, in one shader.
 *
 *   DIRECT.  The day's work. Yesterday this was `max(ndl, 0)` and an isotropic
 *            GGX lobe around `uLightDir`, multiplied by a soft visibility — a
 *            source with a size for the purposes of the shadow test and a source
 *            with no size at all for the purposes of everything else. Today the
 *            cosine is `areaNdL` and the lobe is `areaSpec`, both out of
 *            `area.js`, both reading the same `uLightAng` and `uSrcAxis` the
 *            shadow test reads.
 *
 *   WASH.    Day 034's hemisphere gather out of the froxel grid, with Day 035's
 *            screen-space visibility march on every tap.
 *
 *   VOLUME.  The integrated in-scatter and transmittance along this pixel's ray.
 *
 *   RADIOSITY. Attachment 1: `direct + wash`, which is what the surface sends
 *            back into the room, and what the froxel injection reads next frame.
 *            Deliberately *not* the pixel that goes to the screen — that one has
 *            the air's own in-scatter added, and handing it back would let the
 *            medium count itself twice.
 *
 * Note what the return path inherits for free. The soft terminator makes the
 * apron's far edge fall off over a band instead of a crease; that apron is the
 * brightest surface in the room and its radiosity is read by 2.36 million
 * froxels next frame. A change to the cosine on one surface reaches the air
 * above a completely different one, one frame later, without a line being
 * written for it.
 */
export function makeCompositeMaterial() {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    // SH_MASK compiles the per-pane form of the shadow test. Only this shader
    // asks for it: the froxels and the motes want one number and would pay for
    // an array they immediately average.
    defines: { SH_SEARCH: 8, SH_PCF: 48, SH_MASK: 1, LTC_PANES: MAX_PANES, LTC_TAPS: MAX_TAPS },
    uniforms: {
      ...froxelReadUniforms(),
      ...shadowUniforms(),
      ...ltcUniforms(),
      uGbuf: { value: null },
      uMot: { value: null }, // attachment 1 — for the material id
      uAlb: { value: null }, // attachment 2 — albedo.rgb, roughness.a
      uMed: { value: null }, // the rate volume, before the scan
      uFar: { value: 80 },
      uTanHalf: { value: 0.3 },
      uAspect: { value: 1.6 },
      uJitter: { value: new THREE.Vector2() },

      uCamWorld: { value: new THREE.Matrix4() },
      uViewProj: { value: new THREE.Matrix4() }, // unjittered — for the volume
      uVPJ: { value: new THREE.Matrix4() }, // jittered — for the G-buffer
      uView: { value: new THREE.Matrix4() },
      uBasis: { value: new THREE.Matrix3() },

      uLightDir: { value: new THREE.Vector3(...LIGHT.dir).normalize() },
      uLightCol: { value: new THREE.Color(...LIGHT.color) },
      uLightInt: { value: LIGHT.intensity },
      uNormalBias: { value: LIGHT.normalBias },
      uSpec: { value: SURF.spec },
      uF0: { value: SURF.f0 },

      uBounce: { value: BOUNCE.gain },
      uBRadius: { value: BOUNCE.radius },
      uBBias: { value: BOUNCE.bias },
      uBSpread: { value: BOUNCE.spread },
      uBFloor: { value: BOUNCE.sigmaFloor },
      uBClamp: { value: BOUNCE.clamp },
      uBJitter: { value: BOUNCE.jitter },

      uVis: { value: 1 },
      uVisBias: { value: VIS.bias },
      uVisThick: { value: VIS.thick },

      uSeed: { value: 0 },
      uShow: { value: 0 }, // 1 = the wash alone, 2 = the direct term alone
      uShowLod: { value: 0 }, // 1 = the level pair the fetch chose, as colour
      uShowTap: { value: 0 }, // 1 = the tap count and the axis's obliquity
      uShowSupp: { value: 0 }, // 1 = how much of the fetch the window itself is
      uShowGain: { value: 0 }, // 1 = how far the measured area moved the ellipse
      uShowCov: { value: 0 }, // 1 = how much of the fetch's footprint was glass
      uShowVis: { value: 0 }, // 1 = how much of that glass the point can see
    },
    depthTest: false,
    depthWrite: false,
    vertexShader: FS_VERT,
    fragmentShader: /* glsl */ `
      precision highp float;
      #define TEX2D texture
      // GLSL ES 3.00: an explicit level. As of Day 042 the glass is an atlas
      // with no mip chain, so every read of it is level 0 and the level pair is
      // an address instead — but the macro stays, because the LTC LUTs and the
      // froxel atlas still want a level nobody's derivatives are allowed to pick.
      #define TEXLOD(s, uv, l) textureLod(s, uv, l)

      layout(location = 0) out vec4 outColor;
      layout(location = 1) out vec4 outRadiosity;

      varying vec2 vUv;

      uniform sampler2D uGbuf;
      uniform sampler2D uMot;
      uniform sampler2D uAlb;
      uniform sampler2D uVol;
      uniform sampler2D uMed;

      uniform mat4 uCamWorld;
      uniform mat4 uViewProj;
      uniform mat4 uVPJ;
      uniform mat4 uView;
      uniform mat3 uBasis;

      uniform vec3 uLightDir;
      uniform vec3 uLightCol;
      uniform float uLightInt;
      uniform float uNormalBias;
      uniform float uSpec;
      uniform float uF0;

      uniform float uBounce;
      uniform float uBRadius;
      uniform float uBBias;
      uniform float uBSpread;
      uniform float uBFloor;
      uniform float uBClamp;
      uniform float uBJitter;

      uniform float uVis;
      uniform float uVisBias;
      uniform float uVisThick;

      uniform float uSeed;
      uniform float uShow;
      uniform float uShowLod;
      uniform float uShowTap;
      uniform float uShowSupp;
      uniform float uShowGain;
      uniform float uShowCov;
      uniform float uShowVis;

      const float PI = 3.14159265359;

      ${RECON}
      ${HASH}
      ${IGN_GLSL}
      ${VOLUME_GLSL}
      ${SHADOW_GLSL}
      ${AREA_GLSL}
      ${LTC_GLSL}
      ${tetraArrayGLSL()}

      /**
       * The direct term, from a source that is a piece of geometry.
       *
       * The early-out is unchanged in form and worth restating: "dot(n, L) <= 0"
       * means "turned away, black, stop" only for a point source. For an opening
       * twenty-one degrees tall a face tipped a few degrees past the geometric
       * horizon still sees the head of the window, so the reject sits out at
       * -sin(bound) and the band between there and zero is the terminator. In a
       * frame with no ambient term anywhere in it, that band is the difference
       * between a crease and a roll.
       *
       * What is new is that neither term below is a fit any more. Both are the
       * same integral over the same six rectangles — one against a cosine lobe,
       * one against a linearly transformed one — so the terminator and the
       * highlight cannot disagree about the source, ever, because there is one
       * description of it and they read different rows of the answer.
       *
       * They are still multiplied by a scalar visibility, and that is today's
       * honest remaining approximation: vis is the fraction of the window this
       * point can see, while the integral assumes it can see all of it. Where a
       * blocker covers one light of the window and not the other, the true answer
       * is the integral over the visible panes only. That is the shadowed-area-
       * light problem, and it was on yesterday's list too.
       *
       * uLtc at 0 restores Day 037's shading exactly — same window, same shadows,
       * approximate lobe — which is what ?pass=8 renders.
       */
      vec3 direct(vec3 p, vec3 n, vec3 albedo, float rough, vec2 sofs) {
        float horizon = -sin(max(uSrcBound.x, uSrcBound.y));
        float ndl = dot(n, uLightDir);
        if (ndl <= horizon) return vec3(0.0);

        // Visibility, per pane. vis is still the scalar — the area-weighted
        // mean of the mask — and it is still what the early-out and Day 037's
        // fallback use, because they are not able to ask a better question.
        float visP[LTC_PANES];
        // Day 047: the same taps, read a second way. visP is how much of each
        // pane gets through — the mass, spent inside the LTC sum since Day 039 —
        // and vfit is a plane through the same hits, in the picture's own uv,
        // which is what the fetch weights itself by. Six numbers for the shape,
        // three for the *where*, one set of shadow-map reads for both.
        vec3 vfit;
        float vis = softVisMask(p + n * uNormalBias, sofs, shSlope(n), visP, vfit);
        if (vis <= 0.0) return vec3(0.0);

        // The comparison render, and it is worth being precise about what it
        // compares. This is not "the mask off"; there is no path with the mask
        // off. It is the *same* weighted integral, handed a visibility function
        // that has been flattened to its own average — which is exactly the
        // assumption every day up to yesterday made without writing it down.
        if (uMask < 0.5) {
          for (int i = 0; i < LTC_PANES; i++) visP[i] = vis;
          // And the plane goes flat with them. ?pass=13 is "the visibility, told
          // to forget where it varies", and from today that sentence has two
          // halves: the mask stops distinguishing panes and the fetch stops
          // knowing which end of the window it can see.
          vfit = vec3(vis, 0.0, 0.0);
        }

        vec3 V = normalize(uCamWorld[3].xyz - p);

        if (uLtc > 0.5) {
          // Radiance, not irradiance: the form factor already carries the
          // opening's solid angle, so what multiplies it is how bright the window
          // *is*. uSrcRad is LIGHT.intensity / omega, recomputed for each
          // comparison mode so that a source with more area is correspondingly
          // dimmer and every render in the set delivers the same light.
          // No vis out here any more. The visibility went *inside* the
          // integral this morning, where it belongs, and multiplying by it again
          // would shadow the room twice.
          // Both terms are vec3 as of today, and they are not the same vec3.
          // The window has six colours in it; the cosine lobe averages all of
          // them and the GGX lobe averages the two or three it can reach, so the
          // glaze and the plaster beside it are lit by measurably different
          // light from one lamp. uLightCol is still the *room's* white — the
          // tints are normalised to a mean of one, so it has not moved.
          vec3 ffD = ltcDiffuse(p, n, V, visP, vfit);
          vec3 ffS = ltcSpecular(p, n, V, rough, uF0, visP, vfit) * uSpec;
          return uLightCol * uSrcRad * (albedo * ffD + ffS);
        }

        // --- Day 037, kept so the claim can be removed ---------------------
        float ndlA = areaNdL(n, uLightDir);
        vec3 spec = areaSpec(n, V, uLightDir, rough, uF0) * uSpec;
        return uLightCol * (uLightInt * vis) * (albedo * (ndlA / PI) + spec);
      }

      /**
       * How much of the segment a -> b is clear (Day 035, unchanged).
       */
      float segmentVis(vec3 a, vec3 b, float jit) {
        if (uVis < 0.5) return 1.0;
        float occ = 0.0;
        for (int i = 0; i < 5; i++) {
          float f = (float(i) + 0.35 + jit * 0.5) / 5.0;
          vec3 s = mix(a, b, f);

          vec4 c = uVPJ * vec4(s, 1.0);
          if (c.w <= 1e-4) continue;
          vec2 uv = c.xy / c.w * 0.5 + 0.5;
          if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) continue;

          float ga = texture(uGbuf, uv).a;
          if (ga <= 1e-5) continue;      // background: nothing in the way
          float sd = ga * uFar;
          float behind = -(uView * vec4(s, 1.0)).z - sd;

          float bias = uVisBias * (1.0 + sd * 0.05);
          float hit = smoothstep(bias, bias * 3.0, behind)
                    * (1.0 - smoothstep(uVisThick * 0.65, uVisThick, behind));
          occ = max(occ, hit);
        }
        return 1.0 - occ;
      }

      void tap(vec3 p, vec3 n, vec3 t, float jit, inout vec3 E, inout float w) {
        vec3 d = normalize(n + (uBasis * t) * uBSpread);
        float c = dot(d, n);
        if (c <= 0.0) return;

        vec3 o = p + n * uBBias;
        vec3 q = o + d * (uBRadius * jit);

        vec4 clip = uViewProj * vec4(q, 1.0);
        if (clip.w <= 1e-4) return;
        vec2 uv = clip.xy / clip.w * 0.5 + 0.5;
        if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return;

        float qd = -(uView * vec4(q, 1.0)).z;
        if (qd <= uVolNear || qd >= uVolFar) return;

        // Blocked taps stay in the average — they contribute nothing to E but
        // they still count toward w, and that difference is the entire visible
        // effect of the visibility term.
        float vis = segmentVis(o, q, jit);

        vec4 cell = sampleMedium(uMed, uv, qd);
        E += min(cell.rgb / max(cell.a, uBFloor), vec3(uBClamp)) * (c * vis);
        w += c;
      }

      vec3 airIrradiance(vec3 p, vec3 n) {
        vec3 E = vec3(0.0);
        float w = 0.0;
        float jit = 1.0 + uBJitter * (hash12(gl_FragCoord.xy + vec2(uSeed, uSeed * 1.61)) - 0.5);
        for (int i = 0; i < 4; i++) tap(p, n, TETRA[i], jit, E, w);
        return w > 0.0 ? E / w : vec3(0.0);
      }

      void main() {
        vec4 g = texture(uGbuf, vUv);
        vec4 alb = texture(uAlb, vUv);
        float matId = texture(uMot, vUv).b;
        float d = g.a > 1e-5 ? g.a * uFar : uFar;

        vec3 surface = vec3(0.0);   // everything leaving the surface
        vec3 lit = vec3(0.0);       // the direct term alone, for ?pass=2
        vec3 wash = vec3(0.0);

        if (g.a > 1e-5) {
          if (matId > 0.5) {
            // The painted distance. Not lit, not washed, and it returns nothing
            // to the air — it is a gradient twenty metres behind the room, not a
            // surface in it.
            surface = alb.rgb;
          } else {
            vec3 p = (uCamWorld * vec4(viewRay(vUv) * d, 1.0)).xyz;
            // The G-buffer normal is in *view* space (three builds normalMatrix
            // against the modelView matrix) and everything here is world space.
            // Forgetting this rotation produces a beautifully lit frame whose
            // light source turns with the camera.
            mat3 camRot = mat3(uCamWorld[0].xyz, uCamWorld[1].xyz, uCamWorld[2].xyz);
            vec3 n = normalize(camRot * g.rgb);

            // The per-pixel decorrelation, and it had to grow a dimension this
            // morning.
            //
            // Day 038 replaced the rotated spiral with a toroidal shift, which
            // was right, and then derived both components of that shift from one
            // scalar: off = fract(vec2(rot * a, rot * b)). Two linear functions
            // of one number do not fill a square — they trace a handful of
            // parallel lines across it — so neighbouring pixels were being
            // handed sample sets displaced along a single direction. That is
            // invisible while the answer is one number (the errors still cancel
            // in the mean) and it is *not* invisible once the answer is a mask:
            // every pane's estimate moves the same way at once, and the tablet's
            // eclipse edge grows the faint stripes I spent twenty minutes
            // blaming on the pane quantisation.
            //
            // So: two independent hashes for the pixel, advanced per frame by
            // the R2 sequence's pair of irrationals rather than by one of them.
            vec2 sofs = fract(
              vec2(ign(gl_FragCoord.xy), hash12(gl_FragCoord.xy + 17.31))
              + fract(uSeed * vec2(0.7548776662, 0.5698402910))
            );

            lit = direct(p, n, alb.rgb, alb.a, sofs);
            if (uBounce > 0.0) wash = alb.rgb * airIrradiance(p, n) * uBounce;
            surface = lit + wash;
          }
        }

        // What this surface hands back to the room, before any of the mist
        // between here and the eye takes its share.
        outRadiosity = vec4(max(surface, vec3(0.0)), 1.0);

        // The footprint itself, drawn (?pass=15). gLod holds whatever the *last*
        // fetch chose, and the last fetch inside direct() is the specular one —
        // which is the lobe worth looking at, because the cosine lobe is round
        // and nearly always reads the top of the pyramid. Red is the level along
        // the window's width, blue the level up it, green their mean, so an
        // isotropic footprint comes out grey and every departure from grey is a
        // pixel where today differs from yesterday. The grade downstream is
        // monotone per channel, so it moves the ramp and not its order — this is
        // a read-out of which way the ellipse points, not of how many levels.
        if (uShowLod > 0.5) {
          outColor = vec4(vec3(gLod.x, 0.5 * (gLod.x + gLod.y), gLod.y) / max(uGlassMax, 1.0), 1.0);
          return;
        }

        // Day 043's read-out (?pass=16), and it is a map of where the day is,
        // not of how bright anything is:
        //
        //   red    the tap count, 1 at black through LTC_TAPS at full — how
        //          elongated the specular lobe's footprint is, quantised the way
        //          the fetch quantises it.
        //   green  the anisotropy that count came from, log2 over three stops,
        //          so the ramp is continuous where the red channel steps. A
        //          green-without-red pixel is a footprint just under the rounding
        //          threshold, and is the honest place to argue about the rule.
        //   blue   how far the major axis lies from a texture axis: 0 along the
        //          leads or up them, 1 at 45 degrees. **This is the only channel
        //          that says anything yesterday could not have said.** Blue marks
        //          the pixels where a ripmap alone had to bound a diagonal
        //          ellipse with a box up to sqrt(2) too big on both sides, and
        //          they are where the measured 6.87% became 5.79%.
        //
        // So: black is a round lobe (nothing to do), red-cyan is elongated along
        // a texture axis (yesterday was already right), and white is elongated
        // and oblique (today's ground). The curved lacquer edges go white.
        if (uShowTap > 0.5) {
          float t = (gTap - 1.0) / max(float(LTC_TAPS) - 1.0, 1.0);
          outColor = vec4(t, clamp(log2(max(gAniso, 1.0)) / 3.0, 0.0, 1.0), gDiag, 1.0);
          return;
        }
        // Day 044's read-out (?pass=17), and it is the exact complement of
        // yesterday's. Red is the fraction the window's support took off the
        // major semi-axis, green the fraction off the minor:
        //
        //   black   the lobe fits inside the opening. The fetch is yesterday's,
        //           texel for texel, and today changed nothing here.
        //   yellow  both axes gone — the ellipse had grown past the picture and
        //           the fetch had silently become the flat mean of the whole
        //           window. This is where the 8.06% was.
        //   red     only the long axis clipped: a grazing surface whose lobe
        //           runs off the leads but still resolves across them.
        //
        // The near tablet is nearly black and the stone is nearly yellow, so the
        // image is a map of which pixels this morning is even about — and it is
        // very nearly the inverse of ?pass=16's, which is the point.
        if (uShowSupp > 0.5) { outColor = vec4(gSupp.x, gSupp.y, 0.0, 1.0); return; }
        // Day 045's read-out (?pass=18): the factor today's measured area
        // multiplied both of yesterday's semi-axes by, on a log scale so that
        // shrinking and growing are legible as two colours rather than as one
        // number near a boundary.
        //
        //   grey    gain 1. The measurement agreed with the two constants and
        //           the fetch is Day 044's, texel for texel.
        //   teal    the kernel's own mass asked for a *tighter* footprint than
        //           delta and the support did — the fetch was over-blurring.
        //   amber   it asked for a wider one.
        //
        // Full saturation is one octave either way, and the frame sorts itself
        // by lobe rather than by material: **every diffuse surface goes teal and
        // every reflected image of the window goes amber.** The two constants
        // were blurring the cosine lobe and sharpening the GGX one, in the same
        // frame, by opposite factors — which is what one number for a size does
        // when the two lobes it serves differ by two orders of magnitude in
        // width. The amber is a picture of the window on the near tablet, so it
        // is also the smallest visible change today makes: the reflected tracery
        // softens by about a third of a level.
        if (uShowGain > 0.5) {
          float g = clamp(log2(max(gGain, 1e-4)), -1.0, 1.0);
          vec3 c = vec3(0.42) + max(-g, 0.0) * vec3(-0.30, 0.18, 0.30)
                              + max(g, 0.0) * vec3(0.42, 0.12, -0.34);
          outColor = vec4(c, 1.0);
          return;
        }
        // Day 046's read-out (?pass=19): the coverage the specular fetch
        // averaged — how much of its own footprint was glass.
        //
        //   black   coverage 1. The footprint lies inside the panes, the divide
        //           by alpha is the identity, and today's build returns Day
        //           045's colour to the last bit.
        //   amber   the footprint straddles stone. The share drawn is the share
        //           of yesterday's answer that was a mullion's, and every one of
        //           those pixels is a place the pyramid was averaging something
        //           the integral had already excluded by its domain.
        //
        // Unlike ?pass=18 this is not a property of the *rule* — it is a
        // property of the window. A round lobe on a coarse level covers three
        // tiers whatever ellipse it was handed, so the map is nearly the same at
        // ?tap=1 or ?aniso=0, and that is the argument for the day: the error it
        // removes was never going to be filtered away by a better footprint.
        if (uShowCov > 0.5) {
          float s = clamp(1.0 - gCov, 0.0, 1.0);
          outColor = vec4(vec3(0.06) + s * vec3(0.86, 0.44, 0.06), 1.0);
          return;
        }
        // Day 047's read-out (?pass=20): the weight today's fetch put on itself
        // — the share of the glass inside its own footprint that this point can
        // see.
        //
        //   black   1. Open light, or a shadow so deep the whole footprint is in
        //           it uniformly; either way the premultiply is a constant and
        //           the colour is Day 046's.
        //   blue    the footprint straddles a blocker's edge. The share drawn is
        //           the part of the window Day 046 averaged into a surface that
        //           cannot see it — and it is a *penumbra* map, so it draws the
        //           lath, the sill's shadow and the apron's far edge and nothing
        //           else in the room.
        //
        // Read it against ?pass=19. That one is a property of the window and is
        // the same picture wherever the surface is; this one is a property of
        // the point and moves when anything in the room does.
        if (uShowVis > 0.5) {
          float s = clamp(1.0 - gVis, 0.0, 1.0);
          outColor = vec4(vec3(0.06) + s * vec3(0.10, 0.42, 0.86), 1.0);
          return;
        }
        if (uShow > 1.5) { outColor = vec4(max(lit, vec3(0.0)), 1.0); return; }
        if (uShow > 0.5) { outColor = vec4(max(wash, vec3(0.0)), 1.0); return; }

        // the volume was built through an unjittered frustum — it is a property
        // of the room, not of this frame's sub-pixel offset
        vec4 vol = sampleScatter(uVol, vUv - uJitter, d);
        outColor = vec4(surface * clamp(vol.a, 0.0, 1.0) + max(vol.rgb, vec3(0.0)), 1.0);
      }
    `,
  })
}

// ---------------------------------------------------------------------------
// pass 3 — the motes. 7,000 billboards, one draw, no CPU.
// ---------------------------------------------------------------------------

/**
 * Day 033's analytic particles. A mote's position is a closed-form function of
 * time, so its previous position is the same function at t - shutter — no
 * history buffer, no per-instance matrix — and the quad is elongated along its
 * own screen-space motion.
 *
 * The shadow test is the soft one at a single tap (Day 036): a speck is a pixel
 * and cannot resolve a gradient by itself, but 4,500 of them scattered through
 * the same penumbra each draw a different sample of it, and the field as a whole
 * fades into the shaft's edge instead of stopping at a line.
 *
 * Nothing here needed editing today, and that is the argument for having put the
 * source's description in one file. The specks now sample an ellipse because
 * `shOffset` makes one; they were never told what shape they were sampling.
 */
export function makeMoteMaterial() {
  return new THREE.ShaderMaterial({
    defines: { SH_SEARCH: 3, SH_PCF: 1, LTC_PANES: MAX_PANES },
    uniforms: {
      ...froxelReadUniforms(),
      ...shadowUniforms(),
      uGbuf: { value: null },
      uLightDir: { value: new THREE.Vector3(...LIGHT.dir).normalize() },
      uLightCol: { value: new THREE.Color(...LIGHT.color) },

      uRes: { value: new THREE.Vector2(1600, 1000) },
      uFar: { value: 80 },
      uTanHalf: { value: 0.3 },
      uJitter: { value: new THREE.Vector2() },

      uTime: { value: 0 },
      uShutter: { value: MOTES.shutter },
      uSize: { value: MOTES.size },
      uMinPx: { value: MOTES.minPx },
      uSpan: { value: new THREE.Vector3(...MOTES.span) },
      uOrigin: { value: new THREE.Vector3(...MOTES.origin) },
      uFall: { value: new THREE.Vector2(...MOTES.fall) },
      uWander: { value: MOTES.wander },
      uStretch: { value: MOTES.stretch },
      uG: { value: MOTES.g },
      uGain: { value: MOTES.gain },
      uAmbient: { value: new THREE.Color(...MOTES.ambient) },
      uSoft: { value: MOTES.soft },
    },
    transparent: true,
    depthTest: false,
    depthWrite: false,
    // A billboard built in view space has no fixed winding: the quad's basis is
    // derived per particle from its own direction of travel, and a basis with a
    // negative determinant mirrors the triangle. The basis below is right-handed
    // on purpose; this note is here so it cannot silently stop being.
    side: THREE.DoubleSide,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uShutter;
      uniform float uSize;
      uniform float uMinPx;
      uniform vec3 uSpan;
      uniform vec3 uOrigin;
      uniform vec2 uFall;
      uniform float uWander;
      uniform float uStretch;
      uniform float uTanHalf;
      uniform vec2 uRes;
      uniform vec3 uLightDir;
      uniform float uG;

      attribute vec4 aSeed;   // xyz: cell in [0,1)^3, w: phase in [0,1)

      varying vec2 vC;
      varying vec3 vW;
      varying float vD;
      varying float vFlare;
      varying float vRot;

      ${PHASE_GLSL}

      vec3 motePos(float t) {
        float ph = aSeed.w * 6.2831853;
        float speed = mix(uFall.x, uFall.y, fract(aSeed.w * 1.6180339887));

        // fract() falling: subtracting from the phase makes y decrease, and the
        // wrap puts a speck that reaches the floor back at the top of the box
        float y = fract(aSeed.y - t * speed / uSpan.y);

        vec3 p = vec3(
          (aSeed.x - 0.5) * uSpan.x,
          (y - 0.5) * uSpan.y,
          (aSeed.z - 0.5) * uSpan.z
        );
        p.x += sin(t * 0.213 + ph) * uWander;
        p.z += cos(t * 0.171 + ph * 1.7) * uWander;
        p.y += sin(t * 0.407 + ph * 2.3) * 0.05;
        return p + uOrigin;
      }

      void main() {
        vec3 p = motePos(uTime);
        vec3 pPrev = motePos(uTime - uShutter);

        vW = p;
        vec4 mv = viewMatrix * vec4(p, 1.0);
        vec4 mvPrev = viewMatrix * vec4(pPrev, 1.0);
        vD = -mv.z;

        // One frame in the life of a speck that just wrapped is a jump the
        // length of the box. Blur is a lie about that frame; zero is not.
        vec2 dv = mv.xy - mvPrev.xy;
        if (length(p - pPrev) > uSpan.y * 0.35) dv = vec2(0.0);

        // A speck narrower than a pixel does not get dimmer, it gets *unstable*.
        float pxWorld = 2.0 * uTanHalf * vD / uRes.y;
        float r = max(uSize, uMinPx * pxWorld);

        vec2 a = length(dv) > 1e-7 ? normalize(dv) : vec2(0.0, 1.0);
        vec2 b = vec2(a.y, -a.x);   // right-handed with a; see side: DoubleSide
        float stretch = 1.0 + clamp(length(dv) / (2.0 * r) * uStretch, 0.0, 1.8);

        vC = position.xy * 2.0;
        mv.xy += b * (position.x * 2.0 * r) + a * (position.y * 2.0 * r * stretch);

        vec3 dirW = normalize(p - cameraPosition);
        vFlare = min(phaseHG(dot(dirW, uLightDir), uG), 8.0);

        // One rotation per particle, from its own seed and its own drift. Seven
        // thousand different single-tap answers to the same question average
        // into the penumbra none of them can see.
        vRot = (aSeed.w + aSeed.x * 0.37 + fract(uTime * 0.31)) * 6.2831853;

        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      #define TEX2D texture2D
      // GLSL ES 1.00 has no explicit-level fetch in a fragment shader, only a
      // bias. The uv here is constant across a speck, so the base level is 0 and
      // a bias of l is a level of l. Stated because it is a coincidence of this
      // call site and not a general equivalence.
      #define TEXLOD(s, uv, l) texture2D(s, uv, l)

      varying vec2 vC;
      varying vec3 vW;
      varying float vD;
      varying float vFlare;
      varying float vRot;

      uniform sampler2D uGbuf;
      uniform sampler2D uVol;
      uniform vec3 uLightCol;
      uniform vec3 uAmbient;
      uniform vec2 uRes;
      uniform vec2 uJitter;
      uniform float uFar;
      uniform float uGain;
      uniform float uSoft;

      ${VOLUME_GLSL}
      ${SHADOW_GLSL}

      void main() {
        float d2 = dot(vC, vC);
        if (d2 > 1.0) discard;
        float cov = pow(1.0 - d2, 1.7);

        vec2 uv = gl_FragCoord.xy / uRes;

        // depth test and soft fade in one expression
        float ga = texture2D(uGbuf, uv).a;
        float dG = ga > 1e-5 ? ga * uFar : uFar;
        float soft = clamp((dG - vD) / uSoft, 0.0, 1.0);
        if (soft < 0.002) discard;

        // A speck of dust is a sample of the window's colour as much as of its
        // brightness — one tap, one pane, and four and a half thousand siblings
        // to average it with. Where the beam is unobstructed they average to
        // white; along the lath's penumbra the ones that can still see the left
        // light go warm while their neighbours go green.
        vec3 surf = uLightCol * (softVisTint(vW, vRot) * (vFlare * uGain)) + uAmbient;

        // what the air between here and the eye kept
        float Tt = clamp(sampleScatter(uVol, uv - uJitter, vD).a, 0.0, 1.0);

        gl_FragColor = vec4(surf * (cov * soft * Tt), 1.0);
      }
    `,
  })
}

// ---------------------------------------------------------------------------
// pass 5 — TAA resolve
// ---------------------------------------------------------------------------

/**
 * Day 030's, unchanged for a sixth day, and today it acquires its most important
 * customer yet: the 20-tap penumbra estimate is rotated per pixel and per frame,
 * so what it produces in one frame is a gradient with noise on it and what it
 * produces over eight is a gradient.
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
// pass 6 — present: motion blur, the mote layer, then the grade.
// ---------------------------------------------------------------------------

export function makePresentMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...froxelReadUniforms(),
      uColor: { value: null }, // TAA output
      uMotes: { value: null }, // the additive speck layer, never temporally filtered
      uGbuf: { value: null },
      uAlb: { value: null },
      uRadio: { value: null }, // composite attachment 1
      uMotion: { value: null },
      uRes: { value: new THREE.Vector2(1600, 1000) },
      uFar: { value: 80 },
      uJitter: { value: new THREE.Vector2() },
      uVelScale: { value: 1.5 },
      uMaxBlur: { value: 55.0 },
      uTime: { value: 0 },
      uFrame: { value: 0 },
      uMode: { value: 0 },
      uReveal: { value: 0 },
      uExposure: { value: 1.22 },
    },
    depthTest: false,
    depthWrite: false,
    vertexShader: FS_VERT,
    fragmentShader: /* glsl */ `
      precision highp float;
      #define TEX2D texture2D
      // GLSL ES 1.00 has no explicit-level fetch in a fragment shader, only a
      // bias. The uv here is constant across a speck, so the base level is 0 and
      // a bias of l is a level of l. Stated because it is a coincidence of this
      // call site and not a general equivalence.
      #define TEXLOD(s, uv, l) texture2D(s, uv, l)

      varying vec2 vUv;

      uniform sampler2D uColor;
      uniform sampler2D uMotes;
      uniform sampler2D uGbuf;
      uniform sampler2D uAlb;
      uniform sampler2D uRadio;
      uniform sampler2D uMotion;
      uniform sampler2D uVol;
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

        // Modes 1, 8, 9 and 10 are the same code path on purpose. Three of the
        // four comparisons this piece makes are between renders that differ by
        // one uniform — the return term off, the source rounded off, the source
        // collapsed to a point — so nothing else about how they are assembled is
        // allowed to differ.
        if (uMode < 0.5 || uMode > 6.5) {
          col = motionBlur(uColor, vUv) + texture2D(uMotes, vUv).rgb;
        } else if (uMode < 1.5) {                           // 2 · the direct term
          col = texture2D(uColor, vUv).rgb;
        } else if (uMode < 2.5) {                           // 3 · albedo
          col = texture2D(uAlb, vUv).rgb;
        } else if (uMode < 3.5) {                           // 4 · radiosity
          col = texture2D(uRadio, vUv).rgb;
        } else if (uMode < 4.5) {                           // 5 · in-scatter
          col = max(sampleScatter(uVol, vUv - uJitter, dLin).rgb, vec3(0.0));
        } else if (uMode < 5.5) {                           // 6 · transmittance
          col = pow(vec3(clamp(sampleScatter(uVol, vUv - uJitter, dLin).a, 0.0, 1.0)), vec3(2.2));
        } else {                                            // 7 · the wash alone
          col = texture2D(uColor, vUv).rgb * 6.0;
        }

        // ---- grade ---------------------------------------------------------
        col *= uExposure;
        col = aces(col);

        float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
        // The shadows go cool and the highlights stay where they are. The warmth
        // in this frame is supposed to be the room's, earned by bouncing, and
        // pushing the highlights warm in the grade would take the credit for it.
        vec3 shadow = vec3(0.003, 0.007, 0.017);
        vec3 high = vec3(0.010, 0.008, 0.005);
        col += shadow * (1.0 - smoothstep(0.0, 0.55, l));
        col += high * smoothstep(0.38, 1.0, l);
        col = clamp(col, 0.0, 1.0);

        // ---- opening: the light arriving down the shaft ---------------------
        float band = smoothstep(0.0, 1.0, uReveal);
        vec2 q = vUv * vec2(uRes.x / uRes.y, 1.0);
        float along = (q.x * 0.42 - q.y * 0.86) * 0.55 + 0.62;
        float open = 1.0 - smoothstep(band * 1.25 - 0.30, band * 1.25, along);
        col = mix(vec3(0.014, 0.016, 0.022), col, clamp(open, 0.0, 1.0));

        // ---- grain + vignette ---------------------------------------------
        float g = hash12(gl_FragCoord.xy + vec2(floor(uTime * 24.0)));
        col += (g - 0.5) * 0.016;

        vec2 vq = vUv - 0.5;
        col *= 1.0 - dot(vq, vq) * 0.36;

        gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
      }
    `,
  })
}
