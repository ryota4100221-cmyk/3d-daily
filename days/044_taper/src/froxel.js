import * as THREE from 'three'
import { FROXEL, FOG, MULTI, RETURN } from './palette.js'
import { SHADOW_GLSL, IGN_GLSL, shadowUniforms } from './shadow.js'
import { MAX_PANES } from './ltc.js'

/**
 * The four vertices of a regular tetrahedron: the smallest set of directions
 * with no preferred axis. Two different gathers want the same one — the
 * diffusion between froxels, and the hemisphere a surface asks the air about.
 * Both spin it by a fresh rotation every frame and let the temporal filter do
 * the integrating.
 */
export const TETRA = [
  [0.5773503, 0.5773503, 0.5773503],
  [0.5773503, -0.5773503, -0.5773503],
  [-0.5773503, 0.5773503, -0.5773503],
  [-0.5773503, -0.5773503, 0.5773503],
]

export const tetraArrayGLSL = () =>
  `const vec3 TETRA[4] = vec3[4](\n  ${TETRA.map((d) => `vec3(${d.join(', ')})`).join(
    ',\n  '
  )}\n);`

/**
 * Day 037 — the froxel volume, and a pass that did not have to be edited.
 *
 * The grid does not change today, and neither does a line of this file's
 * lighting. Injection still writes a rate and an extinction per cell, the scan
 * still integrates them along the eye ray, the diffusion (Day 033) and the
 * return path (Day 035) still run inside the same one-Jacobi-iteration-per-frame
 * the temporal filter has been accumulating for four days.
 *
 * What changed is underneath `softVis(p, rot)`. Yesterday that call started
 * answering with a fraction instead of a yes; this morning the disc it samples
 * became an ellipse. This pass was never told either time. It asks "how much of
 * the lamp can this cell see", and the lamp's description lives in one file, so
 * the shafts acquire the opening's anisotropy the same way the floor does.
 *
 * That matters for the composition and not just for the tidiness. The aperture's
 * slots run across the source's *short* axis, so the shafts keep the crisp edges
 * Day 036 fought for while everything standing on the ground softens along the
 * long one. A slot window does exactly this in a real room, and it is the reason
 * the choice of `LIGHT.axis` is a compositional decision rather than a detail.
 *
 * The prices are unchanged: 4 search taps and 2 PCF taps here, per cell, 2.36
 * million times a frame — an estimate so coarse that one frame of it is visibly
 * speckled, handed to a filter that has been integrating four-tap estimates
 * since Day 033. The shaft's edge is soft *over frames*.
 */

// ---------------------------------------------------------------------------
// shared GLSL — the grid's own coordinate system (Day 032, unchanged)
// ---------------------------------------------------------------------------

export const VOLUME_GLSL = /* glsl */ `
  uniform vec3 uFroxel;   // cells: x, y, z
  uniform vec2 uTiles;    // atlas tiles: across, down
  uniform float uVolNear;
  uniform float uVolFar;

  float logRange() { return log(uVolFar / uVolNear); }

  // continuous slice index of a linear view depth, and its inverse
  float sliceOfDepth(float d) {
    return uFroxel.z * log(max(d, uVolNear) / uVolNear) / logRange();
  }
  float depthOfSlice(float s) {
    return uVolNear * exp(logRange() * s / uFroxel.z);
  }

  // where slice k lives in the atlas
  vec2 tileOrigin(float k) {
    return vec2(mod(k, uTiles.x), floor(k / uTiles.x));
  }
  vec2 tileUV(vec2 uv, float k) {
    return (tileOrigin(k) + uv) / uTiles;
  }

  // Trilinear by hand: the hardware does the bilinear inside a tile, we do the
  // lerp between tiles. The clamp is not optional — a tile's edge texel is
  // adjacent, in the atlas, to a completely different part of the room, and a
  // bilinear tap that reaches half a texel too far pulls that room in.
  vec4 fetchFroxel(sampler2D atlas, vec2 uv, float sIndex) {
    float s = clamp(sIndex, 0.0, uFroxel.z - 1.0);
    float k0 = floor(s);
    float k1 = min(k0 + 1.0, uFroxel.z - 1.0);
    vec2 h = 0.5 / uFroxel.xy;
    vec2 c = clamp(uv, h, 1.0 - h);
    return mix(
      TEX2D(atlas, tileUV(c, k0)),
      TEX2D(atlas, tileUV(c, k1)),
      s - k0
    );
  }

  // The two volumes index differently, and getting this wrong is a half-slice
  // of fog nobody would ever find by looking.
  //   injection : texel k was sampled at the *centre* of slab k, z(k + 0.5)
  //   scan      : texel k holds the integral to the *back* of slab k, z(k + 1)
  vec4 sampleMedium(sampler2D atlas, vec2 uv, float depth) {
    return fetchFroxel(atlas, uv, sliceOfDepth(depth) - 0.5);
  }
  vec4 sampleScatter(sampler2D atlas, vec2 uv, float depth) {
    return fetchFroxel(atlas, uv, sliceOfDepth(depth) - 1.0);
  }
`

