// rig.js — the whole instrument: one massing, one sun, one count.
//
// An architect's shadow study does not draw shadows. It asks every point of the
// ground the same question at every quarter hour of one day — "can you see the
// sun past the building?" — and then draws the lines where the number of "no"
// answers crosses a whole hour. Those lines (等時間日影線, equal-hour shadow
// lines) are not the outline of any shadow that ever fell. They are the outline
// of how long the building borrowed the light.
//
// Units: 1 = 1 m. x = east, y = up, z = south (north is −z).

export const SITE = { name: 'Kyiv', lat: 50.45 } // the bureau's city

// Massing, as axis-aligned boxes [minX, minY, minZ, maxX, maxY, maxZ].
// The cantilever (index 2) floats 18 m above the ground: the sun passes under it,
// so the hours it lends are an island detached from its own footprint.
export const BOXES = [
  [-7, 0, -5, 7, 44, 5], //   tower
  [-28, 0, 5, 16, 10, 13], // long bar
  [7, 18, -11, 27, 25, -2], // cantilever
  [-9, 44, -7, 9, 45.2, 7], // roof plate
  [-28, 10, 5, -20, 14, 13], // bar head
]

export const SEASONS = [
  { key: 'winter', label: 'Winter solstice', decl: -23.44 },
  { key: 'equinox', label: 'Equinox', decl: 0 },
  { key: 'summer', label: 'Summer solstice', decl: 23.44 },
]

export const T0 = 8 // the window a shadow study counts, in apparent solar time
export const T1 = 16
export const STEPS = 65 // 7.5-minute samples, both ends included
export const DT = (T1 - T0) / (STEPS - 1) // hours per sample

const D = Math.PI / 180

// Sun direction (unit, pointing at the sun) for a declination and a solar hour.
export function sunDir(declDeg, hour, latDeg = SITE.lat) {
  const phi = latDeg * D
  const dl = declDeg * D
  const H = (hour - 12) * 15 * D
  const east = -Math.cos(dl) * Math.sin(H)
  const north = Math.cos(phi) * Math.sin(dl) - Math.sin(phi) * Math.cos(dl) * Math.cos(H)
  const up = Math.sin(phi) * Math.sin(dl) + Math.cos(phi) * Math.cos(dl) * Math.cos(H)
  return [east, up, -north]
}

export function altAz(s) {
  const alt = Math.asin(s[1]) / D
  let az = Math.atan2(s[0], -s[2]) / D // from north, clockwise
  if (az < 0) az += 360
  return { alt, az }
}

// Sun directions for the whole counted window. Samples with the sun below the
// horizon are kept as zero vectors; the ground shader skips them, so the count
// only ever measures the hours the sun was actually up.
export function sunTable(declDeg) {
  const out = []
  for (let i = 0; i < STEPS; i++) {
    const s = sunDir(declDeg, T0 + i * DT)
    out.push(s[1] > 0 ? s : [0, 0, 0])
  }
  return out
}

// Ray from ground point (x, 0, z) toward the sun: does it hit any box?
// Slab test, identical to the GLSL in Scene.jsx line for line.
export function blocked(x, z, s) {
  if (s[1] <= 0) return false
  for (const b of BOXES) {
    let t0 = 1e-4
    let t1 = 1e9
    const o = [x, 0, z]
    let miss = false
    for (let k = 0; k < 3; k++) {
      if (Math.abs(s[k]) < 1e-9) {
        if (o[k] < b[k] || o[k] > b[k + 3]) { miss = true; break }
        continue
      }
      let ta = (b[k] - o[k]) / s[k]
      let tb = (b[k + 3] - o[k]) / s[k]
      if (ta > tb) [ta, tb] = [tb, ta]
      t0 = Math.max(t0, ta)
      t1 = Math.min(t1, tb)
      if (t0 > t1) { miss = true; break }
    }
    if (!miss) return true
  }
  return false
}

export function insideFootprint(x, z) {
  for (const b of BOXES) if (b[1] === 0 && x >= b[0] && x <= b[3] && z >= b[2] && z <= b[5]) return true
  return false
}

// Hours of shadow at one ground point. The 65 samples only find *where* the
// answer changes; each change is then bisected 6 times in time (≈7 s), so the
// count is continuous and its whole-hour lines are clean curves, not a
// staircase of 7.5-minute steps. Same scheme in the ground shader.
export const BISECT = 6
export function shadowHours(x, z, declDeg) {
  let h = 0
  let tPrev = T0
  let bPrev = blocked(x, z, sunDir(declDeg, T0))
  for (let i = 1; i < STEPS; i++) {
    const t = T0 + i * DT
    const b = blocked(x, z, sunDir(declDeg, t))
    if (b && bPrev) h += DT
    else if (b !== bPrev) {
      let lo = tPrev
      let hi = t // invariant: state(lo) = bPrev, state(hi) = b
      for (let k = 0; k < BISECT; k++) {
        const m = (lo + hi) / 2
        if (blocked(x, z, sunDir(declDeg, m)) === bPrev) lo = m
        else hi = m
      }
      const tc = (lo + hi) / 2
      h += bPrev ? tc - tPrev : t - tc
    }
    tPrev = t
    bPrev = b
  }
  return h
}

// Areas of the ground (outside the footprint) shaded for at least k hours,
// k = 1..5, plus the area shaded at the instant `now`. 1 m grid over 360×360 m.
export function survey(declDeg, nowDir) {
  const ks = [1, 2, 3, 4, 5]
  const area = ks.map(() => 0)
  let instant = 0
  let longest = 0
  const R = 180
  for (let z = -R + 0.5; z < R; z += 1) {
    for (let x = -R + 0.5; x < R; x += 1) {
      if (insideFootprint(x, z)) continue
      const h = shadowHours(x, z, declDeg)
      if (h > longest) longest = h
      for (let i = 0; i < ks.length; i++) if (h >= ks[i] - 1e-9) area[i]++
      if (nowDir && blocked(x, z, nowDir)) instant++
    }
  }
  return { ks, area, instant, longest }
}
