import { useMemo, useRef, useEffect } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'

/* ------------------------------------------------------------------ *
 * Day 014 — Week 2 capstone · "Current"
 *
 * A field of instanced blades aligned to an analytic, divergence-free
 * curl-noise flow (Day 012 curl noise → now steering *orientation* of an
 * InstancedMesh, Day 005/009). The pointer is raycast onto y=0 (Day 009)
 * and injects a vortex that rotates the local flow and lifts the blades;
 * proximity, lean and colour all ease with THREE.MathUtils.damp (Day 008)
 * so the field settles back the moment the cursor leaves. Fully
 * deterministic + stateless — no velocity buffers, no HDRI, no troika Text.
 * ------------------------------------------------------------------ */

// ---- dependency-free value noise (integer hash + quintic) -----------
function hash2(ix, iz) {
  let h = (ix | 0) * 374761393 + (iz | 0) * 668265263
  h = (h ^ (h >> 13)) >>> 0
  h = (h * 1274126177) >>> 0
  h = (h ^ (h >> 16)) >>> 0
  return h / 4294967295
}
const quintic = (t) => t * t * t * (t * (t * 6 - 15) + 10)

function vnoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z)
  const fx = x - ix, fz = z - iz
  const ux = quintic(fx), uz = quintic(fz)
  const a = hash2(ix, iz)
  const b = hash2(ix + 1, iz)
  const c = hash2(ix, iz + 1)
  const d = hash2(ix + 1, iz + 1)
  const top = a + (b - a) * ux
  const bot = c + (d - c) * ux
  return top + (bot - top) * uz // 0..1
}

// 2 octaves of fBm — the scalar potential ψ whose curl drives the flow.
function psi(x, z) {
  let s = 0, amp = 0.65, f = 1
  for (let o = 0; o < 2; o++) {
    s += (vnoise(x * f, z * f) - 0.5) * amp
    f *= 2.03
    amp *= 0.5
  }
  return s
}

// ---- field parameters ------------------------------------------------
const R = 7.2              // field radius (world units)
const STEP = 0.19          // grid spacing
const NOISE_FREQ = 0.16    // spatial scale of the flow
const DRIFT = 0.045        // how fast the whole current translates in time
const EPS = 0.09           // finite-difference epsilon for the curl
const SIGMA = 2.35         // vortex falloff radius
const YHAT = new THREE.Vector3(0, 1, 0)

// paper-tone palette (matches the HUD)
const INK = new THREE.Color('#2b2822')
const COOL = new THREE.Color('#5f6b63')   // green-grey where the flow is quick
const ACCENT = new THREE.Color('#e07338') // terracotta at the vortex core

