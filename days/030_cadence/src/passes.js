import * as THREE from 'three'
import { SKY, SKY_GLSL, skyUniforms } from './palette.js'

/**
 * Day 030 — the shader half of the pipeline.
 *
 *   makeGBufferMaterial   GLSL3 + MRT. One draw, two attachments. Now with a
 *                         *previous model matrix* per object and a *previous
 *                         instance matrix* per instance, so the world is
 *                         finally allowed to move.
 *   makeSSRMaterial       screen-space reflections, accumulated — with the
 *                         feedback now let go wherever the reflected world is
 *                         itself in motion.
 *   makeCompositeMaterial beauty + reflection, still linear, no grade.
 *   makeTaaMaterial       temporal anti-aliasing: Halton jitter, reprojection
 *                         through the velocity buffer, YCoCg variance clipping.
 *                         This is what replaced MSAA today.
 *   makePresentMaterial   motion blur gathered along the velocity buffer, then
 *                         the grade. The only pass that writes the canvas.
 */

// ---------------------------------------------------------------------------
// shared GLSL
// ---------------------------------------------------------------------------

// View-space position from a uv and a *linear* view depth. No inverse matrix:
// the ray is built from the fov and the aspect (Day 028's SSAO started this).
//
// New today: uJitter. The G-buffer and the beauty buffer were rendered through
// a sub-pixel-offset projection, so the feature that *would* have landed at
// uv_clean is sitting at uv_clean + jitter. Reconstruct from the clean uv or
// every screen-space march starts half a pixel out.
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

// The plate's surface normal. Compiled into BOTH the reflection pass (which
// bends the ray) and the composite (which takes Fresnel from it) — if the two
// disagreed, the mirror would slide off the floor. Nothing displaces the
// geometry: the plate stays flat, so its motion vectors stay exact.
const RIPPLE = /* glsl */ `
  void addWave(inout vec2 slope, vec2 p, vec2 dir, float freq, float amp, float speed, float t) {
    float ph = dot(p, dir) * freq + t * speed;
    slope += cos(ph) * amp * freq * dir;
  }

  // a lacquer plate, not water: an order of magnitude flatter than Day 029's
  // basin, just enough to break the mirror into something hand-made
  vec3 rippleNormal(vec2 p, float t) {
    vec2 s = vec2(0.0);
    addWave(s, p, normalize(vec2( 1.00,  0.20)), 0.95, 0.0044, 0.21, t);
    addWave(s, p, normalize(vec2(-0.30,  1.00)), 1.70, 0.0026, 0.33, t);
    addWave(s, p, normalize(vec2( 0.70, -0.70)), 3.10, 0.0010, 0.52, t);
    return normalize(vec3(-s.x, 1.0, -s.y));
  }
`

const HASH = /* glsl */ `
  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
`

// YCoCg is the colour space temporal filters clip in: luma is one axis, so a
// history sample that is too bright gets pulled along luma instead of being
// dragged sideways into a hue it never had.
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

// Karis' reversible tone map. Blending HDR values linearly lets one very bright
// sample dominate a whole neighbourhood (a firefly that never dies); blend in
// this compressed space instead and undo it afterwards.
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
// pass 1 — G-buffer (GLSL3, two colour attachments)
// ---------------------------------------------------------------------------

