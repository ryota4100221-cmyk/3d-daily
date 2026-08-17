import * as THREE from 'three'
import { RectAreaLightTexturesLib } from 'three/examples/jsm/lights/RectAreaLightTexturesLib.js'

/**
 * Day 047 — the visibility that was already in here.
 *
 * The top of every NOTES list since Day 041 has been the same line: the radiance
 * has texel resolution and the *occlusion* still has a resolution of six. The
 * split this file ships is
 *
 *     result  =  ltcClip( sum vis_i e_i )  x  Lbar(footprint)
 *
 * and read left to right it says the visible mass is per-pane and the mean
 * radiance has no visibility in it at all — so a lath across the warm light of
 * this window should darken the room without greening it. Six mornings of NOTES
 * said so. Nobody had measured it, because `lobe-error.mjs` has never had
 * anything in the way.
 *
 * `scripts/vis-error.mjs` puts a blocker in front of the window — a half-plane in
 * the source's uv, which is the exact silhouette of a straight edge seen from a
 * point — and integrates the reference over the part of the opening the point can
 * actually see. The line was wrong, and the number is not close:
 *
 *     the fetch, with no visibility anywhere      18.73 %
 *     what this file already ships                 5.48 %
 *
 * The difference is one sentence in Day 041's own header, written as a curiosity
 * and never scored: **the fetch is pointed along the visibility-weighted edge
 * sum.** `f` is summed with vis_i inside it, so where the lobe looks and how big
 * its footprint is (Day 045 divides by the same clipped `f`) both already follow
 * the light that is left. Three quarters of the covariance the split-sum is
 * supposed to drop is picked up by a normalize nobody counted.
 *
 * Four mechanisms were built this morning against the remaining quarter and all
 * four are measured losses; they are in the build, off, so the results can be
 * re-run rather than believed. The one that stayed closest is `uVisFit`, one
 * multiply per tap, and its failure is arithmetic rather than tuning: the mean
 * tap count is 1.31, and a scalar on a single premultiplied tap cancels in the
 * divide exactly. See NOTES for the other three and for the ablation that says
 * where the error actually is — the fetch's *centre*, worth 1.13 points, which
 * is neither the mask's business nor this week's.
 *
 * ---------------------------------------------------------------------------
 * Day 044's header follows.
 *
 * The ellipse itself, which was never the right one.
 *
 * Yesterday's NOTES put this at the top of its own list of what to try next, and
 * put it in the strongest form available:
 *
 *   > **つまり今日の ground truth 自体が近似だった可能性がある。これが今の最上位。**
 *
 * It was. Days 041, 042 and 043 all scored themselves against the same
 * reference — the *unweighted* mean of the window's image over an ellipse — and
 * that ellipse is the preimage of a disc of angular radius delta, with delta =
 * GLASS_K / GLASS_SIZE = 0.5 rad, a number chosen by eye on Day 041 against the
 * sharpest surface in the frame. Three mornings of work went into how that
 * ellipse is *sampled*. None of them asked whether it was the right ellipse.
 *
 * `scripts/lobe-error.mjs` asks. It brute-forces the thing the fetch is a
 * stand-in for — the D-weighted mean of the window over the whole window, with
 * D the clamped cosine the LTC transform leaves behind — and the answer is that
 * the rule's ellipse was, on average, **105 times too long**.
 *
 * The reason is one line. A disc of 0.5 rad is bigger than this window (13 by 21
 * degrees) to begin with, so a diffuse surface's fetch was always reading the top
 * of the pyramid: the flat mean of the whole opening, with the lobe's own shape
 * discarded. The shader has been saying so for three days by clamping uv into
 * [0,1] — **but a clamp moves the centre of a fetch and never shrinks it.**
 *
 * The fix is two lines, and it is the one place a kernel can be corrected without
 * a fetch: two kernels multiplying is two variances adding reciprocally, and the
 * unit square's covariance is isotropic and exactly (1/12) I, so the opening
 * shortens both semi-axes and turns neither.
 *
 *     1 / A_eff^2 = 1 / A^2 + 1 / SUPPORT^2,   SUPPORT = N / sqrt(3) texels
 *
 * Measured, 1024 configurations from the frame's own geometry: **8.09% relative
 * RMS to 4.44%**, against 8.48 -> 8.33 -> 8.09 for the three days before it. And
 * it makes yesterday cheaper rather than dearer — a shorter ellipse is a less
 * anisotropic one, so the mean tap count falls from 3.47 to 1.35.
 *
 * Two results worth carrying at the top because they are about method:
 *
 *   the same derivation also moves the fetch's centre toward the window's, and
 *   that half **loses** 2.7 points. A square support truncates rather than
 *   shifts. Two terms out of one derivation are still two claims.
 *
 *   Day 041's constant, picked by eye and never examined, turns out to sit at the
 *   measured optimum — but only once the support is in. Without it the same sweep
 *   wants the smallest delta it is offered, because shrinking delta was the only
 *   lever the old rule had for a job that was not delta's.
 *
 * uSupport = 0 is Day 043 exactly. ?supp=0 is yesterday, ?supp=0&tap=1 the day
 * before, ?supp=0&aniso=0 the day before that: four builds on one atlas.
 *
 * ---------------------------------------------------------------------------
 * Day 043's header follows.
 *
 * The same ellipse, read where it actually lies.
 *
 * Yesterday's table had one hole in it and yesterday's NOTES put it first:
 *
 *   > **斜めの楕円（EWA か長軸方向の複数タップ）**。今日の表が示した唯一の穴で、
 *   > >3x・45度で改善が 5% しか出ない。ripmap の上に長軸方向2〜4タップを載せる
 *   > のが素直な直し方で、コストは 4フェッチ→8〜16フェッチ。
 *
 * A ripmap is indexed by the texture's two axes. It can hold "average 2^m across
 * and 2^n up" and it cannot hold *where* — so an ellipse whose major axis runs
 * diagonally gets bounded by a box up to sqrt(2) too big on both sides, and the
 * fetch averages a lozenge of window that the lobe never looked at. Measured
 * yesterday: at more than 3x anisotropy the ripmap beat Day 041 by 25% near the
 * texture axes and by 5% at 45 degrees to them. The second number is the hole.
 *
 * The fix is to stop asking one fetch to cover the ellipse. Cut it into n slabs
 * perpendicular to its major axis; read slab k as its own sub-ellipse of
 * semi-axes (A/n, B), through the ripmap, at the slab's own centre; weigh the n
 * answers by the exact area of the ellipse in each slab. The sub-ellipses are
 * congruent, so they share one level pair — **the ripmap still does the
 * axis-aligned part and the taps buy only the orientation**, which is the part it
 * has no index for. This is Schilling's texram arrangement (probes along the
 * major axis, footprint chosen by the minor) with a ripmap under it instead of a
 * mip chain, so the probes do not have to be round either.
 *
 * Two things follow that are worth having at the top:
 *
 *   n = 1 is Day 042. Centre at zero, half-length A: the same bounding box, the
 *   same cells, the same memory. ?tap=1 is not an approximation of yesterday's
 *   build, it *is* it, exactly as ?aniso=0 is Day 041 and for the same reason.
 *
 *   the weights are not tuned. The area of the unit disc left of x is
 *   (x sqrt(1-x^2) + asin x)/pi, so slab k weighs the difference of two of those
 *   at x = 2k/n - 1. They are constants of n and they sum to one by construction.
 *
 * Measured against a brute-forced elliptical average of level 0 (4096 taps,
 * scripts/aniso-error.mjs): 4.76% relative RMS against yesterday's 5.26%, and in
 * the bin that motivated the day — more than 3x anisotropy, major axis past 30
 * degrees — 5.79% against 6.87%. Above a 4.1% floor that is box-versus-ellipse
 * and inter-cell bilinear, the excess error falls by a quarter. Mean cost 2.76
 * taps.
 *
 * ---------------------------------------------------------------------------
 * Day 042's header follows.
 *
 * The same picture, over a footprint that is no longer round.
 *
 * Yesterday's fetch was correct in structure and wrong in shape. It asked the
 * pyramid for "the window averaged over a disc of such-and-such a size", and the
 * set a lobe averages over is a disc only if the lobe is round *and* the plane is
 * square-on. LTC's whole business is that GGX lobes are not round — Minv is a
 * non-uniform transform, that is what it is for — and this window is seen
 * obliquely by everything in the room.
 *
 * So the scalar `d` becomes a 2x2 Jacobian, and the square pyramid becomes a
 * ripmap. The derivation is written out at `glassFetch` below; the one line worth
 * putting at the top is that it *reduces* to yesterday's expression, with
 * yesterday's constant, when the ellipse happens to be a circle:
 *
 *     fu, fv = delta·N·|col(J)| / |det J|      -->  delta·N·dist/sqrt(area)
 *
 * The measurable claim is the one Day 041 recorded as its only regression. The
 * hue difference between the left and right reflections in the near tablet went
 * 0.203 (Day 040's six constants) -> 0.088 (Day 041's square pyramid), because an
 * isotropic footprint bounded by the long axis averages straight across the
 * mullion. See NOTES for where it lands today.
 *
 * ---------------------------------------------------------------------------
 * Day 041's header follows.
 *
 * The same integral, over a source that is now a picture.
 *
 * Yesterday's answer to "what colour is the lamp" was `Lbar`, a sum over six
 * panes of six constants. Yesterday's NOTES put the objection first: *piecewise
 * constant on the panes* is a resolution limit, and it is the same one Day 039's
 * shadow mask has, moved onto the radiance side. Six numbers cannot paint a
 * window. Subdividing until they could costs four edges per pane in this file and
 * a whole shadow estimate per pane in `shadow.js`, which is unaffordable twice.
 *
 * Heitz's §5 answers it without touching either budget. Keep the polygon set;
 * make the radiance a **texture with a filtered pyramid**, and read it *once*,
 * at a level chosen from how much of the source the lobe covers:
 *
 *     result = ltcClip(Σ w_i e_i)  ×  L̄(uv, lod)
 *              ^ Day 038-040, untouched  ^ one fetch, whatever the window holds
 *
 * The pyramid is the whole trick. A mip level of a mean-preserving box pyramid
 * *is* the average of the source over a footprint of 2^m texels, so choosing the
 * level is choosing how much of the window the lobe averages over — which is the
 * only question the split-integral approximation ever asks. A rough surface reads
 * the top of the pyramid and gets white; a lacquer at roughness 0.05 reads four
 * levels down and gets the quarries. Same fetch, same cost.
 *
 * Two departures from the paper, both stated where they happen below:
 *
 *   the point   the paper projects the shading point orthogonally onto the light
 *               plane and reads there. This file intersects the plane with the
 *               *LTC vector's own direction* — the mean direction of the lobe
 *               restricted to the source, which the edge sum has already
 *               computed and thrown away since Day 038. It costs a normalize and
 *               it is inside the source's hull by construction, where the
 *               orthogonal projection wanders off the window at grazing angles.
 *   the base    a 2× pyramid instead of the paper's 3×, so the level is a plain
 *               log2 instead of log3. Their `log(2048*d)/log(3)` is exactly this
 *               formula written for a base-3 pyramid over a 2048-wide image.
 *
 * And one consequence nobody designed: `f` is the *visibility-weighted* edge sum,
 * so when the lath eclipses part of the window the direction it points shifts
 * toward what is still visible, and the fetch follows it. The colour of a
 * partially blocked window changes because the part you can still see is a
 * different part of the picture. That fell out of pointing the fetch at the lobe.
 *
 * ---------------------------------------------------------------------------
 * Day 040's header follows.
 *
 * The same integral, over a source that is no longer one colour.
 *
 * Yesterday's file put the shadow inside the sum, and the argument that made it
 * legal was one sentence: *the edge sum is a vector integral, and a vector
 * integral is additive over a partition of its domain, weights and all.* Today
 * the panes stop agreeing about radiance, and that same sentence is what has to
 * be checked again — because now the weights are coloured.
 *
 * It survives, but not intact, and the crack is worth being precise about.
 *
 * What we want is  ∫ L(ω) vis(ω) f(ω) dω  with L piecewise constant on the
 * panes. Additivity gives  Σ_i c_i · w_i · e_i  — a triple of vector integrals,
 * one per channel, and each is exact in exactly the way yesterday's was. But the
 * next line is not additive. `ltcClip` is a *fit*, and a nonlinear one: it takes
 * a whole accumulated vector and returns the horizon-clipped form factor of the
 * shape that vector describes. Run it three times, once per channel, and you are
 * asking it about three different shapes that do not exist — the red window, the
 * green window — and where a pane straddles the horizon the three answers move
 * apart for no physical reason at all. That is the double-count of Day 038, in
 * colour, and it shows up as a fringe along terminators.
 *
 * So the answer is split into a magnitude and a chromaticity:
 *
 *     F     = ltcClip( Σ w_i e_i )                   — one shape, clipped once
 *     Lbar  = Σ w_i max(e_i.z, 0) c_i  /  Σ w_i max(e_i.z, 0)
 *     result = F * Lbar
 *
 * `Lbar` is the mean radiance the lobe sees, with each pane weighted by how much
 * of the lobe it actually covers — which is what `e_i.z` is before clipping. The
 * approximation is confined to *how the horizon correction is shared out among
 * the panes*, and it is exact whenever the panes agree (yesterday's frame, and
 * ?pass=8) or whenever none of them straddles the horizon (every surface in this
 * picture that is bright enough to read a colour off).
 *
 * I would rather ship a scalar clip and a stated approximation than three clips
 * and a fringe nobody can explain. The honest fix is a real polygon clip, which
 * is a variable-length loop; see NOTES.
 *
 * ---------------------------------------------------------------------------
 * Day 039's header follows.
 *
 * The same integral, with the shadow moved inside it.
 *
 * Yesterday's file computed the exact integral of a GGX lobe over six panes and
 * then the caller multiplied the answer by one number: the fraction of the
 * window visible from the shaded point. That last multiply is the last place in
 * this renderer where the lamp is still treated as a thing with a brightness
 * rather than a thing with a shape.
 *
 * It comes out today. `ltcVector` takes a weight per pane and applies it to that
 * pane's four edges, which needs no new mathematics at all — the edge sum is a
 * vector integral over the source's solid angle, and a vector integral is
 * additive over a partition whether or not the pieces are weighted. The result
 * is the integral of *radiance times visibility*, with visibility held piecewise
 * constant on the panes.
 *
 * Two consequences worth stating before reading the code:
 *
 *   the resolution of a shadowed highlight is the tracery. Where a blocker's
 *   edge falls inside a pane rather than on the stone, that pane is uniformly
 *   dimmed and the old error is back, locally. Where it falls near a mullion,
 *   the answer is essentially exact. The stone is where a window's radiance is
 *   discontinuous, so a basis aligned to the stone is the cheapest basis that
 *   can be right at all — but it is not a fine one, and refining it means
 *   splitting panes, which costs four edges each.
 *
 *   ltcClip is now clipping a *weighted* sum. Heitz's horizon fit was derived
 *   for a uniformly bright polygon; handed a partly occluded one it is being
 *   asked a question slightly outside its training. In this frame the difference
 *   is invisible, because the surfaces that show the mask are all facing the
 *   window and nowhere near their own horizons. It would not stay invisible on a
 *   floor at grazing incidence.
 *
 * ---------------------------------------------------------------------------
 * Yesterday's header follows.
 *
 * Day 038 — linearly transformed cosines, for a source made of several polygons.
 *
 * Yesterday's `area.js` did the honest approximate thing: point the lobe at a
 * representative point on the source and widen it by the source's angles. It is
 * fifteen per cent at the peak and it is *shapeless* — the widened lobe is an
 * ellipse whatever the opening actually looks like, and at grazing incidence the
 * clamp that produces the representative point folds the whole highlight into a
 * crease. Today's source has a mullion in it. No amount of widening puts a
 * mullion in a highlight.
 *
 * ---------------------------------------------------------------------------
 * The idea, in three sentences
 *
 * The integral of a *cosine* lobe over a polygon has a closed form: sum an
 * arc-length term over the edges of the spherically-projected polygon and read
 * off one component. Heitz's observation (Heitz, Dupuy, Hill, Neubelt, *Real-Time
 * Polygonal-Light Shading with Linearly Transformed Cosines*, SIGGRAPH 2016) is
 * that a GGX lobe is well approximated by a 3x3 linear transform of a cosine
 * lobe — so to integrate GGX over a polygon, apply the *inverse* transform to
 * the polygon and integrate a cosine over that instead. The matrices live in a
 * 64x64 lookup indexed by roughness and viewing angle, and three ships one,
 * because `RectAreaLight` has needed exactly this since r87.
 *
 * So this file is small, and almost all of what is in it is the part three does
 * not do: **a source that is more than one rectangle.**
 *
 * ---------------------------------------------------------------------------
 * Why several polygons costs nothing
 *
 * The edge sum is not a form factor yet — it is a *vector*, the integral of the
 * direction over the solid angle, and a vector integral over a domain is the sum
 * of the integrals over the pieces of that domain. So six disjoint panes are six
 * loops of four edges accumulated into the same `vec3`, and the horizon clipping
 * (`ClippedSphereFormFactor`, which is where the approximation in the method
 * actually is) is applied **once, to the total**.
 *
 * That is better than calling three's per-rectangle routine six times and adding
 * the results, not just cheaper: clipping each pane against the horizon
 * separately and then summing double-counts the correction on every pane that
 * straddles it. Six panes of one window all straddle it at once.
 *
 * ---------------------------------------------------------------------------
 * What comes out
 *
 * `ltcTotal` returns the form factor — the fraction of the (transformed) cosine
 * lobe the opening covers — so the caller multiplies by the source's *radiance*,
 * not by an irradiance. `palette.js` derives that radiance by dividing the
 * scene's irradiance by the opening's solid angle, which is the one place the
 * two conventions are reconciled, and it is why removing the tracery does not
 * make the room brighter.
 */

