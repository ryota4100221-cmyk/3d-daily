import * as THREE from 'three'
import { LIGHT, buildWindow } from './palette.js'
import { MAX_PANES } from './ltc.js'

/**
 * Day 039 — the shadow test, asked *which part*.
 *
 * Yesterday this file learned what the source looks like: the PCF kernel stopped
 * being a disc and became the window, panes and stone and all, so a soft edge
 * carries the mullion's seam. The whole of that stands. What changes today is
 * the *return type*.
 *
 * `softVisS` answers "what fraction of the window can this point see". That is a
 * scalar, and a scalar is a claim that the window went dim. It did not. A lath
 * across the beam covers one part of the opening and leaves the rest exactly as
 * bright as it was, and the taps already knew that — each one landed in a
 * particular pane and reported on that pane — right up to the line where they
 * were summed and divided.
 *
 * So `softVisMask` at the bottom of this file turns the loop inside out and
 * hands back the vector instead. Same map, same search, same penumbra estimate,
 * same taps; the average is now something the caller can compute if it wants
 * one, rather than the only thing on offer.
 *
 * ---------------------------------------------------------------------------
 * Yesterday's header follows, because none of it stopped being true.
 *
 * Day 038 — the shadow test, given a *silhouette*.
 *
 * Day 031 built this renderer its own light-space depth map, in metres. Day 036
 * turned the question it answers from `step()` into a fraction — search for a
 * blocker, measure the gap `g`, and the source's half-angle gives the penumbra
 * width `theta * g`. Day 037 made theta two numbers so the kernel could be an
 * ellipse. All of that is still here.
 *
 * What changes is what the kernel *is*.
 *
 * A penumbra is the source's own silhouette, seen from the receiving point,
 * convolved with the blocker's. Every version of PCSS since 2005 has stood on
 * that sentence and then quietly replaced the silhouette with a disc, because
 * the sources people simulate are lamps and a lamp is roughly a disc. A window
 * is not. If the kernel is genuinely the source, then a window with a mullion
 * down it must lay a faint pale seam through every soft edge in the room — and
 * it does, and it costs nothing, because sampling a shape is the same price as
 * sampling a disc as long as you can pick a point inside it in constant time.
 *
 * So:
 *
 *   1. BLOCKER SEARCH over the opening's bounding rectangle, scaled to metres.
 *   2. PENUMBRA SIZE  the bounding rectangle times the gap, clamped to a budget
 *                     per axis, and turned back into a *scale on the angles* so
 *                     the clamp shrinks the window rather than cropping it.
 *   3. PCF            taps distributed over **the panes**, area-proportionally,
 *                     by a CDF walked once per tap.
 *
 * ---------------------------------------------------------------------------
 * The decorrelation has to change, and this is the subtle part of the day
 *
 * Every previous day rotated the tap spiral by a per-pixel angle. That works
 * because a disc is invariant under rotation: turning the kernel changes which
 * samples you take without changing the shape you are estimating. **Today's
 * kernel is not rotation-invariant.** It has a picture in it. Rotate it per
 * pixel and the mullion's seam is smeared into an annulus — you get a soft
 * shadow that is subtly *wrong* in a way that looks like it is merely noisy.
 *
 * The fix is to decorrelate in sample space instead: take a stratified point set
 * over the unit square and shift it toroidally by a per-pixel offset
 * (Cranley-Patterson rotation). Neighbouring pixels then use different points of
 * the same source, which is the property we actually wanted; nobody ever wanted
 * a rotated lamp.
 *
 * ---------------------------------------------------------------------------
 * And the three customers still pay different prices for the same function:
 *
 *   surfaces   SH_SEARCH 8, SH_PCF 48 (8 per pane). Once per screen pixel, and
 *              the one number that moved today. The *mask* is free — it is the
 *              same loop with the divide moved — but a per-pane estimate has a
 *              sixth of the samples standing behind it that the average had, so
 *              its variance is six times worse for the same budget. On a
 *              highlight the tone map is saturating anyway, 0.75 and 1.0 are the
 *              same white and nobody sees the noise; along the eclipse's edge,
 *              where a pane sits at a quarter, everybody does. 24 -> 48 is what
 *              that costs, and it is a cost of *estimating a mask*, not a cost
 *              of using one.
 *   the air    SH_SEARCH 4, SH_PCF 2. Once per froxel — 2.36 million of them.
 *   the motes  SH_SEARCH 3, SH_PCF 1. One tap each, 4,500 of them, averaged by
 *              being a field rather than by being sampled.
 *
 * At one tap a mote is a Bernoulli sample of the window's area; four and a half
 * thousand of them are a picture of it.
 */

const W = buildWindow()

