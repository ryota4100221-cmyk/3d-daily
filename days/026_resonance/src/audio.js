// audio.js — Day 026 · a self-contained GENERATIVE ambient engine + FFT analysis.
//
// New technique for this project: sound is the driver. For 25 days the input has
// been the pointer (light / force / focus / grade / sun / director). Here the
// visual is driven by the music's own spectrum. To stay 100% offline & asset-free
// (no mp3 fetch, works in a headless build), the music is SYNTHESISED live in the
// WebAudio graph — a generative pentatonic drone/arpeggio with a soft kick — and
// analysed every frame with an AnalyserNode (FFT).
//
// Browser autoplay policy blocks sound until a user gesture, so start() is called
// from the BEGIN overlay. Before that (and in headless), update() returns a
// procedurally-synthesised spectrum so the scene is never dead.

export const SPEC_N = 96 // downsampled spectrum bins the visual consumes

// A2 minor-pentatonic, a couple of octaves. Warm, unresolved, monaka-calm.
const ROOT = 55 // A1
const PENTA = [0, 3, 5, 7, 10] // minor pentatonic semitone offsets
function scaleFreq(deg, oct) {
  const semis = PENTA[((deg % PENTA.length) + PENTA.length) % PENTA.length]
  return ROOT * Math.pow(2, oct + semis / 12)
}

export class AudioEngine {
  constructor() {
    this.ctx = null
    this.master = null
    this.analyser = null
    this._bytes = null
    this.started = false
    this.muted = false

    // conductor params (pointer can nudge these; defaults stand alone)
    this.brightness = 0.5 // 0..1  -> lowpass cutoff
    this.tempo = 0.5 // 0..1      -> arpeggio speed

    // outputs the visual reads (all smoothed, 0..1-ish)
    this.spectrum = new Float32Array(SPEC_N)
    this.bass = 0
    this.mid = 0
    this.treble = 0
    this.level = 0
    this.beat = 0 // decaying pulse on bass onsets

    this._nextNote = 0
    this._step = 0
    this._prevBass = 0
    this._t = 0
  }

  async start() {
    if (this.started) {
      if (this.ctx.state === 'suspended') await this.ctx.resume()
      return
    }
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    this.ctx = ctx

    // ---- master chain: bus -> lowpass -> master gain -> analyser -> out
    const master = ctx.createGain()
    master.gain.value = 0.0
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 1400
    lp.Q.value = 0.6
    this.lp = lp

    const analyser = ctx.createAnalyser()
    analyser.fftSize = 2048
    analyser.smoothingTimeConstant = 0.78
    this.analyser = analyser
    this._bytes = new Uint8Array(analyser.frequencyBinCount)

    // a cheap algorithmic reverb: two feedback delays for air
    const wet = ctx.createGain()
    wet.gain.value = 0.32
    const d1 = ctx.createDelay(1.0)
    d1.delayTime.value = 0.23
    const d2 = ctx.createDelay(1.0)
    d2.delayTime.value = 0.37
    const fb = ctx.createGain()
    fb.gain.value = 0.42
    const damp = ctx.createBiquadFilter()
    damp.type = 'lowpass'
    damp.frequency.value = 2200

    // bus receives all voices
    const bus = ctx.createGain()
    bus.gain.value = 1.0
    this.bus = bus

    bus.connect(lp)
    bus.connect(d1)
    d1.connect(damp)
    damp.connect(fb)
    fb.connect(d2)
    d2.connect(d1) // feedback loop
    d2.connect(wet)
    wet.connect(lp)

    lp.connect(master)
    master.connect(analyser)
    analyser.connect(ctx.destination)
    this.master = master

    // low drone pad — two detuned saws through a soft filter, always on
    const pad = ctx.createGain()
    pad.gain.value = 0.16
    const padFilt = ctx.createBiquadFilter()
    padFilt.type = 'lowpass'
    padFilt.frequency.value = 500
    padFilt.Q.value = 3
    padFilt.connect(pad)
    pad.connect(bus)
    ;[0, 0.5].forEach((det, i) => {
      const o = ctx.createOscillator()
      o.type = 'sawtooth'
      o.frequency.value = scaleFreq(0, 1)
      o.detune.value = det * 8 - 2
      const lfo = ctx.createOscillator()
      lfo.frequency.value = 0.05 + i * 0.03
      const lfoG = ctx.createGain()
      lfoG.gain.value = 120
      lfo.connect(lfoG)
      lfoG.connect(padFilt.frequency)
      o.connect(padFilt)
      o.start()
      lfo.start()
    })
    this._padFilt = padFilt

    // fade master in
    const now = ctx.currentTime
    master.gain.setValueAtTime(0.0, now)
    master.gain.linearRampToValueAtTime(0.9, now + 2.0)

    this._nextNote = ctx.currentTime + 0.1
    this._step = 0
    this.started = true
  }

  setMuted(m) {
    this.muted = m
    if (this.master) {
      const now = this.ctx.currentTime
      this.master.gain.cancelScheduledValues(now)
      this.master.gain.linearRampToValueAtTime(m ? 0.0 : 0.9, now + 0.4)
    }
  }