export default function Scene({ onState }) {
  const mesh = useRef()
  const { camera, gl } = useThree()

  // ---- static grid, culled to a soft-edged disk --------------------
  const base = useMemo(() => {
    const pts = []
    const n = Math.ceil(R / STEP)
    for (let i = -n; i <= n; i++) {
      for (let j = -n; j <= n; j++) {
        // brick-offset rows read less like a grid, more like a field
        const x = i * STEP + (j & 1 ? STEP * 0.5 : 0)
        const z = j * STEP
        const r = Math.hypot(x, z)
        if (r > R) continue
        const edge = THREE.MathUtils.smoothstep(r, R, R - 1.4) // 1 inside → 0 at rim
        // deterministic per-blade jitter + height variety
        const jx = (hash2(i * 91 + 7, j * 53 + 3) - 0.5) * STEP * 0.55
        const jz = (hash2(i * 17 + 1, j * 71 + 9) - 0.5) * STEP * 0.55
        const hv = 0.7 + hash2(i * 13, j * 29) * 0.6
        pts.push({ x: x + jx, z: z + jz, edge, hv })
      }
    }
    return pts
  }, [])
  const COUNT = base.length

  // pointer state in world space (raycast onto y=0), eased in Scene state
  const ndc = useRef(new THREE.Vector2(0, 0))
  const active = useRef(0)          // 0/1 target: is the pointer over the canvas
  const presence = useRef(0)        // eased 0..1 presence
  const rc = useRef(new THREE.Raycaster())
  const plane = useRef(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0))
  const world = useRef(new THREE.Vector3(0, 0, 0))
  const hit = useRef(new THREE.Vector3())

  useEffect(() => {
    const el = gl.domElement
    const move = (e) => {
      const r = el.getBoundingClientRect()
      ndc.current.set(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        -((e.clientY - r.top) / r.height) * 2 + 1,
      )
      active.current = 1
    }
    const leave = () => (active.current = 0)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerleave', leave)
    return () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerleave', leave)
    }
  }, [gl])

  // tapered blade geometry, pivot moved to the ground (built once)
  const geom = useMemo(() => {
    const g = new THREE.CylinderGeometry(0.006, 0.03, 1, 6, 1)
    g.translate(0, 0.5, 0)
    return g
  }, [])
  // NB: per-instance colour comes from InstancedMesh.instanceColor (setColorAt),
  // NOT vertexColors — enabling vertexColors here would demand a geometry
  // `color` attribute that doesn't exist and zero every fragment to black.
  const mat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        roughness: 0.62,
        metalness: 0.05,
        envMapIntensity: 0.6,
      }),
    [],
  )
  useEffect(() => () => { geom.dispose(); mat.dispose() }, [geom, mat])

  // scratch objects reused every frame (no per-frame allocation)
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const col = useMemo(() => new THREE.Color(), [])
  const axis = useMemo(() => new THREE.Vector3(), [])
  const quat = useMemo(() => new THREE.Quaternion(), [])
  const camAim = useMemo(() => new THREE.Vector3(0, 0, 0), [])

  // seed instance colours once so the first frame isn't black
  useEffect(() => {
    if (!mesh.current) return
    for (let k = 0; k < COUNT; k++) mesh.current.setColorAt(k, INK)
    mesh.current.instanceColor.needsUpdate = true
  }, [COUNT])

  const lastLabel = useRef('drift')

  useFrame((st, delta) => {
    const im = mesh.current
    if (!im) return
    const t = st.clock.elapsedTime
    const dt = Math.min(delta, 1 / 30)

    // ---- raycast pointer → world point on the ground -----------------
    rc.current.setFromCamera(ndc.current, camera)
    if (rc.current.ray.intersectPlane(plane.current, hit.current)) {
      world.current.lerp(hit.current, 1 - Math.exp(-10 * dt))
    }
    presence.current = THREE.MathUtils.damp(presence.current, active.current, 3.5, dt)
    const presTarget = presence.current
    const px = world.current.x, pz = world.current.z
    const drift = t * DRIFT

    // ---- per-instance update ----------------------------------------
    for (let k = 0; k < COUNT; k++) {
      const b = base[k]
      const x = b.x, z = b.z

      // curl of the scalar potential ψ → divergence-free 2D flow.
      // sample coordinates translate with time so the whole current drifts.
      const sx = x * NOISE_FREQ + drift
      const sz = z * NOISE_FREQ
      const dpz = psi(sx, sz + EPS) - psi(sx, sz - EPS)
      const dpx = psi(sx + EPS, sz) - psi(sx - EPS, sz)
      let fx = dpz            //  ∂ψ/∂z
      let fz = -dpx           // -∂ψ/∂x
      const speed = Math.min(1, Math.hypot(fx, fz) * 3.2)

      // ---- pointer vortex: rotate the local flow, lift the blade -----
      const dx = x - px, dz = z - pz
      const d2 = dx * dx + dz * dz
      const w = presTarget * Math.exp(-d2 / (2 * SIGMA * SIGMA))
      if (w > 0.002) {
        const swirl = w * 3.0                 // radians of rotation at the core
        const cs = Math.cos(swirl), sn = Math.sin(swirl)
        const rx = fx * cs - fz * sn
        const rz = fx * sn + fz * cs
        fx = rx; fz = rz
      }

      const ang = Math.atan2(fz, fx)
      const dirx = Math.cos(ang), dirz = Math.sin(ang)

      // orientation: strokes lie almost flat and point along the flow, so the
      // curl field reads as a wind-map from above. Inside the vortex the blades
      // rear up (lift) — a calm current with a standing spike where you point.
      const lift = 0.30 + w * 0.55
      axis.set(dirx, lift, dirz).normalize()
      quat.setFromUnitVectors(YHAT, axis)

      // length grows sharply inside the vortex → bold flat strokes, not spikes
      const h = (0.5 + b.hv * 0.4 + w * 1.7) * b.edge
      const rad = 1 + w * 0.5

      dummy.position.set(x, 0, z)
      dummy.quaternion.copy(quat)
      dummy.scale.set(rad, Math.max(0.001, h), rad)
      dummy.updateMatrix()
      im.setMatrixAt(k, dummy.matrix)

      // colour: ink → cool with flow speed, → terracotta inside the vortex
      col.copy(INK).lerp(COOL, speed * 0.6 * b.edge)
      if (w > 0.001) col.lerp(ACCENT, Math.min(1, w * 1.8))
      im.setColorAt(k, col)
    }
    im.instanceMatrix.needsUpdate = true
    if (im.instanceColor) im.instanceColor.needsUpdate = true

    // ---- camera parallax (Day 009): drift with the pointer ----------
    const tx = ndc.current.x * 1.6 * presTarget
    const tz = 8.6 - ndc.current.y * 0.6 * presTarget
    camera.position.x = THREE.MathUtils.damp(camera.position.x, tx, 2.4, dt)
    camera.position.z = THREE.MathUtils.damp(camera.position.z, tz, 2.4, dt)
    camAim.set(px * 0.25 * presTarget, 0.2, pz * 0.25 * presTarget)
    camera.lookAt(camAim)

    // ---- HUD status word --------------------------------------------
    const label = presTarget > 0.55 ? 'vortex' : presTarget > 0.12 ? 'stir' : 'drift'
    if (label !== lastLabel.current) {
      lastLabel.current = label
      onState && onState(label)
    }
  })

  return (
    <>
      {/* high-key, HDRI-free lighting — matte blades read on paper */}
      <color attach="background" args={['#ece7dd']} />
      <fog attach="fog" args={['#ece7dd', 12, 26]} />
      <hemisphereLight args={['#fdfaf3', '#b9b09f', 1.05]} />
      <directionalLight position={[5.5, 7, 3]} intensity={1.35} color={'#fff3e2'} />
      <directionalLight position={[-6, 3, -4]} intensity={0.35} color={'#cfe0ff'} />

      {/* the field */}
      <instancedMesh
        ref={mesh}
        args={[geom, mat, COUNT]}
        frustumCulled={false}
      />

      {/* faint ground so blades feel planted; fog fades it to the horizon */}
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.01, 0]}>
        <circleGeometry args={[R + 2, 64]} />
        <meshStandardMaterial color={'#e4ddd0'} roughness={1} metalness={0} />
      </mesh>
    </>
  )
}
