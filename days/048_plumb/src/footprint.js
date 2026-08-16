/**
 * Day 044 — the footprint rule, in the one place every reader of it can import.
 *
 * The rule is stated twice: once in GLSL, inside `glassFetch` in `ltc.js`, and
 * once in JavaScript, for the two harnesses in `scripts/`. Two statements of one
 * rule is exactly the arrangement that cost Day 042 a day — a number written in
 * `glass.js` stopped agreeing with a number written in `palette.js` and the
 * discrepancy was diagnosed as a filtering error for twenty-four hours. So the
 * parts that are *numbers* live here and every half imports them: the tap
 * budget, the count rule, the slab weights, and today the support width.
 *
 * ---------------------------------------------------------------------------
 * What the rule is, as of this morning
 *
 * The lobe's footprint on the light plane is an ellipse of semi-axes A >= B at
 * some angle to the texture's own axes:
 *
 *   Day 041  one level, from the ellipse's geometric mean — a circle.
 *   Day 042  a level *pair*, from the ellipse's axis-aligned bounding box.
 *   Day 043  n taps along the major axis, each slab read as its own congruent
 *            sub-ellipse and weighted by the exact area of the disc it covers.
 *   Day 044  the ellipse itself, corrected — because it was never the ellipse
 *            of the thing being averaged.
 *
 * All three of the first three read one ellipse: the preimage of a disc of
 * angular radius delta, with delta = GLASS_K / GLASS_SIZE = 0.5 radians, a
 * constant chosen by eye on Day 041 against the sharpest surface in the frame.
 * Every day since has improved *how that ellipse is sampled* and none has asked
 * whether it is the right ellipse. `scripts/lobe-error.mjs` asks, against the
 * integral the fetch is a stand-in for, and the answer is in NOTES.
 */

/**
 * The tap budget. Four is a measurement, not a convention — see Day 043's NOTES;
 * 8 and 16 were scored on the same footprints and bought 0.03 and 0.04 points of
 * RMS for two and four times the fetches.
 *
 * Cost, stated plainly: `glassFetch` runs twice per shaded pixel (the cosine
 * lobe and the GGX lobe) and each tap is a `ripFetch`, which is four bilinear
 * reads. So the ceiling is 32 fetches of a 2 MB texture per pixel, against
 * Day 042's 8 — and the *typical* count is far below it, because n is chosen
 * from the anisotropy and the cosine lobe is nearly round almost everywhere.
 */
export const TAP_MAX = 4

/**
 * Day 044 — the source's own support, as a semi-axis in texels.
 *
 * The fetch is a stand-in for a weighted mean of the window's image, and the
 * weight is the lobe *times the window*: outside the opening there is nothing to
 * average, and the shader has been saying so all along by clamping uv into
 * [0,1]. Clamping moves the centre; it does not shrink the kernel. So a surface
 * far enough from the opening, or rough enough, asks for an ellipse wider than
 * the picture and gets a fetch that is neither the whole window nor a part of
 * it.
 *
 * Two variances add reciprocally when two kernels multiply, so instead of
 * clamping the answer, add the support to the ellipse:
 *
 *     Sigma_lobe = delta^2 Q^-1 / 4        semi-axes 2 sqrt(eig) = delta/sqrt(eig Q)
 *     Sigma_supp = (1/12) I                the unit square's own covariance
 *     Sigma_eff^-1 = Sigma_lobe^-1 + Sigma_supp^-1
 *
 * The support term is a multiple of the identity — a square's covariance is
 * isotropic, exactly — so it does not turn the ellipse, only shortens both of
 * its axes, and the eigenvectors of Q are still the answer. Matching a semi-axis
 * a to the square's variance gives a^2/4 = N^2/12, so the square weighs the same
 * as an ellipse of semi-axis N/sqrt(3):
 *
 *     1 / A_eff^2 = 1 / A^2 + 1 / SUPPORT^2
 *
 * which is two lines in the shader and reduces to Day 043 exactly as
 * SUPPORT goes to infinity. `?supp=0` is that limit and is yesterday's build.
 */
export const SUPPORT_VAR = 1 / 3