/**
 * `uPane` is `[cx, cy, hx, hy]` in radians and `uPaneCdf` the running area
 * fraction. Both are padded to MAX_PANES because a uniform array's length is a
 * compile-time constant and the comparison modes need to swap a six-pane window
 * for a one-pane one without recompiling every shader in the renderer.
 */
function padPanes(panes) {
  const out = []
  for (let i = 0; i < MAX_PANES; i++) {
    const p = panes[i] || [0, 0, 0, 0]
    out.push(new THREE.Vector4(p[0], p[1], p[2], p[3]))
  }
  return out
}

function padCdf(cdf) {
  const out = new Float32Array(MAX_PANES)
  for (let i = 0; i < MAX_PANES; i++) out[i] = i < cdf.length ? cdf[i] : 1.0
  return out
}

export const WINDOW_DATA = {
  panes: padPanes(W.panes),
  cdf: padCdf(W.cdf),
  count: W.panes.length,
  omega: W.omega,
  solid: padPanes(W.solid),
  solidCdf: padCdf(W.solidCdf),
  solidCount: 1,
  solidOmega: W.solidOmega,
  bound: W.bound,
}

export function shadowUniforms() {
  return {
    uLightDepth: { value: null },
    uLightVP: { value: new THREE.Matrix4() },
    uLightView: { value: new THREE.Matrix4() },
    uLightFar: { value: LIGHT.far },
    uLightBias: { value: LIGHT.bias },
    uLightHalf: { value: LIGHT.halfSize },

    // --- the source, and nothing but the source ---
    uPane: { value: WINDOW_DATA.panes },
    uPaneCdf: { value: WINDOW_DATA.cdf },
    uPaneN: { value: WINDOW_DATA.count },
    uSrcBound: { value: new THREE.Vector2(...W.bound) },
    // The long axis as a unit vector in the light's uv frame, so a tap is turned
    // into the window's orientation by a complex multiply rather than two trig
    // calls. The panes themselves stay unrotated — a rotated rectangle is not a
    // rectangle, and the sampler wants one.
    uSrcAxis: { value: new THREE.Vector2(0, 1) },
    // Radiance, not irradiance. Set from LIGHT.intensity / omega, and reset for
    // each comparison mode so that taking the tracery away does not smuggle in
    // extra light along with the extra area.
    uSrcRad: { value: LIGHT.intensity / W.omega },

    uPenMin: { value: new THREE.Vector2(...LIGHT.minPen) },
    uPenMax: { value: new THREE.Vector2(...LIGHT.maxPen) },
    uPenSearch: { value: new THREE.Vector2(...LIGHT.search) },
    uHard: { value: 0 }, // 1 collapses the window to a point
  }
}

/**
 * Requires SH_SEARCH and SH_PCF to be #defined, LTC_PANES to be the uniform
 * array length, and TEX2D to be the sampling macro of the host's GLSL version.
 */
