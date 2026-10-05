// rig.js — Day 096 · One Line Holds a Face
//
// The whole picture is a single polyline. It is laid out once as a boustrophedon
// (left→right, half-turn, right→left, …) of perfectly straight rows, and nothing
// in this file knows there is a face. The face lives in a second, invisible
// render: a lit head (signed distance field, raymarched into a small texture).
// The vertex shader reads that texture under each point of the line and pushes
// the point sideways by tone × sin(phase). Where the head is dark the line
// trembles; where it is lit, or where there is no head, it lies flat.
//
// So: geometry = 1 path, shader = 1 lookup, light = the pointer.

// ── the path ─────────────────────────────────────────────────────────────
export const ROW_GAP = 9 // px between rows
export const WAVELEN = 5.2 // px per sine cycle along a row
export const SAMPLES_PER_PX = 1.7 // ≥ 8 samples per cycle
export const LINE_W = 1.15 // px

// Field rectangle in CSS px (y up, origin at viewport centre), from viewport.
export function field(w, h) {
  const narrow = w < 760
  const left = narrow ? -w / 2 + 16 : -w / 2 + Math.max(380, w * 0.34)
  const right = w / 2 - (narrow ? 16 : 64)
  const top = h / 2 - (narrow ? 210 : 56)
  const bottom = -h / 2 + (narrow ? 40 : 84)
  return { left, right, top, bottom }
}

// One continuous stroke. Each vertex carries its own base point, the base point
// of its neighbour (so the shader can find the displaced tangent), a ±1 side and
// a "row" flag (1 on a row, 0 on a turn — turns are never displaced).
export function buildStroke(f) {
  const rows = Math.max(2, Math.floor((f.top - f.bottom) / ROW_GAP) + 1)
  const width = f.right - f.left
  const n = Math.max(16, Math.round(width * SAMPLES_PER_PX))
  const r = ROW_GAP / 2
  const turnN = 14
  const pts = [] // [x, y, onRow]
  for (let i = 0; i < rows; i++) {
    const y = f.top - i * ROW_GAP
    const ltr = i % 2 === 0
    for (let j = 0; j <= n; j++) {
      const s = j / n
      const x = ltr ? f.left + s * width : f.right - s * width
      pts.push([x, y, 1])
    }
    if (i < rows - 1) {
      // half-turn of radius ROW_GAP/2 outside the field edge
      const cx = ltr ? f.right : f.left
      const cy = y - r
      for (let k = 1; k < turnN; k++) {
        const a = Math.PI / 2 - (k / turnN) * Math.PI
        const x = ltr ? cx + r * Math.cos(a) : cx - r * Math.cos(a)
        pts.push([x, cy + r * Math.sin(a), 0])
      }
    }
  }
  const count = pts.length
  const base = new Float32Array(count * 2 * 3)
  const next = new Float32Array(count * 2 * 3)
  const side = new Float32Array(count * 2)
  const onRow = new Float32Array(count * 2)
  let length = 0
  for (let i = 0; i < count; i++) {
    const p = pts[i]
    const isLast = i === count - 1
    const q = isLast ? pts[i - 1] : pts[i + 1]
    const flip = isLast ? -1 : 1
    if (!isLast) length += Math.hypot(q[0] - p[0], q[1] - p[1])
    for (let s = 0; s < 2; s++) {
      const v = i * 2 + s
      base.set([p[0], p[1], 0], v * 3)
      next.set([q[0], q[1], 0], v * 3)
      side[v] = (s === 0 ? 1 : -1) * flip
      onRow[v] = p[2]
    }
  }
  const index = new Uint32Array((count - 1) * 6)
  for (let i = 0; i < count - 1; i++) {
    const a = i * 2
    index.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], i * 6)
  }
  return { base, next, side, onRow, index, rows, vertices: count, length }
}

// ── the stroke shader ────────────────────────────────────────────────────
export const strokeVert = /* glsl */ `
  attribute vec3 aNext;
  attribute float aSide;
  attribute float aRow;
  uniform sampler2D uTone;
  uniform vec4 uField;      // left, bottom, width, height (px)
  uniform float uAmp;       // max half-amplitude, px
  uniform float uK;         // radians per px
  uniform float uPhase;
  uniform float uW;

  float toneAt(vec2 p) {
    vec2 uv = (p - uField.xy) / uField.zw;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 0.0;
    return texture2D(uTone, uv).r;
  }
  vec2 displaced(vec2 b, float row) {
    float t = toneAt(b) * row;
    return b + vec2(0.0, uAmp * t * sin(b.x * uK + uPhase));
  }
  void main() {
    vec2 p = displaced(position.xy, aRow);
    vec2 q = displaced(aNext.xy, aRow);
    vec2 d = q - p;
    float L = length(d);
    vec2 nrm = L > 1e-4 ? vec2(-d.y, d.x) / L : vec2(0.0, 1.0);
    vec2 o = p + nrm * aSide * uW * 0.5;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(o, 0.0, 1.0);
  }
`

export const strokeFrag = /* glsl */ `
  uniform vec3 uInk;
  void main() { gl_FragColor = vec4(uInk, 1.0); }
`

