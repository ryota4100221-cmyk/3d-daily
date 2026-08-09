/**
 * Day 037's shading, kept whole, as the thing today is measured against.
 *
 * Nothing in the shipping frame calls this any more: `ltc.js` replaced both
 * functions this morning. It stays compiled into the composite because a claim
 * is only worth making if it can be removed, and `?pass=8` removes it — the same
 * scene, the same window, the same shadows, shaded by yesterday's representative
 * point and per-axis lobe widening instead of by an integral.
 *
 * Two edits, both mechanical: `shAng()` is gone, so the source's extent is read
 * from `uSrcBound` (the window's bounding half-angles, which is exactly the
 * ellipse yesterday would have been given), and the day's comparison switches
 * are `uLtc` rather than `uIso`. What the picture then shows is the *difference
 * between an approximation and an integral*, on identical geometry: a lozenge
 * where there should be a window, and a highlight that collapses into a crease
 * along the lacquer's grazing edge where the MRP's clamp runs out.
 *
 * ---------------------------------------------------------------------------
 * Original header follows.
 *
 * Day 037 — the other half of "the lamp has a size".
 *
 * `shadow.js` has known the source's angular extent since yesterday. This file
 * is what happens when the *shading* is told as well. It is meant to be pasted
 * into a shader that has already pasted `SHADOW_GLSL`, because everything here
 * reads that block's uniforms — `uLightView`, `uLightAng`, `uSrcAxis`, `uIso`
 * — and the whole point of the day is that there is exactly one description of
 * the source and all three terms read it.
 *
 * Two functions, two textbook results, and one consequence each.
 *
 * ---------------------------------------------------------------------------
 * areaNdL — the terminator
 *
 * Lambert's `max(dot(n, L), 0)` is the irradiance from a source of zero size.
 * A real source of angular radius sigma starts setting *before* the geometric
 * horizon and finishes after it, so the falloff is a band about 2*sigma wide
 * rather than a crease. The closed form for a disc partially below the horizon
 * (Frostbite, "Moving Frostbite to PBR", listing 10) is:
 *
 *     cos^2 > sin^2(sigma)   ->   pi * sin^2(sigma) * cos          (fully above)
 *     otherwise              ->   an arccos/arctan expression      (straddling)
 *
 * divided here by `pi * sin^2(sigma)` so it *is* Lambert as sigma -> 0 and the
 * scene's exposure does not move. Above the band it agrees with yesterday's
 * frame to the last bit; through the band it is the only thing that can make a
 * cylinder roll out of the light instead of stopping.
 *
 * Which sigma? An ellipse does not have one. It has a radius in every direction,
 * `r(d) = 1/sqrt((d.x/a)^2 + (d.y/b)^2)`, and the direction that matters is the
 * one the surface is *tilting* in — the projection of the normal onto the plane
 * perpendicular to L, expressed in the source's own axes. So a vertical rod and
 * a horizontal beam under the same slot get terminators of different widths, and
 * they are correct rather than tuned.
 *
 * ---------------------------------------------------------------------------
 * areaSpec — the highlight
 *
 * Karis's two-part treatment of sphere lights (Real Shading in UE4, 2013),
 * generalised from a disc to an ellipse.
 *
 *   representative point   the mirror direction R is clamped into the source's
 *                          elliptical cone. Where R already lands inside the
 *                          opening, the surface sees the opening's *interior*
 *                          and the highlight is bright right across it — which
 *                          is what makes a bar instead of a dot.
 *   lobe widening          alpha' = alpha + theta/2, per axis. Two different
 *                          alphas is an anisotropic GGX, so the lobe is
 *                          evaluated in a tangent frame built from the source's
 *                          own long axis projected onto the surface.
 *
 * The pair double-counts slightly — the MRP has already moved the peak — and
 * that is the accepted price of not integrating the source per pixel. What is
 * *not* here is Karis's (alpha/alpha')^2 energy term; see the note beside the
 * widening for why it belongs to a different formulation and what it does to a
 * glaze if you paste it in anyway.
 *
 * A rough surface barely notices any of this: at roughness 0.8 the lobe is
 * already wider than the opening. The one glazed thing in the frame is what the
 * function is for, and it is why the scene has one.
 */

