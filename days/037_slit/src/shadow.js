import * as THREE from 'three'
import { LIGHT } from './palette.js'

/**
 * Day 037 — the shadow test, given a shape.
 *
 * Day 031 built this renderer its own light-space depth map, in *metres*,
 * because the volume march needed a linear distance at points that are not on
 * any surface. Day 036 turned the question that map answers from `step()` into a
 * fraction: search for a blocker, measure the gap `g`, and the source's own
 * half-angle `theta` gives the penumbra width `theta * g`. Both of those are
 * unchanged today.
 *
 * What changes is that `theta` is not a number. It is two numbers.
 *
 * A source subtends an ellipse — a slot window, a strip light, a doorway seen
 * off-square. Its penumbra is that ellipse scaled by the gap and laid on the
 * floor, so the blocker search and the PCF have to be elliptical too, in the
 * source's own frame:
 *
 *   1. BLOCKER SEARCH over an ellipse `search` wide, rotated so its long axis
 *      lies along the source's. The rotation happens *after* the scaling, and
 *      the per-pixel decorrelation happens *before* it — rotate the unit disc,
 *      then squash it, then turn it into the light's frame. Do those in the
 *      wrong order and the noise pattern acquires the source's aspect ratio
 *      while the kernel does not.
 *   2. PENUMBRA WIDTH `w = angles * (d - d_b)`, now a vec2, still in metres,
 *      still because this map has been in metres for six days.
 *   3. PCF over the ellipse of that size.
 *
 * The consequence in the picture is the day's whole argument: **the softness of
 * an edge now depends on which way the thing casting it is turned.** A blade
 * broadside to the slot's long axis dissolves; the same blade, same height, same
 * gap, rotated ninety degrees, stays a line. Yesterday's circular source could
 * not say that, because a circle has nothing to be turned relative to.
 *
 * Two comparison modes are wired to keys, because the claim is only worth making
 * if it can be removed:
 *
 *   uIso   collapses the ellipse to a disc of the same solid angle
 *          (sqrt(theta_a * theta_b)). Day 036's lamp, exactly.
 *   uHard  collapses the source to a point. Day 031's lamp, exactly.
 *
 * And the three customers still pay different prices for the same function:
 *
 *   surfaces   SH_SEARCH 8, SH_PCF 20. Once per screen pixel.
 *   the air    SH_SEARCH 4, SH_PCF 2. Once per froxel — 2.36 million of them.
 *   the motes  SH_SEARCH 3, SH_PCF 1. One tap each, 4,500 of them, averaged by
 *              being a field rather than by being sampled.
 */

