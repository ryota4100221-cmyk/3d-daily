import * as THREE from 'three'
import { LIGHT, MOTES } from './palette.js'
import { VOLUME_GLSL, PHASE_GLSL, froxelReadUniforms } from './froxel.js'

/**
 * Day 033 — the rest of the pipeline.
 *
 *   makeLightDepthMaterial  pass 0: the scene from the light's point of view as
 *                           *linear* distance. Day 031's, unchanged.
 *   makeGBufferMaterial     pass 1: MRT normal+depth and velocity+id, previous
 *                           matrix per object and per instance (Day 030).
 *   makeCompositeMaterial   pass 5: one trilinear read of the froxel volume.
 *   makeMoteMaterial        pass 6, new today: 7,000 billboards animated
 *                           entirely in the vertex shader, lit by the same
 *                           depth map as the air, faded softly against the
 *                           G-buffer, and attenuated by one read of the volume
 *                           at each speck's own depth.
 *   makeTaaMaterial         pass 7: Halton jitter, YCoCg variance clipping.
 *   makePresentMaterial     pass 8: motion blur, the mote layer, the grade.
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

// the light-space shadow test, in world units — shared by the motes, which are
// the one thing in the piece three's own shadow machinery never shades
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
// pass 5 — composite
// ---------------------------------------------------------------------------

/**
 * One read and the two-term compositing rule that has been true since Day 031:
 * what is behind the air, dimmed by what the air absorbed, plus what the air
 * scattered toward the eye. Nothing here knows or cares that the second term now
 * includes light that bounced twice.
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
// pass 6 — the motes. 7,000 billboards, one draw, no CPU.
// ---------------------------------------------------------------------------

/**
 * Day 032 put 130 specks in the frame as ordinary instanced solids, laid out by
 * a JavaScript loop that wrote 130 matrices every frame. That does not go to
 * 7,000, and the reason it does not is instructive: the CPU work is not the
 * matrices, it is that a matrix is the wrong representation. A mote's position
 * is a *closed-form function of time*. Writing it into a buffer throws that away
 * and then pays to move the result to the GPU.
 *
 * So the position lives in the vertex shader, evaluated from a four-float seed.
 * Which immediately gives something the matrix version could not: the previous
 * position is the same function at t - dt, exactly, for free, with no history
 * buffer and no wrap bookkeeping. Day 030 needed an entire per-instance mat4
 * attribute to know where an instance used to be. An analytic particle just
 * knows.
 *
 * That velocity is spent on the billboard itself — the quad is elongated along
 * its own screen-space motion, which is per-particle motion blur that needs no
 * gather, no history and no velocity buffer. Which is the whole reason this
 * layer can be composited *after* the TAA resolve: a per-pixel velocity buffer
 * holds one surface per pixel, seven thousand transparent specks are not one
 * surface, and feeding the resolve a velocity it cannot represent would be
 * lying to it. Better to hand it nothing and let each speck carry its own blur.
 *
 * Three reads make a speck belong to the room rather than sit in front of it:
 *
 *   light depth   the same map, the same bias, the same world units as the air.
 *                 A mote in a shadow lane goes out. This is why the shaft is
 *                 full of glinting and the lanes beside it are not.
 *   G-buffer      a soft fade over the last 60cm before a surface, so a speck
 *                 crossing the floor dissolves instead of stamping a hard disc
 *                 on it.
 *   the volume    one trilinear read at the speck's *own* depth. This is the
 *                 Day 032 argument again, and it is what makes a field this deep
 *                 read as depth at all: the far motes are behind eight metres of
 *                 lit mist and come back grey, the near ones do not.
 *
 * Blending is additive, which is not a shortcut — an optically thin scatterer
 * adds sigma·L·T to the ray and occludes nothing measurable. Additive is also
 * order independent, so 7,000 overlapping quads need no sorting whatsoever.
 */
