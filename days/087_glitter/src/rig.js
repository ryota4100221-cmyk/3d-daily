// rig.js — the sea, written as a slope budget.
//
// Nothing in here draws a road of light. What is written down is:
//   1. how much slope the sea has in total (Cox & Munk 1954: <s²> = 0.003 + 0.00512·U)
//   2. how that total is split among 32 wave trains (equal per log-wavelength)
//   3. one rule for when a wave is too small for the pixel it lands on
// The glitter path is what the shader gets when it asks each pixel
// "how many facets here point halfway between the eye and the sun?"

export const G = 9.81

// Cox–Munk mean-square slope (both axes together), U = wind at 12.5 m.
export const coxMunk = (U) => 0.003 + 0.00512 * U

// Share of the budget carried by waves long enough to ever be drawn.
// The remaining share is capillary ripple: never resolved, always statistics.
export const RESOLVED_SHARE = 0.8

export const NW = 32
const LAMBDA_MAX = 64 // m
const LAMBDA_MIN = 0.07 // m
const WIND_DIR = -0.35 // rad, wind blows mostly away from the viewer, slightly across

// Deterministic spread around the wind so every load is the same sea.
const PHI = (Math.sqrt(5) - 1) / 2

export function buildWaves() {
  const waves = []
  for (let i = 0; i < NW; i++) {
    const t = i / (NW - 1)
    const lambda = LAMBDA_MAX * Math.pow(LAMBDA_MIN / LAMBDA_MAX, t)
    const k = (2 * Math.PI) / lambda
    // spread widens for short waves (they answer to local gusts, not the fetch)
    const u = ((i * PHI) % 1) * 2 - 1
    const theta = WIND_DIR + u * (0.45 + 0.7 * t)
    // slope variance of one train = ½(ak)². Equal share per train, for mss = 1.
    const ak = Math.sqrt((2 * RESOLVED_SHARE) / NW)
    waves.push({
      dx: Math.sin(theta),
      dz: -Math.cos(theta),
      k,
      ak,
      omega: Math.sqrt(G * k),
      phase: ((i * 0.618034 * 7.31) % 1) * Math.PI * 2,
      lambda,
    })
  }
  return waves
}

// The same filter the fragment shader uses. r = footprint / wavelength.
// A wave keeps f of its amplitude, so it keeps f² of its slope variance;
// the other (1 − f²) is handed to the statistical term. Nothing is lost.
export const keep = (r) => {
  const x = Math.min(Math.max((r - 0.25) / (0.6 - 0.25), 0), 1)
  return 1 - x * x * (3 - 2 * x)
}

// Pixel footprint on the water at ground distance d, for a camera at height h,
// vertical fov (rad) and viewport height (px). Across the view a pixel covers
// d·α; along the view it is stretched by 1/sin(grazing).
export function footprint(d, h, fov, px) {
  const alpha = fov / px
  const slant = Math.hypot(d, h)
  const s = h / slant
  return slant * alpha * Math.sqrt(1 + 1 / (s * s))
}

// Where the variance lives at distance d: [resolved, unresolved] as shares of mss.
export function budgetAt(waves, d, h, fov, px) {
  const fp = footprint(d, h, fov, px)
  let res = 0
  for (const w of waves) {
    const f = keep(fp / w.lambda)
    res += f * f * 0.5 * w.ak * w.ak
  }
  return { fp, resolved: res, unresolved: 1 - res }
}

// Scene constants
export const CAM_H = 42 // m, the bluff above Ōsaki Park
export const CAM_PITCH = (-8.5 * Math.PI) / 180
export const FOV = 36 // deg, vertical
export const SUN_ELEV = (3.4 * Math.PI) / 180
export const SUN_AZ = (7.5 * Math.PI) / 180 // right of straight ahead

export const sunDir = () => {
  const c = Math.cos(SUN_ELEV)
  return [Math.sin(SUN_AZ) * c, Math.sin(SUN_ELEV), -Math.cos(SUN_AZ) * c]
}
