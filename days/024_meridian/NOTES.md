# Day 024 — Week 4 · Scene Composition ⭐5 — "Meridian"

The ⭐5 capstone of Week 4: stop making *objects* and make a **place**. A month
of separate techniques — real lights, a procedural studio, a displaced relief
ground, instancing, particles, post-processing — composed into one coherent
world: a quiet valley of porcelain monuments at first light, with a sun you can
steer across the sky.

## 狙い (Intent)
- A single, unified *world* rather than a hero object on a backdrop. Everything
  in the frame — near porcelain gate, mid-field monoliths, far horizon, sky,
  drifting dust — has to read as sitting in **the same air**.
- monaka register: warm paper light, ample negative space (lower-left kept open
  for the type), a single terracotta accent, English typography.
- The interaction *is* the composition: move the cursor and the whole world's
  light changes at once.

## 新しく入れた技法 (New technique)
**A custom post-processing Effect that reads the scene DEPTH buffer** to
composite depth-aware atmospheric haze + screen-space sun scattering
(`Atmosphere.jsx`). Every prior post pass in this project (Day 022 bloom/DoF,
Day 023 grade) shaded the flat colour frame; this one declares
`EffectAttribute.DEPTH`, so the library hands `mainImage` the per-pixel depth.
I **linearise it myself** from `cameraNear`/`cameraFar` (self-contained, no
reliance on library helpers like `getViewZ`) and:
- **exp²-distance fog** toward a vertical dawn gradient (warm horizon → cool
  zenith), gated to real geometry (`step(depth, 0.9999)`), so near and far melt
  into one volume.
- The **sky itself is painted by this pass** for depth==1 pixels — no sky dome
  mesh (which would carry its own depth and get fogged). The atmosphere both
  *is* the sky and *is* the haze.
- **Screen-space sun scattering** — an aspect-corrected radial glow at the sun's
  projected screen position, stronger through more air, in HDR so Bloom lifts
  its core.

## 1段高い完成度 (Higher completeness — the composition)
Synthesis of the whole project into one scene:
- **Relief ground shader** (Day 016) — vertex displacement + finite-difference
  normals + wrapped contours (Day 015), lit by the moving sun.
- **Instanced monument field** (Day 005/009) — 42 standing stones receding into
  the haze, planted below the relief so nothing floats.
- **Drifting motes** (Day 012) — an additive `<points>` dust stratum.
- **Porcelain hero** — a standing gate (torus), a calm sphere, a monolith, in
  meshPhysical clearcoat reflecting a procedural studio (Day 003/018/023).
- **Post stack** — Atmosphere (depth) → Bloom → Vignette → Grain, renderer on
  ACES so the terracotta ember and sun core roll off.
- **Interaction = pointer-as-SUN** (a fresh input after light/force/focus/grade):
  cursor.x drives azimuth, cursor.y elevation; the key light, sky gradient, fog
  colour and sun glow all lerp dawn → high-morning together.

## 罠 / メモ
- No sky dome: a dome is real geometry at radius R, so its depth < 1 and the
  atmosphere would fog the sky against itself. Painting the sky inside the depth
  pass (for depth==1) sidesteps this and unifies sky+air in one shader.
- Instancing with `MeshStandardMaterial({ vertexColors: false })` + `setColorAt`
  still tints via `instanceColor` — Day 014's all-black trap was `vertexColors:
  true` reading a missing attribute; keep it false.
- swiftshader `glBlitFramebuffer ... depth stencil` warning reappears (expected
  now that we read the depth buffer — same class as Day 022's DoF depth pass);
  real render is correct.
- headless capture flaked once to a blank canvas (CSS bg only) at 12s
  virtual-time (Day 018 trap); 18s captured the full frame reliably.

## 次に試したいこと (Next)
- Day 025 — loading / scene transition: a designed reveal into this world
  (curtain of haze lifting, the sun rising on entry).
- True volumetric god-rays (radial blur occlusion pass) instead of the cheap
  screen-space glow.
- A shallow reflective basin (MeshReflectorMaterial) under the gate for a mirror
  horizon — budget permitting under swiftshader.
