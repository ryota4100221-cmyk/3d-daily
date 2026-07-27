import * as THREE from 'three'

/* -------------------------------------------------------------------------
 * Pass 1 — G-buffer
 * Rendered by swapping scene.overrideMaterial, so a single material describes
 * the whole scene's geometry: rgb = view-space normal, a = view depth / far.
 * Packing depth into alpha (instead of a DepthTexture) keeps precision under
 * our control and works identically everywhere.
 * ---------------------------------------------------------------------- */
export function makeGBufferMaterial(far) {
  return new THREE.ShaderMaterial({
    uniforms: { uFar: { value: far } },
    blending: THREE.NoBlending,
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying float vZ;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vZ = -mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uFar;
      varying vec3 vN;
      varying float vZ;
      void main() {
        vec3 n = normalize(vN);
        gl_FragColor = vec4(n * 0.5 + 0.5, clamp(vZ / uFar, 0.0, 1.0));
      }
    `,
  })
}

const VIEW_RECONSTRUCT = /* glsl */ `
  // rebuild the view-space position of a texel from uv + linear view depth
  vec3 viewPos(vec2 uv, float vz) {
    return vec3(
      (uv.x * 2.0 - 1.0) * uTanHalf * uAspect * vz,
      (uv.y * 2.0 - 1.0) * uTanHalf * vz,
      -vz
    );
  }
`

const FS_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

/* -------------------------------------------------------------------------
 * Pass 2 — horizon-style SSAO with temporal accumulation
 * 14 cosine-weighted hemisphere taps per pixel, rotated by a per-pixel hash and
 * a per-frame golden-angle offset, so consecutive frames sample *different*
 * directions. The result is blended into the previous AO buffer (ping-pong),
 * validated against the stored view depth so the history is thrown away where
 * the geometry changed. A still camera therefore keeps refining toward a
 * near-noise-free occlusion solve — progressive rendering, not a bigger kernel.
 * ---------------------------------------------------------------------- */
export function makeAOMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uGbuf: { value: null },
      uPrev: { value: null },
      uProj: { value: new THREE.Matrix4() },
      uFar: { value: 60 },
      uTanHalf: { value: 0.36 },
      uAspect: { value: 1.6 },
      uRadius: { value: 0.48 },
      uBias: { value: 0.028 },
      uIntensity: { value: 1.02 },
      uFrame: { value: 0 },
      uBlend: { value: 0.24 },
    },
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
    vertexShader: FS_VERT,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform sampler2D uGbuf, uPrev;
      uniform mat4 uProj;
      uniform float uFar, uTanHalf, uAspect, uRadius, uBias, uIntensity, uFrame, uBlend;
      varying vec2 vUv;

      ${VIEW_RECONSTRUCT}

      float hash12(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
      }

      const int SAMPLES = 14;

      void main() {
        vec4 g = texture2D(uGbuf, vUv);
        float vz = g.a * uFar;

        // background: nothing to occlude
        if (g.a <= 0.0001) { gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0); return; }

        vec3 n = normalize(g.rgb * 2.0 - 1.0);
        vec3 p = viewPos(vUv, vz);

        // per-pixel + per-frame rotation of the whole kernel
        float rot = hash12(gl_FragCoord.xy) * 6.2831853 + uFrame * 2.3999632;
        vec3 rv = vec3(cos(rot), sin(rot), 0.0);
        vec3 t = normalize(rv - n * dot(rv, n));
        vec3 b = cross(n, t);

        float occ = 0.0;
        for (int i = 0; i < SAMPLES; i++) {
          float fi = (float(i) + 0.5) / float(SAMPLES);
          float a = fi * float(SAMPLES) * 2.3999632 + rot;
          float rr = sqrt(fi);
          // cosine-ish hemisphere direction, samples packed toward the origin
          vec3 dir = vec3(cos(a) * rr, sin(a) * rr, sqrt(max(0.0, 1.0 - fi)));
          float scale = mix(0.22, 1.0, fi * fi);
          vec3 sp = p + (t * dir.x + b * dir.y + n * dir.z) * uRadius * scale;

          vec4 clip = uProj * vec4(sp, 1.0);
          vec2 suv = clip.xy / clip.w * 0.5 + 0.5;
          if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) continue;

          float sceneA = texture2D(uGbuf, suv).a;
          if (sceneA <= 0.0001) continue;         // sky can't occlude
          float sceneZ = sceneA * uFar;
          float sampleZ = -sp.z;

          // occluded when real geometry sits in front of the sample point
          float range = smoothstep(0.0, 1.0, uRadius / max(0.0001, abs(vz - sceneZ)));
          occ += (sceneZ < sampleZ - uBias ? 1.0 : 0.0) * range;
        }

        float ao = clamp(1.0 - (occ / float(SAMPLES)) * uIntensity, 0.0, 1.0);

        // temporal accumulation, rejected where depth no longer matches
        vec4 prev = texture2D(uPrev, vUv);
        float valid = step(abs(prev.g - vz), max(0.02, vz * 0.012)) * step(0.5, prev.a);
        float k = mix(1.0, uBlend, valid);
        float acc = mix(prev.r, ao, k);

        gl_FragColor = vec4(acc, vz, 0.0, 1.0);
      }
    `,
  })
}

