import * as THREE from 'three'
import { FROXEL, FOG, LIGHT, MULTI } from './palette.js'

/**
 * Day 033 — the froxel volume, scattering more than once.
 *
 * Day 032 built the grid: 256 x 144 x 64 cells aligned to the view frustum,
 * filled in one draw, integrated by six prefix-scan passes, and readable at any
 * (screen uv, depth) by anyone who wants it. The NOTES that night listed what it
 * still could not do, and the first item was multiple scattering.
 *
 * Here is the shape of that problem. Injection asks each cell one question —
 * "how much light does the *source* put into this cell" — and the answer only
 * ever travels source -> cell -> eye. Light that scatters off a mote and then
 * hits another mote does not exist in that model. Which is why single scattering
 * always looks like this: a shaft with a hard shoulder, and air beside the shaft
 * that is exactly as black as air in an unlit room, because nothing in the
 * equations carries energy sideways.
 *
 * The real answer is a global solve — every cell's radiance depends on every
 * other cell's. But notice the shape of it:
 *
 *     L(x) = S(x) + albedo · <L>(neighbourhood of x)
 *
 * which is a Jacobi iteration. Run it once and you have two bounces. Run it n
 * times and you have n + 1. And a froxel grid that already keeps its previous
 * frame around — for a temporal filter that exists for entirely unrelated
 * reasons — can run *exactly one iteration per frame* and let the frames do the
 * rest. After a second of standing still the grid holds the sum of the whole
 * geometric series.
 *
 * So the day's technique is not a new pass. It is four extra taps inside a pass
 * that already existed, pointed at a buffer that was already there:
 *
 *   INJECTION   direct source, as before, plus a gather from four neighbours in
 *               the *previous* volume — a tetrahedron in world space, rotated by
 *               the golden angle every frame so that over time the four taps
 *               sweep the whole sphere. Added back with no phase function at
 *               all, because light that has bounced twice has forgotten which
 *               way it came from, and that is the physical content of the word
 *               "diffuse".
 *
 *   INTEGRATION untouched from Day 032. The scan does not care where the
 *               radiance in a cell came from.
 */

// ---------------------------------------------------------------------------
// shared GLSL — the grid's own coordinate system (Day 032, unchanged)
// ---------------------------------------------------------------------------

/**
 * Slices are distributed exponentially: z(s) = near · (far/near)^(s/N). Linear
 * slices would spend most of the volume on air twenty metres away and give the
 * first two metres — the part filling half the screen — three cells.
 *
 * Slice k stores the integral from the eye to the *back* of slab k, i.e. to
 * z(k+1). So the texel index wanted for a surface at depth d is
 * sliceOfDepth(d) - 1, and the sampler's continuous coordinate is that plus a
 * half, over N.
 */
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
// pass A — injection, now with a diffusion term
// ---------------------------------------------------------------------------

/**
 * One draw, 2.36 million cells, no ordering.
 *
 * Output is still the two local, length-independent quantities:
 *
 *   rgb : in-scattered radiance per unit of path length
 *   a   : extinction per unit of path length
 *
 * and it matters more today than it did yesterday, because those channels are
 * now read *by the shader that writes them*, one frame later. A rate is a
 * property of the medium at a place. An integral is a property of a camera. Only
 * the first of the two can be handed to a neighbour and still mean anything.
 */
