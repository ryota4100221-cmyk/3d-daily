import * as THREE from 'three'
import { FROXEL, FOG, LIGHT, LAMP } from './palette.js'

/**
 * Day 032 — the froxel volume.
 *
 * Yesterday the medium was computed *per pixel*: march the view ray, forty-eight
 * steps, and throw the result away at the end of the frame. It worked, and the
 * NOTES said what was wrong with it — the answer was never a thing, only ever a
 * picture of a thing. It could not be read twice, it could not be read by
 * anything except the composite, and it cost more every time the window grew.
 *
 * Today the same integral is computed once into a *grid*: 256 x 144 x 64 cells
 * aligned to the view frustum (hence "froxel" — frustum voxel), stored in one
 * atlas of 64 tiles. Two passes build it:
 *
 *   INJECTION   one draw over the whole atlas. Each froxel is asked what it is
 *               made of — density here, can the key see this point, how much
 *               does the lamp give it — and writes (in-scattered radiance per
 *               unit length, extinction per unit length). Cells are independent,
 *               so this is embarrassingly parallel and needs no ordering at all.
 *
 *   INTEGRATION the part that looks serial and is not. Walking a ray front to
 *               back is L_k = L_{k-1} + T_{k-1}·l_k, T_k = T_{k-1}·t_k, which
 *               reads like a loop with a carried dependency. But that operator
 *
 *                   (L_a, T_a) ⊕ (L_b, T_b) = (L_a + T_a·L_b , T_a·T_b)
 *
 *               is *associative* — it is the same monoid as 2x2 upper triangular
 *               matrix multiplication — and an associative operator can be
 *               prefix-scanned. So the integration is six ping-pong passes
 *               (offsets 1, 2, 4, 8, 16, 32), each one full-screen, instead of a
 *               64-step serial chain. log n passes, no layered rendering, no
 *               feedback loop, and every slice of the volume ends up holding the
 *               complete integral from the eye to its own back plane.
 *
 * What comes out is a *resource*: sample it at any (screen uv, depth) and get
 * back everything the air did between the eye and that point. The composite uses
 * it. The glass uses it, at its own depth, which is the thing a screen-space ray
 * march structurally cannot do. And a second light was free.
 */

// ---------------------------------------------------------------------------
// shared GLSL — the grid's own coordinate system
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

