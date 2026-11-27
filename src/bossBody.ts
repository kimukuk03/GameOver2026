// Whole-body poses of the boss after the chest hit: recoil, kneel (groggy), final collapse.
// All torso / leg joints rotate about the boss-local X axis, so poses are stored as angles (deg)
// and the pelvis height is solved every frame so the lowest leg point stays on the ground.
import { Entity, Transform } from '@dcl/sdk/ecs'
import { Vector3, Quaternion } from '@dcl/sdk/math'
import { BOSS_CONFIG as C } from './config'
import { setPhase } from './gameState'
import { parts } from './bossParts'
import { v, pitch, clamp01, easeInOut, easeIn, worldPose, conj } from './utils'
import { burst, SPARKS, SMOKE } from './fx'

type Body = { pelvis: number; thigh: number; shin: number; foot: number; chest: number; head: number }
// thigh / shin / foot are absolute pitches (boss frame); chest and head are relative to their parent.
const STAND: Body = { pelvis: 0, thigh: 0, shin: 0, foot: 0, chest: 0, head: 0 }
/** Groggy pose: deep kneel (shins flat on the ground), torso bowed almost horizontal, head hanging. */
const KNEEL: Body = { pelvis: 60, thigh: -70, shin: 90, foot: 24, chest: 28, head: 30 }
/** Dead pose: torso collapsed flat onto the ground. */
const DEAD: Body = { pelvis: 85, thigh: -70, shin: 90, foot: 24, chest: 10, head: 30 }

export type BodyMode = 'STAND' | 'STAGGER' | 'KNEEL' | 'GROGGY' | 'COLLAPSE' | 'DEAD'

let mode: BodyMode = 'STAND'
let t = 0
let cur: Body = { ...STAND }
let from: Body = { ...STAND }
let push = 0
let instability = 0
let fxClock = 0
let armFrom: Quaternion[] = []
let armTo: Quaternion[] = []
let onKneelDone: () => void = () => {}
let onCollapseDone: () => void = () => {}

export function setBodyCallbacks(kneel: () => void, collapse: () => void) {
  onKneelDone = kneel
  onCollapseDone = collapse
}

export function bodyMode() {
  return mode
}

/** 0..1: extra shaking of the torso while the core is being damaged. */
export function setInstability(x: number) {
  instability = x
}

export function resetBody() {
  mode = 'STAND'
  t = 0
  cur = { ...STAND }
  from = { ...STAND }
  push = 0
  instability = 0
  fxClock = 0
  armFrom = []
  armTo = []
}

// ---------------------------------------------------------------------------
// 2D helpers in the boss YZ plane. R(phi) rotates (y, z) by a pitch of phi degrees.
// ---------------------------------------------------------------------------
type P2 = { y: number; z: number }
const D2R = Math.PI / 180
function R(phi: number, p: P2): P2 {
  const c = Math.cos(phi * D2R)
  const s = Math.sin(phi * D2R)
  return { y: p.y * c - p.z * s, z: p.y * s + p.z * c }
}
const add = (a: P2, b: P2): P2 => ({ y: a.y + b.y, z: a.z + b.z })

/** Height of the hip joint above the ground so the lowest point of thigh, shin or foot touches y=0. */
function solveHipY(b: Body): number {
  let minY = 0
  const corners = (origin: P2, ang: number, ys: number[], zs: number[]) => {
    for (const y of ys) for (const z of zs) minY = Math.min(minY, add(origin, R(ang, { y, z })).y)
  }
  const hip = { y: 0, z: 0 }
  corners(hip, b.thigh, [0, -5.5], [-1.8, 1.8])
  const knee = add(hip, R(b.thigh, { y: -5.5, z: 0 }))
  corners(knee, b.shin, [0, -5.5], [-2.2, 2.2])
  const ankle = add(knee, R(b.shin, { y: -5.5, z: 0 }))
  corners(ankle, b.foot, [-0.5, 0.5], [-2.5, 4.5])
  return -minY
}

