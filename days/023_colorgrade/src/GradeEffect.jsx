import { Effect, BlendFunction } from 'postprocessing'
import { Uniform, Color, Vector3 } from 'three'
import { forwardRef, useMemo, useLayoutEffect } from 'react'

/* ------------------------------------------------------------------ *
 * Day 023 — Week 4 · COLOR GRADING  "Chroma"
 *
 * NEW TECHNIQUE — a *custom* postprocessing Effect (a subclass of
 * `Effect` from the `postprocessing` library, not an off-the-shelf
 * component) that owns the entire display transform in one GLSL pass:
 *
 *     linear HDR  →  exposure  →  white balance  →  TONE MAP (ACES fit)
 *                 →  lift / gamma / gain  →  saturation
 *                 →  split-toning (shadow hue vs highlight hue by luma)
 *                 →  linear display-referred [0,1]
 *
 * This is exactly the pipeline a creative .cube LUT bakes down — here it
 * stays live and parametric, so a single neutral scene can be re-lit into
 * completely different WORLDS purely through the grade. Day 022 leaned on
 * the renderer's stock ACES + ready-made effect components; today the tone
 * map itself is ours (renderer set to NoToneMapping), which is the step up.
 *
 * The pointer crossfades between three complete grades (pointer-as-GRADE,
 * a fresh interaction after 22 days of pointer-as-light / force / focus).
 * ------------------------------------------------------------------ */

// Narkowicz ACES fit — scene-linear HDR → linear display-referred [0,1].
// The renderer's tone map is disabled; this pass performs it, so the grade
// ops downstream act on a properly rolled-off image (highlights don't clip
// hard, shadows keep their toe). The composer applies the sRGB OETF after.
const fragment = /* glsl */ `
  uniform float uExposure;   // stops
  uniform vec3  uWB;         // per-channel white-balance gains (~1.0)
  uniform float uContrast;
  uniform float uPivot;
  uniform vec3  uLift;       // shadow offset
  uniform vec3  uGain;       // highlight multiply
  uniform vec3  uInvGamma;   // 1.0 / midtone gamma
  uniform float uSat;
  uniform vec3  uShadowTint; // 0.5 = neutral
  uniform vec3  uHighTint;
  uniform float uSplitStr;
  uniform float uSplitBalance;
  uniform float uAmount;     // master graded<->neutral blend (0..1)

  const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

  vec3 aces(vec3 x) {
    const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
    return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
  }

  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    vec3 c = max(inputColor.rgb, 0.0);

    // --- scene-linear ops (before the tone map) ---
    c *= exp2(uExposure);                 // exposure in stops
    c *= uWB;                             // white balance / temperature-tint

    // neutral reference (only exposure + tone map) for the master blend
    vec3 neutral = aces(max(inputColor.rgb, 0.0) * exp2(uExposure));

    // --- tone map: HDR -> display-referred [0,1] ---
    c = aces(c);

    // --- display-referred ops (the "LUT look") ---
    // contrast around a pivot
    c = (c - uPivot) * uContrast + uPivot;
    c = clamp(c, 0.0, 1.0);

    // lift / gamma / gain (classic colourist trim)
    c = c * uGain + uLift * (1.0 - c);   // gain scales highs, lift floats shadows
    c = pow(max(c, 0.0), uInvGamma);     // gamma bends the midtones per channel

    // saturation about luma
    float l = dot(c, LUMA);
    c = mix(vec3(l), c, uSat);

    // split-toning — push a hue into shadows, another into highlights,
    // weighted by luminance so the two never fight in the midtones.
    float lum = clamp(dot(c, LUMA), 0.0, 1.0);
    float sw = pow(1.0 - lum, uSplitBalance);          // shadow weight
    float hw = pow(lum, uSplitBalance);                // highlight weight
    c += (uShadowTint * 2.0 - 1.0) * uSplitStr * sw;
    c += (uHighTint  * 2.0 - 1.0) * uSplitStr * hw;

    c = clamp(c, 0.0, 1.0);
    c = mix(neutral, c, uAmount);        // let the day dial the whole grade in

    outputColor = vec4(c, inputColor.a);
  }
`

