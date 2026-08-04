import * as THREE from 'three'
import { LIGHT } from './palette.js'

/**
 * Day 036 — the shadow test, promoted from a boolean to a number.
 *
 * Day 031 built this renderer its own light-space depth map, for a reason that
 * had nothing to do with softness: the volume march needed a *linear* distance
 * in metres at points that are not on any surface, and three's shadow map is
 * packed in projection space and handed only to a lit material. For five days
 * that map has answered exactly one question, `step(d - bias, m)`, and the
 * surfaces in the frame never asked it at all — they were shaded by three, off
 * three's own second copy of the same map.
 *
 * Today the surfaces are ours, so there is one map, and the question can change.
 *
 * A lamp is not a point. It subtends a half-angle `θ`, and a blocker `g` metres
 * above a surface therefore throws a penumbra about `θ·g` wide. That single fact
 * is the entire technique, and it takes three steps to use:
 *
 *   1. BLOCKER SEARCH. Look around the point in a disc the size of the widest
 *      penumbra we are willing to draw. Average the distances of the taps that
 *      are in front of us — that average is `d_b`, "how far away is whatever is
 *      blocking me".
 *   2. PENUMBRA WIDTH. `w = θ · (d_r − d_b)`, in world units, which is why it
 *      matters that this map has always been in metres. A projection-space depth
 *      would need an unpacking and a derivative here, and the number it produced
 *      would not be a length anybody could reason about.
 *   3. PCF at that radius. `w` in metres over the orthographic frustum's width
 *      is the radius in uv, directly.
 *
 * If nothing blocks any tap in the search disc, the point is lit and no further
 * work happens — which is most of the screen, and is why this is affordable at
 * all.
 *
 * The taps are a golden-angle spiral rather than a stored Poisson set, because
 * the same source is compiled at three different sample counts and a spiral is
 * the one construction that stays well distributed at every count. It is rotated
 * per pixel and per frame; what is left over is noise, and this renderer has had
 * something that eats noise since Day 030.
 *
 * The three customers, and what each is willing to pay:
 *
 *   surfaces   SH_SEARCH 8, SH_PCF 20. Once per screen pixel, and the gradient
 *              on a floor is the picture, so it is resolved in one frame.
 *   the air    SH_SEARCH 4, SH_PCF 2. Once per froxel — 2.36 million of them —
 *              so the estimate is deliberately terrible and the temporal filter
 *              is left to integrate it. A shaft's edge is soft *over frames*.
 *   the motes  SH_SEARCH 3, SH_PCF 1. A speck is one pixel; it is either in the
 *              beam or it is not, and 7,000 of them average into the same answer.
 *
 * Same model, same map, same numbers — three budgets. That is the argument for
 * having spent Day 031 writing our own map instead of reading three's.
 */

export function shadowUniforms() {
  return {
    uLightDepth: { value: null },
    uLightVP: { value: new THREE.Matrix4() },
    uLightView: { value: new THREE.Matrix4() },
    uLightFar: { value: LIGHT.far },
    uLightBias: { value: LIGHT.bias },
    uLightAngle: { value: LIGHT.angle },
    uLightHalf: { value: LIGHT.halfSize },
    uPenMin: { value: LIGHT.minPen },
    uPenMax: { value: LIGHT.maxPen },
    uPenSearch: { value: LIGHT.search },
    uHard: { value: 0 }, // 1 collapses the source back to a point
  }
}

/**
 * Requires SH_SEARCH and SH_PCF to be #defined, and TEX2D to be the sampling
 * macro of whichever GLSL version the host shader is in.
 */