/**
 *   location 0 : rgb = view-space normal, a = linear view depth / far
 *   location 1 : rg  = screen-space velocity (uv), b = material id, a = 1
 *
 * The shape is Day 029's. What changed is where "previous" comes from.
 *
 * Yesterday the vertex shader said, in a comment: *the scene is a still life,
 * so this frame's world position IS last frame's*. One uniform — the previous
 * camera — described the entire past. Today each object hands in `uPrevModel`,
 * its own world matrix from the last frame, and instanced geometry hands in
 * `aPrevInstance` per instance. A blade of the fin ring is moved by its own
 * orbit, its own twist, and the sway of the group above it; all three are
 * already baked into the matrix it was drawn with last frame, so none of them
 * have to be modelled here.
 *
 * The other subtlety: velocity is measured with *unjittered* matrices on both
 * ends. `gl_Position` keeps the TAA's sub-pixel offset, because the buffers must
 * actually be jittered — but if that offset leaked into the velocity, every
 * static pixel in the scene would report half a pixel of motion every frame and
 * the anti-aliasing would chase its own tail.
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

        // where this vertex was, one frame ago
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
// pass 3 — screen-space reflections, accumulated through the motion vectors
// ---------------------------------------------------------------------------

export function makeSSRMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uGbuf: { value: null },
      uMotion: { value: null },
      uBeauty: { value: null },
      uPrev: { value: null },
      uProj: { value: new THREE.Matrix4() },
      uCamWorld: { value: new THREE.Matrix4() },
      uView: { value: new THREE.Matrix4() },
      uFar: { value: 80 },
      uTanHalf: { value: 0.3 },
      uAspect: { value: 1.6 },
      uJitter: { value: new THREE.Vector2() },
      uRes: { value: new THREE.Vector2(1600, 1000) },
      uTime: { value: 0 },
      uFrame: { value: 0 },
      uThick: { value: 0.30 },
      uMaxDist: { value: 40.0 },
      uRough: { value: 0.008 },
      uBlend: { value: 0.88 },
      uWallZ: { value: SKY.wallZ },
      ...skyUniforms(THREE),
    },
    depthTest: false,
    depthWrite: false,
    vertexShader: FS_VERT,
    fragmentShader: /* glsl */ `
      precision highp float;

      varying vec2 vUv;

      uniform sampler2D uGbuf;
      uniform sampler2D uMotion;
      uniform sampler2D uBeauty;
      uniform sampler2D uPrev;
      uniform mat4 uProj;
      uniform mat4 uCamWorld;
      uniform mat4 uView;
      uniform vec2 uRes;
      uniform float uTime;
      uniform float uFrame;
      uniform float uThick;
      uniform float uMaxDist;
      uniform float uRough;
      uniform float uBlend;
      uniform float uWallZ;

      ${RECON}
      ${RIPPLE}
      ${HASH}
      ${SKY_GLSL}

      // A ray that leaves the screen has not hit nothing — it has hit the room.
      // Intersect the backdrop plane and evaluate the *same* gradient the
      // backdrop mesh is painted with (Day 029 learned this the hard way: a
      // constant fallback puts a band of another world across the frame).
      vec3 roomMiss(vec3 worldOrigin, vec3 viewDir) {
        vec3 wd = normalize(mat3(uCamWorld) * viewDir);
        vec2 p;
        if (wd.z < -1e-3) {
          float tt = clamp((uWallZ - worldOrigin.z) / wd.z, 0.0, 240.0);
          p = worldOrigin.xy + wd.xy * tt;
        } else {
          p = worldOrigin.xy + wd.xy * 30.0;
        }
        return skyAt(p);
      }

      void main() {
        vec4 gnd = texture2D(uGbuf, vUv);
        vec4 gm = texture2D(uMotion, vUv);
        float dLin = gnd.a * uFar;
        float isPlate = step(0.5, gm.b);

        if (isPlate < 0.5) {
          // nothing to reflect here, but the depth still has to be recorded so
          // a *neighbouring* plate pixel can validate its history next frame
          gl_FragColor = vec4(0.0, 0.0, 0.0, dLin);
          return;
        }

        vec3 P = viewRay(vUv) * dLin;
        vec3 worldP = (uCamWorld * vec4(P, 1.0)).xyz;
        vec3 N = normalize(mat3(uView) * rippleNormal(worldP.xz, uTime));
        vec3 V = normalize(P);
        vec3 R = normalize(reflect(V, N));

        // one jittered ray per pixel per frame inside a narrow cone. Alone it is
        // noise; the accumulation at the bottom integrates it into gloss.
        float rnd = hash12(gl_FragCoord.xy + vec2(uFrame * 17.13, uFrame * 9.71));
        float rnd2 = hash12(gl_FragCoord.yx * 1.7 + vec2(uFrame * 5.37, uFrame * 23.1));
        vec3 up = mix(vec3(0.0, 1.0, 0.0), vec3(1.0, 0.0, 0.0), step(0.9, abs(R.y)));
        vec3 t1 = normalize(cross(up, R));
        vec3 t2 = cross(R, t1);
        float ang = rnd * 6.2831853;
        R = normalize(R + (cos(ang) * t1 + sin(ang) * t2) * uRough * sqrt(rnd2));

        // --- the march -----------------------------------------------------
        float stride = 0.20;
        float t = stride * (0.55 + 0.9 * rnd2); // dithered start kills banding
        float prevT = 0.0;
        float conf = 0.0;
        vec2 hitUV = vec2(0.0);

        for (int i = 0; i < 48; i++) {
          vec3 sp = P + R * t;
          vec4 cp = uProj * vec4(sp, 1.0);
          if (cp.w <= 0.0) break;
          vec2 suv = cp.xy / cp.w * 0.5 + 0.5;
          if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) break;

          float sa = texture2D(uGbuf, suv).a;
          if (sa > 1e-4) {
            float sceneD = sa * uFar;
            float diff = (-sp.z) - sceneD;
            // "in front of the ray, but not by more than the surface is thick"
            if (diff > 0.0 && diff < uThick + stride * 0.85) {
              float lo = prevT;
              float hi = t;
              for (int k = 0; k < 6; k++) {
                float mid = 0.5 * (lo + hi);
                vec3 mp = P + R * mid;
                vec4 mc = uProj * vec4(mp, 1.0);
                vec2 muv = mc.xy / mc.w * 0.5 + 0.5;
                float md = texture2D(uGbuf, muv).a * uFar;
                if ((-mp.z) - md > 0.0) hi = mid; else lo = mid;
              }
              vec3 fp = P + R * hi;
              vec4 fc = uProj * vec4(fp, 1.0);
              hitUV = fc.xy / fc.w * 0.5 + 0.5;
              t = hi;
              conf = 1.0;
              break;
            }
          }
          prevT = t;
          stride *= 1.11;
          t += stride;
        }

        vec3 miss = roomMiss(worldP, R);
        vec3 refl = miss;
        float hitVel = 0.0;
        if (conf > 0.5) {
          vec2 e = min(hitUV, 1.0 - hitUV);
          float edge = smoothstep(0.0, 0.13, min(e.x, e.y));
          float far = 1.0 - smoothstep(0.55, 1.0, t / uMaxDist);
          conf = edge * far;
          refl = mix(miss, texture2D(uBeauty, hitUV).rgb, conf);
          // how fast is the thing we are reflecting?
          hitVel = length(texture2D(uMotion, hitUV).rg * uRes) * conf;
        }

        // --- temporal accumulation -----------------------------------------
        // The plate itself is still, so reprojecting its history by its own
        // velocity is exact — and completely wrong for what it is *showing*.
        // A mirror's surface and a mirror's image move at different speeds, and
        // Day 029's NOTES left that as an open problem. The honest fix is to
        // reproject the reflection by the reflected surface's velocity; the
        // cheap fix that behaves correctly at both ends is to let the history
        // GO wherever the reflected world is moving. Still corners of the room
        // keep integrating toward smooth gloss; the swept baton is redrawn
        // almost every frame, so it never trails.
        vec2 prevUV = vUv - gm.rg;
        vec4 hist = texture2D(uPrev, prevUV);
        float valid = 1.0;
        if (prevUV.x < 0.0 || prevUV.x > 1.0 || prevUV.y < 0.0 || prevUV.y > 1.0) valid = 0.0;
        valid *= step(abs(hist.a - dLin), 0.05 * dLin + 0.04);

        float blend = uBlend * (1.0 - clamp(hitVel * 0.16, 0.0, 0.92));

        vec3 outCol = mix(refl, hist.rgb, valid * blend);
        gl_FragColor = vec4(outCol, dLin);
      }
    `,
  })
}