const PHASE = /* glsl */ `
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
// pass A — injection
// ---------------------------------------------------------------------------

/**
 * One draw, 2.36 million cells, no ordering.
 *
 * Output is deliberately *not* the integrated result but the two local, length-
 * independent quantities:
 *
 *   rgb : in-scattered radiance per unit of path length
 *   a   : extinction per unit of path length
 *
 * which is what makes the temporal filter legitimate. A froxel's slab thickness
 * changes with the camera; its density does not. Blending rates is blending the
 * same physical quantity; blending integrals would be blending two different
 * ones and calling the average fog.
 *
 * The reprojection here is the part Day 031 had to be clever about. Yesterday
 * the buffer was 2D, so "where was this pixel's fog last frame" had no answer
 * and had to be invented — the scattering centroid, a weighted mean depth used
 * as a stand-in for a distribution. Today every cell *is* a place. It has a
 * world position; the previous view-projection maps it exactly; the trick is not
 * needed, and its absence is the clearest evidence that the third dimension was
 * the thing that was missing.
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

      uLampPos: { value: new THREE.Vector3(...LAMP.pos) },
      uLampCol: { value: new THREE.Color(...LAMP.color) },
      uLampPower: { value: LAMP.power },
      uLampRadius: { value: new THREE.Vector2(...LAMP.radius) },
      uLampG: { value: LAMP.g },
      uLampScatter: { value: LAMP.scatter },

      uDensity: { value: FOG.density },
      uFogH: { value: FOG.height },
      uFogY0: { value: FOG.y0 },
      uFogCenter: { value: new THREE.Vector2(...FOG.center) },
      uFogR: { value: new THREE.Vector2(...FOG.radius) },
      uG: { value: FOG.g },
      uScatter: { value: FOG.scatter },

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

      uniform vec3 uLampPos;
      uniform vec3 uLampCol;
      uniform float uLampPower;
      uniform vec2 uLampRadius;
      uniform float uLampG;
      uniform float uLampScatter;

      uniform float uDensity;
      uniform float uFogH;
      uniform float uFogY0;
      uniform vec2 uFogCenter;
      uniform vec2 uFogR;
      uniform float uG;
      uniform float uScatter;

      uniform float uTime;
      uniform float uJitterZ;
      uniform vec2 uJitterXY;
      uniform float uValid;
      uniform float uFeedback;

      ${VOLUME_GLSL}
      ${ATLAS_DECODE}
      ${RAY}
      ${PHASE}

      float fogNoise(vec3 p) {
        float n1 = texture(uNoise, p * 0.058 + vec3(0.0, uTime * 0.0042, uTime * 0.010)).r;
        float n2 = texture(uNoise, p * 0.180 + vec3(uTime * 0.013, 0.0, uTime * -0.005)).r;
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
        return base * (0.40 + 1.18 * fogNoise(p));
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

        // --- key light ---------------------------------------------------
        vec3 S = uLightCol * (uScatter * sig * lightVis(p) * phaseHG(dot(dirW, uLightDir), uG));

        // --- lamp ---------------------------------------------------------
        // The whole argument for a grid, in five lines: a second light costs one
        // more evaluation per *cell*, not per march step per pixel. Yesterday
        // this would have been another 19 million shadow lookups.
        vec3 toLamp = uLampPos - p;
        float dl = max(length(toLamp), 1e-3);
        float fall = uLampPower / (dl * dl + 0.25);
        fall *= 1.0 - smoothstep(uLampRadius.x, uLampRadius.y, dl);
        S += uLampCol * (uLampScatter * sig * fall * phaseHG(dot(dirW, toLamp / dl), uLampG));

        vec4 cur = vec4(S, sig);

        // --- temporal ------------------------------------------------------
        // No centroid, no stand-in depth, no motion vector. This cell is a place
        // in the room; last frame's camera saw that place from somewhere, and
        // the matrix says exactly where.
        float fb = 0.0;
        vec4 hist = vec4(0.0);
        vec4 pp = uPrevViewProj * vec4(p, 1.0);
        if (pp.w > 1e-4) {
          vec2 puv = pp.xy / pp.w * 0.5 + 0.5;
          float pd = -(uPrevView * vec4(p, 1.0)).z;
          if (puv.x >= 0.0 && puv.x <= 1.0 && puv.y >= 0.0 && puv.y <= 1.0 && pd > uVolNear) {
            hist = sampleMedium(uPrevVol, puv, pd);
            // A slat sliding past changes a cell's radiance without moving
            // anything the depth test can see, so reject on disagreement too —
            // but only barely. Day 031 rejected hard because its reprojection
            // was a guess; this one is a matrix applied to a world position, and
            // most of the frame-to-frame difference here is our own jitter,
            // which is the signal the filter is supposed to be integrating, not
            // an error it should be running away from.
            float lc = dot(cur.rgb, vec3(0.3333));
            float lh = dot(hist.rgb, vec3(0.3333));
            float diff = abs(lc - lh) / (lc + lh + 1e-3);
            fb = uFeedback * uValid * (1.0 - smoothstep(0.60, 1.20, diff));
          }
        }

        outCell = max(mix(cur, hist, fb), vec4(0.0));
      }
    `,
  })
}

// ---------------------------------------------------------------------------
// pass B — integration by parallel prefix scan
// ---------------------------------------------------------------------------

/**
 * Hillis-Steele over the slice axis: out[k] = in[k - offset] ⊕ in[k], with the
 * identity (0, 1) — no light, nothing absorbed — for anything off the front of
 * the volume. Six passes with offsets 1, 2, 4, 8, 16, 32 leave every slice
 * holding the inclusive scan, which is the integral from the eye.
 *
 * The first pass is the only one that differs: its input is the injection
 * volume's (rate, extinction) pair rather than a (radiance, transmittance)
 * element, so it converts on the way in. Analytically, over a slab of length s:
 *
 *     T = exp(-σ·s)          L = S · (1 - T) / σ
 *
 * which is the closed form of the thing Day 031 estimated with a Riemann sum,
 * and it is exact regardless of how thick the slab is. That matters here because
 * the far slices are metres deep.
 *
 * Reads are texelFetch, not texture2D: the atlas is filtered LINEAR for the
 * benefit of everyone downstream, and a scan that sampled it through the filter
 * would be at the mercy of whether a computed uv lands a bit-width to the left
 * of a texel centre.
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
