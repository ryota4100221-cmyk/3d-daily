/**
 * Day 047 — visibility, as something the fetch can be *weighted by*.
 *
 * Yesterday's NOTES put this at the top of its own list, and it has been on that
 * list since Day 041:
 *
 *   > **可視性も画像にする。今の最上位。** 今日「ペイン単位の可視率 `vis[i]` は
 *   > `ltcClip(f)` を通って面積の測定に入っている」と書いたが、**その可視率の
 *   > 粒度はいまも 6** である。放射輝度をテクセル解像度にした今、形状（6枚）と
 *   > **遮蔽**（6つの数）が残った2つの粗い量で、しかも遮蔽の方が動く。
 *
 * The split the renderer has used since Day 039 is
 *
 *     result  =  ltcClip( Σ vis_i e_i )   ×   L̄(footprint)
 *                ^ the visible *mass*         ^ the mean radiance, unweighted
 *
 * and the second factor has no visibility in it at all. So a lath across the
 * left light dims the answer and does not change its colour: the fetch goes on
 * averaging the panes that are in shadow together with the ones that are not,
 * and the surface stays as warm as it was while getting darker. That is exactly
 * the error a split-sum makes when its two factors are correlated —
 *
 *     ∫ L V k  =  (∫ V k) · (∫ L V k / ∫ V k)   exactly, always
 *              ≈  (∫ V k) · (∫ L k   / ∫ k)     what Day 046 computes
 *
 * — and the difference between the two lines is the covariance of L and V over
 * the lobe's own footprint. Nothing about it is small here: the whole subject of
 * this window is that its two lights are different colours.
 *
 * ---------------------------------------------------------------------------
 * What has to be carried, and why it is three numbers
 *
 * The correction needs V *inside* the footprint, so the shading point has to
 * hand the fetch a description of its own visibility over the window rather than
 * a single fraction of it. Day 039's answer — one number per pane — is the
 * description the mask already computes, and it is available for free. It is
 * also the wrong shape for this job in two ways:
 *
 *   it is discontinuous where the window is not. The panes are where the
 *   *radiance* jumps; a blocker's silhouette has no idea the mullions exist and
 *   crosses them wherever it likes. A basis aligned to the leads cannot place an
 *   edge inside a light, which is where most edges are.
 *
 *   it is noisy. A per-pane estimate stands on a sixth of the taps, and it goes
 *   into a *ratio* here rather than into a sum, so its variance is not hidden by
 *   the tone map the way the mask's is.
 *
 * The silhouette of a straight blocker, seen from a point, is a straight line on
 * the light's plane — always, for any straight edge, because the projection of a
 * line through a point onto a plane is a line. So the cheapest description that
 * can hold *the thing that is actually there* is the plane's own linear one:
 *
 *     V(u, v)  ≈  k0 + k1 (u - ½) + k2 (v - ½),   clamped to [0, 1]
 *
 * Three numbers instead of six, continuous across the leads, and — the part that
 * makes it affordable — fitted by least squares over **all 48 taps at once**
 * rather than eight at a time, so it is better conditioned than the mask it is
 * computed beside. It cannot represent two blockers or a hole; it represents one
 * edge, at any angle, anywhere, which is what a penumbra is made of.
 *
 * And one property that is not an accident: **a linear V has the sub-ellipse's
 * mean at the sub-ellipse's centre.** The tap loop in `glassFetch` reads n
 * congruent slabs at their centres, so point-evaluating this fit there is not an
 * approximation of the slab's mean visibility — for this model it *is* the
 * slab's mean, exactly, because the slab is symmetric about its own centre.
 * The approximation left is the one the model itself makes.
 *
 * ---------------------------------------------------------------------------
 * This file holds the rule; `shadow.js` states it in GLSL and the harness in
 * `scripts/vis-error.mjs` imports it. Two statements of one rule is the
 * arrangement that cost Day 042 a day, so the parts that are arithmetic live
 * here and both halves read them.
 */

/**
 * Least squares of a plane through samples of a {0,1} visibility.
 *
 * `samples` are [u, v, hit] with u, v in [0, 1] over the window's bounding
 * rectangle. Returns [k0, k1, k2] for V ≈ k0 + k1(u - ½) + k2(v - ½).
 *
 * Centred moments rather than a 3x3 solve: the constant term separates from the
 * gradient when the design is centred on the samples' own centroid, which
 * leaves a symmetric 2x2 whose inverse is three multiplies. The determinant
 * guard is not decoration — with a single pane (the comparison renders) the taps
 * span a rectangle, but with a *degenerate* one they can be collinear, and a
 * gradient of infinity would then be premultiplied into every fetch on the
 * surface.
 */
