// The ring a taut cover draws.
//
// A pillow, reduced to the two things that hold a head up:
//
//   foam   a bed of independent springs, k = E / h(x,y)   (Winkler foundation)
//   cover  a membrane stretched over it at tension T       (N per metre of seam)
//
// The top surface sinks by w(x,y), and everywhere it is free
//
//     −T ∇²w + k w = 0
//
// Under the head the surface is not free: it is pinned to the skull (w = d,
// the depth the skull would reach into the undeformed pillow), and the
// pressure it puts on the skull is whatever that equation leaves over,
//
//     p = −T ∇²w + k w   ≥ 0.
//
// That is the whole device. Nothing below draws the spread. A slack cover
// (T → 0) hands every spring the weight right above it; a taut one carries the
// weight sideways, out past the edge of the skull, into foam the head is not
// touching — and the contact patch shrinks while the pressure on it climbs.
// Integrate −T∇²w over the pillow and it vanishes at the seams, so the foam
// carries the whole head: Σ k w dA = W. `lent` is the part of that sum that
// lies outside the contact patch.
//
// Measured on this grid and again at half the step (DX 5 mm → 2.5 mm, E 30 kPa):
//   lent   10.4 → 11.6 %  /  60.7 → 61.8  /  90.6 → 91.3  /  97.4 → 97.7
//   peak   7.76 → 7.75 kPa / 12.06 → 12.06 / 36.49 → 36.58 / 110.46 → 110.50
// but the share carried by the one-cell rim of the patch halved (5.9 → 3.1 %),
// so the rim is drawn and never quoted.

export const L = 0.6 // pillow length along x  (m)
export const D = 0.4 // pillow depth along y   (m)
export const H = 0.11 // crown height of the undeformed pillow (m)
export const DX = 0.005 // grid step (m)
export const NX = Math.round(L / DX) + 1 // 121
export const NY = Math.round(D / DX) + 1 // 81

export const E = 8e3 // foam modulus (Pa): a soft urethane
export const WEIGHT = 45 // the load of a supine head on a pillow (N), ≈ 4.6 kg
export const HEAD = { a: 0.075, b: 0.095, c: 0.09 } // back-of-skull ellipsoid (m)
// Capillary closing pressure, 32 mmHg — the number pressure-care starts from.
export const CAPILLARY = 4.27e3

export const COVERS = [
  { key: 'gauze', name: 'Gauze', T: 5 },
  { key: 'jersey', name: 'Jersey', T: 30 },
  { key: 'knit', name: 'Knit', T: 250 },
  { key: 'twill', name: 'Twill', T: 1200 },
  { key: 'drum', name: 'Drum', T: 4000 },
]

// The undeformed puff: flat-ish crown, rolling down to the seam.
export function crown(x, y) {
  const u = Math.min(1, Math.abs((2 * x) / L))
  const v = Math.min(1, Math.abs((2 * y) / D))
  return H * Math.pow(1 - Math.pow(u, 4), 0.42) * Math.pow(1 - Math.pow(v, 3), 0.42)
}

export function createPillow() {
  const n = NX * NY
  const h0 = new Float32Array(n)
  const k = new Float32Array(n)
  for (let j = 0; j < NY; j++)
    for (let i = 0; i < NX; i++) {
      const x = -L / 2 + i * DX
      const y = -D / 2 + j * DX
      const id = j * NX + i
      h0[id] = crown(x, y)
      // Near the seam the foam is thin and therefore stiff; floor it at 1 cm.
      k[id] = E / Math.max(h0[id], 0.01)
    }
  return {
    h0,
    k,
    w: new Float32Array(n), // sink of the top surface (m, positive = down)
    d: new Float32Array(n), // depth the skull reaches into the undeformed pillow
    p: new Float32Array(n), // contact pressure (Pa)
    contact: new Uint8Array(n),
    hx: 0,
    hy: 0.02,
    zc: H + HEAD.c, // skull centre height (m); found by force balance
    T: 250,
    force: 0,
    stats: null,
  }
}

function skullDepth(s) {
  const { a, b, c } = HEAD
  const { h0, d } = s
  for (let j = 0; j < NY; j++) {
    const y = -D / 2 + j * DX - s.hy
    for (let i = 0; i < NX; i++) {
      const x = -L / 2 + i * DX - s.hx
      const id = j * NX + i
      const r = 1 - (x * x) / (a * a) - (y * y) / (b * b)
      if (r <= 0) {
        d[id] = 0
        continue
      }
      const zb = s.zc - c * Math.sqrt(r)
      d[id] = Math.max(0, h0[id] - zb)
    }
  }
}

