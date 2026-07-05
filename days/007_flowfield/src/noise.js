// A tiny, dependency-free 2D value-noise field with fBm layering.
//
// Day 005's kinetic field moved on a single radial sine — perfectly symmetric,
// and once you've seen one ring you've seen them all. The Week-1 reprise steps
// that up: the height + flow of every instance is now read from a *continuous
// pseudo-random field* that we advance through time, so the surface drifts like
// wind over grass instead of pulsing like a speaker cone. Same one-draw-call
// InstancedMesh discipline, a far richer signal driving it.
//
// Kept deterministic (a fixed integer hash, no Math.random) so the field is the
// same on every reload and the build is reproducible.

// Integer hash → [0,1). Cheap, stable, good enough for a decorative field.
function hash(ix, iy) {
  let h = (ix * 374761393 + iy * 668265263) | 0
  h = (h ^ (h >>> 13)) * 1274126177
  h = h ^ (h >>> 16)
  // >>> 0 forces unsigned; divide by 2^32 → [0,1)
  return (h >>> 0) / 4294967296
}

// Smoothstep-interpolated value noise. Continuous and smooth (C1), which is
// what makes the pillars ease between neighbours instead of stair-stepping.
export function valueNoise(x, y) {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const fx = x - ix
  const fy = y - iy

  const a = hash(ix, iy)
  const b = hash(ix + 1, iy)
  const c = hash(ix, iy + 1)
  const d = hash(ix + 1, iy + 1)

  // Quintic fade (Perlin's), gentler slopes than plain smoothstep.
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10)
  const v = fy * fy * fy * (fy * (fy * 6 - 15) + 10)

  const ab = a + (b - a) * u
  const cd = c + (d - c) * u
  return ab + (cd - ab) * v // [0,1)
}

// Fractal Brownian motion: sum several octaves of value noise at doubling
// frequency and halving amplitude. Gives the field both broad swells and fine
// texture — the detail that reads as "crafted" rather than "procedural".
export function fbm(x, y, octaves = 4) {
  let sum = 0
  let amp = 0.5
  let freq = 1
  let norm = 0
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(x * freq, y * freq)
    norm += amp
    amp *= 0.5
    freq *= 2
  }
  return sum / norm // normalised back to [0,1)
}