export function shadowUniforms() {
  return {
    uLightDepth: { value: null },
    uLightVP: { value: new THREE.Matrix4() },
    uLightView: { value: new THREE.Matrix4() },
    uLightFar: { value: LIGHT.far },
    uLightBias: { value: LIGHT.bias },
    uLightAng: { value: new THREE.Vector2(...LIGHT.angles) },
    // The long axis as a unit vector in the light's uv frame, so the shader
    // rotates by a complex multiply instead of two trig calls per tap.
    uSrcAxis: { value: new THREE.Vector2(Math.cos(LIGHT.axis), Math.sin(LIGHT.axis)) },
    uLightHalf: { value: LIGHT.halfSize },
    uPenMin: { value: new THREE.Vector2(...LIGHT.minPen) },
    uPenMax: { value: new THREE.Vector2(...LIGHT.maxPen) },
    uPenSearch: { value: new THREE.Vector2(...LIGHT.search) },
    uIso: { value: 0 }, // 1 rounds the source off to a disc of equal solid angle
    uHard: { value: 0 }, // 1 collapses it the rest of the way, to a point
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
  uniform vec2 uLightAng;
  uniform vec2 uSrcAxis;
  uniform float uLightHalf;
  uniform vec2 uPenMin;
  uniform vec2 uPenMax;
  uniform vec2 uPenSearch;
  uniform float uIso;
  uniform float uHard;

  // The disc of equal solid angle: pi*a*b == pi*r*r, so r = sqrt(a*b). Used by
  // every one of the three "round it off" paths so the comparison renders differ
  // by the source's *shape* and not by how much light it lets through.
  vec2 shRound(vec2 v) { return vec2(sqrt(v.x * v.y)); }
  vec2 shAng()    { return uIso > 0.5 ? shRound(uLightAng)   : uLightAng; }
  vec2 shSearch() { return uIso > 0.5 ? shRound(uPenSearch)  : uPenSearch; }
  vec2 shPenMax() { return uIso > 0.5 ? shRound(uPenMax)     : uPenMax; }
  vec2 shPenMin() { return uIso > 0.5 ? shRound(uPenMin)     : uPenMin; }

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

  /**
   * One tap offset, in light-space uv.
   *
   * Order matters and is the one thing in this file that is easy to get subtly
   * wrong: **rotate the unit disc by the decorrelation angle, then scale it to
   * the ellipse, then rotate it into the source's frame.** Scaling first would
   * make the per-pixel noise elliptical too, and the two ellipses would beat
   * against each other into a moire that survives the temporal filter.
   */
  vec2 shOffset(int i, int n, vec2 rr, vec2 radiiUV) {
    return shRot(shRot(shSpiral(i, n), rr) * radiiUV, uSrcAxis);
  }

  float shDepth(vec2 uv) {
    return TEX2D(uLightDepth, uv).r * uLightFar;
  }

  /**
   * The receiver's own plane, expressed as "how fast does the light-space depth
   * change per unit of light-space uv". A surface tilted away from the lamp
   * recedes as you walk across it, and a blocker search this wide would
   * otherwise report the *floor itself* as its own occluder at every grazing
   * angle. A constant bias cannot fix it: across the long axis of today's search
   * ellipse this floor's depth changes by nearly a metre, and the bias is 7cm.
   *
   * In light-view space the plane through the shaded point satisfies n·dp = 0,
   * so dz = -(n.x·dx + n.y·dy)/n.z, and one orthographic uv is 2·halfSize world
   * units. Clamped, because a surface seen edge-on from the lamp has an infinite
   * slope and no useful shadow either way.
   */
  vec2 shSlope(vec3 nWorld) {
    vec3 nl = mat3(uLightView) * nWorld;
    if (abs(nl.z) < 0.12) return vec2(0.0);
    return clamp((2.0 * uLightHalf) * nl.xy / nl.z, vec2(-45.0), vec2(45.0));
  }

  /**
   * The fraction of the source visible from p.
   *
   * The rotation is an angle in radians and is the caller's business, because
   * the three customers decorrelate differently: a surface wants per-pixel
   * noise, a froxel
   * wants per-frame noise it can accumulate, and a mote wants per-particle noise
   * it can average across thousands of siblings.
   *
   * The slope argument is the receiver plane above, or vec2(0) for mid-air,
   * which has no plane and needs none.
   */
  float softVisS(vec3 p, float rot, vec2 slope) {
    vec4 lp = uLightVP * vec4(p, 1.0);
    vec2 luv = lp.xy / lp.w * 0.5 + 0.5;
    if (luv.x < 0.0 || luv.x > 1.0 || luv.y < 0.0 || luv.y > 1.0) return 1.0;

    // Linear, in metres, because that is what this map has always stored.
    float d = -(uLightView * vec4(p, 1.0)).z;

    if (uHard > 0.5) {
      return step(d - uLightBias, shDepth(luv));
    }

    // The orthographic frustum is 2 * halfSize wide and maps to one unit of uv,
    // so a world radius converts to a uv radius by one multiply. This is the
    // step a packed projection-space map cannot take without knowing more than
    // it stores — and today it is the step that lets an ellipse measured in
    // metres stay an ellipse in texels.
    float perWorld = 1.0 / (2.0 * uLightHalf);
    vec2 rr = vec2(cos(rot), sin(rot));

    // --- 1. blocker search ---------------------------------------------------
    float sum = 0.0;
    float cnt = 0.0;
    vec2 sr = shSearch() * perWorld;
    for (int i = 0; i < SH_SEARCH; i++) {
      vec2 o = shOffset(i, SH_SEARCH, rr, sr);
      float ref = d + dot(slope, o) - uLightBias;
      float m = shDepth(luv + o);
      if (m < ref) { sum += m; cnt += 1.0; }
    }
    // Nothing within a full penumbra's reach is in front of this point, so no
    // amount of sampling will darken it. Most of a lit frame exits here.
    if (cnt < 0.5) return 1.0;

    // --- 2. penumbra size ----------------------------------------------------
    // theta * gap, straight out of similar triangles — twice, once per axis. The
    // ratio of the two is the ratio of the opening's sides, which is why a slot
    // draws a smear one way and a line the other.
    float db = sum / cnt;
    float gap = max(d - db, 0.0);
    vec2 w = clamp(shAng() * gap, shPenMin(), shPenMax());
    vec2 rad = w * perWorld;

    // --- 3. PCF over that ellipse -------------------------------------------
    float vis = 0.0;
    for (int i = 0; i < SH_PCF; i++) {
      vec2 o = shOffset(i, SH_PCF, rr, rad);
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