// The pixel -> (cell x, cell y, slice) decode, used by both volume passes.
const ATLAS_DECODE = /* glsl */ `
  // gl_FragCoord is at a pixel centre, so inTile is (i + 0.5) and inUv lands
  // exactly on the texel centre the sampler above will read back.
  void decodeAtlas(out vec2 inTile, out vec2 inUv, out float k) {
    vec2 tile = floor(gl_FragCoord.xy / uFroxel.xy);
    k = tile.y * uTiles.x + tile.x;
    inTile = gl_FragCoord.xy - tile * uFroxel.xy;
    inUv = inTile / uFroxel.xy;
  }
`

const RAY = /* glsl */ `
  uniform float uTanHalf;
  uniform float uAspect;

  // view-space direction with z = -1, so direction * linearDepth is the position
  vec3 viewRay(vec2 uv) {
    return vec3(
      (uv.x * 2.0 - 1.0) * uTanHalf * uAspect,
      (uv.y * 2.0 - 1.0) * uTanHalf,
      -1.0
    );
  }
`

export const PHASE_GLSL = /* glsl */ `
  // Henyey-Greenstein without its 1/4pi: that constant, the light's radiance and
  // the medium's albedo all collapse into one scatter number that can be dialled.
  float phaseHG(float c, float g) {
    float g2 = g * g;
    return (1.0 - g2) / pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5);
  }
`

function volumeUniforms() {
  return {
    uFroxel: { value: new THREE.Vector3(FROXEL.x, FROXEL.y, FROXEL.z) },
    uTiles: { value: new THREE.Vector2(FROXEL.tx, FROXEL.ty) },
    uVolNear: { value: FROXEL.near },
    uVolFar: { value: FROXEL.far },
  }
}

/** The uniforms every consumer of the finished volume needs. */
export function froxelReadUniforms() {
  return { ...volumeUniforms(), uVol: { value: null } }
}

// ---------------------------------------------------------------------------
// pass A — injection: the lamp, the neighbours, and the room
// ---------------------------------------------------------------------------