// ── the invisible head ───────────────────────────────────────────────────
// Rendered into a small texture. Output .r = tone (0 = flat line, 1 = full
// tremble). The head faces −x: a profile, as in the source.
export const toneVert = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`

export const toneFrag = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform vec2 uAspect;     // half extents of the view in head units
  uniform float uYaw;
  uniform float uPitch;
  uniform vec3 uLight;      // world space, normalised
  uniform float uFloor;     // tone on the fully lit side

  float sdEll(vec3 p, vec3 r) {
    float k0 = length(p / r);
    float k1 = length(p / (r * r));
    return k0 * (k0 - 1.0) / k1;
  }
  float sdCap(vec3 p, vec3 a, vec3 b, float r) {
    vec3 pa = p - a, ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h) - r;
  }
  float sdRCone(vec3 p, vec3 a, vec3 b, float r1, float r2) {
    vec3 pa = p - a, ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h) - mix(r1, r2, h);
  }
  float smin(float a, float b, float k) {
    float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
    return mix(b, a, h) - k * h * (1.0 - h);
  }
  float smax(float a, float b, float k) { return -smin(-a, -b, k); }

  float head(vec3 p) {
    vec3 q = vec3(p.x, p.y, abs(p.z));
    float d = sdEll(p - vec3(0.24, 0.36, 0.0), vec3(0.78, 0.74, 0.64));          // cranium
    d = smin(d, sdEll(p - vec3(-0.08, -0.14, 0.0), vec3(0.48, 0.60, 0.48)), 0.20); // face mass
    d = smin(d, sdEll(p - vec3(-0.22, -0.56, 0.0), vec3(0.32, 0.17, 0.30)), 0.14); // jaw
    d = smin(d, sdEll(p - vec3(-0.50, -0.62, 0.0), vec3(0.12, 0.12, 0.15)), 0.08); // chin
    d = smin(d, sdEll(q - vec3(-0.52, 0.29, 0.15), vec3(0.10, 0.07, 0.17)), 0.08); // brow
    d = smin(d, sdRCone(p, vec3(-0.55, 0.20, 0.0), vec3(-0.80, -0.10, 0.0), 0.05, 0.08), 0.06); // nose
    d = smin(d, sdEll(p - vec3(-0.69, -0.13, 0.0), vec3(0.08, 0.06, 0.10)), 0.05); // nose tip
    d = smin(d, sdEll(p - vec3(-0.62, -0.30, 0.0), vec3(0.07, 0.045, 0.15)), 0.05); // upper lip
    d = smin(d, sdEll(p - vec3(-0.59, -0.40, 0.0), vec3(0.065, 0.045, 0.13)), 0.05); // lower lip
    d = smax(d, -sdEll(q - vec3(-0.66, 0.15, 0.20), vec3(0.09, 0.07, 0.10)), 0.05); // eye socket
    d = smin(d, sdEll(q - vec3(-0.54, 0.15, 0.19), vec3(0.06, 0.05, 0.06)), 0.02); // eyeball
    d = smin(d, sdEll(q - vec3(0.10, 0.05, 0.56), vec3(0.11, 0.21, 0.07)), 0.05);  // ear
    d = smin(d, sdCap(p, vec3(0.08, -0.45, 0.0), vec3(0.20, -1.70, 0.0), 0.34), 0.20); // neck
    d = smin(d, sdEll(p - vec3(0.28, -1.95, 0.0), vec3(1.30, 0.40, 0.70)), 0.30); // shoulders
    return d;
  }
  vec3 nrm(vec3 p) {
    vec2 e = vec2(0.002, 0.0);
    return normalize(vec3(head(p + e.xyy) - head(p - e.xyy),
                          head(p + e.yxy) - head(p - e.yxy),
                          head(p + e.yyx) - head(p - e.yyx)));
  }
  mat3 rotY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
  mat3 rotX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }

  void main() {
    vec2 xy = (vUv * 2.0 - 1.0) * uAspect;
    mat3 R = rotY(uYaw) * rotX(uPitch);     // head → world
    mat3 Ri = transpose(R);
    vec3 ro = Ri * vec3(xy, 3.0);
    vec3 rd = Ri * vec3(0.0, 0.0, -1.0);
    float t = 0.0;
    float hit = 0.0;
    for (int i = 0; i < 90; i++) {
      float d = head(ro + rd * t);
      if (d < 0.0015) { hit = 1.0; break; }
      t += d * 0.9;
      if (t > 6.0) break;
    }
    if (hit < 0.5) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
    vec3 p = ro + rd * t;
    vec3 n = R * nrm(p);
    float lam = max(dot(n, uLight), 0.0);
    // soft shadow toward the light (the nose casts onto the cheek)
    vec3 Lh = Ri * uLight;
    float sh = 1.0, s = 0.02;
    for (int i = 0; i < 28; i++) {
      float h = head(p + n * 0.004 + Lh * s);
      sh = min(sh, 10.0 * h / s);
      s += clamp(h, 0.02, 0.2);
      if (sh < 0.01 || s > 2.5) break;
    }
    lam *= clamp(sh, 0.0, 1.0);
    float rim = pow(1.0 - max(n.z, 0.0), 4.0);  // the outline wants a little ink
    float tone = max(uFloor + (1.0 - uFloor) * pow(1.0 - lam, 1.3), 0.8 * rim);
    gl_FragColor = vec4(tone, lam, 0.0, 1.0);
  }
`