  // one plucked/bowed voice through an ADSR-ish envelope
  _voice(freq, time, dur, type, peak) {
    const ctx = this.ctx
    const o = ctx.createOscillator()
    o.type = type
    o.frequency.value = freq
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, time)
    g.gain.exponentialRampToValueAtTime(peak, time + 0.02)
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur)
    o.connect(g)
    g.connect(this.bus)
    o.start(time)
    o.stop(time + dur + 0.05)
  }

  _kick(time) {
    const ctx = this.ctx
    const o = ctx.createOscillator()
    o.type = 'sine'
    o.frequency.setValueAtTime(120, time)
    o.frequency.exponentialRampToValueAtTime(38, time + 0.16)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, time)
    g.gain.exponentialRampToValueAtTime(0.7, time + 0.01)
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.28)
    o.connect(g)
    g.connect(this.bus)
    o.start(time)
    o.stop(time + 0.32)
  }

  // deterministic-ish generative sequence (no Math.random dependence for shape,
  // but a little variation keeps it alive)
  _playStep(step, time) {
    // arpeggio: wander the pentatonic scale
    const deg = (step * 2 + Math.floor(step / 8) * 3) % 5
    const oct = 2 + (step % 4 === 0 ? 1 : 0) + (step % 16 < 8 ? 1 : 0)
    this._voice(scaleFreq(deg, oct), time, 0.9, 'triangle', 0.14)
    // sparkle harmony every other step
    if (step % 2 === 1) {
      this._voice(scaleFreq((deg + 2) % 5, oct + 1), time + 0.03, 0.7, 'sine', 0.07)
    }
    // bass movement every 4 steps
    if (step % 4 === 0) {
      this._voice(scaleFreq((step / 4) % 5, 0), time, 1.6, 'sawtooth', 0.12)
    }
    // soft kick on the down-beat
    if (step % 4 === 0) this._kick(time)
  }

  _schedule() {
    const ctx = this.ctx
    const noteDur = 0.5 - this.tempo * 0.22 // faster when brighter
    while (this._nextNote < ctx.currentTime + 0.18) {
      this._playStep(this._step, this._nextNote)
      this._nextNote += noteDur
      this._step++
    }
    // conductor -> timbre
    if (this.lp) {
      const cut = 500 + this.brightness * 4500
      this.lp.frequency.setTargetAtTime(cut, ctx.currentTime, 0.15)
    }
  }

  // called every frame from useFrame; returns nothing, mutates public fields
  update(dt) {
    this._t += dt
    if (this.started && !this.muted) {
      this._schedule()
      const a = this.analyser
      a.getByteFrequencyData(this._bytes)
      const bins = this._bytes
      const n = bins.length

      // downsample to SPEC_N on a mild log curve (perceptual)
      for (let i = 0; i < SPEC_N; i++) {
        const f0 = Math.pow(i / SPEC_N, 1.7)
        const f1 = Math.pow((i + 1) / SPEC_N, 1.7)
        let s = 0, c = 0
        const a0 = Math.floor(f0 * n), a1 = Math.max(a0 + 1, Math.floor(f1 * n))
        for (let k = a0; k < a1 && k < n; k++) { s += bins[k]; c++ }
        const v = c ? s / c / 255 : 0
        this.spectrum[i] += (v - this.spectrum[i]) * 0.35
      }
      const band = (lo, hi) => {
        let s = 0, c = 0
        for (let k = Math.floor(lo * n); k < hi * n && k < n; k++) { s += bins[k]; c++ }
        return c ? s / c / 255 : 0
      }
      const bass = band(0.0, 0.06)
      const mid = band(0.06, 0.22)
      const treble = band(0.22, 0.6)
      this.bass += (bass - this.bass) * 0.4
      this.mid += (mid - this.mid) * 0.3
      this.treble += (treble - this.treble) * 0.3
      this.level += ((bass + mid + treble) / 3 - this.level) * 0.25
      // bass onset -> beat pulse
      const onset = Math.max(0, bass - this._prevBass)
      this._prevBass = bass
      if (onset > 0.06) this.beat = Math.min(1, this.beat + onset * 2.2)
      this.beat *= Math.exp(-dt * 4.5)
    } else {
      // ---- SYNTHETIC fallback: keep the scene alive with no audio ----
      this._synth(dt)
    }
  }

  _synth(dt) {
    const t = this._t
    // pseudo-beat every ~1.1s
    const phase = (t % 1.1) / 1.1
    const beat = Math.exp(-phase * 6.0)
    this.beat += (beat - this.beat) * 0.3
    for (let i = 0; i < SPEC_N; i++) {
      const f = i / SPEC_N
      // rolling hills of spectrum, drifting in time
      const env = Math.pow(1 - f, 1.4) // more energy in low end
      const wob =
        0.5 +
        0.5 * Math.sin(t * 1.3 + i * 0.35) *
          Math.sin(t * 0.7 - i * 0.11)
      const spark = 0.25 * Math.max(0, Math.sin(t * 3.0 + i * 0.9))
      const v = Math.min(1, env * (0.35 + 0.6 * wob) + spark * env + beat * env * 0.5)
      this.spectrum[i] += (v - this.spectrum[i]) * 0.15
    }
    this.bass += (0.35 + 0.5 * beat - this.bass) * 0.15
    this.mid += (0.35 + 0.2 * Math.sin(t * 0.9) - this.mid) * 0.12
    this.treble += (0.3 + 0.2 * Math.max(0, Math.sin(t * 2.2)) - this.treble) * 0.12
    this.level += ((this.bass + this.mid + this.treble) / 3 - this.level) * 0.2
  }
}
