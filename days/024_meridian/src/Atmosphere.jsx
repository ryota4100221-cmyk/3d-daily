import { Effect, EffectAttribute } from 'postprocessing'
import { Uniform, Vector2, Vector3 } from 'three'
import { forwardRef, useMemo, useLayoutEffect } from 'react'

/* ------------------------------------------------------------------ *
 * Day 024 — Week 4 · SCENE COMPOSITION  "Meridian"
 *
 * NEW TECHNIQUE — a custom postprocessing Effect that reads the scene
 * DEPTH buffer to composite depth-aware atmospheric haze + screen-space
 * sun scattering. Every prior post pass in this project shaded the flat
 * colour frame; this one declares `EffectAttribute.DEPTH`, so the library
 * hands `mainImage` the per-pixel depth. We linearise it ourselves from
 * cameraNear/cameraFar (self-contained — no reliance on library helpers)
 * and fold the whole scene into ONE volume of air:
 *
 *   • exp²-distance fog toward a vertical dawn gradient (warm horizon →
 *     cool zenith), so near porcelain and far monuments share the same haze
 *   • a soft screen-space sun glow that scatters *more* through the haze,
 *     bound to the same sun the lights and sky shader use
 *
 * This is the pass that unifies the composed world (custom sky + relief
 * ground + instanced monuments + motes + bloom) into a single atmosphere,
 * which is what makes a ⭐5 "scene" read as a place rather than a pile of
 * objects. Runs on the HDR frame, before bloom lifts the sun's core.
 * ------------------------------------------------------------------ */

const fragment = /* glsl */ `
  uniform vec3  uHorizon;   // fog colour at the horizon (warm)
  uniform vec3  uZenith;    // fog colour high in frame (cool)
  uniform float uDensity;   // distance-fog density
  uniform float uNear;
  uniform float uFar;
  uniform vec2  uSun;       // sun position in screen uv
  uniform vec3  uSunColor;
  uniform float uSunFall;   // glow falloff (larger = tighter)
  uniform float uSunStr;    // glow strength
  uniform float uAspect;

  // perspective depth (non-linear, [0,1]) -> linear view distance
  float linearDist(float d) {
    float ndc = d * 2.0 - 1.0;
    return (2.0 * uNear * uFar) / (uFar + uNear - ndc * (uFar - uNear));
  }

  void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
    vec3 c = inputColor.rgb;

    // sky pixels (depth == 1.0) already carry the gradient from the dome —
    // don't double-fog them to a flat grey; fog only what has real depth.
    float isScene = step(depth, 0.9999);
    float dist = linearDist(depth);

    // exponential-squared distance fog, gated to scene geometry
    float f = 1.0 - exp(-uDensity * uDensity * dist * dist);
    f = clamp(f, 0.0, 1.0) * isScene;

    // the haze itself is a vertical dawn gradient, so the floor melts into
    // a warm band and the upper air stays cool — the frame reads as air.
    vec3 fogCol = mix(uHorizon, uZenith, smoothstep(0.28, 0.92, uv.y));
    c = mix(c, fogCol, f);

    // screen-space sun scattering — aspect-corrected radial glow, stronger
    // where there is more air between camera and geometry (through the haze).
    vec2 d2 = (uv - uSun) * vec2(uAspect, 1.0);
    float r = length(d2);
    float glow = exp(-r * r * uSunFall);
    float scatter = 0.4 + 0.6 * clamp(f + (1.0 - isScene) * 0.7, 0.0, 1.0);
    c += uSunColor * glow * uSunStr * scatter;

    outputColor = vec4(c, inputColor.a);
  }
`

export class AtmosphereEffectImpl extends Effect {
  constructor() {
    super('AtmosphereEffect', fragment, {
      attributes: EffectAttribute.DEPTH,
      uniforms: new Map([
        ['uHorizon', new Uniform(new Vector3(0.95, 0.86, 0.74))],
        ['uZenith', new Uniform(new Vector3(0.78, 0.79, 0.83))],
        ['uDensity', new Uniform(0.026)],
        ['uNear', new Uniform(0.1)],
        ['uFar', new Uniform(60.0)],
        ['uSun', new Uniform(new Vector2(0.5, 0.7))],
        ['uSunColor', new Uniform(new Vector3(1.0, 0.72, 0.42))],
        ['uSunFall', new Uniform(9.0)],
        ['uSunStr', new Uniform(0.5)],
        ['uAspect', new Uniform(1.0)],
      ]),
    })
  }

  set(props) {
    const u = this.uniforms
    if (props.horizon) u.get('uHorizon').value.copy(props.horizon)
    if (props.zenith) u.get('uZenith').value.copy(props.zenith)
    if (props.sun) u.get('uSun').value.copy(props.sun)
    if (props.sunColor) u.get('uSunColor').value.copy(props.sunColor)
    if (props.sunStr !== undefined) u.get('uSunStr').value = props.sunStr
    if (props.density !== undefined) u.get('uDensity').value = props.density
    if (props.near !== undefined) u.get('uNear').value = props.near
    if (props.far !== undefined) u.get('uFar').value = props.far
    if (props.aspect !== undefined) u.get('uAspect').value = props.aspect
  }
}

export const Atmosphere = forwardRef(function Atmosphere(_props, ref) {
  const effect = useMemo(() => new AtmosphereEffectImpl(), [])
  useLayoutEffect(() => {
    if (!ref) return
    if (typeof ref === 'function') ref(effect)
    else ref.current = effect
  }, [effect, ref])
  return <primitive object={effect} dispose={null} />
})
