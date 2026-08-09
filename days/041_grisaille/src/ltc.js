import * as THREE from 'three'
import { RectAreaLightTexturesLib } from 'three/examples/jsm/lights/RectAreaLightTexturesLib.js'

/**
 * Day 041 — the same integral, over a source that is now a picture.
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
  // uGlass / uGlassMax / uGlassK / uTexLight come from SHADOW_GLSL, which is
  // always concatenated ahead of this — the source is described in one place,
  // and today the description grew a texture.

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
   * The mean radiance the lobe sees, read out of the window's own image.
   *
   * The source is a plane, and a linear map takes a plane to a plane, so the
   * whole of this can be done in whichever space the lobe was integrated in:
   * hand it the same M and the same bounding quad and it answers about the same
   * lobe. Nothing here is per-pane. The panes are the *shape*, and the shape has
   * already been integrated by the time this runs.
   *
   * Three quantities out of one cross product:
   *
   *   no   = V1 × V2      the plane's normal, scaled by the quad's area
   *   A2   = |no|²        the area, squared
   *   dA   = no · p1      the plane's distance from the shading point, times the
   *                       area — because no is not normalised, and dividing it
   *                       out separately would be two square roots for nothing
   *
   * from which d = |dA| / A2^0.75 = distance / sqrt(area) is the source's
   * apparent size, inverted: small when the window is large and near, large when
   * it is small and far. That single ratio is the footprint, because after M the
   * lobe is a cosine lobe and a cosine lobe has no parameters left to vary.
   */
  vec3 glassFetch(vec3 P, mat3 M, vec3 lobe) {
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
    vec3 hit = (abs(den) > 1e-6 && t > 0.0) ? lobe * t - p1 : dA * no / A2 - p1;

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

    // How much of the picture the lobe averages, as a level of the pyramid.
    // uGlassK texels per unit of d, then log2 — the paper's log(2048*d)/log(3)
    // is this, written for a base-3 pyramid. Clamped at both ends: below zero
    // there is no more detail to fetch, above the top there is no more averaging
    // to do, and the top of a mean-preserving pyramid is exactly white.
    float d = abs(dA) / pow(A2, 0.75);
    float lod = clamp(log2(max(d * uGlassK, 1.0)), 0.0, uGlassMax);

    return mix(vec3(1.0), TEXLOD(uGlass, uv, lod).rgb, uTint);
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
  vec3 ltcDiffuse(vec3 P, vec3 N, vec3 V, float vis[LTC_PANES]) {
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
    if (uTexLight > 0.5) tint = glassFetch(P, F, f / l);
    return ltcClip(f) * tint;
  }

  /**
   * The specular term. Two lookups: the inverse transform, and the pair of
   * coefficients that turn f0 into a Fresnel-and-energy factor for the whole
   * lobe rather than for one direction.
   */
  vec3 ltcSpecular(vec3 P, vec3 N, vec3 V, float rough, float f0, float vis[LTC_PANES]) {
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
    if (uTexLight > 0.5) tint = glassFetch(P, M, f / l);

    // Split-sum Fresnel for the whole lobe. f90 is 1 for everything here.
    float F = f0 * t2.x + (1.0 - f0) * t2.y;
    // The tint the *lobe* sees, which is not the tint the cosine sees: the GGX
    // transform narrows the set of panes a glaze can reach, so at roughness 0.06
    // the highlight can be reading one pane while the diffuse term two
    // millimetres away is averaging all six. That divergence is the picture.
    return ff * F * tint;
  }
`
