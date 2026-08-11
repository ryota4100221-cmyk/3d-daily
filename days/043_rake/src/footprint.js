/**
 * Day 043 — the footprint rule, in the one place both halves of it can read.
 *
 * The rule is small and it is stated twice: once in GLSL, inside `glassFetch`
 * in `ltc.js`, and once in JavaScript, for `scripts/aniso-error.mjs` to score
 * against a brute-forced elliptical average. Two statements of one rule is
 * exactly the arrangement that cost Day 042 a day — a number written down in
 * `glass.js` stopped agreeing with a number written down in `palette.js` and the
 * discrepancy was diagnosed as a filtering error for twenty-four hours.
 *
 * So the parts that are *numbers* live here, and both halves import them:
 * the tap budget, the count rule, and the slab weights. What cannot be shared is
 * the loop itself, and the loop is four lines.
 *
 * ---------------------------------------------------------------------------
 * What the rule is
 *
 * The lobe's footprint on the light plane is an ellipse of semi-axes A >= B at
 * some angle to the texture's own axes. Day 042 read it through one ripmap cell
 * chosen from the ellipse's axis-aligned bounding box, which is right when the
 * major axis lies along a texture axis and up to sqrt(2) too big on both axes
 * when it lies at 45 degrees to them. Measured: at >3x anisotropy the ripmap beat
 * the isotropic rules by 25% near the axes and by 5% at 45 degrees.
 *
 * Today the ellipse is cut into n slabs perpendicular to its major axis, and
 * slab k is read as its own **sub-ellipse** of semi-axes (A/n, B) centred on the
 * slab. Two properties make that worth the fetches:
 *
 *   the sub-ellipses are congruent — same A/n, same B, same angle — so all n
 *   taps share one level pair. The ripmap still does the axis-aligned part of
 *   the work and the taps only pay for the part it has no index for.
 *
 *   they tile the ellipse exactly. Centres at (A - A/n)(2k - (n-1))/(n-1) plus
 *   half-length A/n reach exactly ±A, with no gap and no overlap along the major
 *   axis. n = 1 puts the centre at 0 and the half-length at A: **Day 042, the
 *   same box, the same cells, the same memory.**
 *
 * The weights are the exact area fractions of the slabs of a disc, which are
 * constants of n alone and therefore not tuned:
 *
 *     F(x) = (x sqrt(1 - x^2) + asin x) / pi        area of the unit disc left of x
 *     w_k  = F(2(k+1)/n - 1) - F(2k/n - 1)          sums to 1 by construction
 *
 * The residual is that a slab of an ellipse is not an ellipse: the sub-ellipse
 * covering the outermost slab reaches the full ±B across, where the true chord
 * there is shorter. The area weights are what pays most of that back, and the
 * harness scores them against flat weights rather than asserting it.
 */

/**
 * The tap budget. Four is a measurement, not a convention — see NOTES; 8 and 16
 * were scored on the same footprints and bought 0.03 and 0.04 points of RMS for
 * two and four times the fetches.
 *
 * Cost, stated plainly: `glassFetch` runs twice per shaded pixel (the cosine
 * lobe and the GGX lobe) and each tap is a `ripFetch`, which is four bilinear
 * reads. So the ceiling is 32 fetches of a 2 MB texture per pixel, against
 * Day 042's 8 — and the *typical* count is far below it, because n is chosen
 * from the anisotropy and the cosine lobe is nearly round almost everywhere.
 */
export const TAP_MAX = 4

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