function pelvisPos(b: Body): P2 {
  const hipY = solveHipY(b)
  // hip sits at pelvis-local (y=-1, z=0); keep the hip above boss-local z=0
  return { y: hipY + Math.cos(b.pelvis * D2R), z: Math.sin(b.pelvis * D2R) }
}

function applyBody(b: Body) {
  const p = pelvisPos(b)
  const pt = Transform.getMutable(parts.pelvis)
  pt.position = v(0, p.y, p.z)
  pt.rotation = pitch(b.pelvis)
  for (const leg of [parts.legL, parts.legR]) {
    Transform.getMutable(leg.hip).rotation = pitch(b.thigh - b.pelvis)
    Transform.getMutable(leg.knee).rotation = pitch(b.shin - b.thigh)
    Transform.getMutable(leg.ankle).rotation = pitch(b.foot - b.shin)
  }
  Transform.getMutable(parts.chest).rotation = pitch(b.chest)
  Transform.getMutable(parts.head).rotation = pitch(b.head)
  const r = C.rootPosition
  Transform.getMutable(parts.root).position = v(r.x, r.y, r.z + push)
}

function lerpBody(a: Body, b: Body, u: number, uTorso = u): Body {
  const l = (x: number, y: number, k: number) => x + (y - x) * k
  return {
    pelvis: l(a.pelvis, b.pelvis, uTorso),
    thigh: l(a.thigh, b.thigh, u),
    shin: l(a.shin, b.shin, u),
    foot: l(a.foot, b.foot, u),
    chest: l(a.chest, b.chest, uTorso),
    head: l(a.head, b.head, uTorso)
  }
}

// ---------------------------------------------------------------------------
// Left arm targets
// ---------------------------------------------------------------------------
function armJoints(): Entity[] {
  return [parts.leftArm.shoulder, parts.leftArm.elbow, parts.leftArm.wrist]
}
function currentArm(): Quaternion[] {
  return armJoints().map((e) => {
    const r = Transform.get(e).rotation
    return Quaternion.create(r.x, r.y, r.z, r.w)
  })
}

/** Shoulder position (boss YZ) for a body pose. Shoulder pivot is at chest-local (-10, 2.5, 0). */
function shoulderYZ(b: Body): P2 {
  const pel = pelvisPos(b)
  const chestC = add(pel, R(b.pelvis, { y: 7, z: 0 }))
  return add(chestC, R(b.pelvis + b.chest, { y: 2.5, z: 0 }))
}

/** Kneel: two-bone IK in the arm's pitch plane, hand flat on the ground in front, elbow up. */
function kneelArm(): Quaternion[] {
  const chestAbs = KNEEL.pelvis + KNEEL.chest
  const S = shoulderYZ(KNEEL)
  const L1 = C.upperArmLength
  const L2 = C.forearmLength
  const handY = 1.5 // hand is 3 m thick
  const d = 27
  const W = { y: handY, z: S.z + Math.sqrt(Math.max(1, d * d - (S.y - handY) ** 2)) }
  const lineDown = Math.atan2(S.y - W.y, W.z - S.z) / D2R // positive = descending
  const angS = Math.acos((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d)) / D2R
  const up1 = lineDown - angS // absolute pitch of the upper arm (negative = rising)
  const E = add(S, { y: -Math.sin(up1 * D2R) * L1, z: Math.cos(up1 * D2R) * L1 })
  const fore = Math.atan2(E.y - W.y, W.z - E.z) / D2R
  return [pitch(up1 - chestAbs), pitch(fore - up1), pitch(0 - fore)]
}

/** Dead: arm sprawled on the ground, upper arm out to the side, forearm back toward the front. */
function deadArm(): Quaternion[] {
  const chestRot = pitch(DEAD.pelvis + DEAD.chest)
  const S2 = shoulderYZ(DEAD)
  const S = v(-10, S2.y, S2.z)
  const d1 = Vector3.normalize(v(-14, 2.0 - S.y, 14))
  const d2 = Vector3.normalize(v(0.6, -0.02, 0.8))
  const upper = Quaternion.lookRotation(d1)
  const fore = Quaternion.lookRotation(d2)
  return [Quaternion.multiply(conj(chestRot), upper), Quaternion.multiply(conj(upper), fore), Quaternion.Identity()]
}