/**
 * Day 045 — the footprint's *area*, measured instead of chosen.
 *
 * Everything above is a rule for a size. Day 041 chose an angular radius by eye
 * (delta = 0.5 rad) and Days 042–044 chose how to read the ellipse that radius
 * implies; Day 044 then bolted a second constant onto it, the unit square's own
 * covariance, because the first one could ask for a kernel wider than the
 * picture. Two constants, both about size, neither measured, and neither of them
 * knows that this opening is *six panes in three tiers* rather than a square.
 *
 * The kernel has an area, and it is not a matter of choice. Write it in uv:
 *
 *     k(u, v) = max(w_z, 0) . j(u, v),        j = dw / dA_uv
 *
 * — the lobe's density times the change of variables from the window's plane to
 * the sphere. Two facts about k are already on the shader's stack:
 *
 *   its **mass**. W = integral of k over the source = pi . ltcClip(f). That is
 *   not a new claim; it is the LTC method's own claim, the scalar it multiplies
 *   the tint by. It is summed over the *panes*, weighted by each pane's
 *   visibility, and clipped at the horizon — so the mullions, the three tiers
 *   and the blocker's edge are all already inside it.
 *
 *   its **peak**. p = w_z . |det J| at the fetch point, and |det J| = sqrt(det Q)
 *   where Q is the same 2x2 whose eigenvalues give the ellipse's shape. One
 *   multiply on numbers the footprint code has already formed.
 *
 * Mass over peak is an area. For a kernel that were uniform on an ellipse of
 * semi-axes (a, b) it is exactly pi.a.b; for a Gaussian of the same covariance
 * it is half that. So one dimensionless constant carries the profile, and *that*
 * is the thing to measure — a shape, not a size:
 *
 *     a . b = kappa . W / (pi . p)  [uv]   =  kappa . ltcClip(f) . N^2 / p [texels]
 *
 * with delta nowhere in it. The shape (aspect and orientation) still comes from
 * Q as before; today only the area is taken off the geometry and put onto the
 * radiometry. Both limits come out right with no clamp: a lobe far narrower than
 * the opening has a large p and a small area, and a lobe that covers the whole
 * opening has W -> the opening's own form factor and p -> the same, so the
 * ellipse converges on the window itself.
 */
export const MASS_KAPPA = 1.2

/**
 * Day 048 — the footprint's *centre*, tilted onto the kernel it stands for.
 *
 * Day 047 measured where the remaining error is, one part of the ellipse at a
 * time, and the answer was the centre: 5.48 -> 4.35 for the centre alone against
 * 4.84 for the shape and 4.97 for the size. The centre is where the fetch reads,
 * and since Day 041 it has been *the ray along the lobe's mean direction, where
 * it meets the plane* — which is a defensible point but is demonstrably not the
 * kernel's first moment.
 *
 * Why not, in one line: `f` is the integral of w over the solid angle of the
 * opening, so `f/|f|` is the centroid of the *solid angle*. The kernel is the
 * solid angle times the cosine, and the plane is not the sphere. Two weights the
 * mean direction has never carried.
 *
 * ---------------------------------------------------------------------------
 * The kernel on the plane, written out
 *
 * Every point of the window is X = p1 + u V1 + v V2, and the shading point is at
 * the origin of the transformed frame. The change of variables from uv area to
 * solid angle is (no . X)/|X|^3 — and `no . X` is the same number for every
 * point of a plane, namely dA. So, with the lobe's own density max(w_z, 0):
 *
 *     k(u, v)  =  max(X_z, 0) . dA / |X|^4
 *
 * A constant times two elementary factors. That is the whole derivation; the
 * rest is calculus. Its log-gradient in the quad's own coordinates is
 *
 *     d log k / du  =  V1_z / X_z  -  4 (V1 . X) / |X|^2
 *     d log k / dv  =  V2_z / X_z  -  4 (V2 . X) / |X|^2
 *
 * — the first term the cosine, the second the falloff, and nothing in either of
 * them that `glassFetch` has not already formed by the time it gets here. Six
 * dot products, no fetch, no new uniform, no loop.
 *
 * ---------------------------------------------------------------------------
 * Why a Langevin function and not the gradient step
 *
 * The textbook move is Laplace's: fit a Gaussian at the point you have and take
 * its mean, x + Sigma . grad. That is right in the limit and useless at the
 * other end — a diffuse footprint covering the whole opening has Sigma ~ 1/4 in
 * uv, gradients of order two are ordinary, and the step it asks for is half a
 * window. The reason is not the gradient; it is the model. A distribution
 * supported on the ellipse cannot have its mean outside the ellipse, and a
 * linear step does not know that.
 *
 * So tilt the profile the taps *already assume* instead. Along each axis the
 * footprint is a slab of half-length h, the fetch weighs it uniformly (Day 043's
 * slab weights are the disc's own marginal, and the reads inside a slab are the
 * ripmap's box), and an exponentially tilted uniform density on [-h, h] has a
 * centroid in closed form:
 *
 *     <x>  =  h . L(g h),        L(t) = coth t - 1/t
 *
 * the Langevin function. It is the Laplace step for small tilts — L(t) -> t/3
 * gives h^2 g/3 = sigma^2 g exactly, since a uniform slab's variance is h^2/3 —
 * and it saturates at +-h, so the centre can slide to the edge of the footprint
 * and never past it. One number, two limits, both correct, and the boundedness
 * is a property of the density rather than a clamp bolted on afterwards.
 *
 * h is the half-length of the uniform slab with the ellipse's own variance: a
 * semi-axis a carries variance a^2/4 (Day 044's convention, the one the support
 * term was matched with), and a uniform slab of half-length h has h^2/3, so
 * h = a sqrt(3)/2.
 */