/* -------------------------------------------------------------------------
 * Pass 3 — composite
 * The only pass that touches the screen. It owns the whole display transform:
 * sky, AO, screen-space contour lines (a depth+normal edge detector run on the
 * G-buffer), distance haze, exposure, ACES, split grade, vignette, grain.
 * ---------------------------------------------------------------------- */
export function makeCompositeMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uBeauty: { value: null },
      uGbuf: { value: null },
      uAO: { value: null },
      uTexel: { value: new THREE.Vector2(1 / 1600, 1 / 1000) },
      uFar: { value: 60 },
      uTanHalf: { value: 0.36 },
      uAspect: { value: 1.6 },
      uTime: { value: 0 },
      uMode: { value: 0 },
      uAoStrength: { value: 0.9 },
      uLineStrength: { value: 0.5 },
      uReveal: { value: 0 },
    },
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
    vertexShader: FS_VERT,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform sampler2D uBeauty, uGbuf, uAO;
      uniform vec2 uTexel;
      uniform float uFar, uTanHalf, uAspect, uTime, uMode, uAoStrength, uLineStrength, uReveal;
      varying vec2 vUv;

      ${VIEW_RECONSTRUCT}

      vec3 aces(vec3 x) {
        const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
        return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
      }
      vec3 toSRGB(vec3 c) {
        return mix(c * 12.92, 1.055 * pow(max(c, vec3(1e-5)), vec3(1.0 / 2.4)) - 0.055,
                   step(0.0031308, c));
      }
      float hash12(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
      }

      // the room behind the still life: a soft vertical wash with a warm pool
      vec3 sky(vec2 uv) {
        vec3 top = vec3(0.905, 0.881, 0.836);
        vec3 bottom = vec3(0.760, 0.729, 0.686);
        vec3 c = mix(bottom, top, smoothstep(0.0, 0.95, uv.y));
        float glow = exp(-pow(distance(uv * vec2(uAspect, 1.0),
                                       vec2(0.30 * uAspect, 0.82)) * 1.35, 2.0));
        c += vec3(0.10, 0.088, 0.072) * glow;
        return c;
      }

      // 3x3 box blur of the accumulated AO — cheap, and the buffer is already
      // temporally smooth, so this only takes the last of the sampling grain out
      float aoBlur(vec2 uv) {
        float s = 0.0;
        for (int y = -1; y <= 1; y++) {
          for (int x = -1; x <= 1; x++) {
            s += texture2D(uAO, uv + vec2(float(x), float(y)) * uTexel * 1.4).r;
          }
        }
        return s / 9.0;
      }

      void main() {
        vec4 g = texture2D(uGbuf, vUv);
        float mask = step(0.0001, g.a);
        float vz = g.a * uFar;
        vec3 n = normalize(g.rgb * 2.0 - 1.0);

        vec3 beauty = texture2D(uBeauty, vUv).rgb;
        float ao = mix(1.0, aoBlur(vUv), mask);

        // ---- debug taps ------------------------------------------------
        if (uMode > 1.5 && uMode < 2.5) {          // normals
          vec3 nv = mask > 0.5 ? g.rgb : vec3(0.5);
          gl_FragColor = vec4(toSRGB(nv), 1.0); return;
        }
        if (uMode > 2.5) {                          // accumulated occlusion
          float a = mix(1.0, aoBlur(vUv), mask);
          gl_FragColor = vec4(toSRGB(vec3(a)), 1.0); return;
        }

        // ---- screen-space contour --------------------------------------
        // depth edge, slope-compensated so grazing floors don't outline
        vec2 e = uTexel * 1.0;
        float zl = texture2D(uGbuf, vUv - vec2(e.x, 0.0)).a * uFar;
        float zr = texture2D(uGbuf, vUv + vec2(e.x, 0.0)).a * uFar;
        float zd = texture2D(uGbuf, vUv - vec2(0.0, e.y)).a * uFar;
        float zu = texture2D(uGbuf, vUv + vec2(0.0, e.y)).a * uFar;
        float dz = max(abs(zl + zr - 2.0 * vz), abs(zd + zu - 2.0 * vz));
        float depthEdge = smoothstep(0.006 * vz, 0.05 * vz, dz);

        vec3 nl = texture2D(uGbuf, vUv - vec2(e.x, 0.0)).rgb * 2.0 - 1.0;
        vec3 nr = texture2D(uGbuf, vUv + vec2(e.x, 0.0)).rgb * 2.0 - 1.0;
        vec3 nd = texture2D(uGbuf, vUv - vec2(0.0, e.y)).rgb * 2.0 - 1.0;
        vec3 nu = texture2D(uGbuf, vUv + vec2(0.0, e.y)).rgb * 2.0 - 1.0;
        float normEdge = 1.0 - min(min(dot(n, normalize(nl)), dot(n, normalize(nr))),
                                   min(dot(n, normalize(nd)), dot(n, normalize(nu))));
        normEdge = smoothstep(0.05, 0.55, normEdge);

        // silhouette against the sky counts too
        float bgEdge = 0.0;
        bgEdge = max(bgEdge, abs(step(0.0001, texture2D(uGbuf, vUv + vec2(e.x, 0.0)).a) - mask));
        bgEdge = max(bgEdge, abs(step(0.0001, texture2D(uGbuf, vUv - vec2(e.x, 0.0)).a) - mask));
        bgEdge = max(bgEdge, abs(step(0.0001, texture2D(uGbuf, vUv + vec2(0.0, e.y)).a) - mask));
        bgEdge = max(bgEdge, abs(step(0.0001, texture2D(uGbuf, vUv - vec2(0.0, e.y)).a) - mask));

        float line = clamp(max(max(depthEdge, normEdge * 0.85), bgEdge * 0.9), 0.0, 1.0);
        line *= uLineStrength * (1.0 - smoothstep(9.0, 26.0, vz));   // fade with distance

        // ---- assemble ---------------------------------------------------
        vec3 skyC = sky(vUv);
        vec3 col = mix(skyC, beauty, mask);

        if (uMode < 0.5 || uMode > 1.5) {
          col *= mix(1.0, pow(ao, 1.35), uAoStrength);               // occlusion
          col = mix(col, vec3(0.055, 0.058, 0.070), line * 0.5);     // ink contour
          float fog = 1.0 - exp(-pow(max(0.0, vz - 5.0) * 0.055, 2.0));
          col = mix(col, skyC * 1.02, fog * mask);                   // distance haze
        }

        // ---- display transform -----------------------------------------
        col *= 1.06;                                                  // exposure
        col = aces(col);
        col = (col - 0.5) * 1.045 + 0.5;                              // contrast
        col = mix(col, col * vec3(1.035, 1.005, 0.965), 0.55);        // warm gain
        col += vec3(-0.004, 0.0, 0.010) * (1.0 - col);                // cool lift

        float vig = smoothstep(1.28, 0.34, length((vUv - 0.5) * vec2(1.06, 1.0)) * 1.62);
        col *= mix(0.80, 1.0, vig);

        col += (hash12(gl_FragCoord.xy + uTime) - 0.5) * 0.016;       // grain

        // opening wipe: the piece resolves out of paper, bottom-up
        float rev = smoothstep(0.0, 1.0, clamp(uReveal * 1.35 - vUv.y * 0.35, 0.0, 1.0));
        col = mix(vec3(0.918, 0.898, 0.858), col, rev);

        gl_FragColor = vec4(toSRGB(clamp(col, 0.0, 1.0)), 1.0);
      }
    `,
  })
}