function applyArm(a: Quaternion[], b: Quaternion[], u: number) {
  const j = armJoints()
  for (let i = 0; i < 3; i++) Transform.getMutable(j[i]).rotation = Quaternion.slerp(a[i], b[i], u)
}

// ---------------------------------------------------------------------------
// Triggers
// ---------------------------------------------------------------------------
export function startStagger() {
  if (mode !== 'STAND') return
  mode = 'STAGGER'
  t = 0
}

export function startCollapse() {
  if (mode !== 'GROGGY' && mode !== 'KNEEL') return
  mode = 'COLLAPSE'
  t = 0
  from = { ...cur }
  armFrom = currentArm()
  armTo = deadArm()
}

/** World positions of the boss joints, for chain explosions and sparks. */
export function jointPoints(): Vector3[] {
  const list: Entity[] = [
    parts.legL.knee,
    parts.legR.knee,
    parts.legL.hip,
    parts.legR.hip,
    parts.leftArm.shoulder,
    parts.leftArm.elbow,
    parts.head
  ]
  if (parts.stump) list.push(parts.stump)
  return list.map((e) => worldPose(e).position)
}

const SMALL_SMOKE = { ...SMOKE(14, 0.6), size: [1, 2] as [number, number], lifetime: 2 }

export function bodySystem(dt: number) {
  if (mode === 'STAND' || mode === 'DEAD') return
  t += dt

  if (mode === 'STAGGER') {
    push = C.staggerPushBack * (1 - Math.exp(-5 * t))
    const lean = -C.staggerLeanDeg * 0.45 - C.staggerLeanDeg * 0.55 * Math.exp(-2.2 * t) * Math.cos(8 * t)
    cur = { ...STAND, chest: lean, pelvis: lean * 0.25 }
    applyBody(cur)
    if (t >= C.staggerTime) {
      mode = 'KNEEL'
      t = 0
      from = { ...cur }
      armFrom = currentArm()
      armTo = kneelArm()
      setPhase('BOSS_STAGGERED')
      console.log('[body] kneeling')
    }
    return
  }

  if (mode === 'KNEEL') {
    const k = clamp01(t / C.kneelTime)
    // legs fold first, the torso follows and bows down
    const uLegs = easeInOut(clamp01(k / 0.75))
    const uTorso = easeInOut(clamp01((k - 0.15) / 0.85))
    cur = lerpBody(from, KNEEL, uLegs, uTorso)
    applyBody(cur)
    applyArm(armFrom, armTo, uTorso)
    if (k >= 1) {
      mode = 'GROGGY'
      t = 0
      console.log('[body] groggy')
      onKneelDone()
    }
    return
  }

  if (mode === 'GROGGY') {
    // damaged machine: occasional twitching that grows as the core is destroyed
    const j = 0.6 + instability * 2.5
    cur = {
      ...KNEEL,
      chest: KNEEL.chest + (Math.random() - 0.5) * j * (Math.random() < 0.3 ? 1 : 0.2),
      head: KNEEL.head + (Math.random() - 0.5) * j * 2 * (Math.random() < 0.2 ? 1 : 0.1)
    }
    applyBody(cur)
    fxClock -= dt
    if (fxClock <= 0) {
      fxClock = (0.5 + Math.random() * 0.9) * (1 - 0.6 * instability)
      const pts = jointPoints()
      const p = pts[Math.floor(Math.random() * pts.length)]
      if (Math.random() < 0.6) burst(p, SPARKS(18))
      else burst(p, SMALL_SMOKE)
    }
    return
  }

  if (mode === 'COLLAPSE') {
    const k = clamp01(t / C.deathCollapseTime)
    const u = easeIn(k)
    cur = lerpBody(from, DEAD, u)
    applyBody(cur)
    applyArm(armFrom, armTo, easeInOut(k))
    if (k >= 1) {
      mode = 'DEAD'
      console.log('[body] collapsed')
      onCollapseDone()
    }
  }
}
