// rig.js — the hi-hat as a list of modes, and the box as one line of physics.
//
// A cymbal is a thin plate. A thin plate struck once rings in its free modes,
// and Chladni's law puts mode (m nodal diameters, n nodal circles) at
//     f = C · (m + 2n)^2
// Nothing else about "the sound of a hi-hat" is written down below. The same
// list is (1) summed into the audio buffer you hear, (2) summed in the vertex
// shader that bends the bronze, and (3) summed again on the floor as the air
// outside the box. One signal, three readers.
//
// The box is the mass law. A limp wall of surface density ms (kg/m²) lets
//     TL(f) = 20·log10(ms · f) − 47   dB
// less through — +6 dB per octave. That is the whole of "Eliminate": the box
// cannot tell a cymbal from a kick drum, it only knows frequency, and a cymbal
// is almost entirely high modes.

export const C_CHLADNI = 85 // Hz — puts (2,0) at 340 Hz, a 14" hi-hat's lowest ring
export const MS = 7.1 // kg/m² — 6 mm acrylic (ρ 1180)
export const KICK_HZ = 60 // reference: what still gets through

// deterministic irregularity: no real cymbal is a perfect plate (hammering)
function jitter(i) {
  const s = Math.sin(i * 127.1 + 311.7) * 43758.5453
  return (s - Math.floor(s)) * 2 - 1
}

export const MODES = (() => {
  const out = []
  let i = 0
  for (let n = 0; n <= 6; n++) {
    for (let m = 0; m <= 13; m++) {
      const q = m + 2 * n
      if (q < 2 || q > 13) continue
      if (n === 0 && m < 2) continue // (0,0) and (1,0) are rigid-body motions
      const f = C_CHLADNI * q * q * (1 + 0.035 * jitter(i))
      // a stick at the edge drives every mode; higher ones a little less
      const a = 1 / (1 + 0.16 * q) * (0.75 + 0.25 * Math.abs(jitter(i + 50)))
      // closed hi-hat: the felt and the other cymbal choke it, highs die first
      const tau = 0.2 * Math.pow(1000 / f, 0.4)
      out.push({ m, n, f, a, tau, phase: (jitter(i + 90) + 1) * Math.PI })
      i++
    }
  }
  return out.sort((x, y) => x.f - y.f)
})()

export function massLawTL(f, ms = MS) {
  return Math.max(0, 20 * Math.log10(ms * f) - 47)
}

export function gainOf(f, hush) {
  return hush ? Math.pow(10, -massLawTL(f) / 20) : 1
}

// energy that leaves the box relative to the bare cymbal, integrated over the
// whole ring-down (∫a²e^{-2t/τ} = a²τ/2)
export function bleedDb(hush) {
  let open = 0
  let out = 0
  for (const k of MODES) {
    const e = k.a * k.a * k.tau
    open += e
    out += e * gainOf(k.f, hush) ** 2
  }
  return 10 * Math.log10(out / open)
}

// Visual time. Audio rates are invisible at 60 fps, so the picture plays the
// same modes slowed: frequency keeps its ORDER (√f), envelopes stretch ×8.
export const STRETCH = 8
export const visHz = (f) => 0.55 * Math.sqrt(f / 340)
// spatial wavelength on the floor: true k = 2πf/c, with c ×2.5 so the grid of
// points can still carry the highest mode (1 unit = 0.178 m = one cymbal radius)
export const UNIT_M = 0.178
export const visK = (f) => (2 * Math.PI * f) / (343 * 2.5) * UNIT_M

// current amplitude of each mode, t seconds (visual) after the strike
export function envelopes(tVis, hush, out) {
  const ta = tVis / STRETCH
  for (let i = 0; i < MODES.length; i++) {
    const k = MODES[i]
    out[i] = ta < 0 ? 0 : k.a * Math.exp(-ta / k.tau) * gainOf(k.f, hush)
  }
  return out
}

// Audio: the same list, rendered at 44.1 kHz. A 2 ms noise click is the stick.
export function renderBuffer(ctx, hush) {
  const sr = ctx.sampleRate
  const len = Math.floor(sr * 1.1)
  const buf = ctx.createBuffer(1, len, sr)
  const d = buf.getChannelData(0)
  for (const k of MODES) {
    const g = k.a * gainOf(k.f, hush)
    if (g < 1e-5) continue
    const w = (2 * Math.PI * k.f) / sr
    const dec = Math.exp(-1 / (k.tau * sr))
    let env = g
    for (let s = 0; s < len; s++) {
      d[s] += env * Math.sin(w * s + k.phase)
      env *= dec
    }
  }
  let seed = 7
  const click = Math.floor(sr * 0.002)
  for (let s = 0; s < click; s++) {
    seed = (seed * 16807) % 2147483647
    const hp = gainOf(4000, hush) // the click is broadband; treat it as 4 kHz
    d[s] += ((seed / 2147483647) * 2 - 1) * 0.6 * hp * (1 - s / click)
  }
  let peak = 0
  for (let s = 0; s < len; s++) peak = Math.max(peak, Math.abs(d[s]))
  // both buffers share the OPEN peak so the hush is heard as quieter, not normalised away
  return { buf, peak }
}