export function makeInjectionMaterial() {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    // Four and two. The composite gets eight and twenty for the same function;
    // this pass runs it 2.36 million times a frame and has a temporal filter
    // standing behind it.
    defines: { SH_SEARCH: 4, SH_PCF: 2, LTC_PANES: MAX_PANES },
    uniforms: {
      ...volumeUniforms(),
      ...shadowUniforms(),
      uNoise: { value: null },
      uPrevVol: { value: null },
      // --- the return path (Day 035) ---
      uRadio: { value: null }, // composite attachment 1, one frame old
      uGbuf: { value: null }, // this frame's normal + linear depth

      uCamWorld: { value: new THREE.Matrix4() },
      uPrevViewProj: { value: new THREE.Matrix4() },
      uPrevView: { value: new THREE.Matrix4() },
      uView: { value: new THREE.Matrix4() },
      uCurVPJ: { value: new THREE.Matrix4() }, // jittered — matches the G-buffer

      uTanHalf: { value: 0.3 },
      uAspect: { value: 1.6 },
      uFar: { value: 80 },

      uLightDir: { value: new THREE.Vector3(0, 1, 0) },
      uLightCol: { value: new THREE.Color(1, 1, 1) },

      uDensity: { value: FOG.density },
      uFogH: { value: FOG.height },
      uFogY0: { value: FOG.y0 },
      uFogCenter: { value: new THREE.Vector2(...FOG.center) },
      uFogR: { value: new THREE.Vector2(...FOG.radius) },
      uG: { value: FOG.g },
      uScatter: { value: FOG.scatter },

      // --- the diffusion (Day 033) ---
      uMulti: { value: 1 },
      uMsAlbedo: { value: new THREE.Color(...MULTI.albedo) },
      uMsRadius: { value: MULTI.radius },
      uMsFloor: { value: MULTI.sigmaFloor },
      uMsClamp: { value: MULTI.clamp },
      uMsBasis: { value: new THREE.Matrix3() },

      // --- the return (Day 035) ---
      uRetGain: { value: RETURN.gain },
      uRetRange: { value: RETURN.range },
      uRetR0: { value: RETURN.r0 },
      uRetSpread: { value: RETURN.spread },
      uRetG: { value: RETURN.g },
      uRetClamp: { value: RETURN.clamp },
      uRetRot: { value: new THREE.Vector2(1, 0) },

      uTime: { value: 0 },
      uJitterZ: { value: 0 },
      uJitterXY: { value: new THREE.Vector2() },
      uJitUV: { value: new THREE.Vector2() },
      uSpin: { value: 0 }, // per-frame angle for the shadow spiral
      uValid: { value: 0 },
      uFeedback: { value: 0.94 },
    },
    depthTest: false,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      precision highp sampler3D;
      #define TEX2D texture
      // GLSL ES 3.00: an explicit level. The glass pyramid is only ever read
      // at a level somebody computed — never at whatever the derivatives say.
      #define TEXLOD(s, uv, l) textureLod(s, uv, l)

      layout(location = 0) out vec4 outCell;

      varying vec2 vUv;

      uniform sampler3D uNoise;
      uniform sampler2D uPrevVol;
      uniform sampler2D uRadio;
      uniform sampler2D uGbuf;

      uniform mat4 uCamWorld;
      uniform mat4 uPrevViewProj;
      uniform mat4 uPrevView;
      uniform mat4 uView;
      uniform mat4 uCurVPJ;

      uniform float uFar;

      uniform vec3 uLightDir;
      uniform vec3 uLightCol;

      uniform float uDensity;
      uniform float uFogH;
      uniform float uFogY0;
      uniform vec2 uFogCenter;
      uniform vec2 uFogR;
      uniform float uG;
      uniform float uScatter;

      uniform float uMulti;
      uniform vec3 uMsAlbedo;
      uniform float uMsRadius;
      uniform float uMsFloor;
      uniform float uMsClamp;
      uniform mat3 uMsBasis;

      uniform float uRetGain;
      uniform float uRetRange;
      uniform float uRetR0;
      uniform float uRetSpread;
      uniform float uRetG;
      uniform float uRetClamp;
      uniform vec2 uRetRot;

      uniform float uTime;
      uniform float uJitterZ;
      uniform vec2 uJitterXY;
      uniform vec2 uJitUV;
      uniform float uSpin;
      uniform float uValid;
      uniform float uFeedback;

      ${VOLUME_GLSL}
      ${ATLAS_DECODE}
      ${RAY}
      ${PHASE_GLSL}
      ${IGN_GLSL}
      ${SHADOW_GLSL}

      float fogNoise(vec3 p) {
        float n1 = texture(uNoise, p * 0.052 + vec3(0.0, uTime * 0.0038, uTime * 0.009)).r;
        float n2 = texture(uNoise, p * 0.163 + vec3(uTime * 0.012, 0.0, uTime * -0.005)).r;
        return n1 * 0.68 + n2 * 0.32;
      }

      float density(vec3 p) {
        float h = exp(-max(p.y - uFogY0, 0.0) / uFogH);
        float r = length(p.xz - uFogCenter);
        // the mist has to end well inside the light-space depth map, or that
        // map's own border shows up in the air as a straight line of "lit"
        float edge = 1.0 - smoothstep(uFogR.x, uFogR.y, r);
        float base = uDensity * h * edge;
        if (base < 1e-5) return 0.0;
        return base * (0.42 + 1.14 * fogNoise(p));
      }

      // Look a world position up in the previous frame's volume. Everything the
      // temporal filter and the diffusion both need, in one place: whether the
      // point was on screen at all, and what was there if it was.
      bool prevAt(vec3 p, out vec4 cell) {
        cell = vec4(0.0);
        vec4 pp = uPrevViewProj * vec4(p, 1.0);
        if (pp.w <= 1e-4) return false;
        vec2 puv = pp.xy / pp.w * 0.5 + 0.5;
        if (puv.x < 0.0 || puv.x > 1.0 || puv.y < 0.0 || puv.y > 1.0) return false;
        float pd = -(uPrevView * vec4(p, 1.0)).z;
        if (pd <= uVolNear || pd >= uVolFar) return false;
        cell = sampleMedium(uPrevVol, puv, pd);
        return true;
      }

      ${tetraArrayGLSL()}

      /**
       * One Jacobi iteration of the air-to-air diffusion, gathered from the
       * previous frame (Day 033, unchanged).
       */
      vec3 gather(vec3 p) {
        vec3 sum = vec3(0.0);
        float n = 0.0;
        for (int i = 0; i < 4; i++) {
          vec3 q = p + (uMsBasis * TETRA[i]) * uMsRadius;
          vec4 nb;
          if (!prevAt(q, nb)) continue;
          vec3 L = nb.rgb / max(nb.a, uMsFloor);
          sum += min(L, vec3(uMsClamp));
          n += 1.0;
        }
        return n > 0.0 ? sum / n : vec3(0.0);
      }

      // The G-buffer was rendered through the *jittered* projection, so a uv
      // that indexes it has to be un-jittered by the same amount before the ray
      // through it can be built.
      vec3 worldFromGbuf(vec2 uv, float d) {
        vec2 c = uv - uJitUV;
        vec3 rv = vec3(
          (c.x * 2.0 - 1.0) * uTanHalf * uAspect,
          (c.y * 2.0 - 1.0) * uTanHalf,
          -1.0
        );
        return (uCamWorld * vec4(rv * d, 1.0)).xyz;
      }

      /**
       * What the room is putting into this cell (Day 035, unchanged). Seven
       * screen-space taps in two rings; each is a patch of surface whose world
       * position comes from the G-buffer's depth, whose orientation comes from
       * its normal, and whose outgoing radiance comes from the composite's
       * radiosity attachment.
       */
      vec3 fromRoom(vec3 p, vec3 dirW) {
        vec4 cp = uCurVPJ * vec4(p, 1.0);
        if (cp.w <= 1e-4) return vec3(0.0);
        vec2 uv = cp.xy / cp.w * 0.5 + 0.5;
        float pd = -(uView * vec4(p, 1.0)).z;
        if (pd <= 0.05) return vec3(0.0);

        // a world radius at this depth, expressed in uv
        vec2 rad = vec2(
          uRetSpread / (2.0 * uTanHalf * uAspect * pd),
          uRetSpread / (2.0 * uTanHalf * pd)
        );

        mat3 camRot = mat3(uCamWorld[0].xyz, uCamWorld[1].xyz, uCamWorld[2].xyz);

        vec3 E = vec3(0.0);
        float w = 0.0;

        for (int i = 0; i < 7; i++) {
          vec2 suv = uv;
          if (i > 0) {
            bool outer = i > 3;
            float a = float(outer ? i - 4 : i - 1) * 2.0943951 + (outer ? 1.0471976 : 0.0);
            vec2 d0 = vec2(cos(a), sin(a)) * (outer ? 1.0 : 0.34);
            suv += vec2(
              d0.x * uRetRot.x - d0.y * uRetRot.y,
              d0.x * uRetRot.y + d0.y * uRetRot.x
            ) * rad;
          }
          if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) continue;

          vec4 g = texture(uGbuf, suv);
          if (g.a <= 1e-5) continue; // background: no surface here at all

          vec3 sp = worldFromGbuf(suv, g.a * uFar);
          vec3 v = sp - p;
          float dist = length(v);
          if (dist < 1e-3 || dist > uRetRange) continue;
          vec3 vd = v / dist;

          // the patch has to be facing the cell
          float c = dot(normalize(camRot * g.rgb), -vd);
          if (c <= 0.0) continue;

          vec3 B = min(texture(uRadio, suv).rgb, vec3(uRetClamp));

          float fall = 1.0 / (1.0 + (dist * dist) / (uRetR0 * uRetR0));
          fall *= 1.0 - smoothstep(uRetRange * 0.66, uRetRange, dist);

          E += B * (c * fall * phaseHG(dot(dirW, vd), uRetG));
          w += 1.0;
        }

        return w > 0.0 ? E / w : vec3(0.0);
      }

      void main() {
        vec2 inTile, uv;
        float k;
        decodeAtlas(inTile, uv, k);

        // The sample point sits in the middle of the cell, offset by a per-frame
        // jitter in all three axes. The cell's *edges* stay put.
        float d = depthOfSlice(k + 0.5 + uJitterZ);

        vec3 rv = viewRay(uv + uJitterXY / uFroxel.xy);
        vec3 p = (uCamWorld * vec4(rv * d, 1.0)).xyz;
        vec3 O = uCamWorld[3].xyz;
        vec3 dirW = normalize(p - O);

        float sig = density(p);

        // --- first bounce: straight from the lamp --------------------------
        // Four search taps and two PCF taps. In one frame this is speckle; the
        // filter below has been turning four-tap estimates into fields since
        // Day 033, and the shaft edge it produces is the same width the surfaces
        // get from twenty taps, arrived at over eight frames instead of one.
        float rot = (ign(gl_FragCoord.xy) + uSpin) * 6.2831853;
        // Day 040: three numbers where there was one. softVisTint returns the
        // mean radiance of the visible part of the opening times the fraction
        // visible, which is exactly the integral a froxel needs — the phase
        // function is all but constant across thirteen degrees, so it comes out
        // of the integral and the rest is a colour. Day 039's NOTES expected to
        // pay for this with a spherical-harmonic projection per cell; it costs
        // two adds per tap and no extra texture read at all.
        vec3 S = uLightCol * (uScatter * sig * phaseHG(dot(dirW, uLightDir), uG)) * softVisTint(p, rot);

        if (sig > 1e-5 && uValid > 0.5) {
          // --- every bounce the air makes on its own (Day 033) -------------
          if (uMulti > 0.5) {
            S += uMsAlbedo * sig * gather(p);
          }
          // --- and the light coming back off the room (Day 035) ------------
          if (uRetGain > 0.0) {
            S += (uRetGain * sig) * fromRoom(p, dirW);
          }
        }

        vec4 cur = vec4(S, sig);

        // --- temporal ------------------------------------------------------
        // Day 032's filter, still not one line changed, and now doing a fourth
        // job: the shadow estimate above is deliberately under-sampled and this
        // is what pays for it.
        float fb = 0.0;
        vec4 hist;
        if (prevAt(p, hist)) {
          float lc = dot(cur.rgb, vec3(0.3333));
          float lh = dot(hist.rgb, vec3(0.3333));
          float diff = abs(lc - lh) / (lc + lh + 1e-3);
          fb = uFeedback * uValid * (1.0 - smoothstep(0.60, 1.20, diff));
        }

        outCell = max(mix(cur, hist, fb), vec4(0.0));
      }
    `,
  })
}

// ---------------------------------------------------------------------------
// pass B — integration by parallel prefix scan (Day 032, unchanged)
// ---------------------------------------------------------------------------

/**
 * Hillis-Steele over the slice axis: out[k] = in[k - offset] ⊕ in[k], with the
 * identity (0, 1) — no light, nothing absorbed — for anything off the front of
 * the volume. Six passes with offsets 1, 2, 4, 8, 16, 32 leave every slice
 * holding the inclusive scan, which is the integral from the eye.
 */
export function makeScanMaterial({ first = false } = {}) {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    defines: first ? { FIRST: '' } : {},
    uniforms: {
      ...volumeUniforms(),
      uSrc: { value: null },
      uOffset: { value: 1 },
      uTanHalf: { value: 0.3 },
      uAspect: { value: 1.6 },
    },
    depthTest: false,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      #define TEX2D texture
      // GLSL ES 3.00: an explicit level. The glass pyramid is only ever read
      // at a level somebody computed — never at whatever the derivatives say.
      #define TEXLOD(s, uv, l) textureLod(s, uv, l)

      layout(location = 0) out vec4 outCell;

      varying vec2 vUv;

      uniform sampler2D uSrc;
      uniform float uOffset;

      ${VOLUME_GLSL}
      ${ATLAS_DECODE}
      ${RAY}

      vec4 elementAt(ivec2 px, float k, float rayLen) {
        vec4 s = texelFetch(uSrc, px, 0);
        #ifdef FIRST
          // the slab's own length, along the ray rather than along view z
          float ds = (depthOfSlice(k + 1.0) - depthOfSlice(k)) * rayLen;
          float sig = max(s.a, 0.0);
          float T = exp(-sig * ds);
          vec3 L = sig > 1e-6 ? s.rgb * ((1.0 - T) / sig) : s.rgb * ds;
          return vec4(L, T);
        #else
          return s;
        #endif
      }

      void main() {
        vec2 inTile, uv;
        float k;
        decodeAtlas(inTile, uv, k);

        float rayLen = length(viewRay(uv));

        vec4 b = elementAt(ivec2(gl_FragCoord.xy), k, rayLen);

        // identity of the monoid: no radiance gathered, nothing absorbed
        vec4 a = vec4(0.0, 0.0, 0.0, 1.0);
        float kp = k - uOffset;
        if (kp >= 0.0) {
          a = elementAt(ivec2(tileOrigin(kp) * uFroxel.xy + inTile), kp, rayLen);
        }

        // (L_a, T_a) (+) (L_b, T_b) = (L_a + T_a * L_b, T_a * T_b)
        outCell = vec4(a.rgb + a.a * b.rgb, a.a * b.a);
      }
    `,
  })
}