export function makeInjectionMaterial() {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {
      ...volumeUniforms(),
      uNoise: { value: null },
      uLightDepth: { value: null },
      uPrevVol: { value: null },

      uCamWorld: { value: new THREE.Matrix4() },
      uPrevViewProj: { value: new THREE.Matrix4() },
      uPrevView: { value: new THREE.Matrix4() },
      uLightVP: { value: new THREE.Matrix4() },
      uLightView: { value: new THREE.Matrix4() },

      uTanHalf: { value: 0.3 },
      uAspect: { value: 1.6 },

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

      // --- the diffusion ---
      uMulti: { value: 1 }, // 0 switches the second bounce off entirely
      uMsAlbedo: { value: MULTI.albedo },
      uMsRadius: { value: MULTI.radius },
      uMsFloor: { value: MULTI.sigmaFloor },
      uMsClamp: { value: MULTI.clamp },
      uMsBasis: { value: new THREE.Matrix3() },

      uTime: { value: 0 },
      uJitterZ: { value: 0 },
      uJitterXY: { value: new THREE.Vector2() },
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

      layout(location = 0) out vec4 outCell;

      varying vec2 vUv;

      uniform sampler3D uNoise;
      uniform sampler2D uLightDepth;
      uniform sampler2D uPrevVol;

      uniform mat4 uCamWorld;
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

      uniform float uMulti;
      uniform float uMsAlbedo;
      uniform float uMsRadius;
      uniform float uMsFloor;
      uniform float uMsClamp;
      uniform mat3 uMsBasis;

      uniform float uTime;
      uniform float uJitterZ;
      uniform vec2 uJitterXY;
      uniform float uValid;
      uniform float uFeedback;

      ${VOLUME_GLSL}
      ${ATLAS_DECODE}
      ${RAY}
      ${PHASE_GLSL}

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

      // in world units, not in the [0,1] the map is stored in: a bias expressed
      // as a fraction of a 52-unit range is a bias nobody can reason about
      float lightVis(vec3 p) {
        vec4 lp = uLightVP * vec4(p, 1.0);
        vec2 luv = lp.xy / lp.w * 0.5 + 0.5;
        if (luv.x < 0.0 || luv.x > 1.0 || luv.y < 0.0 || luv.y > 1.0) return 1.0;
        float d = -(uLightView * vec4(p, 1.0)).z;
        float m = texture(uLightDepth, luv).r * uLightFar;
        return step(d - uLightBias, m);
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

      // The four vertices of a regular tetrahedron: the smallest set of
      // directions with no preferred axis. Rotated by uMsBasis, which advances
      // by the golden angle every frame, so four taps integrate the whole sphere
      // over roughly a dozen frames instead of baking a fixed cross into the air.
      const vec3 TETRA[4] = vec3[4](
        vec3( 0.5773503,  0.5773503,  0.5773503),
        vec3( 0.5773503, -0.5773503, -0.5773503),
        vec3(-0.5773503,  0.5773503, -0.5773503),
        vec3(-0.5773503, -0.5773503,  0.5773503)
      );

      /**
       * One Jacobi iteration of the diffusion, gathered from the previous frame.
       *
       * A cell stores a *rate*: radiance scattered toward the eye per unit
       * length, which is sigma_s times a radiance. To hand a neighbour something
       * it can use, that has to be divided back out — rate / sigma is an
       * estimate of the radiance field at the neighbour, independent of how
       * thick the air happens to be there. Multiplying by this cell's own sigma
       * on the way back in is what makes dense air glow and thin air not.
       *
       * No phase function. A photon on its second bounce has forgotten the
       * direction it arrived from, and pretending otherwise would put a
       * forward lobe on light that has none.
       */
      vec3 gather(vec3 p) {
        vec3 sum = vec3(0.0);
        float n = 0.0;
        for (int i = 0; i < 4; i++) {
          vec3 q = p + (uMsBasis * TETRA[i]) * uMsRadius;
          vec4 nb;
          if (!prevAt(q, nb)) continue;
          // rate -> radiance, floored and capped: both ends of this division are
          // small numbers and neither is trustworthy on its own
          vec3 L = nb.rgb / max(nb.a, uMsFloor);
          sum += min(L, vec3(uMsClamp));
          n += 1.0;
        }
        return n > 0.0 ? sum / n : vec3(0.0);
      }

      void main() {
        vec2 inTile, uv;
        float k;
        decodeAtlas(inTile, uv, k);

        // The sample point sits in the middle of the cell, offset by a per-frame
        // jitter in all three axes. The cell's *edges* stay put — the
        // integration depends on them, and so does where this value gets stored
        // — so the jitter only moves where inside its own cell the medium is
        // asked. Together with the temporal filter, each cell converges to the
        // average over its own footprint instead of one sample from the middle
        // of it, which is the whole difference between a shaft edge that steps
        // across the grid and one that ramps across it.
        float d = depthOfSlice(k + 0.5 + uJitterZ);

        vec3 rv = viewRay(uv + uJitterXY / uFroxel.xy);
        vec3 p = (uCamWorld * vec4(rv * d, 1.0)).xyz;
        vec3 O = uCamWorld[3].xyz;
        vec3 dirW = normalize(p - O);

        float sig = density(p);

        // --- first bounce -------------------------------------------------
        vec3 S = uLightCol * (uScatter * sig * lightVis(p) * phaseHG(dot(dirW, uLightDir), uG));

        // --- every bounce after it ----------------------------------------
        // Four taps. The entire difference between a shaft with a hard shoulder
        // and a shaft that lights the room it is standing in.
        if (uMulti > 0.5 && uValid > 0.5 && sig > 1e-5) {
          S += uMsAlbedo * sig * gather(p);
        }

        vec4 cur = vec4(S, sig);

        // --- temporal ------------------------------------------------------
        // Day 032's filter, not one line changed, and now doing a second job.
        // Its fixed point is the state where cur and hist agree, and cur is
        // "direct + albedo * neighbours(hist)" — so the value it settles on is
        // exactly the solution of the diffusion, whatever the feedback constant
        // happens to be. The constant only sets how fast it gets there.
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
 *
 * It needed no changes today, and that is the interesting part: the scan is a
 * statement about an operator, not about physics. Radiance that arrived by two
 * bounces integrates along a ray exactly like radiance that arrived by one.
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