export const TILT_HALF = Math.sqrt(3) / 2

/**
 * The one dimensionless constant, swept in both harnesses the way MASS_KAPPA was
 * on Day 045. It is **not** 1, and the reason is worth the paragraph.
 *
 * The derivation above predicts a displacement, and that displacement was scored
 * against the measured one — the visible kernel's own first moment, which is what
 * Day 047's ablation handed the fetch to get 4.35. Regressed over 1024
 * configurations the prediction comes out
 *
 *     slope 0.47      R 0.62      |predicted| 19.7 texels   |measured| 12.2
 *
 * so the direction is right two times out of three and the length is about 1.6
 * times too long. Both numbers matter, and they are the same number twice: the
 * least-squares multiple of a predictor is R times the ratio of the spreads,
 * 0.62 / 1.6 = 0.40, and the independent sweep of this constant bottoms out at
 * 0.5. Two routes, one answer.
 *
 * A predictor that is right in direction and imperfect in detail should not be
 * applied at full strength — the error-minimising multiple of a noisy estimate is
 * its reliability, not one. That is not a fudge; it is the same statement Day 045
 * recorded when the measured covariance turned out not to be the error-minimising
 * covariance. What it costs is honesty about what the model leaves out: the
 * kernel written here has the cosine and the falloff in it and knows nothing
 * about the mullions or the blocker, and 0.62 is how much of the displacement
 * those two terms explain.
 */
export const TILT_GAIN = 0.5

/** coth(t) - 1/t, with both limits taken by hand. */
export function langevin(t) {
  const a = Math.abs(t)
  if (a < 1e-3) return t / 3
  if (a > 30) return Math.sign(t)
  const e = Math.exp(-2 * a)
  return Math.sign(t) * ((1 + e) / (1 - e) - 1 / a)
}

/**
 * The tilted centre. `uv` in [0,1], the ellipse in texels at angle `th`, the
 * quad's two edge vectors and the fetch point X (both in the transformed frame),
 * r = |X|, N texels per uv unit. Returns a new uv, clamped to the picture the
 * way the untilted one always was.
 */
/**
 * How far a line through `o` in direction (dx, dy) runs before it leaves the
 * unit square, each way. The ray-box slab test, two axes, no branches worth the
 * name — and the same four numbers a shader would form.
 */
export function spanInSquare(o, dx, dy) {
  let lo = -1e9
  let hi = 1e9
  const one = (d, c) => {
    if (Math.abs(d) < 1e-9) {
      if (c < 0 || c > 1) { lo = 0; hi = 0 }
      return
    }
    const t0 = -c / d
    const t1 = (1 - c) / d
    lo = Math.max(lo, Math.min(t0, t1))
    hi = Math.min(hi, Math.max(t0, t1))
  }
  one(dx, o[0])
  one(dy, o[1])
  return [Math.min(lo, 0), Math.max(hi, 0)]
}

