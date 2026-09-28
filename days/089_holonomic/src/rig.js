// rig.js — the kinematics of a load carried by nine balls.
//
// After TriOrb's recruit site: three triangular robots, each riding on three
// spheres instead of wheels, carry one slab together. Nothing here says "roll
// this way". The group gets a planar twist (V, Ω); every ball reads its own
// contact velocity off that twist and rolls about the axis the ground gives it:
//
//   v_c = V + Ω × (c − P)          contact velocity of ball c
//   ω_b = (n × v_c) / R            the only spin that does not slip
//
// A wheel can only roll one way, so a wheeled cart has to turn to go sideways.
// A ball has no preferred axis, so every direction is forward.
import * as THREE from 'three'

export const R = 0.17 // ball radius
export const UNIT_R = 1.75 // unit centres from the group centre
export const BALL_R = 0.44 // ball centres from a unit centre
export const TRAIL = 520 // samples kept per ball
export const UNIT_ANGLES = [Math.PI / 2, Math.PI / 2 + (2 * Math.PI) / 3, Math.PI / 2 + (4 * Math.PI) / 3]

const UP = new THREE.Vector3(0, 1, 0)

// local (group-frame) offsets of the 3 units and the 9 balls
export const units = UNIT_ANGLES.map((a, i) => ({
  x: Math.cos(a) * UNIT_R,
  z: Math.sin(a) * UNIT_R,
  yaw: -a + Math.PI / 2 + (i % 2 ? Math.PI / 3 : 0),
}))
export const balls = []
units.forEach((u, ui) => {
  for (let k = 0; k < 3; k++) {
    const a = u.yaw + Math.PI / 2 + (k * 2 * Math.PI) / 3
    balls.push({ unit: ui, x: u.x + Math.cos(a) * BALL_R, z: u.z - Math.sin(a) * BALL_R })
  }
})

// rotate a local (x, z) by heading th, three.js convention (rotation.y = th)
function rot(x, z, th) {
  const c = Math.cos(th), s = Math.sin(th)
  return [x * c + z * s, -x * s + z * c]
}

export function createRig() {
  const pose = { x: 0, z: 0, th: 0 }
  const twist = { vx: 0, vz: 0, w: 0 }
  const target = { x: 0, z: 0, th: 0 }
  const ball = balls.map(() => ({
    pos: new THREE.Vector3(),
    vc: new THREE.Vector3(),
    q: new THREE.Quaternion(),
    spin: 0,
    trail: new Float32Array(TRAIL * 3),
    head: 0,
    count: 0,
    since: 0,
  }))
  const state = { pose, twist, target, ball, t: 0, idle: 99, holding: false, auto: true }

  // autopilot: a square walked without ever facing its sides, while the
  // heading turns on its own clock — the two are independent, which is the point
  function autopilot(t) {
    const side = 4.6, per = 16
    const u = ((t / per) % 1) * 4
    const k = Math.floor(u), f = u - k
    const e = f * f * (3 - 2 * f)
    const C = [[-1, -1], [1, -1], [1, 1], [-1, 1]]
    const a = C[k], b = C[(k + 1) % 4]
    target.x = ((a[0] + (b[0] - a[0]) * e) * side) / 2
    target.z = ((a[1] + (b[1] - a[1]) * e) * side) / 2
    target.th = Math.sin(t * 0.21) * 2.4
  }

  const tmp = new THREE.Vector3()
  const dq = new THREE.Quaternion()
  function step(dt) {
    state.t += dt
    state.idle += dt
    state.auto = state.idle > 2.5
    if (state.auto) autopilot(state.t)
    if (state.holding) target.th += dt * 1.1

    // critically damped follow on each coordinate, speed-limited like a real base
    const k = 5.5, c = 2 * Math.sqrt(k)
    twist.vx += (k * (target.x - pose.x) - c * twist.vx) * dt
    twist.vz += (k * (target.z - pose.z) - c * twist.vz) * dt
    twist.w += (k * (target.th - pose.th) - c * twist.w) * dt
    const sp = Math.hypot(twist.vx, twist.vz), vmax = 2.2
    if (sp > vmax) { twist.vx *= vmax / sp; twist.vz *= vmax / sp }
    twist.w = THREE.MathUtils.clamp(twist.w, -1.6, 1.6)
    pose.x += twist.vx * dt
    pose.z += twist.vz * dt
    pose.th += twist.w * dt

    balls.forEach((b, i) => {
      const s = ball[i]
      const [ox, oz] = rot(b.x, b.z, pose.th)
      s.pos.set(pose.x + ox, R, pose.z + oz)
      // ω ẑ-up × r:  (0,Ω,0) × (ox,0,oz) = (Ω·oz, 0, −Ω·ox)
      s.vc.set(twist.vx + twist.w * oz, 0, twist.vz - twist.w * ox)
      tmp.crossVectors(UP, s.vc).divideScalar(R) // ω_b
      const ang = tmp.length()
      s.spin = ang
      if (ang > 1e-6) {
        dq.setFromAxisAngle(tmp.normalize(), ang * dt)
        s.q.premultiply(dq)
      }
      s.since += dt
      if (s.since > 1 / 40) {
        s.since = 0
        s.trail.set([s.pos.x, 0.004, s.pos.z], s.head * 3)
        s.head = (s.head + 1) % TRAIL
        s.count = Math.min(s.count + 1, TRAIL)
      }
    })
  }

  // fill the floor with history so the first frame already has marks on it
  for (let i = 0; i < 60 * 14; i++) step(1 / 60)

  return { state, step, unitPose: (u) => {
    const [ox, oz] = rot(u.x, u.z, pose.th)
    return { x: pose.x + ox, z: pose.z + oz, yaw: pose.th + u.yaw }
  } }
}
