import * as THREE from 'three'
import { RectAreaLightTexturesLib } from 'three/examples/jsm/lights/RectAreaLightTexturesLib.js'

/**
 * Day 039 — the same integral, with the shadow moved inside it.
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
  vec3 ltcVector(vec3 P, mat3 M, float vis[LTC_PANES], out float behind) {
    vec3 sum = vec3(0.0);
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
    }
    return sum;
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
  float ltcDiffuse(vec3 P, vec3 N, vec3 V, float vis[LTC_PANES]) {
    mat3 F = ltcFrame(N, V);
    float behind;
    vec3 f = ltcVector(P, F, vis, behind);
    if (behind <= 0.0) return 0.0;
    return ltcClip(f);
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
    vec3 f = ltcVector(P, Minv * ltcFrame(N, V), vis, behind);
    if (behind <= 0.0) return vec3(0.0);
    float ff = ltcClip(f);

    // Split-sum Fresnel for the whole lobe. f90 is 1 for everything here.
    float F = f0 * t2.x + (1.0 - f0) * t2.y;
    return vec3(ff * F);
  }
`