export function makeMoteMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...froxelReadUniforms(),
      uGbuf: { value: null },
      uLightDepth: { value: null },
      uLightVP: { value: new THREE.Matrix4() },
      uLightView: { value: new THREE.Matrix4() },
      uLightFar: { value: LIGHT.far },
      uLightBias: { value: LIGHT.bias + 0.04 },
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
    // negative determinant mirrors the triangle. Every speck in the first build
    // of this was back-facing and silently culled — one draw, fourteen thousand
    // triangles, zero pixels. The basis below is right-handed on purpose; this
    // is here so it cannot happen again.
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

      ${PHASE_GLSL}

      // The whole particle system. Everything below is a consequence of this
      // being a function rather than a buffer.
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

        // A speck narrower than a pixel does not get dimmer, it gets *unstable*:
        // it lands inside a pixel some frames and between two on others. Hold a
        // floor on the screen-space radius and let the far field stay quiet.
        float pxWorld = 2.0 * uTanHalf * vD / uRes.y;
        float r = max(uSize, uMinPx * pxWorld);

        // Elongate along the direction of travel: per-particle motion blur, done
        // with geometry, which is the only kind that survives being composited
        // outside the temporal resolve.
        vec2 a = length(dv) > 1e-7 ? normalize(dv) : vec2(0.0, 1.0);
        vec2 b = vec2(a.y, -a.x);   // right-handed with a; see side: DoubleSide
        float stretch = 1.0 + clamp(length(dv) / (2.0 * r) * uStretch, 0.0, 1.8);

        vC = position.xy * 2.0;
        mv.xy += b * (position.x * 2.0 * r) + a * (position.y * 2.0 * r * stretch);

        // Backlit: the view direction and the direction toward the light very
        // nearly agree, which is the whole reason a strongly forward-scattering
        // phase function was worth writing. Capped, because the peak of an
        // HG lobe at g = 0.72 is twenty-two and nothing here wants twenty-two.
        vec3 dirW = normalize(p - cameraPosition);
        vFlare = min(phaseHG(dot(dirW, uLightDir), uG), 8.0);

        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      #define TEX2D texture2D

      varying vec2 vC;
      varying vec3 vW;
      varying float vD;
      varying float vFlare;

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
      ${LIGHT_VIS}

      void main() {
        float d2 = dot(vC, vC);
        if (d2 > 1.0) discard;
        float cov = pow(1.0 - d2, 1.7);

        vec2 uv = gl_FragCoord.xy / uRes;

        // depth test and soft fade in one expression: a speck sixty centimetres
        // from the floor is already half gone, and one behind it is zero
        float ga = texture2D(uGbuf, uv).a;
        float dG = ga > 1e-5 ? ga * uFar : uFar;
        float soft = clamp((dG - vD) / uSoft, 0.0, 1.0);
        if (soft < 0.002) discard;

        vec3 surf = uLightCol * (lightVis(vW) * vFlare * uGain) + uAmbient;

        // what the air between here and the eye kept
        float Tt = clamp(sampleScatter(uVol, uv - uJitter, vD).a, 0.0, 1.0);

        gl_FragColor = vec4(surf * (cov * soft * Tt), 1.0);
      }
    `,
  })
}

// ---------------------------------------------------------------------------
// pass 7 — TAA resolve
// ---------------------------------------------------------------------------

/**
 * Day 030's, unchanged for a fourth day, and this time it lost a customer rather
 * than gaining one: yesterday's glass was resolved here despite writing no
 * velocity, and the NOTES called that out as a lie the variance clip happened to
 * absorb. Today's transparent layer is composited downstream instead, so the
 * resolve only ever sees surfaces that wrote the velocity it reprojects with.
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
// pass 8 — present: motion blur, the mote layer, then the grade.
// ---------------------------------------------------------------------------

export function makePresentMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...froxelReadUniforms(),
      uColor: { value: null }, // TAA output
      uMotes: { value: null }, // the additive speck layer, never temporally filtered
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
      uExposure: { value: 1.52 },
    },
    depthTest: false,
    depthWrite: false,
    vertexShader: FS_VERT,
    fragmentShader: /* glsl */ `
      precision highp float;
      #define TEX2D texture2D

      varying vec2 vUv;

      uniform sampler2D uColor;
      uniform sampler2D uMotes;
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

        if (uMode < 0.5 || (uMode > 7.5 && uMode < 8.5)) {
          // 1 · composite, and 9 · the same thing with the second bounce off
          col = motionBlur(uColor, vUv) + texture2D(uMotes, vUv).rgb;
        } else if (uMode < 1.5) {
          col = texture2D(uBeauty, vUv).rgb;                // 2 · beauty, dry air
        } else if (uMode < 2.5) {                           // 3 · normals
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
          col = texture2D(uVol, vUv).rgb * 0.9;
        } else if (uMode < 7.5) {                           // 8 · light-space depth
          float d = texture2D(uLightDepth, vUv).r;
          col = pow(vec3(1.0 - d), vec3(2.2));
        } else {                                            // 10 · the specks alone
          col = texture2D(uMotes, vUv).rgb;
        }

        // ---- grade ---------------------------------------------------------
        col *= uExposure;
        col = aces(col);

        float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
        // The shadows go cool and the highlights stay where they are. The warmth
        // in this frame is supposed to be the air's, earned by bouncing, and
        // pushing the highlights warm in the grade would take the credit for it.
        vec3 shadow = vec3(0.003, 0.007, 0.017);
        vec3 high = vec3(0.010, 0.008, 0.005);
        col += shadow * (1.0 - smoothstep(0.0, 0.55, l));
        col += high * smoothstep(0.38, 1.0, l);
        col = clamp(col, 0.0, 1.0);

        // ---- opening: the light arriving down the shaft ---------------------
        // Day 032 opened as a circle around a lamp. This piece has no lamp; it
        // has a beam, so the room arrives along the beam — a diagonal wipe
        // running down and to the left, the way the light itself travels.
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