export class GradeEffectImpl extends Effect {
  constructor() {
    super('GradeEffect', fragment, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map([
        ['uExposure', new Uniform(0.0)],
        ['uWB', new Uniform(new Vector3(1, 1, 1))],
        ['uContrast', new Uniform(1.06)],
        ['uPivot', new Uniform(0.5)],
        ['uLift', new Uniform(new Vector3(0, 0, 0))],
        ['uGain', new Uniform(new Vector3(1, 1, 1))],
        ['uInvGamma', new Uniform(new Vector3(1, 1, 1))],
        ['uSat', new Uniform(1.0)],
        ['uShadowTint', new Uniform(new Vector3(0.5, 0.5, 0.5))],
        ['uHighTint', new Uniform(new Vector3(0.5, 0.5, 0.5))],
        ['uSplitStr', new Uniform(0.0)],
        ['uSplitBalance', new Uniform(1.4)],
        ['uAmount', new Uniform(1.0)],
      ]),
    })
  }

  // convenience setter used by the FrameRig — copies a resolved world into
  // the live uniforms (all colourist parameters at once).
  applyGrade(g) {
    const u = this.uniforms
    u.get('uExposure').value = g.exposure
    u.get('uWB').value.set(g.wb[0], g.wb[1], g.wb[2])
    u.get('uContrast').value = g.contrast
    u.get('uLift').value.set(g.lift[0], g.lift[1], g.lift[2])
    u.get('uGain').value.set(g.gain[0], g.gain[1], g.gain[2])
    u.get('uInvGamma').value.set(1 / g.gamma[0], 1 / g.gamma[1], 1 / g.gamma[2])
    u.get('uSat').value = g.sat
    u.get('uShadowTint').value.set(g.shadowTint[0], g.shadowTint[1], g.shadowTint[2])
    u.get('uHighTint').value.set(g.highTint[0], g.highTint[1], g.highTint[2])
    u.get('uSplitStr').value = g.splitStr
    u.get('uSplitBalance').value = g.splitBalance
  }
}

// wrap as a JSX component; ref points at the effect instance
export const Grade = forwardRef(function Grade(_props, ref) {
  const effect = useMemo(() => new GradeEffectImpl(), [])
  useLayoutEffect(() => {
    if (!ref) return
    if (typeof ref === 'function') ref(effect)
    else ref.current = effect
  }, [effect, ref])
  return <primitive object={effect} dispose={null} />
})

/* ---------------------------- the three WORLDS ---------------------------- *
 * Each is a complete colourist grade. The pointer travels a 0..2 axis across
 * them (A→B→C); every parameter is interpolated, so the scene never cuts —
 * it dissolves from one world's mood into the next. Values are chosen to stay
 * within the monaka register: refined, warm paper, a single terracotta accent.
 * ------------------------------------------------------------------------- */
export const WORLDS = [
  {
    name: 'Bone',
    caption: 'clean · warm neutral',
    exposure: 0.0,
    wb: [1.03, 1.0, 0.96],
    contrast: 1.07,
    sat: 1.03,
    lift: [0.012, 0.01, 0.008],
    gain: [1.02, 1.0, 0.97],
    gamma: [1.0, 1.0, 1.02],
    shadowTint: [0.47, 0.49, 0.53],
    highTint: [0.54, 0.51, 0.45],
    splitStr: 0.05,
    splitBalance: 1.4,
  },
  {
    name: 'Amber',
    caption: 'golden hour · teal–orange',
    exposure: 0.14,
    wb: [1.08, 1.0, 0.9],
    contrast: 1.15,
    sat: 1.09,
    lift: [0.012, 0.014, 0.024],
    gain: [1.06, 1.0, 0.92],
    gamma: [0.98, 1.0, 1.06],
    shadowTint: [0.42, 0.5, 0.6],
    highTint: [0.61, 0.52, 0.38],
    splitStr: 0.13,
    splitBalance: 1.6,
  },
  {
    name: 'Nocturne',
    caption: 'cool · quiet · matte',
    exposure: -0.24,
    wb: [0.95, 1.0, 1.08],
    contrast: 1.03,
    sat: 0.82,
    lift: [0.02, 0.026, 0.034],
    gain: [0.95, 0.98, 1.05],
    gamma: [1.05, 1.04, 1.02],
    shadowTint: [0.44, 0.49, 0.59],
    highTint: [0.5, 0.51, 0.55],
    splitStr: 0.11,
    splitBalance: 1.2,
  },
]

const lerp = (a, b, t) => a + (b - a) * t
const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]

// resolve a continuous grade at position p ∈ [0, WORLDS.length-1]
export function gradeAt(p) {
  const n = WORLDS.length
  const clamped = Math.max(0, Math.min(n - 1, p))
  const i = Math.min(n - 2, Math.floor(clamped))
  const t = clamped - i
  const a = WORLDS[i]
  const b = WORLDS[i + 1]
  return {
    exposure: lerp(a.exposure, b.exposure, t),
    wb: lerp3(a.wb, b.wb, t),
    contrast: lerp(a.contrast, b.contrast, t),
    sat: lerp(a.sat, b.sat, t),
    lift: lerp3(a.lift, b.lift, t),
    gain: lerp3(a.gain, b.gain, t),
    gamma: lerp3(a.gamma, b.gamma, t),
    shadowTint: lerp3(a.shadowTint, b.shadowTint, t),
    highTint: lerp3(a.highTint, b.highTint, t),
    splitStr: lerp(a.splitStr, b.splitStr, t),
    splitBalance: lerp(a.splitBalance, b.splitBalance, t),
  }
}
