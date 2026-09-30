// Day 091 — the night the rings go out.
//
// Everything the picture knows about Saturn is in this file, and it is short on
// purpose. Lengths are in Saturn equatorial radii (1 R_S = 60,268 km).
//
//   OBLATE   the planet is an ellipsoid, polar/equatorial = 54,364 / 60,268
//   tau(r)   normal optical depth of the ring sheet at radius r
//   sunDir   where the Sun is, as a function of the calendar year
//
// Nothing here says "make the rings dim at equinox". The ring sheet is lit by
// sunlight arriving at elevation B above its plane, and the light it can
// scatter back is proportional to mu0 = sin|B|. When the Sun sits in the ring
// plane, mu0 = 0, and the brightest thing in the outer solar system has
// nothing left to reflect.

export const OBLATE = 54364 / 60268 // 0.90204

// Saturn's obliquity is 26.73°. Seen from the Sun, the ring plane tilts by up to
// that much over one Saturn year (29.457 yr). Equinoxes (Sun crossing the ring
// plane) fell on 2009.61 and 2025.35. A sinusoid through 2025.35 is the honest
// simplification here: the real half-seasons are unequal (13.7 / 15.7 yr)
// because Saturn's orbit is eccentric, and this rig does not model that.
export const OBLIQ = (26.73 * Math.PI) / 180
export const YEAR_S = 29.457
export const EQUINOX = 2025.35

export function sunElevation(year) {
  return OBLIQ * Math.sin((2 * Math.PI * (year - EQUINOX)) / YEAR_S)
}

// Sun azimuth is fixed 58° round from the camera, so the planet shows a
// terminator. Only the elevation moves with the calendar.
export const SUN_AZ = (-58 * Math.PI) / 180
export function sunDir(year) {
  const B = sunElevation(year)
  return [Math.cos(B) * Math.sin(SUN_AZ), Math.sin(B), Math.cos(B) * Math.cos(SUN_AZ)]
}

// Camera: extreme telephoto, fixed 13° above the ring plane on the north side.
// (From Earth the viewing elevation tracks the Sun's to within a few degrees;
// pinning it is what lets the Sun alone carry the change, and it means half of
// every Saturn year is spent looking at the unlit face of the rings.)
export const CAM_EL = (13 * Math.PI) / 180
export const CAM_DIST = 34

// ---------------------------------------------------------------------------
// Ring optical depth. Boundaries from the Voyager/Cassini radial profile; the
// values inside each ring are a smooth plateau plus a few deterministic
// ringlet ripples. Written once in GLSL and once in JS from the same table so
// that the numbers in NOTES.md are computed from the exact function the
// shader draws.
// ---------------------------------------------------------------------------
export const RING_IN = 1.239
export const RING_OUT = 2.33

export const TAU_GLSL = /* glsl */ `
float bandw(float r, float a, float b, float e) {
  return smoothstep(a - e, a + e, r) * (1.0 - smoothstep(b - e, b + e, r));
}
float ripple(float r) {
  return 0.5 + 0.5 * sin(r * 611.0) * sin(r * 173.0 + 1.3) * sin(r * 47.0 + 0.4);
}
float ringTau(float r) {
  float t = 0.0;
  // C ring: faint, banded
  t += bandw(r, 1.239, 1.527, 0.002) * (0.06 + 0.10 * ripple(r) + 0.25 * bandw(r, 1.45, 1.49, 0.004));
  // B ring: the opaque core
  float bi = bandw(r, 1.527, 1.951, 0.002);
  float bcore = smoothstep(1.60, 1.70, r);
  t += bi * (0.9 + 1.9 * bcore + 0.6 * ripple(r * 1.3));
  // Cassini division (with the Huygens gap at its inner edge)
  t += bandw(r, 1.962, 2.025, 0.002) * (0.08 + 0.07 * ripple(r));
  // A ring, with the Encke and Keeler gaps cut out
  float a = bandw(r, 2.025, 2.267, 0.002) * (0.55 + 0.20 * ripple(r * 0.7) - 0.15 * smoothstep(2.20, 2.26, r));
  a *= 1.0 - bandw(r, 2.2135, 2.2190, 0.0006);
  a *= 1.0 - bandw(r, 2.2620, 2.2635, 0.0003);
  t += a;
  // F ring: one thread
  t += 0.35 * bandw(r, 2.3245, 2.3275, 0.0008);
  return t;
}
`

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
const bandw = (r, a, b, e) => smooth(a - e, a + e, r) * (1 - smooth(b - e, b + e, r))
const ripple = (r) => 0.5 + 0.5 * Math.sin(r * 611) * Math.sin(r * 173 + 1.3) * Math.sin(r * 47 + 0.4)
export function ringTau(r) {
  let t = 0
  t += bandw(r, 1.239, 1.527, 0.002) * (0.06 + 0.1 * ripple(r) + 0.25 * bandw(r, 1.45, 1.49, 0.004))
  const bi = bandw(r, 1.527, 1.951, 0.002)
  t += bi * (0.9 + 1.9 * smooth(1.6, 1.7, r) + 0.6 * ripple(r * 1.3))
  t += bandw(r, 1.962, 2.025, 0.002) * (0.08 + 0.07 * ripple(r))
  let a = bandw(r, 2.025, 2.267, 0.002) * (0.55 + 0.2 * ripple(r * 0.7) - 0.15 * smooth(2.2, 2.26, r))
  a *= 1 - bandw(r, 2.2135, 2.219, 0.0006)
  a *= 1 - bandw(r, 2.262, 2.2635, 0.0003)
  t += a
  t += 0.35 * bandw(r, 2.3245, 2.3275, 0.0008)
  return t
}

// ---------------------------------------------------------------------------
// Single-scattering slab (Chandrasekhar / Cuzzi). K = ω·P/4 lumps the particle
// albedo and the low-phase backscatter into one exposure number; it is tuned,
// and it is the only tuned number in the ring's brightness. The mu0 in front
// of each branch is not tuned — it is the geometry of light landing on a sheet.
//
//   lit face     I/F = K · mu0/(mu0+mu) · (1 − e^{−τ(1/mu0 + 1/mu)})
//   unlit face   I/F = K · mu0/(mu−mu0) · (e^{−τ/mu} − e^{−τ/mu0})
// ---------------------------------------------------------------------------
export const RING_K = 0.62

export const SLAB_GLSL = /* glsl */ `
float slabLit(float tau, float mu0, float mu) {
  return mu0 / (mu0 + mu) * (1.0 - exp(-tau * (1.0 / mu0 + 1.0 / mu)));
}
float slabUnlit(float tau, float mu0, float mu) {
  float d = mu - mu0;
  if (abs(d) < 1e-4) return tau / mu * exp(-tau / mu);
  return mu0 / d * (exp(-tau / mu) - exp(-tau / mu0));
}
`

export function slabLit(tau, mu0, mu) {
  if (mu0 <= 0) return 0
  return (mu0 / (mu0 + mu)) * (1 - Math.exp(-tau * (1 / mu0 + 1 / mu)))
}
export function slabUnlit(tau, mu0, mu) {
  if (mu0 <= 0) return 0
  const d = mu - mu0
  if (Math.abs(d) < 1e-4) return (tau / mu) * Math.exp(-tau / mu)
  return (mu0 / d) * (Math.exp(-tau / mu) - Math.exp(-tau / mu0))
}