let cached = null

/** The 64x64 RGBA float LUTs, initialised once. */
export function ltcTextures() {
  if (!cached) {
    RectAreaLightTexturesLib.init()
    cached = {
      m: RectAreaLightTexturesLib.LTC_FLOAT_1,
      f: RectAreaLightTexturesLib.LTC_FLOAT_2,
    }
  }
  return cached
}

export const MAX_PANES = 8

// The tap budget, so the shader's loop bound and the harness's cap are the same
// number. It lives in footprint.js with the rest of the rule; re-exported here
// because passes.js already imports its defines from this file and a second
// import path for one integer is how the two halves drift apart.
export { TAP_MAX as MAX_TAPS } from './footprint.js'

export function ltcUniforms() {
  return {
    uLtcMat: { value: null },
    uLtcMag: { value: null },
    // The source as geometry. `uSrcC` is the window's centre in world space,
    // `uSrcA`/`uSrcB` its two axes; a pane's four corners are built from those
    // and its own half-angles, in the shader, so the CPU uploads 8 vec4s and no
    // vertex data at all.
    uSrcC: { value: new THREE.Vector3() },
    uSrcA: { value: new THREE.Vector3(1, 0, 0) },
    uSrcB: { value: new THREE.Vector3(0, 1, 0) },
    uSrcDist: { value: 24.0 },
    uLtc: { value: 1 }, // 0 falls back to Day 037's representative point
    // 0 replaces the measured mask with a constant one — see `direct()`. Not a
    // second code path: the same integral, handed a visibility function that has
    // been told to forget where it varies.
    uMask: { value: 1 },

    // The glass's image and the two numbers that turn a lobe into a level live
    // in `shadowUniforms()`, with the rest of the source's description. This
    // file's shader reads them; it does not own them.
  }
}