export function fitVis(samples) {
  let n = 0
  let su = 0
  let sv = 0
  let sh = 0
  for (const [u, v, h] of samples) {
    n++
    su += u
    sv += v
    sh += h
  }
  if (n < 3) return [n ? sh / n : 1, 0, 0]
  const mu = su / n
  const mv = sv / n
  const mh = sh / n
  let cuu = 0
  let cuv = 0
  let cvv = 0
  let chu = 0
  let chv = 0
  for (const [u, v, h] of samples) {
    const du = u - mu
    const dv = v - mv
    const dh = h - mh
    cuu += du * du
    cuv += du * dv
    cvv += dv * dv
    chu += dh * du
    chv += dh * dv
  }
  const det = cuu * cvv - cuv * cuv
  // The scale here is uv squared over a window-sized spread, so 1e-9 is six
  // orders below a real design and still far above the float32 the shader does
  // this in.
  if (!(Math.abs(det) > 1e-9)) return [mh, 0, 0]
  const k1 = (cvv * chu - cuv * chv) / det
  const k2 = (cuu * chv - cuv * chu) / det
  return [mh + k1 * (0.5 - mu) + k2 * (0.5 - mv), k1, k2]
}

/** The fit, evaluated and clamped — a visibility is a fraction. */
export function evalVis(fit, u, v) {
  return Math.min(Math.max(fit[0] + fit[1] * (u - 0.5) + fit[2] * (v - 0.5), 0), 1)
}

/**
 * Where the blocker's edge is, from the taps' own moments — and the level set of
 * the fitted plane is *not* it.
 *
 * Least squares through a step is a biased way to find the step, in two ways
 * that both have closed forms. For samples of covariance C and a true edge at
 * n·x = c, the regression slope is
 *
 *     k = C⁻¹ n σ φ(β),      β = (c - n·µ)/σ,     σ² = nᵀ C n
 *
 * so the edge's normal is along **C k**, not along k — they agree only when the
 * taps are isotropic, and this window is half again as tall as it is wide. And
 * the plane crosses one half where h + β φ(β) = ½, which is the edge only at
 * β = 0. A point that can see a sixth of the window has β ≈ 1, and there the
 * level set sits 41% further into the dark than the edge does.
 *
 * So take the two statistics the taps estimate best. The *direction* is C k. The
 * *offset* comes from the mean visibility — the mask's own scalar, standing on
 * all forty-eight taps rather than on the eight in one pane — by modelling the
 * taps as a Gaussian of their measured covariance, under which the visible
 * fraction is 1 - Φ(β) and β is fixed by h alone. No inverse normal is needed:
 * |C k| = σ φ(β) gives the density, and h gives the sign.
 *
 * Returns [nx, ny, c] with the visible side at n·x >= c, in the image's uv, or
 * null when the taps found no edge at all — in open light, or in a shadow deep
 * enough that every tap agrees, both of which are the identity downstream.
 */
export function edgeFrom(mu, C, k, h) {
  const g = [C[0] * k[0] + C[1] * k[1], C[1] * k[0] + C[2] * k[1]]
  const gl = Math.hypot(g[0], g[1])
  if (!(gl > 1e-9)) return null
  const n = [g[0] / gl, g[1] / gl]
  const s2 = n[0] * (C[0] * n[0] + C[1] * n[1]) + n[1] * (C[1] * n[0] + C[2] * n[1])
  if (!(s2 > 1e-12)) return null
  const sd = Math.sqrt(s2)
  const SQ2PI = Math.sqrt(2 * Math.PI)
  const ph = Math.min(gl / sd, 1 / SQ2PI)
  const beta = Math.sign(0.5 - h) * Math.sqrt(Math.max(-2 * Math.log(SQ2PI * ph), 0))
  return [n[0], n[1], n[0] * mu[0] + n[1] * mu[1] + sd * beta]
}

/**
 * The fraction of an axis-aligned rectangle on the visible side of n·x = c.
 *
 * Sutherland-Hodgman against one plane, then the shoelace. A convex quad cut by
 * a line is a polygon of at most five vertices, so the loop is bounded and the
 * same code runs in GLSL with a fixed array — which is the reason it is written
 * this way rather than as the four-case integral it could be.
 *
 * This is what replaces eight Bernoulli trials per pane. The taps still decide
 * *where* the line is; they stop deciding how much of each rectangle is behind
 * it, which is a question with an exact answer once the line is known.
 */
export function clipFrac(r, n, c) {
  const px = [r.u0, r.u1, r.u1, r.u0]
  const py = [r.v0, r.v0, r.v1, r.v1]
  const ox = []
  const oy = []
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4
    const di = n[0] * px[i] + n[1] * py[i] - c
    const dj = n[0] * px[j] + n[1] * py[j] - c
    if (di >= 0) {
      ox.push(px[i])
      oy.push(py[i])
    }
    if (di * dj < 0) {
      const t = di / (di - dj)
      ox.push(px[i] + t * (px[j] - px[i]))
      oy.push(py[i] + t * (py[j] - py[i]))
    }
  }
  if (ox.length < 3) return 0
  let a = 0
  for (let i = 0; i < ox.length; i++) {
    const j = (i + 1) % ox.length
    a += ox[i] * oy[j] - ox[j] * oy[i]
  }
  const area = Math.abs(r.u1 - r.u0) * Math.abs(r.v1 - r.v0)
  return Math.min(Math.max(Math.abs(a) * 0.5 / Math.max(area, 1e-12), 0), 1)
}