export function tiltCentre(uv, A, B, th, V1, V2, X, r, N, gain = TILT_GAIN, iter = 0, clip = false) {
  const ca = Math.cos(th)
  const sa = Math.sin(th)
  // Half-lengths in uv, along the major axis and across it.
  const ha = (TILT_HALF * A) / N
  const hb = (TILT_HALF * B) / N
  // The two axes as displacements in the transformed frame: one step of a uv
  // unit along each of the ellipse's own directions.
  const Ea = [ca * V1[0] + sa * V2[0], ca * V1[1] + sa * V2[1], ca * V1[2] + sa * V2[2]]
  const Eb = [-sa * V1[0] + ca * V2[0], -sa * V1[1] + ca * V2[1], -sa * V1[2] + ca * V2[2]]
  // d log k / d(along each axis), at a point Y of the plane.
  const grad = (Y) => {
    const q2 = Y[0] * Y[0] + Y[1] * Y[1] + Y[2] * Y[2]
    // The cosine's term is dropped rather than clipped where the fetch direction
    // grazes the transformed plane: X_z -> 0 is the horizon, where max(w_z, 0)
    // has truncated the kernel and a 1/X_z describes a factor that is not there.
    const iz = Y[2] > 1e-4 * Math.sqrt(q2) ? 1 / Y[2] : 0
    const ir2 = 1 / q2
    return [
      Ea[2] * iz - 4 * (Ea[0] * Y[0] + Ea[1] * Y[1] + Ea[2] * Y[2]) * ir2,
      Eb[2] * iz - 4 * (Eb[0] * Y[0] + Eb[1] * Y[1] + Eb[2] * Y[2]) * ir2,
    ]
  }
  // sigma^2 . g, saturated at the footprint's own half-length. L(t) -> t/3, so
  // the argument carries the 3 that turns h^2/3 back into sigma^2 = h^2/3.
  const slab = (g, h) => h * langevin(3 * gain * ((h * h) / 3) * g / h)
  // The same thing on an interval that is not centred: the tilted mean of a
  // uniform density on [p, q] is its own midpoint plus its own half-width times
  // the Langevin of the tilt across it. Symmetric [-h, h] is the line above.
  const clipped = (g, p, q) => {
    const m = 0.5 * (p + q)
    const h = 0.5 * (q - p)
    return h > 1e-9 ? m + h * langevin(gain * g * h) : m
  }
  let da = 0
  let db = 0
  for (let k = 0; k <= iter; k++) {
    // Day 048, the second half: the gradient is read at the *midpoint* of the
    // step it is about to justify, not at its start. log k is curved — the
    // falloff bends it everywhere and the cosine bends it hard near the horizon
    // — so a slope read at one end of a step describes the far end of it badly,
    // and the error is one-signed: the tilt read at the ray's hit point is the
    // steepest one anywhere along the move, so the step it asks for is always
    // too long. Reading it halfway is the midpoint rule, it costs one more
    // evaluation of six dot products, and it has no constant in it.
    const mu = 0.5 * k * da
    const mv = 0.5 * k * db
    const Y = [
      X[0] + mu * Ea[0] + mv * Eb[0],
      X[1] + mu * Ea[1] + mv * Eb[1],
      X[2] + mu * Ea[2] + mv * Eb[2],
    ]
    const g = grad(Y)
    if (clip) {
      // The slab, cut to the picture. Outside the opening there is nothing to
      // average — the same sentence Day 044 answered for the footprint's *size*,
      // asked now of its *centre*. A slab hanging half off the left edge has its
      // mass on the right of where it was drawn, tilt or no tilt, and no shrink
      // of the ellipse says so: shrinking is symmetric and this is not.
      const [la, hA] = spanInSquare(uv, ca, sa)
      const [lb, hB] = spanInSquare(uv, -sa, ca)
      da = clipped(g[0], Math.max(la, -ha), Math.min(hA, ha))
      db = clipped(g[1], Math.max(lb, -hb), Math.min(hB, hb))
    } else {
      da = slab(g[0], ha)
      db = slab(g[1], hb)
    }
  }
  const du = ca * da - sa * db
  const dv = sa * da + ca * db
  return [
    Math.min(Math.max(uv[0] + du, 0), 1),
    Math.min(Math.max(uv[1] + dv, 0), 1),
    Math.hypot(du, dv) * N,
  ]
}

