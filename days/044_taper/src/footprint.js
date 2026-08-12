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
