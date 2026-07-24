import { shaderMaterial } from '@react-three/drei'
import { extend } from '@react-three/fiber'
import * as THREE from 'three'

/* ------------------------------------------------------------------ *
 * TransitionMaterial — the compositor.
 * Draws a full-screen clip-space quad that cross-blends two whole
 * rendered scenes (uFrom / uTo, each a scene FBO) with a DIRECTED
 * transition: a directional wipe, a noise dissolve, or a radial iris,
 * each carrying a bright terracotta "seam" of light along its front.
 * This is the day's new technique — transitions between entire scenes,
 * not objects or a single post chain.
 * ------------------------------------------------------------------ */

const TransitionMaterial = shaderMaterial(
  {
    uFrom: null,
    uTo: null,
    uProgress: 0,
    uType: 0, // 0 wipe · 1 dissolve · 2 iris
    uAngle: 0.6,
    uAspect: 1.6,
    uTime: 0,
    uFromSolid: 0, // 1 = ignore uFrom texture, use paper (initial reveal)
    uPaper: new THREE.Color('#e7e1d5'),
    uSeam: new THREE.Color('#c8663a'),
  },
  // vertex — clip-space fullscreen quad (planeGeometry(2,2))
  /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }
  `,
  // fragment
  /* glsl */ `
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D uFrom;
    uniform sampler2D uTo;
    uniform float uProgress;
    uniform float uType;
    uniform float uAngle;
    uniform float uAspect;
    uniform float uTime;
    uniform float uFromSolid;
    uniform vec3 uPaper;
    uniform vec3 uSeam;

    // -- cheap value-noise fBm (offline, no deps) --
    float hash(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
    float vnoise(vec2 p){
      vec2 i=floor(p), f=fract(p);
      float a=hash(i), b=hash(i+vec2(1.0,0.0)), c=hash(i+vec2(0.0,1.0)), d=hash(i+vec2(1.0,1.0));
      vec2 u=f*f*(3.0-2.0*f);
      return mix(mix(a,b,u.x),mix(c,d,u.x),u.y);
    }
    float fbm(vec2 p){
      float s=0.0, a=0.5;
      for(int i=0;i<4;i++){ s+=a*vnoise(p); p*=2.02; a*=0.5; }
      return s;
    }

    void main(){
      vec2 uv = vUv;
      vec3 from = uFromSolid > 0.5 ? uPaper : texture2D(uFrom, uv).rgb;
      vec3 to   = texture2D(uTo, uv).rgb;

      // aspect-corrected centered coords
      vec2 p = (uv - 0.5) * vec2(uAspect, 1.0);

      // per-type transition field, normalized ~0..1
      float field;
      if (uType < 0.5) {
        vec2 dir = vec2(cos(uAngle), sin(uAngle));
        field = dot(p, dir) / (0.5 * (abs(uAspect) + 1.0)) * 0.5 + 0.5;
      } else if (uType < 1.5) {
        field = fbm(uv * 3.4 + 11.0);
      } else {
        field = clamp(length(p) / (0.5 * sqrt(uAspect*uAspect + 1.0)), 0.0, 1.0);
      }
      // organic warp on the front edge
      field += (fbm(uv * 6.0 + uTime * 0.05) - 0.5) * 0.12;

      float edge = 0.16;
      float th = uProgress * (1.0 + 2.0 * edge) - edge;
      // m = 1 -> FROM still present, 0 -> switched to TO
      float m = smoothstep(th - edge, th + edge, field);

      vec3 col = mix(to, from, m);

      // a thin terracotta seam of light riding the transition front
      float seam = smoothstep(edge * 0.95, 0.0, abs(field - th));
      float alive = smoothstep(0.0, 0.08, uProgress) * smoothstep(1.0, 0.92, uProgress);
      float core = pow(seam, 6.0);
      col += uSeam * pow(seam, 2.0) * 0.28 * alive;
      col += vec3(1.0, 0.95, 0.88) * core * 0.3 * alive;

      // vignette
      float vig = smoothstep(1.25, 0.35, length((uv - 0.5) * vec2(uAspect, 1.0)));
      col *= 0.9 + 0.1 * vig;

      // film grain
      float g = hash(uv * 900.0 + fract(uTime) * 100.0);
      col += (g - 0.5) * 0.022;

      // FBOs hold tone-mapped LINEAR light; this custom material gets no
      // automatic color-space conversion, so apply the sRGB OETF once here.
      col = pow(clamp(col, 0.0, 1.0), vec3(1.0 / 2.2));

      gl_FragColor = vec4(col, 1.0);
    }
  `,
)

extend({ TransitionMaterial })
export default TransitionMaterial