/**
 * a.b, in texels squared, from the two numbers above. `ff` is ltcClip(f), `wz`
 * the fetch direction's z in the transformed frame, `detJ` the uv -> solid angle
 * stretch there, `N` texels per uv unit.
 *
 * The cap is the largest ellipse a kernel supported on the unit square can have:
 * a distribution on [0,1] has variance at most 1/4, so a semi-axis 2.sqrt(var)
 * is at most N and a.b at most N^2. It is a guard against p -> 0 for a fetch
 * direction that grazes the window's own plane, not a modelling choice — the
 * measured areas sit two orders below it.
 */
export function massArea(ff, wz, detJ, N, kappa = MASS_KAPPA) {
  const p = Math.max(wz, 0) * Math.max(detJ, 0)
  if (!(p > 1e-20)) return N * N
  return Math.min((kappa * Math.max(ff, 0) * N * N) / p, N * N)
}

/**
 * How many taps an ellipse of semi-axes A >= B gets.
 *
 * Rounding rather than the hardware's ceiling: at a ratio of 1.4 the single-tap
 * answer is already inside the error floor, and spending a second fetch there
 * buys 0.01 points while doubling the cost of every nearly-round lobe in the
 * frame. Scored both ways in the harness.
 */
export function tapCount(A, B, max = TAP_MAX, rule = 'round') {
  const ratio = A / Math.max(B, 1e-6)
  const n = rule === 'ceil' ? Math.ceil(ratio - 1e-6) : Math.round(ratio)
  return Math.min(Math.max(n, 1), max)
}

/** Area of the unit disc to the left of x, over pi. F(-1) = -0.5, F(1) = 0.5. */
export function slabF(x) {
  const c = Math.min(1, Math.max(-1, x))
  return (c * Math.sqrt(Math.max(1 - c * c, 0)) + Math.asin(c)) / Math.PI
}

/**
 * erf, to about 1.2e-7 — Abramowitz & Stegun 7.1.26. Needed only by the `gauss`
 * weights, and only on the CPU: if that profile ever reaches the shader it wants
 * the cheap rational, not this.
 */
export function erf(x) {
  const s = Math.sign(x)
  const a = Math.abs(x)
  const t = 1 / (1 + 0.3275911 * a)
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-a * a)
  return s * y
}

/**
 * The weight of each of n slabs cut across the major axis, as a fraction of the
 * whole. Constants of n alone — nothing here is tuned — and they sum to 1.
 *
 *   area   the exact area of the unit disc in slab k. A disc's marginal along a
 *          diameter is (2/pi) sqrt(1 - x^2), variance 1/4.
 *   flat   1/n. The control: it isolates *where* the taps are from *what they
 *          are worth*, and Day 043 scored it at 4.85 against area's 4.76.
 *   gauss  a Gaussian of the same variance, 1/4, with its tails folded into the
 *          outermost slabs so the sum is still exactly 1. This exists because
 *          the lobe is not a uniform disc and the question of whether the
 *          *profile* matters is separable from the question of the ellipse's
 *          size. Scored in both harnesses.
 */
export function slabWeights(n, kind = 'area') {
  const w = []
  if (kind === 'flat') {
    for (let k = 0; k < n; k++) w.push(1 / n)
    return w
  }
  const SD = 0.5 // matches the disc's marginal variance of 1/4
  const cdf = (x) =>
    kind === 'gauss' ? 0.5 * erf(x / (SD * Math.SQRT2)) : slabF(x)
  let prev = -0.5 // both profiles integrate to 1 over [-1, 1] by this convention
  for (let k = 0; k < n; k++) {
    const F = k === n - 1 ? 0.5 : cdf(2 * (k + 1) / n - 1)
    w.push(F - prev)
    prev = F
  }
  return w
}