/**
 * Requires `uPane[]`, `uPaneN` and `uSrcRad` from SHADOW_GLSL — the source's
 * description is shared, which is the point of the day.
 */
export const LTC_GLSL = /* glsl */ `
  uniform sampler2D uLtcMat;
  uniform sampler2D uLtcMag;
  uniform vec3 uSrcC;
  uniform vec3 uSrcA;
  uniform vec3 uSrcB;
  uniform float uSrcDist;
  uniform float uLtc;
  uniform float uMask;
  // uGlass / uGlassMax / uGlassK / uAniso / uTapMax / uTexLight and the
  // ripCell/ripFetch pair come from SHADOW_GLSL, which is always concatenated
  // ahead of this — the source is described in one place, and this week that
  // description grew a texture, then a second axis on its pyramid, and today a
  // budget for how many times a lobe may read it.

  // The level pair the last fetch chose, kept so that ?pass=15 can draw it. A
  // mutable global in a shader is a smell everywhere except a debug read-out, and
  // it is here rather than as an out parameter so that the two shading terms keep
  // the signatures every day since 038 has given them.
  vec2 gLod = vec2(0.0);
  // Day 043's read-out (?pass=16): how many taps the last fetch took, how
  // anisotropic its footprint was, and how far that footprint's major axis lies
  // from a texture axis. The third is the day's whole subject — it is exactly
  // the quantity a ripmap has no index for, and 0 wherever yesterday was already
  // right.
  float gTap = 1.0;
  float gAniso = 1.0;
  float gDiag = 0.0;
  // Day 044's (?pass=17): the fraction of each semi-axis the window's own
  // support took off it. 0 where the lobe fits inside the opening and the fetch
  // is unchanged from yesterday, 1 where the fetch had become the whole picture.
  vec2 gSupp = vec2(0.0);

  // Day 045's (?pass=18): the factor today's measured area multiplied both of
  // yesterday's semi-axes by. 1 is a fetch unchanged from Day 044.
  float gGain = 1.0;

  // Day 046's (?pass=19): the coverage the last fetch averaged — the share of
  // its footprint that was glass rather than stone. 1 is a footprint entirely
  // inside the panes, where the premultiplied divide is the identity and today
  // changes nothing.
  float gCov = 1.0;

  // Day 047's (?pass=20): the share of the footprint's glass that this point can
  // see — the weight today's fetch put on itself. 1 is a fetch in open light,
  // where the premultiply by visibility is the identity and today changes
  // nothing; below 1 is a fetch whose footprint straddles a blocker's edge, and
  // the shortfall is exactly the part of the window Day 046 was averaging into
  // the colour of a surface that cannot see it.
  float gVis = 1.0;

  // Day 048's (?pass=21): how far the tilt moved the fetch, in texels. 0 is a
  // centre unchanged from Day 041's ray-plane intersection, which is every pixel
  // whose kernel is flat across its own footprint — a small lobe far from the
  // horizon — and the map is therefore a picture of where the frame's error
  // actually lives rather than of where the light is.
  float gCtr = 0.0;

  // The half-length of the uniform slab that carries a semi-axis's variance: a
  // semi-axis a is variance a^2/4 and a slab of half-length h is h^2/3, so
  // h = a sqrt(3)/2. Stated once here and once in src/footprint.js, which is the
  // arrangement Day 042 paid a day for and Day 044 wrote the rule about.
  const float TILT_HALF = 0.86602540378;

  /**
   * coth(t) - 1/t, the Langevin function: the mean of a uniform density on
   * [-1, 1] tilted by exp(t x). Both limits taken by hand — t/3 at the origin,
   * where the ratio is 0/0, and +-1 far out, where exp overflows.
   */
  float langevin(float t) {
    float a = abs(t);
    if (a < 1e-3) return t / 3.0;
    a = min(a, 30.0);
    float e = exp(-2.0 * a);
    return sign(t) * ((1.0 + e) / (1.0 - e) - 1.0 / a);
  }

  const float LTC_SIZE  = 64.0;
  const float LTC_SCALE = (LTC_SIZE - 1.0) / LTC_SIZE;
  const float LTC_BIAS  = 0.5 / LTC_SIZE;

  /**
   * The integral of the direction over the wedge swept by one edge.
   *
   * The rational fit is for theta/sin(theta)/2pi — **including the 2pi**, which
   * is why nothing downstream divides by it. Substituting a fit for theta/sinθ
   * alone (there are several in circulation) makes every lit surface 6.28 times
   * too bright, and since the tone map saturates, it looks like a *shape* bug
   * rather than a scale one. Coefficients as in the authors' reference code.
   */
  vec3 ltcEdge(vec3 a, vec3 b) {
    float x = dot(a, b);
    float y = abs(x);
    float A = 0.8543985 + (0.4965155 + 0.0145206 * y) * y;
    float B = 3.4175940 + (4.1616724 + y) * y;
    float v = A / B;
    float ts = x > 0.0 ? v : 0.5 * inversesqrt(max(1.0 - x * x, 1e-7)) - v;
    return cross(a, b) * ts;
  }

  /**
   * The whole opening, integrated against a cosine lobe that has been linearly
   * transformed by M.
   *
   * panes are angular rectangles in the window's own frame; they become world
   * quads at uSrcDist here rather than on the CPU, because the same six vec4s
   * then serve the shadow sampler, which wants them as *angles*.
   *
   * The one-sided test is done once for the plane, not per pane. A window lights
   * the room in front of it and nothing behind it, and without this a surface
   * under the sill gets a highlight from the back of the glass.
   */
  vec3 ltcVector(vec3 P, mat3 M, float vis[LTC_PANES], out float behind, out vec3 tint) {
    vec3 sum = vec3(0.0);
    // The chromaticity accumulators. csum is the pane colours weighted by how
    // much of the lobe each pane covers; wsum the same weights alone. See the
    // header for why this is a separate sum rather than three copies of the one
    // above.
    vec3 csum = vec3(0.0);
    float wsum = 0.0;
    tint = vec3(1.0);
    // The window's normal, pointing into the room. The light camera looks down
    // -z, so its frame satisfies x cross y = +dir (target -> lamp) and B cross A
    // is therefore -dir, into the court, for any rotation of the pair. Getting
    // this backwards lights precisely the wrong half of every object, which on a
    // sphere is remarkably difficult to see.
    vec3 nW = cross(uSrcB, uSrcA);
    behind = dot(nW, P - uSrcC);

    for (int i = 0; i < LTC_PANES; i++) {
      if (i >= uPaneN) break;
      // Today's one new line in this file, and the day's whole argument.
      //
      // The edge sum is a *vector* integral over the source's solid angle, and a
      // vector integral is additive over a partition of its domain — which is
      // why six panes cost what one costs. Additivity does not care whether the
      // pieces are weighted. Scaling pane i's four edges by the fraction of pane
      // i this point can see is therefore not a hack on top of the integral; it
      // *is* the integral, of radiance times visibility, over a visibility
      // function held piecewise constant on the panes.
      //
      // Everything before today multiplied the finished form factor by one
      // scalar instead, which is the same statement with the visibility assumed
      // constant over the *whole* window. That assumption is exactly wrong where
      // it matters most: a blocker's edge does not dim a window, it covers part
      // of one.
      float wi = vis[i];
      if (wi <= 0.0) continue;   // an occluded pane is not a dim pane
      vec4 q = uPane[i];
      // tan, not the small-angle shortcut. The head tier of this window sits 10
      // degrees off the axis; the linear version would make it slightly short,
      // and only at the top, which reads as a modelling mistake rather than an
      // approximation.
      vec3 c = uSrcC + (uSrcA * tan(q.x) + uSrcB * tan(q.y)) * uSrcDist;
      vec3 ex = uSrcA * ((tan(q.x + q.z) - tan(q.x - q.z)) * 0.5) * uSrcDist;
      vec3 ey = uSrcB * ((tan(q.y + q.w) - tan(q.y - q.w)) * 0.5) * uSrcDist;

      // Counter-clockwise seen from the lit side, matching the winding the
      // horizon-clipping term was fitted against.
      vec3 p0 = normalize(M * (c + ex - ey - P));
      vec3 p1 = normalize(M * (c - ex - ey - P));
      vec3 p2 = normalize(M * (c - ex + ey - P));
      vec3 p3 = normalize(M * (c + ex + ey - P));

      vec3 e = ltcEdge(p0, p1) + ltcEdge(p1, p2) + ltcEdge(p2, p3) + ltcEdge(p3, p0);
      sum += e * wi;

      // How much of the lobe this pane covers, before the horizon fit gets to
      // touch anything: the z component is the unclipped form factor, and it is
      // the only per-pane number available that is comparable across panes.
      // Negative means the pane is behind the shading plane and contributes
      // nothing to what this point sees, so it should not vote on the colour
      // either.
      float wz = wi * max(e.z, 0.0);
      csum += wz * mix(vec3(1.0), uPaneCol[i], uTint);
      wsum += wz;
    }
    if (wsum > 1e-8) tint = csum / wsum;
    return sum;
  }

  /**
   * The mean radiance the lobe sees, read out of the window's own image — over a
   * footprint that is an ellipse.
   *
   * The source is a plane, and a linear map takes a plane to a plane, so the
   * whole of this can be done in whichever space the lobe was integrated in:
   * hand it the same M and the same bounding quad and it answers about the same
   * lobe. Nothing here is per-pane. The panes are the *shape*, and the shape has
   * already been integrated by the time this runs.
   *
   * ---------------------------------------------------------------------------
   * Today's change, which is one paragraph of geometry
   *
   * Day 041 reduced the footprint to a single number, d = distance / sqrt(area),
   * and read log2(K*d) levels down a square pyramid. That number describes a
   * *disc* on the light plane, and the set a lobe actually averages is a disc
   * only when it is looking square-on at a square. Neither is true here.
   *
   * So instead of a ratio, take the derivative. Parametrise the source plane by
   * its own (u, v) — the coordinates the texture is indexed by — and differentiate
   * the direction to it:
   *
   *     X(u,v) = p1 + u V1 + v V2          the point, from the shading point
   *     dω     = P⊥ dX / r                 P⊥ = I - ωω^T,  r = |X|
   *
   * which is a linear map J from (du, dv) to the 2D tangent plane at ω, and it is
   * the whole of the footprint. Its two columns are the projections of V1 and V2
   * perpendicular to the view, over r — so the foreshortening of an obliquely seen
   * window is in there, and so is whatever M did to the source.
   *
   * The lobe is a cosine lobe after M and therefore has one parameter left, an
   * angular radius delta. The preimage of a disc of radius delta is the ellipse
   * J⁻¹(disc), and the half-extents of its axis-aligned box — which is what a
   * ripmap is indexed by — are the row norms of J⁻¹ times delta:
   *
   *     fu = delta · |col1(J)| / |det J|     fv = delta · |col0(J)| / |det J|
   *
   * (adj(J)'s rows are J's columns rotated, so no inverse is actually formed.)
   * Times N texels, log2, and that is the level pair. Set the plane square-on and
   * M to a uniform scale and both collapse to delta·N·dist/sqrt(area) — Day 041's
   * expression exactly, with delta = K/N = 0.5. **The constant did not change;
   * it acquired a direction.**
   *
   * The axis-aligned box is the ripmap's own limitation showing through: a
   * diagonal ellipse gets bounded by a box up to sqrt(2) too big on each axis, so
   * a surface whose anisotropy runs at 45 degrees to the leads is over-blurred by
   * about half a level. Measured in NOTES. The fix is EWA or taps along the major
   * axis, and both cost more than one fetch.
   *
   * Three quantities still come out of one cross product:
   *
   *   no   = V1 × V2      the plane's normal, scaled by the quad's area
   *   A2   = |no|²        the area, squared
   *   dA   = no · p1      the plane's distance from the shading point, times the
   *                       area — because no is not normalised, and dividing it
   *                       out separately would be two square roots for nothing
   */
  vec3 glassFetch(vec3 P, mat3 M, vec3 lobe, float ff, vec3 vfit) {
    // The bounding rectangle — the *whole* opening, stone included, because the
    // image is drawn through the leads and the stone is carried by the polygons.
    // Same tan() as the panes use: at 10 degrees off axis the linear version is
    // short enough to read as a modelling error.
    vec3 ax = uSrcA * (tan(uSrcBound.x) * uSrcDist);
    vec3 ay = uSrcB * (tan(uSrcBound.y) * uSrcDist);
    vec3 o  = uSrcC - P;
    vec3 p1 = M * (o - ax - ay);   // the quad's uv origin
    vec3 V1 = M * (2.0 * ax);      // uv +x
    vec3 V2 = M * (2.0 * ay);      // uv +y

    vec3 no = cross(V1, V2);
    float A2 = dot(no, no);
    if (A2 < 1e-12) return vec3(1.0);
    float dA = dot(no, p1);

    // Where on the window the lobe is looking. The paper takes the orthogonal
    // projection of the shading point; this takes the ray along the lobe's own
    // mean direction, which the edge sum already computed. At grazing incidence
    // the two disagree by most of a window: the orthogonal projection has no idea
    // the lobe is tilted, and can land outside the opening entirely, where the
    // clamp then pins the fetch to a corner of the picture for a whole surface.
    float den = dot(no, lobe);
    float t = dA / den;
    // X is the fetch point *as a position*, not as an offset from the quad's
    // corner, because the footprint needs its distance and yesterday only needed
    // its coordinates. Same two branches, one subtraction moved.
    vec3 X = (abs(den) > 1e-6 && t > 0.0) ? lobe * t : dA * no / A2;
    vec3 hit = X - p1;

    // Coordinates of hit in the quad's own (non-orthogonal, in general) basis.
    // One Gram-Schmidt step rather than an inverse; V1 and V2 are orthogonal here
    // but they are not after M, which is the whole reason the general form is
    // written out.
    float d12 = dot(V1, V2);
    float i11 = 1.0 / dot(V1, V1);
    vec3 V2p = V2 - V1 * (d12 * i11);
    float v = dot(V2p, hit) / dot(V2p, V2p);
    float u = dot(V1, hit) * i11 - d12 * i11 * v;
    vec2 uv = clamp(vec2(u, v), 0.0, 1.0);

    // --- the footprint, as a 2x2 Jacobian ------------------------------------
    //
    // A frame perpendicular to the direction actually used. w is not the lobe in
    // the fallback branch, and using the lobe there would measure the footprint
    // of a ray that was rejected for pointing away from the plane.
    float r = max(length(X), 1e-6);
    vec3 w = X / r;
    vec3 T1 = normalize(abs(w.z) < 0.99 ? cross(vec3(0.0, 0.0, 1.0), w)
                                        : cross(vec3(1.0, 0.0, 0.0), w));
    vec3 T2 = cross(w, T1);

    // Columns are d(direction)/du and d(direction)/dv. The perpendicular
    // projection is free: T1 and T2 are already orthogonal to w, so dotting
    // against them *is* P⊥.
    vec2 c0 = vec2(dot(T1, V1), dot(T2, V1)) / r;
    vec2 c1 = vec2(dot(T1, V2), dot(T2, V2)) / r;

    // --- the footprint, as an ellipse ---------------------------------------
    //
    // Day 042 went from J straight to a bounding box, through the row norms of
    // its inverse: two lines, no eigenvalues, and enough, because a box was all
    // a ripmap could be indexed by. Today the taps run **along the major axis**,
    // and a box does not have one — so the ellipse has to be formed.
    //
    // Q = J^T J, and the preimage of the disc of angular radius delta is
    // { x : x^T Q x <= delta^2 }. Its semi-axes are delta over the square roots
    // of Q's eigenvalues, with the **smaller** eigenvalue giving the **major**
    // axis: the direction J stretches least is the direction the preimage runs
    // furthest. Q is a symmetric 2x2, so the eigenvalues are the quadratic
    // formula and an eigenvector is a row of Q - lambda I.
    //
    // This is not a different footprint from yesterday's, only a different
    // description of it — the bounding box of the ellipse below agrees with
    // Day 042's row norms to 6e-9 per cent over four thousand random Jacobians,
    // checked at the top of scripts/aniso-error.mjs, because if it did not then
    // today's n = 1 would not be yesterday's build and no comparison would mean
    // anything.
    float qa = dot(c0, c0);
    float qb = dot(c0, c1);
    float qc = dot(c1, c1);
    float tr  = 0.5 * (qa + qc);
    float dsc = sqrt(max(tr * tr - (qa * qc - qb * qb), 0.0));
    float lmin = max(tr - dsc, 1e-18);
    float lmax = max(tr + dsc, 1e-18);

    // Both candidate rows, and the longer of the two, because either one can
    // vanish on its own: the first at a circular footprint, the second wherever
    // the major axis lies exactly along u. Neither case is rare in a frame with
    // a flat floor in it, and a normalize of a zero vector is a NaN that the
    // temporal filter then spreads over the whole image in four frames.
    vec2 r0 = vec2(qb, lmin - qa);
    vec2 r1 = vec2(lmin - qc, qb);
    vec2 axis = dot(r0, r0) > dot(r1, r1) ? r0 : r1;
    axis = dot(axis, axis) > 1e-24 ? normalize(axis) : vec2(1.0, 0.0);

    // Semi-axes, in texels. uGlassK is delta*N, so it is still Day 041's
    // constant — see glass.js for why the same number now means an angle.
    float semiA = uGlassK * inversesqrt(lmin);   // major
    float semiB = uGlassK * inversesqrt(lmax);   // minor

    // Day 041, for comparison, and it is worth being exact about what "Day 041"
    // means here. Two isotropic footprints were available: the ellipse's long
    // axis — the circle that *circumscribes* it, which is what a GPU would pick
    // to avoid aliasing — and Day 041's own scalar, d = distance / sqrt(area),
    // which is the geometric mean of the two semi-axes exactly, and therefore
    // aliases a little on the long axis while over-blurring the short.
    //
    // This restores Day 041's, not the conservative one, because the point of
    // the mode is to be the previous build rather than to be a fair isotropic
    // filter. Cell (m, m) of a ripmap is mip level m texel for texel, so the
    // fetch reads the same memory Day 041 read, at the same coordinates. A round
    // footprint also takes exactly one tap, so this line switches the day off as
    // well — which it should, since there is no major axis to walk along.
    if (uAniso < 0.5) {
      semiA = max(abs(dA) / pow(A2, 0.75), 0.0) * uGlassK;
      semiB = semiA;
    }

    // --- today: the window is part of the kernel ------------------------------
    //
    // Three days have read an ellipse that is the preimage of a disc of angular
    // radius delta, and delta has been half a radian since Day 041, where it was
    // chosen by eye. What the fetch stands in for is the lobe-weighted mean of
    // the window's image — and the *window* is half of that weight. Outside the
    // opening there is nothing to average. The shader has been saying so all
    // along by clamping uv into [0, 1], but a clamp moves the centre of a fetch
    // and never shrinks it, so a surface far enough away, or rough enough, asked
    // for an ellipse many times wider than the picture and got the top of the
    // pyramid: the flat mean of the whole window, with the lobe's own shape
    // thrown away.
    //
    // Two kernels multiplying is two variances adding reciprocally, and the unit
    // square's covariance is isotropic and exactly (1/12) I — so the support
    // does not turn the ellipse, only shortens both of its axes, and the
    // eigenvectors above are still the answer. Matching a semi-axis to that
    // variance, a^2/4 = N^2/12, gives an ellipse of N/sqrt(3) texels, which is
    // what uSupport holds:
    //
    //     1 / A_eff^2 = 1 / A^2 + 1 / uSupport^2
    //
    // Two lines, no new fetch, and uSupport = 0 is Day 043 exactly. Measured
    // against a brute-forced lobe-weighted mean it is worth more than the last
    // two mornings put together: 8.09% to 4.44%. See scripts/lobe-error.mjs.
    float shrinkA = 1.0;
    float shrinkB = 1.0;
    if (uSupport > 0.0) {
      float isup = 1.0 / (uSupport * uSupport);
      float nA = inversesqrt(1.0 / (semiA * semiA) + isup);
      float nB = inversesqrt(1.0 / (semiB * semiB) + isup);
      shrinkA = nA / max(semiA, 1e-9);
      shrinkB = nB / max(semiB, 1e-9);
      semiA = nA;
      semiB = nB;
    }

    // --- today: the area is measured, not chosen -----------------------------
    //
    // Everything above is a rule for a *size*, and both of its constants were
    // picked rather than measured: delta by eye on Day 041, the support from the
    // unit square yesterday. Neither knows that this opening is six panes in
    // three tiers with stone between them.
    //
    // The kernel has an area and it is not a matter of choice. In uv the kernel
    // is k = max(w_z, 0) . dw/dA — the lobe's density times the change of
    // variables to the sphere — and two facts about k are already on this
    // function's stack by the time it gets here:
    //
    //   its mass.  W = pi . ltcClip(f), the scalar the caller is about to
    //              multiply this tint by. Summed over the *panes*, weighted by
    //              each pane's visibility, clipped at the horizon: the mullions,
    //              the tiers and the blocker's edge are all already inside it.
    //   its peak.  p = w.z . |det J|, and |det J| = sqrt(lmin . lmax) — the two
    //              eigenvalues the ellipse's shape was just formed from.
    //
    // Mass over peak is an area: exactly pi.a.b for a kernel uniform on its
    // ellipse, half that for a Gaussian of the same covariance. So one
    // dimensionless profile constant carries the difference and uMass holds it,
    // measured at 1.2 over 1024 configurations — nearer the flat end, which is
    // the right sign for a cosine truncated by an opening.
    //
    //     a . b = uMass . ltcClip(f) . N^2 / (w.z . sqrt(lmin lmax))
    //
    // and delta is nowhere in it. Aspect and orientation are left exactly as
    // they were: this scales both semi-axes by one number, so uMass = 0 is
    // Day 044 to the texel and ?mass=0 is yesterday's build.
    float gain = 1.0;
    if (uMass > 0.0) {
      float peak = max(w.z, 0.0) * sqrt(lmin * lmax);
      // The cap is the largest ellipse a kernel living on the unit square can
      // have — variance at most 1/4 per axis, so a semi-axis at most N. It
      // guards peak -> 0 for a fetch direction grazing the window's own plane;
      // the measured areas sit two orders below it.
      float ab = peak > 1e-20
        ? min(uMass * max(ff, 0.0) * uRipBase * uRipBase / peak, uRipBase * uRipBase)
        : uRipBase * uRipBase;
      float cur = semiA * semiB;
      gain = cur > 1e-20 ? sqrt(ab / cur) : 1.0;
      semiA *= gain;
      semiB *= gain;
    }

    // --- today: the centre, tilted onto the kernel it stands for -------------
    //
    // Everything above this line is about the ellipse's *size and shape*. Where
    // it is centred has not been touched since Day 041, and Day 047 measured
    // that this is now the largest single term left: hand the fetch the visible
    // kernel's own first moment and the error falls 5.48 -> 4.35, against 4.84
    // for its shape and 4.97 for its area.
    //
    // Why the centre is wrong is a one-line argument. f is the integral of w
    // over the *solid angle* of the opening, so f/|f| is the solid angle's own
    // centroid direction, and the ray along it is a defensible point on the
    // plane. But the kernel is the solid angle times the cosine, and the plane
    // is not the sphere — two weights the mean direction has never carried.
    //
    // Both of them are elementary once the kernel is written on the plane. Every
    // point of the window is X = p1 + u V1 + v V2, and the change of variables
    // from uv area to solid angle is (no . X)/|X|^3 — where no . X is the same
    // number dA for every point of a plane. So
    //
    //     k(u, v)  =  max(X_z, 0) . dA / |X|^4
    //
    // and its log-gradient along a direction E of the plane is
    //
    //     d log k / dE  =  E_z / X_z  -  4 (E . X) / |X|^2
    //
    // — the cosine and the falloff, six dot products, no fetch and no loop.
    //
    // The step it justifies is not the textbook one. Laplace's move is
    // x + Sigma . grad, which is right in the limit and useless at the other
    // end: a diffuse footprint covering the opening has Sigma ~ 1/4 in uv and
    // asks to move half a window. The fault is the model, not the gradient — a
    // density supported on the ellipse cannot have its mean outside it. So tilt
    // the profile the taps *already* assume instead. Along each axis the
    // footprint is a slab of half-length h, and an exponentially tilted uniform
    // density on [-h, h] has a centroid in closed form:
    //
    //     <x>  =  h . L(g h),          L(t) = coth t - 1/t
    //
    // the Langevin function. It is the Laplace step for small tilts — L(t) -> t/3
    // and a uniform slab's variance is h^2/3, so h^2 g/3 = sigma^2 g exactly —
    // and it saturates at +-h, so the centre slides to the edge of the footprint
    // and never past it. The boundedness is a property of the density rather
    // than a clamp bolted on afterwards, which is the whole reason for using it.
    //
    // uTilt is 0.5 and not 1, and that is measured rather than tuned: regressed
    // against the kernel's true first moment the prediction has slope 0.47 and
    // R 0.62, and the sweep of the constant bottoms out at 0.5 on both harnesses
    // independently. A predictor right in direction and imperfect in detail is
    // applied at its reliability, not at full strength. See src/footprint.js.
    //
    // ?tilt=0 removes the day: two vectors are formed and nothing moves.
    float gStep = 0.0;
    if (uTilt > 0.0) {
      // The two axes as displacements of the plane: one uv unit along each of
      // the ellipse's own directions.
      vec3 Ea =  axis.x * V1 + axis.y * V2;
      vec3 Eb = -axis.y * V1 + axis.x * V2;
      // The cosine's term is dropped rather than clipped where the fetch
      // direction grazes the transformed plane: X.z -> 0 is the horizon, where
      // max(w.z, 0) has already truncated the kernel and a 1/X.z would be
      // describing a factor that is not there.
      float izx = X.z > 1e-4 * r ? 1.0 / X.z : 0.0;
      float ir2 = 1.0 / (r * r);
      float ga = Ea.z * izx - 4.0 * dot(Ea, X) * ir2;
      float gb = Eb.z * izx - 4.0 * dot(Eb, X) * ir2;
      // The half-length of the uniform slab carrying the ellipse's own variance:
      // a semi-axis a is variance a^2/4 (Day 044's convention, the one the
      // support term was matched with) and a slab of half-length h is h^2/3.
      float ha = TILT_HALF * semiA / uRipBase;
      float hb = TILT_HALF * semiB / uRipBase;
      vec2 d = axis * (ha * langevin(uTilt * ga * ha))
             + vec2(-axis.y, axis.x) * (hb * langevin(uTilt * gb * hb));
      uv = clamp(uv + d, 0.0, 1.0);
      gStep = length(d) * uRipBase;
    }
    // How far today moved the fetch, in texels. 0 is a centre unchanged from
    // Day 041's ray. Drawn by ?pass=21.
    gCtr = gStep;

    // --- Day 043: n taps along the major axis --------------------------------
    //
    // Cut the ellipse into n slabs perpendicular to its major axis and read slab
    // k as its own sub-ellipse of semi-axes (A/n, B), centred on the slab. The
    // sub-ellipses are congruent, so **all n taps share one level pair** and the
    // ripmap still does the axis-aligned part of the work; the taps buy only the
    // part it has no index for, which is where along a diagonal major axis the
    // ellipse actually is. And they tile: centre (A - A/n) plus half-length A/n
    // reaches exactly A, with no gap and no overlap.
    //
    // n = 1 puts the centre at 0 and the half-length at A. Same box, same cells,
    // same memory: ?tap=1 is Day 042, and the harness scores the two identical
    // to the last printed digit wherever the anisotropy is under 1.5x.
    float capN = min(float(LTC_TAPS), max(uTapMax, 1.0));
    float fn = clamp(floor(semiA / max(semiB, 1e-6) + 0.5), 1.0, capN);
    int taps = int(fn);
    float sub = semiA / fn;

    // The sub-ellipse's axis-aligned bounding box, in texels, then in levels.
    vec2 fp = vec2(length(vec2(sub * axis.x, semiB * axis.y)),
                   length(vec2(sub * axis.y, semiB * axis.x)));
    vec2 lod = clamp(log2(max(fp, vec2(1.0))), vec2(0.0), vec2(uGlassMax));

    gLod = lod;
    gTap = fn;
    gAniso = semiA / max(semiB, 1e-6);
    // Zero where the major axis lies along a texture axis, one at 45 degrees to
    // it: the pixels where a ripmap on its own had to bound a diagonal ellipse
    // by a box up to sqrt(2) too big on both sides. Drawn by ?pass=16.
    gDiag = abs(2.0 * axis.x * axis.y);
    // How much of each axis today took away. 0 is a lobe entirely inside the
    // opening — nothing to correct — and 1 is a fetch that had become the whole
    // window. Drawn by ?pass=17.
    gSupp = vec2(1.0 - shrinkA, 1.0 - shrinkB);
    // Day 045: how far today moved the ellipse. 1 is a fetch identical to
    // yesterday's; below 1 the measurement asked for a tighter footprint than
    // the two constants did, above 1 a wider one. Drawn by ?pass=18.
    gGain = gain;

    // The outermost tap centre, in uv, and the walk between them.
    vec2 along = axis * ((semiA - sub) / uRipBase);
    float inv = taps > 1 ? 1.0 / (fn - 1.0) : 0.0;

    // Day 046: premultiplied, so the accumulator is four wide. The n taps are a
    // weighted mean of the same footprint, and colour and coverage go through it
    // together — one divide at the end makes the whole multi-tap fetch the mean
    // of the glass over the union of the slabs, which is what the integral is
    // over. Dividing per tap would average n ratios, and a slab that landed on a
    // mullion would then contribute a colour it has no glass to justify.
    // Day 047: the third weight on the same accumulator.
    //
    // Yesterday's aperture rides *in* the pyramid because it is a property of the
    // window — the same mask for every pixel in the frame, so it can be filtered
    // once and read forever. Visibility is a property of the *point*, so it
    // cannot be in the texture; but the arithmetic that made the aperture work
    // does not care where the factor comes from. Premultiplying each tap by the
    // visibility at its own centre carries (L·m·V, m·V) through the same sum, and
    // the same single divide at the end returns
    //
    //     Σ w·V·mean(L·m)  /  Σ w·V·mean(m)   =  the mean of L over the part of
    //                                            the glass this point can see
    //
    // which is the second factor of the split-sum written honestly. The first
    // factor — ltcClip(Σ vis_i e_i) — already carries how *much* gets through, so
    // there is no double count: the mass is the panes', the mean is the visible
    // glass's, and their product is ∫ L V k rather than (∫ V k)(∫ L k / ∫ k).
    //
    // Two things make the point evaluation legitimate rather than lazy. The fit
    // is a plane (visfit.js), and a plane's mean over a region symmetric about
    // its centre *is* its value at the centre — so for this model each slab's
    // weight is the slab's exact mean visibility, not a sample of it. And the
    // slabs run along the major axis, which is the direction the footprint is
    // long in and therefore the direction V has room to vary across; what is
    // dropped is the correlation across the minor axis, where the footprint is
    // by construction narrow.
    vec4 acc = vec4(0.0);
    float wsum = 0.0;
    float vsum = 0.0;
    float asum = 0.0;
    float prev = -0.5;   // F(-1)
    for (int k = 0; k < LTC_TAPS; k++) {
      if (k >= taps) break;
      // The exact area of the ellipse in slab k, as a fraction of the whole.
      // F(x) = (x sqrt(1-x^2) + asin x)/pi is the area of the unit disc left of
      // x, over pi, so the difference of two of them is the slab. These are
      // constants of n alone — nothing here is tuned, and they sum to one by
      // construction rather than by the division below, which is a guard.
      float cx = clamp(2.0 * float(k + 1) / fn - 1.0, -1.0, 1.0);
      float F = (cx * sqrt(max(1.0 - cx * cx, 0.0)) + asin(cx)) / PI;
      float w = F - prev;
      prev = F;
      float s = (2.0 * float(k) - (fn - 1.0)) * inv;
      vec2 tuv = clamp(uv + along * s, 0.0, 1.0);
      float vk = visAt(vfit, tuv);
      vec4 c = ripFetch(tuv, lod);
      acc  += (w * vk) * c;
      wsum += w;
      // What the visibility took off this fetch, weighted the way the fetch
      // weights everything else: the ratio of the two alphas is the share of the
      // footprint's glass that this point can actually see. 1 is a fetch today
      // did not touch. Drawn by ?pass=20.
      // visRaw, not visAt: the map is of the *window*, not of the switch, so
      // ?pass=20 draws the same picture whether the mechanism is on or off — the
      // way ?pass=17 and ?pass=19 draw where their days are rather than what
      // they did.
      vsum += w * visRaw(vfit, tuv) * c.a;
      asum += w * c.a;
    }
    acc /= max(wsum, 1e-6);
    gVis = asum > 1e-6 ? clamp(vsum / asum, 0.0, 1.0) : 1.0;
    // How much of what this fetch averaged was glass. 1 is a footprint entirely
    // inside the panes — today changed nothing there — and 0 is one entirely
    // inside the stone, where there is nothing to average and glassMean returns
    // the whole window. Drawn by ?pass=19.
    //
    // Day 047: taken from the *unweighted* sum, so ?pass=19 still draws what it
    // drew yesterday — a property of the window, not of this point's shadow.
    // acc.a is now coverage times visibility, and mixing the two into one
    // read-out would have made the coverage map light up along every penumbra in
    // the room for a reason that has nothing to do with the mullions.
    gCov = asum / max(wsum, 1e-6);
    return mix(vec3(1.0), glassMean(acc), uTint);
  }

  /**
   * Heitz's clipped-sphere approximation, applied once to the accumulated
   * vector. This is the only inexact step in the method — the exact answer needs
   * the polygon clipped against the horizon, which is a variable-length loop —
   * and applying it to the sum rather than to each pane is what keeps six
   * openings costing the same as one.
   */
  float ltcClip(vec3 f) {
    float l = length(f);
    return max((l * l + f.z) / (l + 1.0), 0.0);
  }

  /**
   * World -> the shading frame the lobe is tabulated in. The rows are the frame's
   * axes, so this is the transpose of the usual tangent matrix.
   *
   * T2 is negated relative to the paper. three carries the same negation with a
   * shrug of a comment about handedness, and it is not cosmetic: flip it and the
   * basis becomes left-handed, every edge's cross product changes sign, and the
   * form factor comes back negative — which ltcClip's max() then turns into an
   * unlit surface rather than into an error.
   */
  mat3 ltcFrame(vec3 N, vec3 V) {
    vec3 t = V - N * dot(V, N);
    float tl = length(t);
    // Looking straight down a normal leaves nothing to project; any tangent will
    // do there, and a silhouette pixel where V and N nearly coincide is exactly
    // where a NaN would otherwise be born and then spread by the temporal filter.
    vec3 T1 = tl > 1e-5 ? t / tl : normalize(cross(N, abs(N.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
    vec3 T2 = -cross(N, T1);
    return mat3(T1.x, T2.x, N.x, T1.y, T2.y, N.y, T1.z, T2.z, N.z);
  }

  /**
   * The diffuse term: the same integral with the identity, which *is* the
   * horizon-clipped irradiance of the polygon set, normalised so a full
   * hemisphere returns 1.
   *
   * This replaces Lambert's cosine and Day 037's disc fit at the same time. It
   * is not a widened cosine — the terminator's width and its shape both come out
   * of the geometry, so the band across the bowl is a couple of degrees narrower
   * where the mullion is pointing at it. Nobody will see that. What they will see
   * is that the band exists and has no crease in it anywhere.
   */
  vec3 ltcDiffuse(vec3 P, vec3 N, vec3 V, float vis[LTC_PANES], vec3 vfit) {
    mat3 F = ltcFrame(N, V);
    float behind;
    vec3 tint;
    vec3 f = ltcVector(P, F, vis, behind, tint);
    if (behind <= 0.0) return vec3(0.0);
    float l = length(f);
    // Nothing visible at all. Guarded before the normalize rather than after,
    // because a NaN born here is spread over the whole frame by the temporal
    // filter within about four frames and looks like a bug in the accumulation.
    if (l < 1e-8) return vec3(0.0);
    // The scalar is formed before the fetch rather than after it, because from
    // today the fetch needs it: it is the mass of the very kernel the footprint
    // is trying to describe. No extra work — the same call, moved one line up.
    float ff = ltcClip(f);
    if (uTexLight > 0.5) tint = glassFetch(P, F, f / l, ff, vfit);
    return ff * tint;
  }

  /**
   * The specular term. Two lookups: the inverse transform, and the pair of
   * coefficients that turn f0 into a Fresnel-and-energy factor for the whole
   * lobe rather than for one direction.
   */
  vec3 ltcSpecular(vec3 P, vec3 N, vec3 V, float rough, float f0, float vis[LTC_PANES], vec3 vfit) {
    vec2 uv = vec2(rough, sqrt(1.0 - clamp(dot(N, V), 0.0, 1.0)));
    uv = uv * LTC_SCALE + LTC_BIAS;
    vec4 t1 = TEX2D(uLtcMat, uv);
    vec4 t2 = TEX2D(uLtcMag, uv);

    // The LUT stores M^-1 in the lobe's own tangent frame, in the paper's
    // sparse layout: only four of nine entries are ever non-zero.
    mat3 Minv = mat3(
      vec3(t1.x, 0.0, t1.y),
      vec3(0.0, 1.0, 0.0),
      vec3(t1.z, 0.0, t1.w)
    );

    float behind;
    vec3 tint;
    mat3 M = Minv * ltcFrame(N, V);
    vec3 f = ltcVector(P, M, vis, behind, tint);
    if (behind <= 0.0) return vec3(0.0);
    float l = length(f);
    if (l < 1e-8) return vec3(0.0);
    float ff = ltcClip(f);
    // The same fetch, in the *lobe's* space. Minv stretches the polygon by
    // roughly the reciprocal of the lobe's width, so d = dist / sqrt(area)
    // falls with the roughness and the level falls with it: the near tablet at
    // 0.05 lands around four levels down and reads the quarries, the far one at
    // 0.125 lands near the top and reads a colour. **The pair of tablets is the
    // pyramid, rendered.** Nothing selects that; the geometry does.
    if (uTexLight > 0.5) tint = glassFetch(P, M, f / l, ff, vfit);

    // Split-sum Fresnel for the whole lobe. f90 is 1 for everything here.
    float F = f0 * t2.x + (1.0 - f0) * t2.y;
    // The tint the *lobe* sees, which is not the tint the cosine sees: the GGX
    // transform narrows the set of panes a glaze can reach, so at roughness 0.06
    // the highlight can be reading one pane while the diffuse term two
    // millimetres away is averaging all six. That divergence is the picture.
    return ff * F * tint;
  }
`