export const AREA_GLSL = /* glsl */ `
  const float A_PI = 3.14159265359;

  /**
   * The source's two axes, in world space. The light view matrix's rows are the
   * light frame's axes expressed in world coordinates — and since GLSL indexes
   * a mat4 by *column*, taking a row means picking one component out of three
   * columns. Getting this transposed produces a highlight that is anisotropic
   * in a direction nothing in the scene has any reason to prefer, which is
   * remarkably hard to notice.
   */
  void srcAxes(out vec3 A, out vec3 B) {
    vec3 lx = vec3(uLightView[0].x, uLightView[1].x, uLightView[2].x);
    vec3 ly = vec3(uLightView[0].y, uLightView[1].y, uLightView[2].y);
    A = normalize(lx * uSrcAxis.x + ly * uSrcAxis.y);   // along the slot
    B = normalize(ly * uSrcAxis.x - lx * uSrcAxis.y);   // across it
  }

  /** Half-angle of the source in a unit direction of its own frame. */
  float srcRadius(vec2 d) {
    vec2 a = uSrcBound;
    float q = (d.x * d.x) / (a.x * a.x) + (d.y * d.y) / (a.y * a.y);
    return q > 1e-8 ? inversesqrt(q) : max(a.x, a.y);
  }

  /**
   * Irradiance from a disc of angular radius sigma, normalised to Lambert.
   * Reduces to max(ndl, 0); widens the terminator to about 2*sigma.
   */
  float discNdL(float ndl, float sigma) {
    float ss = sin(sigma);
    float s2 = max(ss * ss, 1e-7);
    float ct = clamp(ndl, -1.0, 1.0);
    float st = sqrt(max(1.0 - ct * ct, 1e-8));

    float E;
    if (ct * ct > s2) {
      E = A_PI * s2 * max(ct, 0.0);          // the whole source is above the horizon
    } else {
      float x = sqrt(max(1.0 / s2 - 1.0, 1e-6));
      float y = clamp(-x * ct / st, -1.0, 1.0);
      float sy = st * sqrt(max(1.0 - y * y, 0.0));
      E = (ct * acos(y) - x * sy) * s2 + atan(sy / x);
    }
    return max(E, 0.0) / (A_PI * s2);
  }

  /**
   * The cosine term, with the source's shape in it. Both vectors are world
   * space, and L points at the source.
   */
  float areaNdL(vec3 n, vec3 L) {
    float ndl = dot(n, L);
    // Which way is this surface rolling away from the light? The part of the
    // normal perpendicular to L, read in the source's own axes.
    vec3 m = n - L * ndl;
    float ml = length(m);
    if (ml < 1e-5) return discNdL(ndl, srcRadius(vec2(1.0, 0.0)));
    vec3 A, B; srcAxes(A, B);
    m /= ml;
    vec2 d = vec2(dot(m, A), dot(m, B));
    float dl = length(d);
    return discNdL(ndl, srcRadius(dl > 1e-5 ? d / dl : vec2(1.0, 0.0)));
  }

  /**
   * The specular lobe, widened and stretched by the source's two angles, and
   * pointed at the representative point rather than the source's centre.
   * Returns the lobe *including* its own cosine, because the direction it uses
   * is not the one the diffuse term uses.
   */
  vec3 areaSpec(vec3 n, vec3 V, vec3 L, float rough, float f0) {
    vec3 A, B; srcAxes(A, B);
    vec2 ang = uSrcBound;
    float ndv = max(dot(n, V), 1e-3);

    // --- representative point ------------------------------------------------
    vec3 R = reflect(-V, n);
    float rl = dot(R, L);
    vec3 Lr = L;
    if (rl > 0.05) {
      vec3 pr = R - L * rl;                       // R's offset from the centre
      vec2 c = vec2(dot(pr, A), dot(pr, B));
      float k = length(vec2(c.x / ang.x, c.y / ang.y));
      if (k > 1.0) c /= k;                        // clamp into the ellipse
      Lr = normalize(L * rl + A * c.x + B * c.y);
    }

    // --- a tangent frame the source can be measured in ----------------------
    vec3 T = A - n * dot(n, A);
    float tl = length(T);
    if (tl < 1e-4) { T = B - n * dot(n, B); tl = max(length(T), 1e-6); }
    T /= tl;
    vec3 Bt = cross(n, T);

    // --- the lobe, widened per axis -----------------------------------------
    //
    // theta/2 and not theta: the half-vector has to move by half an angle for
    // the reflected direction to move by a whole one, and it is the half-vector
    // GGX is parameterised over.
    //
    // There is deliberately **no energy normalisation** here, and that is worth
    // a paragraph because the first version of this function had one and it cost
    // an hour. Karis's sphere-light note multiplies by (alpha/alpha')^2, and
    // pasting that in makes a mirror reflect *nothing*: as alpha -> 0 the factor
    // goes to zero while the true answer, the source's own radiance times F,
    // does not. GGX's D is already normalised — widening it redistributes energy
    // without creating any — so the widening on its own is the whole correction.
    // The check is a number, not an opinion: at the peak this returns
    //     E * F / (pi * ax * ay)  =  2.24
    // against a true mirror's L_src * F = (E / omega) * F = 2.65, where omega is
    // the source's solid angle. Fifteen per cent, from four lines.
    float a = max(rough * rough, 0.002);
    float ax = clamp(a + ang.x * 0.5, 0.0, 1.0);
    float ay = clamp(a + ang.y * 0.5, 0.0, 1.0);

    vec3 H = normalize(V + Lr);
    float ndl = max(dot(n, Lr), 1e-4);
    float ndh = max(dot(n, H), 0.0);
    float vdh = max(dot(V, H), 0.0);

    // Anisotropic GGX in Filament's stable arrangement — the naive form loses
    // all its precision on a smooth surface, which is the only kind that shows
    // the effect.
    float a2 = ax * ay;
    vec3 dv = vec3(ay * dot(T, H), ax * dot(Bt, H), a2 * ndh);
    float w2 = a2 / max(dot(dv, dv), 1e-9);
    float D = a2 * w2 * w2 / A_PI;

    // Smith height-correlated visibility, anisotropic. Includes the 1/(4·ndl·ndv).
    float lv = ndl * length(vec3(ax * dot(T, V), ay * dot(Bt, V), ndv));
    float ll = ndv * length(vec3(ax * dot(T, Lr), ay * dot(Bt, Lr), ndl));
    float Vs = 0.5 / max(lv + ll, 1e-5);

    float F = f0 + (1.0 - f0) * pow(1.0 - vdh, 5.0);
    return vec3(D * Vs * F * ndl);
  }
`