// Projected SOR: the free equation everywhere, then "the surface may not rise
// through the skull" as a max(). Seams (the border) are pinned at w = 0.
function sweep(s, iters) {
  const { w, d, k } = s
  const tt = s.T / (DX * DX)
  const omega = 1.7
  for (let it = 0; it < iters; it++) {
    for (let j = 1; j < NY - 1; j++)
      for (let i = 1; i < NX - 1; i++) {
        const id = j * NX + i
        const nb = w[id - 1] + w[id + 1] + w[id - NX] + w[id + NX]
        const free = (tt * nb) / (4 * tt + k[id])
        let v = w[id] + omega * (free - w[id])
        if (v < d[id]) v = d[id]
        w[id] = v
      }
  }
}

function pressures(s) {
  const { w, d, k, p, contact } = s
  const tt = s.T / (DX * DX)
  let F = 0
  for (let j = 1; j < NY - 1; j++)
    for (let i = 1; i < NX - 1; i++) {
      const id = j * NX + i
      const on = d[id] > 0 && w[id] - d[id] < 1e-7
      contact[id] = on ? 1 : 0
      if (!on) {
        p[id] = 0
        continue
      }
      const lap = w[id - 1] + w[id + 1] + w[id - NX] + w[id + NX] - 4 * w[id]
      const v = Math.max(0, -tt * lap + k[id] * w[id])
      p[id] = v
      F += v * DX * DX
    }
  s.force = F
  return F
}

// One frame: relax the surface, then move the skull toward force balance.
// The skull's "stiffness" estimate is the foam under the contact patch plus
// the cover's pull around its perimeter; it only sets the step size.
export function step(s, iters = 24) {
  skullDepth(s)
  sweep(s, iters)
  const F = pressures(s)
  let area = 0
  let kSum = 0
  for (let id = 0; id < s.p.length; id++)
    if (s.contact[id]) {
      area += DX * DX
      kSum += s.k[id] * DX * DX
    }
  const K = kSum + 2 * Math.PI * s.T + 2e3
  const dz = Math.max(-0.004, Math.min(0.004, (F - WEIGHT) / K))
  s.zc += dz
  return Math.abs(F - WEIGHT) / WEIGHT
}

export function settle(s, maxFrames = 4000, tol = 2e-4) {
  let err = 1
  let f = 0
  let calm = 0
  for (; f < maxFrames; f++) {
    err = step(s, 30)
    calm = err < tol ? calm + 1 : 0
    if (calm > 40) break
  }
  s.stats = measure(s)
  return { frames: f, err }
}

export function measure(s) {
  const { p, contact, w } = s
  let area = 0
  let F = 0
  let ring = 0
  let peak = 0
  let over = 0
  let sink = 0
  for (let j = 1; j < NY - 1; j++)
    for (let i = 1; i < NX - 1; i++) {
      const id = j * NX + i
      if (w[id] > sink) sink = w[id]
      if (!contact[id]) continue
      area += DX * DX
      F += p[id] * DX * DX
      if (p[id] > peak) peak = p[id]
      if (p[id] > CAPILLARY) over += DX * DX
      const rim = !contact[id - 1] || !contact[id + 1] || !contact[id - NX] || !contact[id + NX]
      if (rim) ring += p[id] * DX * DX
    }
  // Foam that is not under the skull but holds it up anyway: the cover
  // carries load sideways out of the patch and the springs there take it.
  let outside = 0
  let foam = 0
  for (let id = 0; id < w.length; id++) {
    const f = s.k[id] * w[id] * DX * DX
    foam += f
    if (!contact[id]) outside += f
  }
  // ringShare is grid-dependent (see header); kept for drawing only.
  return {
    area, // m²
    force: F,
    ringShare: F > 0 ? ring / F : 0,
    lent: foam > 0 ? outside / foam : 0, // share of the head held by foam it is not touching
    mean: area > 0 ? F / area : 0,
    peak,
    overCap: area > 0 ? over / area : 0,
    sink, // m
    spread: Math.sqrt(s.T / (E / H)), // ℓ = √(T/k) at the crown (m)
  }
}