export const SHADOW_GLSL = /* glsl */ `
  uniform sampler2D uLightDepth;
  uniform mat4 uLightVP;
  uniform mat4 uLightView;
  uniform float uLightFar;
  uniform float uLightBias;
  uniform float uLightAngle;
  uniform float uLightHalf;
  uniform float uPenMin;
  uniform float uPenMax;
  uniform float uPenSearch;
  uniform float uHard;

  // A spiral rather than a table: the same source is compiled at 1, 2, 3, 4, 8
  // and 20 taps, and a stored Poisson disc is only well distributed at the count
  // it was generated for.
  vec2 shSpiral(int i, int n) {
    float f = (float(i) + 0.5) / float(n);
    float a = float(i) * 2.3999632 + 1.0;
    return vec2(cos(a), sin(a)) * sqrt(f);
  }

  vec2 shRot(vec2 v, vec2 r) {
    return vec2(v.x * r.x - v.y * r.y, v.x * r.y + v.y * r.x);
  }

  float shDepth(vec2 uv) {
    return TEX2D(uLightDepth, uv).r * uLightFar;
  }

  /**
   * The receiver's own plane, expressed as "how fast does the light-space depth
   * change per unit of light-space uv". A surface tilted away from the lamp
   * recedes as you walk across it, and a blocker search a metre wide would
   * otherwise report the *floor itself* as its own occluder at every grazing
   * angle. A constant bias cannot fix that: on this floor the depth changes by
   * 60cm over the search disc and the bias is 7.
   *
   * In light-view space the plane through the shaded point satisfies
   * n·dp = 0, so dz = −(n.x·dx + n.y·dy)/n.z, and one orthographic uv is
   * 2·halfSize world units. Clamped, because a surface seen edge-on from the
   * lamp has an infinite slope and no useful shadow either way.
   */
  vec2 shSlope(vec3 nWorld) {
    vec3 nl = mat3(uLightView) * nWorld;
    if (abs(nl.z) < 0.12) return vec2(0.0);
    return clamp((2.0 * uLightHalf) * nl.xy / nl.z, vec2(-45.0), vec2(45.0));
  }

  /**
   * The fraction of the source visible from p.
   *
   * The rotation is an angle in radians and is the caller's business, because the three
   * customers decorrelate differently: a surface wants per-pixel noise, a froxel
   * wants per-frame noise it can accumulate, and a mote wants per-particle noise
   * it can average across seven thousand siblings.
   *
   * The slope argument is the receiver plane above, or vec2(0) for a point in
   * mid-air, which has no plane and needs none.
   */
  float softVisS(vec3 p, float rot, vec2 slope) {
    vec4 lp = uLightVP * vec4(p, 1.0);
    vec2 luv = lp.xy / lp.w * 0.5 + 0.5;
    if (luv.x < 0.0 || luv.x > 1.0 || luv.y < 0.0 || luv.y > 1.0) return 1.0;

    // Linear, in metres, because that is what this map has always stored.
    float d = -(uLightView * vec4(p, 1.0)).z;

    // The orthographic frustum is 2 * halfSize wide and maps to one unit of uv,
    // so a world radius converts to a uv radius by one multiply. This is the
    // step a packed projection-space map cannot take without knowing more than
    // it stores.
    float perWorld = 1.0 / (2.0 * uLightHalf);
    vec2 rr = vec2(cos(rot), sin(rot));

    if (uHard > 0.5) {
      return step(d - uLightBias, shDepth(luv));
    }

    // --- 1. blocker search ---------------------------------------------------
    float sum = 0.0;
    float cnt = 0.0;
    float sr = uPenSearch * perWorld;
    for (int i = 0; i < SH_SEARCH; i++) {
      vec2 o = shRot(shSpiral(i, SH_SEARCH), rr) * sr;
      float ref = d + dot(slope, o) - uLightBias;
      float m = shDepth(luv + o);
      if (m < ref) { sum += m; cnt += 1.0; }
    }
    // Nothing within a full penumbra's reach is in front of this point, so no
    // amount of sampling will darken it. Most of a lit frame exits here.
    if (cnt < 0.5) return 1.0;

    // --- 2. penumbra width ---------------------------------------------------
    // theta * gap, straight out of similar triangles. The clamp at the top is
    // the budget speaking: past uPenMax the taps are further apart than the
    // gradient is wide, and more of them would only buy a smoother lie.
    float db = sum / cnt;
    float w = clamp(uLightAngle * max(d - db, 0.0), uPenMin, uPenMax);
    float rad = w * perWorld;

    // --- 3. PCF at that radius ----------------------------------------------
    float vis = 0.0;
    for (int i = 0; i < SH_PCF; i++) {
      vec2 o = shRot(shSpiral(i, SH_PCF), rr) * rad;
      vis += step(d + dot(slope, o) - uLightBias, shDepth(luv + o));
    }
    return vis / float(SH_PCF);
  }

  float softVis(vec3 p, float rot) {
    return softVisS(p, rot, vec2(0.0));
  }
`

/**
 * Interleaved gradient noise (Jimenez). One angle per pixel that decorrelates
 * neighbours completely while staying stable under a sub-pixel jitter, which is
 * the property a plain hash does not have.
 */
export const IGN_GLSL = /* glsl */ `
  float ign(vec2 px) {
    return fract(52.9829189 * fract(dot(px, vec2(0.06711056, 0.00583715))));
  }
`
