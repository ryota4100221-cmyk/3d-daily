import * as THREE from 'three'
import { SKY, SKY_GLSL, skyUniforms } from './palette.js'

/**
 * Day 029 — the shader half of the pipeline.
 *
 * Three materials:
 *   makeGBufferMaterial  GLSL3 + MRT. One scene draw, two attachments.
 *   makeSSRMaterial      screen-space reflection ray march + temporal reprojection.
 *   makeCompositeMaterial the only pass that touches the screen.
 */

// ---------------------------------------------------------------------------
// shared GLSL
// ---------------------------------------------------------------------------

// view-space position from a uv and a *linear* view depth. No inverse matrix:
// we build the ray straight out of the fov and the aspect, exactly as Day 028's
// SSAO did — it is cheaper and it cannot disagree with the projection we use to
// go the other way.
const RECON = /* glsl */ `
  uniform float uFar;
  uniform float uTanHalf;
  uniform float uAspect;

  vec3 viewRay(vec2 uv) {
    return vec3(
      (uv.x * 2.0 - 1.0) * uTanHalf * uAspect,
      (uv.y * 2.0 - 1.0) * uTanHalf,
      -1.0
    );
  }
`

// The basin's surface normal. This lives in exactly one place and is compiled
// into BOTH the reflection pass (which bends the ray) and the composite (which
// takes the Fresnel term from it) — if the two ever disagreed, the mirror would
// slide off the water. Nothing displaces the geometry: the plane stays flat, so
// the motion vectors baked in the G-buffer stay exact.
const RIPPLE = /* glsl */ `
  void addWave(inout vec2 slope, vec2 p, vec2 dir, float freq, float amp, float speed, float t) {
    float ph = dot(p, dir) * freq + t * speed;
    slope += cos(ph) * amp * freq * dir;
  }

  vec3 rippleNormal(vec2 p, float t) {
    vec2 s = vec2(0.0);
    addWave(s, p, normalize(vec2( 1.00,  0.22)), 1.30, 0.030, 0.42, t);
    addWave(s, p, normalize(vec2(-0.35,  1.00)), 2.05, 0.017, 0.61, t);
    addWave(s, p, normalize(vec2( 0.72, -0.68)), 3.55, 0.008, 0.93, t);
    addWave(s, p, normalize(vec2(-0.90, -0.30)), 6.20, 0.003, 1.40, t);
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
 * Day 028 wrote normals and depth into one RGBA and needed a second full scene
 * draw for anything else. WebGL2 lets a fragment shader declare more than one
 * output, so today one draw fills both:
 *
 *   location 0 : rgb = view-space normal, a = linear view depth / far
 *   location 1 : rg  = screen-space velocity (uv), b = material id, a = 1
 *
 * The velocity is the new part. Every pixel now knows where it was last frame,
 * which is what lets the reflection buffer survive a moving camera.
 */
export function makeGBufferMaterial(far, matId) {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {
      uFar: { value: far },
      uMatId: { value: matId },
      uPrevViewProj: { value: new THREE.Matrix4() },
    },
    vertexShader: /* glsl */ `
      uniform mat4 uPrevViewProj;

      varying vec3 vN;
      varying float vDepth;
      varying vec4 vCur;
      varying vec4 vPrev;

      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vec4 view = viewMatrix * world;
        vN = normalize(normalMatrix * normal);
        vDepth = -view.z;
        vec4 clip = projectionMatrix * view;
        vCur = clip;
        // the scene is a still life: this frame's world position IS last
        // frame's, so the previous clip position is just the old camera.
        vPrev = uPrevViewProj * world;
        gl_Position = clip;
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
      uTime: { value: 0 },
      uFrame: { value: 0 },
      uThick: { value: 0.34 },
      uMaxDist: { value: 34.0 },
      uRough: { value: 0.016 },
      uBlend: { value: 0.82 },
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

      // A ray that walks off the screen has not hit "nothing" — it has hit the
      // sky. Rather than fading to a flat colour (which painted a cold band
      // right across the horizon), evaluate the same gradient the backdrop is
      // painted with, at the height the ray would reach.
      vec3 skyMiss(vec3 worldOrigin, vec3 viewDir) {
        vec3 wd = normalize(mat3(uCamWorld) * viewDir);
        float y;
        if (wd.z < -1e-3) {
          float tt = clamp((uWallZ - worldOrigin.z) / wd.z, 0.0, 240.0);
          y = worldOrigin.y + wd.y * tt;
        } else {
          y = worldOrigin.y + wd.y * 30.0;
        }
        return skyAtHeight(y);
      }

      void main() {
        vec4 gnd = texture2D(uGbuf, vUv);
        vec4 gm = texture2D(uMotion, vUv);
        float dLin = gnd.a * uFar;
        float isWater = step(0.5, gm.b);

        if (isWater < 0.5) {
          // nothing to reflect, but the depth still has to be recorded so the
          // history of a *neighbouring* water pixel can be validated next frame
          gl_FragColor = vec4(0.0, 0.0, 0.0, dLin);
          return;
        }

        vec3 P = viewRay(vUv) * dLin;
        vec3 worldP = (uCamWorld * vec4(P, 1.0)).xyz;
        vec3 N = normalize(mat3(uView) * rippleNormal(worldP.xz, uTime));
        vec3 V = normalize(P);
        vec3 R = normalize(reflect(V, N));

        // one jittered ray per pixel per frame inside a narrow cone. On its own
        // this is noise; the reprojection at the bottom is what integrates it
        // into a smooth glossy reflection.
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

        vec3 miss = skyMiss(worldP, R);
        vec3 refl = miss;
        if (conf > 0.5) {
          vec2 e = min(hitUV, 1.0 - hitUV);
          float edge = smoothstep(0.0, 0.13, min(e.x, e.y));
          float far = 1.0 - smoothstep(0.55, 1.0, t / uMaxDist);
          conf = edge * far;
          refl = mix(miss, texture2D(uBeauty, hitUV).rgb, conf);
        }

        // --- temporal reprojection ----------------------------------------
        // Day 028 accumulated too, but it could only keep history while the
        // camera held still. Now every pixel carries where it came from.
        vec2 prevUV = vUv - gm.rg;
        vec4 hist = texture2D(uPrev, prevUV);
        float valid = 1.0;
        if (prevUV.x < 0.0 || prevUV.x > 1.0 || prevUV.y < 0.0 || prevUV.y > 1.0) valid = 0.0;
        valid *= step(abs(hist.a - dLin), 0.05 * dLin + 0.04);

        vec3 outCol = mix(refl, hist.rgb, valid * uBlend);
        gl_FragColor = vec4(outCol, dLin);
      }
    `,
  })
}

// ---------------------------------------------------------------------------
// pass 4 — composite
// ---------------------------------------------------------------------------

export function makeCompositeMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uBeauty: { value: null },
      uGbuf: { value: null },
      uMotion: { value: null },
      uRefl: { value: null },
      uProj: { value: new THREE.Matrix4() },
      uCamWorld: { value: new THREE.Matrix4() },
      uView: { value: new THREE.Matrix4() },
      uFar: { value: 80 },
      uTanHalf: { value: 0.3 },
      uAspect: { value: 1.6 },
      uTexel: { value: new THREE.Vector2(1 / 1600, 1 / 900) },
      uTime: { value: 0 },
      uMode: { value: 0 },
      uReveal: { value: 0 },
      uExposure: { value: 1.06 },
      uReflGain: { value: 1.18 },
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
      uniform float uMode;
      uniform float uReveal;
      uniform float uExposure;
      uniform float uReflGain;

      ${RECON}
      ${RIPPLE}
      ${HASH}

      // filmic curve (ACES fit) — the whole frame lives in linear HDR until here
      vec3 aces(vec3 x) {
        return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
      }

      // widen the reflection with distance: a poor man's roughness falloff, and
      // it hides the last of the ray-march noise the history has not eaten yet
      vec3 blurRefl(vec2 uv, float d) {
        vec2 s = uTexel * (1.0 + d * 0.10);
        vec3 c = texture2D(uRefl, uv).rgb * 0.36;
        c += texture2D(uRefl, uv + vec2( s.x,  s.y)).rgb * 0.16;
        c += texture2D(uRefl, uv + vec2(-s.x,  s.y)).rgb * 0.16;
        c += texture2D(uRefl, uv + vec2( s.x, -s.y)).rgb * 0.16;
        c += texture2D(uRefl, uv + vec2(-s.x, -s.y)).rgb * 0.16;
        return c;
      }

      // The G-buffer is one sample per pixel; the beauty pass is 4x MSAA. On a
      // silhouette the two disagree — beauty already blended object and water,
      // while the material id snapped to one of them, and adding a full
      // reflection on top of that left a bright dotted fringe along every rim.
      // Feathering the mask by one pixel puts the two back in step.
      float waterMask(vec2 uv) {
        vec2 s = uTexel;
        float m = texture2D(uMotion, uv).b * 0.36;
        m += texture2D(uMotion, uv + vec2(s.x, 0.0)).b * 0.16;
        m += texture2D(uMotion, uv - vec2(s.x, 0.0)).b * 0.16;
        m += texture2D(uMotion, uv + vec2(0.0, s.y)).b * 0.16;
        m += texture2D(uMotion, uv - vec2(0.0, s.y)).b * 0.16;
        return clamp(m, 0.0, 1.0);
      }

      void main() {
        vec4 gnd = texture2D(uGbuf, vUv);
        vec4 gm = texture2D(uMotion, vUv);
        vec3 beauty = texture2D(uBeauty, vUv).rgb;
        float dLin = gnd.a * uFar;
        float isWater = waterMask(vUv);

        vec3 col = beauty;

        if (isWater > 0.01) {
          vec3 P = viewRay(vUv) * dLin;
          vec3 V = normalize(P);
          vec3 worldP = (uCamWorld * vec4(P, 1.0)).xyz;
          vec3 N = normalize(mat3(uView) * rippleNormal(worldP.xz, uTime));

          // Schlick, F0 = 0.02 for water. At this camera height most of the
          // basin sits far out on the tail, which is exactly why a still lake
          // is a mirror at the horizon and glass at your feet.
          float c = clamp(dot(N, -V), 0.0, 1.0);
          float F = 0.02 + 0.98 * pow(1.0 - c, 5.0);

          vec3 refl = blurRefl(vUv, dLin);
          // the water is not neutral: it eats a little red on the way down
          vec3 tint = vec3(0.90, 0.95, 1.0);
          col = beauty + refl * tint * F * uReflGain * isWater;
        }

        // ---- debug taps ---------------------------------------------------
        if (uMode > 0.5 && uMode < 1.5) {
          col = beauty;
        } else if (uMode > 1.5 && uMode < 2.5) {
          col = gnd.rgb * 0.5 + 0.5;
          col = pow(col, vec3(2.2));
        } else if (uMode > 2.5 && uMode < 3.5) {
          vec2 v = gm.rg * 120.0;
          col = vec3(0.5 + v.x, 0.5 + v.y, 0.5);
          col = pow(clamp(col, 0.0, 1.0), vec3(2.2));
        } else if (uMode > 3.5) {
          col = texture2D(uRefl, vUv).rgb;
        }

        // ---- grade ---------------------------------------------------------
        col *= uExposure;
        col = aces(col);

        // split tone: ink into the shadows, paper into the highlights
        float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
        vec3 shadow = vec3(0.024, 0.030, 0.046);
        vec3 high = vec3(0.032, 0.020, -0.008);
        col += shadow * (1.0 - smoothstep(0.0, 0.55, l));
        col += high * smoothstep(0.35, 1.0, l);
        col = clamp(col, 0.0, 1.0);

        // ---- opening wipe: the frame fills upward out of the horizon -------
        // (Day 028's version counted frames by accident; this one is wall clock)
        float band = smoothstep(0.0, 1.0, uReveal);
        float dCentre = abs(vUv.y - 0.34);
        float wipe = smoothstep(band * 0.95 + 0.02, band * 0.75, dCentre);
        vec3 dusk = vec3(0.098, 0.113, 0.140);
        col = mix(dusk, col, clamp(wipe, 0.0, 1.0));

        // ---- grain + vignette ---------------------------------------------
        float g = hash12(gl_FragCoord.xy + vec2(floor(uTime * 24.0)));
        col += (g - 0.5) * 0.018;

        vec2 q = vUv - 0.5;
        float vig = 1.0 - dot(q, q) * 0.42;
        col *= vig;

        gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
      }
    `,
  })
}