export const SHADOW_GLSL = /* glsl */ `
  uniform sampler2D uLightDepth;
  uniform mat4 uLightVP;
  uniform mat4 uLightView;
  uniform float uLightFar;
  uniform float uLightBias;
  uniform float uLightHalf;
  uniform vec4 uPane[LTC_PANES];
  uniform float uPaneCdf[LTC_PANES];
  uniform int uPaneN;
  uniform vec2 uSrcBound;
  uniform vec2 uSrcAxis;
  uniform float uSrcRad;
  uniform vec2 uPenMin;
  uniform vec2 uPenMax;
  uniform vec2 uPenSearch;
  uniform float uHard;

  vec2 shRot(vec2 v, vec2 r) {
    return vec2(v.x * r.x - v.y * r.y, v.x * r.y + v.y * r.x);
  }

  /**
   * A point on the source, uniform over the union of the panes.
   *
   * s walks a stratified sequence in [0,1) and picks the pane by area — a
   * pane covering a fifth of the opening gets a fifth of the taps, which is the
   * whole of importance sampling here because the panes are equally bright. The
   * leftover fraction inside the chosen pane is *reused* as the tap's coordinate
   * along one axis ((s - lo) / (hi - lo)); throwing it away and drawing a
   * fresh number would leave six taps clustered at six pane centres.
   *
   * Returns the offset in radians, in the window's own frame.
   */
  vec2 srcSample(float s, float v) {
    float lo = 0.0;
    for (int i = 0; i < LTC_PANES; i++) {
      if (i >= uPaneN) break;
      float hi = uPaneCdf[i];
      if (s < hi || i == uPaneN - 1) {
        vec4 q = uPane[i];
        float u = clamp((s - lo) / max(hi - lo, 1e-6), 0.0, 1.0);
        return q.xy + (vec2(u, v) * 2.0 - 1.0) * q.zw;
      }
      lo = hi;
    }
    return vec2(0.0);
  }

  /**
   * The i-th of n stratified points, shifted toroidally by off.
   *
   * One axis is the stratum index, the other the golden-ratio sequence. Both are
   * shifted by the caller's per-pixel offset rather than rotated — see the note
   * at the top of the file about what rotating a kernel with a picture in it
   * does to the picture.
   */
  vec2 shPoint(int i, int n, vec2 off) {
    float f = (float(i) + 0.5) / float(n);
    return fract(vec2(f, fract(float(i) * 0.6180339887)) + off);
  }

  float shDepth(vec2 uv) {
    return TEX2D(uLightDepth, uv).r * uLightFar;
  }

  /**
   * The receiver's own plane, as "how fast does light-space depth change per
   * unit of light-space uv" (Day 037, unchanged). A surface tilted away from the
   * window recedes as you walk across it, and a blocker search this wide would
   * otherwise report the floor itself as its own occluder at every grazing
   * angle. A constant bias cannot fix that: across the long axis of the search
   * rectangle this floor's depth changes by nearly a metre and the bias is 7cm.
   */
  vec2 shSlope(vec3 nWorld) {
    vec3 nl = mat3(uLightView) * nWorld;
    if (abs(nl.z) < 0.12) return vec2(0.0);
    return clamp((2.0 * uLightHalf) * nl.xy / nl.z, vec2(-45.0), vec2(45.0));
  }

  /**
   * The fraction of the *window* visible from p.
   *
   * rot is the caller's decorrelation handle — still an angle, still the
   * caller's business, because a surface wants per-pixel noise, a froxel wants
   * per-frame noise it can accumulate and a mote wants per-particle noise it can
   * average across thousands of siblings. It is now consumed as a pair of
   * toroidal shifts instead of as a rotation.
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
    // so a world radius converts to a uv radius with one multiply. This is the
    // step a packed projection-space map cannot take without knowing more than
    // it stores.
    float perWorld = 1.0 / (2.0 * uLightHalf);
    vec2 off = fract(vec2(rot * 0.1591549, rot * 0.2756644));

    // --- 1. blocker search, over the opening's bounding rectangle ------------
    float sum = 0.0;
    float cnt = 0.0;
    vec2 sr = uPenSearch * perWorld;
    for (int i = 0; i < SH_SEARCH; i++) {
      vec2 t = shPoint(i, SH_SEARCH, off) * 2.0 - 1.0;
      vec2 o = shRot(t * sr, uSrcAxis);
      float ref = d + dot(slope, o) - uLightBias;
      float m = shDepth(luv + o);
      if (m < ref) { sum += m; cnt += 1.0; }
    }
    // Nothing within a full penumbra's reach is in front of this point, so no
    // amount of sampling will darken it. Most of a lit frame exits here.
    if (cnt < 0.5) return 1.0;

    // --- 2. penumbra size ----------------------------------------------------
    // The window, scaled by the gap — similar triangles, twice. The budget is
    // applied by *shrinking the angles* rather than by cropping the kernel: a
    // clamped penumbra is then a smaller picture of the same window, which is
    // wrong by a scale factor, where a cropped one would be a picture of a
    // different window and wrong by a shape.
    float db = sum / cnt;
    float gap = max(d - db, 0.0);
    vec2 w = clamp(uSrcBound * gap, uPenMin, uPenMax);
    vec2 scale = (w / max(uSrcBound, vec2(1e-5))) * perWorld;

    // --- 3. PCF over the panes ----------------------------------------------
    float vis = 0.0;
    for (int i = 0; i < SH_PCF; i++) {
      vec2 st = shPoint(i, SH_PCF, off);
      vec2 o = shRot(srcSample(st.x, st.y) * scale, uSrcAxis);
      vis += step(d + dot(slope, o) - uLightBias, shDepth(luv + o));
    }
    return vis / float(SH_PCF);
  }

  float softVis(vec3 p, float rot) {
    return softVisS(p, rot, vec2(0.0));
  }

#ifdef SH_MASK
  /**
   * The same test, refusing to average.
   *
   * softVisS above walks the whole opening and divides by the number of taps.
   * That number — the fraction of the window this point can see — is all any day
   * before this one asked for, and it is thrown away information: the taps *knew*
   * which pane they were in, and the answer collapsed six panes into one float
   * before anybody downstream could ask which ones went dark.
   *
   * So the loop is turned inside out. The outer level is the pane, the inner one
   * its own taps, and what comes back is a vector — visP[i] is the fraction of
   * pane i that is clear — with the scalar returned alongside as the
   * area-weighted mean, so the callers that only ever wanted one number
   * (the air, the motes, the early-out here) still get exactly what they got.
   *
   * The budget does not move. Six panes at four taps is the same twenty-four
   * shadow-map reads Day 038 spent, and the taps are *better placed* than they
   * were: yesterday a CDF distributed them by area, which is importance sampling
   * for an average and the wrong allocation for a per-pane estimate. Each pane
   * now gets the same count, because each pane's own fraction is its own
   * question. When the source is a single rectangle (the comparison renders) the
   * one pane collects all twenty-four and nothing has changed at all.
   *
   * The stratification is per pane and shifted per pane as well — the same
   * Cranley-Patterson shift as yesterday, plus a golden-ratio offset by index.
   * Without it every pane samples the same six positions of its own rectangle
   * and the mask's noise is perfectly correlated across the window, which reads
   * as the whole opening flickering rather than as its parts disagreeing.
   */
  float softVisMask(vec3 p, vec2 off, vec2 slope, out float visP[LTC_PANES]) {
    for (int i = 0; i < LTC_PANES; i++) visP[i] = 1.0;

    vec4 lp = uLightVP * vec4(p, 1.0);
    vec2 luv = lp.xy / lp.w * 0.5 + 0.5;
    if (luv.x < 0.0 || luv.x > 1.0 || luv.y < 0.0 || luv.y > 1.0) return 1.0;

    float d = -(uLightView * vec4(p, 1.0)).z;

    // A point source has one direction and therefore one visibility; the mask is
    // that number in every slot, which is the correct degenerate case and not a
    // special case.
    if (uHard > 0.5) {
      float v = step(d - uLightBias, shDepth(luv));
      for (int i = 0; i < LTC_PANES; i++) visP[i] = v;
      return v;
    }

    // The caller hands the shift in already, and as a *pair*. softVisS above
    // still manufactures one from an angle, because its callers have an angle
    // and want a scalar back; a mask cannot afford that — see the note beside
    // sofs in the composite.
    float perWorld = 1.0 / (2.0 * uLightHalf);

    // --- 1. blocker search — unchanged, and still over the bounding rectangle -
    // The search asks "is anything in front of me at all", which is a question
    // about the opening and not about any one pane of it.
    float sum = 0.0;
    float cnt = 0.0;
    vec2 sr = uPenSearch * perWorld;
    for (int i = 0; i < SH_SEARCH; i++) {
      vec2 t = shPoint(i, SH_SEARCH, off) * 2.0 - 1.0;
      vec2 o = shRot(t * sr, uSrcAxis);
      float ref = d + dot(slope, o) - uLightBias;
      float m = shDepth(luv + o);
      if (m < ref) { sum += m; cnt += 1.0; }
    }
    // Fully lit: every pane is clear, which the initialisation already says.
    if (cnt < 0.5) return 1.0;

    // --- 2. penumbra size — unchanged ---------------------------------------
    float db = sum / cnt;
    float gap = max(d - db, 0.0);
    vec2 w = clamp(uSrcBound * gap, uPenMin, uPenMax);
    vec2 scale = (w / max(uSrcBound, vec2(1e-5))) * perWorld;

    // --- 3. PCF, pane by pane ------------------------------------------------
    int tp = max(SH_PCF / max(uPaneN, 1), 1);
    float vis = 0.0;
    float lo = 0.0;
    for (int i = 0; i < LTC_PANES; i++) {
      if (i >= uPaneN) break;
      vec4 q = uPane[i];
      float hi = uPaneCdf[i];
      vec2 ph = vec2(float(i) * 0.3819660, float(i) * 0.1701102);

      float acc = 0.0;
      for (int j = 0; j < SH_PCF; j++) {
        if (j >= tp) break;
        vec2 st = shPoint(j, tp, fract(off + ph));
        vec2 s = q.xy + (st * 2.0 - 1.0) * q.zw;
        vec2 o = shRot(s * scale, uSrcAxis);
        acc += step(d + dot(slope, o) - uLightBias, shDepth(luv + o));
      }

      visP[i] = acc / float(tp);
      vis += visP[i] * (hi - lo);   // the CDF's step *is* this pane's area share
      lo = hi;
    }
    return vis;
  }
#endif
`

/**
 * Interleaved gradient noise (Jimenez). One value per pixel that decorrelates
 * neighbours completely while staying stable under a sub-pixel jitter, which is
 * the property a plain hash does not have.
 */
export const IGN_GLSL = /* glsl */ `
  float ign(vec2 px) {
    return fract(52.9829189 * fract(dot(px, vec2(0.06711056, 0.00583715))));
  }
`