// ---------------------------------------------------------------------------
// pass 4 — composite: beauty + reflection, still linear HDR, no grade
// ---------------------------------------------------------------------------

/**
 * Day 029 ended here and graded straight to the canvas. Today two passes come
 * after, so this one stops at "the image, in linear light": the tone curve has
 * to happen after temporal accumulation and after the blur, or the blur would
 * be averaging display-referred values and the highlights would go grey.
 */
export function makeCompositeMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uBeauty: { value: null },
      uGbuf: { value: null },
      uMotion: { value: null },
      uRefl: { value: null },
      uCamWorld: { value: new THREE.Matrix4() },
      uView: { value: new THREE.Matrix4() },
      uFar: { value: 80 },
      uTanHalf: { value: 0.3 },
      uAspect: { value: 1.6 },
      uJitter: { value: new THREE.Vector2() },
      uTexel: { value: new THREE.Vector2(1 / 1600, 1 / 1000) },
      uTime: { value: 0 },
      uReflGain: { value: 1.0 },
    },
    depthTest: false,
    depthWrite: false,
    vertexShader: FS_VERT,
    fragmentShader: /* glsl */ `
      precision highp float;

      varying vec2 vUv;

      uniform sampler2D uBeauty;
      uniform sampler2D uGbuf;
      uniform sampler2D uMotion;
      uniform sampler2D uRefl;
      uniform mat4 uCamWorld;
      uniform mat4 uView;
      uniform vec2 uTexel;
      uniform float uTime;
      uniform float uReflGain;

      ${RECON}
      ${RIPPLE}

      // widen the reflection with distance: a poor man's roughness falloff, and
      // it eats the last of the ray-march noise the history has not caught
      vec3 blurRefl(vec2 uv, float d) {
        vec2 s = uTexel * (1.0 + d * 0.10);
        vec3 c = texture2D(uRefl, uv).rgb * 0.36;
        c += texture2D(uRefl, uv + vec2( s.x,  s.y)).rgb * 0.16;
        c += texture2D(uRefl, uv + vec2(-s.x,  s.y)).rgb * 0.16;
        c += texture2D(uRefl, uv + vec2( s.x, -s.y)).rgb * 0.16;
        c += texture2D(uRefl, uv + vec2(-s.x, -s.y)).rgb * 0.16;
        return c;
      }

      // Day 029 had to feather this mask by a pixel, because the beauty pass was
      // 4x MSAA while the G-buffer was one sample and the two disagreed along
      // every silhouette. Today the beauty pass is one sample too — TAA is the
      // anti-aliasing — so the two buffers describe exactly the same geometry
      // and the mask can be read straight.
      void main() {
        vec4 gnd = texture2D(uGbuf, vUv);
        vec4 gm = texture2D(uMotion, vUv);
        vec3 beauty = texture2D(uBeauty, vUv).rgb;
        float dLin = gnd.a * uFar;
        float isPlate = clamp(gm.b, 0.0, 1.0);

        vec3 col = beauty;

        if (isPlate > 0.01) {
          vec3 P = viewRay(vUv) * dLin;
          vec3 V = normalize(P);
          vec3 worldP = (uCamWorld * vec4(P, 1.0)).xyz;
          vec3 N = normalize(mat3(uView) * rippleNormal(worldP.xz, uTime));

          // Schlick, F0 = 0.045 for lacquer — a little more mirror than water,
          // and enough at grazing angles to carry the whole lower frame
          float c = clamp(dot(N, -V), 0.0, 1.0);
          float F = 0.045 + 0.955 * pow(1.0 - c, 5.0);

          // Fade the mirror out with distance. Without this the plate keeps
          // reflecting all the way to where it passes behind the backdrop, and
          // the two meet in a hard bright seam straight across the frame — the
          // 2026 restaging of Day 029's cold horizon band, and the same lesson:
          // a reflection needs somewhere to end.
          float fade = 1.0 - smoothstep(10.0, 26.0, dLin);

          vec3 refl = blurRefl(vUv, dLin);
          col = beauty + refl * F * fade * uReflGain * isPlate;
        }

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  })
}

// ---------------------------------------------------------------------------
// pass 5 — TAA resolve
// ---------------------------------------------------------------------------

/**
 * Temporal anti-aliasing, which is what let today's beauty buffer drop MSAA.
 *
 * The camera's projection is offset by a sub-pixel Halton(2,3) step each frame,
 * so over eight frames the scene is sampled at eight positions inside every
 * pixel. Reprojecting the previous result through the velocity buffer and
 * blending 0.93 of it back is what turns those eight positions into one
 * supersampled image — at 1 sample per pixel per frame.
 *
 * The whole difficulty of TAA is in refusing history. Two mechanisms here:
 *
 *   depth rejection      the history slot carries the linear depth it was
 *                        written at; if the surface at prevUV was a different
 *                        distance away, this is a disocclusion, not a match.
 *   variance clipping    build a mean and a standard deviation from the 3x3
 *                        neighbourhood in YCoCg, and clip the history sample
 *                        into that ellipsoid *along the line* toward the
 *                        current colour. Plain min/max clamping keeps
 *                        outliers; clipping along the segment is what removes
 *                        ghosting behind a fast edge — which today is the
 *                        baton, so the mechanism is not academic.
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
      uGamma: { value: 1.15 },
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

      // clip q into the box (c ± e) along the segment from c toward q
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

        // --- neighbourhood statistics, in YCoCg ---------------------------
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

        // --- history -------------------------------------------------------
        vec2 vel = texture2D(uMotion, vUv).rg;
        vec2 prevUV = vUv - vel;
        vec4 h = texture2D(uHist, prevUV);

        float valid = uValid;
        if (prevUV.x < 0.0 || prevUV.x > 1.0 || prevUV.y < 0.0 || prevUV.y > 1.0) valid = 0.0;
        valid *= step(abs(h.a - curD), 0.06 * curD + 0.06);

        vec3 histY = clipToBox(m1, ext, rgb2ycocg(toneIn(h.rgb)));
        vec3 hist = ycocg2rgb(histY);

        // a long screen-space step means the reprojection is standing on one
        // bilinear tap of a surface that has moved a long way: trust it less
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

/**
 * The velocity buffer was built for the reprojections above; here it becomes
 * something you can actually see.
 *
 * A naive gather ("smear each pixel along its own velocity") gives a moving
 * object a soft interior and a razor edge, because the still background beside
 * it has zero velocity and so blurs by nothing. The fix is that a pixel must be
 * allowed to *receive* a smear it is not making: sample a ring of neighbours,
 * take the largest velocity found, gather along that — and weight every tap by
 * whether the surface there actually sweeps far enough to reach here. That
 * "reach" test is what keeps the whole background from softening along with the
 * baton.
 *
 * Shutter is a duration, not a per-frame amount: the velocity buffer holds uv
 * per *frame*, so it is scaled by shutter/dt. The blur is then the same length
 * at 30fps and 144fps, which is the only way it can be a look rather than a
 * side effect of the machine.
 */
export function makePresentMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: null }, // TAA output
      uRaw: { value: null }, // composite output, pre-TAA
      uBeauty: { value: null },
      uGbuf: { value: null },
      uMotion: { value: null },
      uRefl: { value: null },
      uRes: { value: new THREE.Vector2(1600, 1000) },
      uVelScale: { value: 1.5 },
      uMaxBlur: { value: 55.0 }, // pixels
      uTime: { value: 0 },
      uFrame: { value: 0 },
      uMode: { value: 0 },
      uReveal: { value: 0 },
      uExposure: { value: 1.18 },
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
      uniform sampler2D uRefl;
      uniform vec2 uRes;
      uniform float uVelScale;
      uniform float uMaxBlur;
      uniform float uTime;
      uniform float uFrame;
      uniform float uMode;
      uniform float uReveal;
      uniform float uExposure;

      ${HASH}

      // velocity at a uv, in pixels of shutter-scaled screen motion
      vec2 velPx(vec2 uv) {
        return texture2D(uMotion, uv).rg * uVelScale * uRes;
      }

      vec3 motionBlur(sampler2D src, vec2 uv) {
        vec2 vC = velPx(uv);
        vec2 vM = vC;
        float lM = length(vC);

        // the dominant velocity nearby — a still pixel next to a fast edge has
        // to know which way the smear is coming from
        float ring = uMaxBlur * 0.5;
        for (int i = 0; i < 8; i++) {
          float a = (float(i) + 0.5) * 0.7853982;
          vec2 v = velPx(uv + vec2(cos(a), sin(a)) * ring / uRes);
          float l = length(v);
          if (l > lM) { lM = l; vM = v; }
        }

        if (lM < 1.2) return texture2D(src, uv).rgb; // sub-pixel: leave it alone

        vec2 dir = vM * min(1.0, uMaxBlur / lM);
        float jit = hash12(gl_FragCoord.xy + vec2(uFrame, uFrame * 1.61)) - 0.5;

        vec3 acc = vec3(0.0);
        float wsum = 0.0;
        for (int i = 0; i < 23; i++) {
          float f = (float(i) + 0.5 + jit) / 23.0 - 0.5;
          vec2 opx = dir * f;
          vec2 suv = uv + opx / uRes;
          float need = length(opx);
          // half the sweep of whichever of the two surfaces is faster
          float reach = 0.5 * max(length(velPx(suv)), length(vC));
          float w = 1.0 - smoothstep(reach * 0.85, reach * 1.25 + 1.0, need);
          acc += texture2D(src, suv).rgb * w;
          wsum += w;
        }
        return wsum > 1e-4 ? acc / wsum : texture2D(src, uv).rgb;
      }

      // filmic curve (ACES fit) — everything above here was linear HDR
      vec3 aces(vec3 x) {
        return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
      }

      void main() {
        vec3 col;

        if (uMode < 0.5) {
          col = motionBlur(uColor, vUv);              // 1 · composite
        } else if (uMode < 1.5) {
          col = texture2D(uBeauty, vUv).rgb;          // 2 · beauty, 1 sample
        } else if (uMode < 2.5) {
          col = pow(texture2D(uGbuf, vUv).rgb * 0.5 + 0.5, vec3(2.2));
        } else if (uMode < 3.5) {                     // 4 · velocity
          vec2 v = texture2D(uMotion, vUv).rg * 150.0;
          col = pow(clamp(vec3(0.5 + v.x, 0.5 + v.y, 0.5), 0.0, 1.0), vec3(2.2));
        } else if (uMode < 4.5) {
          col = texture2D(uRefl, vUv).rgb;            // 5 · accumulated SSR
        } else {
          col = motionBlur(uRaw, vUv);                // 6 · TAA off
        }

        // ---- grade ---------------------------------------------------------
        col *= uExposure;
        col = aces(col);

        // split tone: a trace of cold in the shadows, warm paper in the
        // highlights. Kept small — the piece needs its blacks to stay black.
        float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
        vec3 shadow = vec3(0.006, 0.009, 0.017);
        vec3 high = vec3(0.030, 0.016, -0.012);
        col += shadow * (1.0 - smoothstep(0.0, 0.55, l));
        col += high * smoothstep(0.35, 1.0, l);
        col = clamp(col, 0.0, 1.0);

        // ---- opening: a shutter sweeping across from the left ---------------
        float band = smoothstep(0.0, 1.0, uReveal);
        float wipe = smoothstep(band * 1.28 - 0.28, band * 1.28, vUv.x);
        col = mix(col, vec3(0.030, 0.034, 0.043), clamp(wipe, 0.0, 1.0));

        // ---- grain + vignette ---------------------------------------------
        float g = hash12(gl_FragCoord.xy + vec2(floor(uTime * 24.0)));
        col += (g - 0.5) * 0.016;

        vec2 q = vUv - 0.5;
        col *= 1.0 - dot(q, q) * 0.46;

        gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
      }
    `,
  })
}
