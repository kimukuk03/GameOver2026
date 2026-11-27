import {
  engine,
  Entity,
  Transform,
  MeshRenderer,
  MeshCollider,
  Material,
  MaterialTransparencyMode,
  Name,
  VisibilityComponent,
  ColliderLayer,
  pointerEventsSystem,
  InputAction
} from '@dcl/sdk/ecs'
import { Vector3, Quaternion, Color4, Color3 } from '@dcl/sdk/math'
import { ARM_POSES, ArmPose, BOSS_CONFIG as C } from './config'
import { game, setPhase, flash, startTimer, fightOver } from './gameState'
import { startBarrage, barrageIdle } from './bossMissiles'
import { damagePlayer } from './player'
import { COMBAT } from './config'
import { parts, bossState, freshBossState, Arm, Leg, ARMOR_LOCAL, CHEST_LOCAL, CORE_LOCAL } from './bossParts'
import { v, pitch, lerp, easeInOut, easeIn, worldPose, worldToLocal, pivot, box, sphere, cylinder, setMat } from './utils'
import { burst, SPARKS, FIRE, SMOKE, flashSphere, shake, loopEmitter } from './fx'
import { startStagger } from './bossBody'

const ARMOR = Color4.create(0.42, 0.45, 0.5, 1)
const DARK = Color4.create(0.18, 0.19, 0.22, 1)
const ACCENT = Color4.create(0.75, 0.35, 0.1, 1)
const WEAK_POINT_SIZE = 2.0

// ---------------------------------------------------------------------------
// Construction. Boss-local frame: +Z = boss forward (toward the player), +Y up, X = boss right.
// ---------------------------------------------------------------------------
function buildArm(side: 1 | -1, chest: Entity, withLauncher: boolean, pose: ArmPose): Arm {
  const tag = withLauncher ? 'ArmR' : 'ArmL'
  const colliders: Entity[] = []
  const forearmColliders: Entity[] = []
  // Arm root: everything below this pivot is detached as one piece when the shoulder breaks.
  const shoulder = pivot(`${tag}_ShoulderPivot`, chest, v(10 * side, 2.5, 0), pitch(pose.shoulder))
  colliders.push(box(`${tag}_UpperArm`, shoulder, v(0, 0, C.upperArmLength / 2), v(4.5, 4, C.upperArmLength), { color: ARMOR }))

  const elbow = pivot(`${tag}_ElbowPivot`, shoulder, v(0, 0, C.upperArmLength), pitch(pose.elbow))
  // Joint spheres stay just under the arm's top surface so they never form a lip on the climb path.
  colliders.push(sphere(`${tag}_ElbowJoint`, elbow, v(0, 0, 0), 3.6, { color: DARK }))
  const forearm = box(`${tag}_Forearm`, elbow, v(0, 0, C.forearmLength / 2), v(5, 3.5, C.forearmLength), { color: ARMOR })
  colliders.push(forearm)
  forearmColliders.push(forearm)

  let pod: Entity | undefined
  if (withLauncher) {
    // Missile pod on the outer side of the forearm, clear of the walkable top surface.
    pod = pivot(`${tag}_MissileLauncher`, elbow, v(3.9 * side, 0.6, C.forearmLength * 0.45))
    const body = box(`${tag}_LauncherBody`, pod, v(0, 0, 0), v(2.6, 2.8, 9), { color: ACCENT })
    colliders.push(body)
    forearmColliders.push(body)
    for (let i = 0; i < 4; i++) {
      const x = i % 2 === 0 ? -0.6 : 0.6
      const y = i < 2 ? -0.65 : 0.65
      cylinder(
        `${tag}_LauncherTube${i}`,
        pod,
        v(x, y, 4.6),
        v(0.9, 0.6, 0.9),
        { color: DARK, collider: false, emissive: Color3.create(1, 0.3, 0.05), emissiveIntensity: 1.5 },
        Quaternion.fromEulerDegrees(90, 0, 0)
      )
    }
  }

  const wrist = pivot(`${tag}_WristPivot`, elbow, v(0, 0, C.forearmLength), pitch(pose.wrist))
  const wj = sphere(`${tag}_WristJoint`, wrist, v(0, 0, 0), 3.0, { color: DARK })
  // Hand is 3 m thick so its top meets the forearm top at the wrist (~0.2 m lip) while the tip sits flush with the ground.
  const hand = box(`${tag}_Hand`, wrist, v(0, 0, C.handLength / 2), v(6, 3, C.handLength), { color: ARMOR })
  colliders.push(wj, hand)
  forearmColliders.push(wj, hand)
  return { shoulder, elbow, wrist, pod, colliders, forearmColliders }
}

function buildLeg(side: 1 | -1, pelvis: Entity): Leg {
  const tag = side === 1 ? 'LegR' : 'LegL'
  // hip -> knee -> ankle pivots so the boss can kneel; rest pose looks exactly like the straight leg.
  const hip = pivot(`${tag}_HipPivot`, pelvis, v(4.5 * side, -1, 0))
  box(`${tag}_Thigh`, hip, v(0, -2.75, 0), v(3.6, 5.5, 3.6), { color: ARMOR })
  const knee = pivot(`${tag}_KneePivot`, hip, v(0, -5.5, 0))
  box(`${tag}_Shin`, knee, v(0, -2.75, 0), v(4.2, 5.5, 4.4), { color: ARMOR })
  const ankle = pivot(`${tag}_AnklePivot`, knee, v(0, -5.5, 0))
  box(`${tag}_Foot`, ankle, v(0, 0, 1), v(5, 1, 7), { color: DARK })
  return { hip, knee, ankle }
}

let onShoulderDestroyed: () => void = () => {}
export function setOnShoulderDestroyed(cb: () => void) {
  onShoulderDestroyed = cb
}

export function createBoss() {
  const root = pivot(
    'Boss_Root',
    engine.RootEntity,
    v(C.rootPosition.x, C.rootPosition.y, C.rootPosition.z),
    Quaternion.fromEulerDegrees(0, 180, 0)
  )
  parts.root = root

  // Pelvis + legs
  const pelvis = pivot('Boss_Pelvis', root, v(0, 12.5, 0))
  parts.pelvis = pelvis
  box('Boss_PelvisBody', pelvis, v(0, 0, 0), v(10, 3, 6), { color: DARK })
  parts.legR = buildLeg(1, pelvis)
  parts.legL = buildLeg(-1, pelvis)

  // Chest (massive upper body), armor plate, core
  const chest = pivot('Boss_Chest', pelvis, v(0, 7, 0))
  parts.chest = chest
  box('Boss_ChestBody', chest, CHEST_LOCAL.center, CHEST_LOCAL.size, { color: ARMOR })
  parts.armor = box('Boss_ChestArmor', chest, ARMOR_LOCAL.center, ARMOR_LOCAL.size, { color: ACCENT, metallic: 0.8 })
  parts.core = sphere('Boss_Core', chest, CORE_LOCAL, 3, {
    color: Color4.create(0.2, 0.9, 1, 1),
    emissive: Color3.create(0.2, 0.9, 1),
    emissiveIntensity: 3,
    collider: false
  })

  // Head
  const head = pivot('Boss_Head', chest, v(0, 7, 0.5))
  parts.head = head
  box('Boss_HeadBody', head, v(0, 0, 0), v(5, 3.5, 5), { color: DARK })
  parts.visor = box('Boss_Visor', head, v(0, 0.3, 2.55), v(3.6, 0.6, 0.1), {
    color: Color4.Red(),
    emissive: Color3.Red(),
    emissiveIntensity: 4,
    collider: false
  })

  // Shoulder armor blocks (stay on the chest when the arm is severed)
  box('ArmR_ShoulderArmor', chest, v(10.5, 2.5, 0), v(7, 7, 7), { color: DARK })
  box('ArmL_ShoulderArmor', chest, v(-10.5, 2.5, 0), v(7, 7, 7), { color: DARK })

  parts.missileArm = buildArm(1, chest, true, ARM_POSES.rest)
  parts.leftArm = buildArm(-1, chest, false, ARM_POSES.rest)

  // Weak point: glowing joint on the front face of the right shoulder, above the top of the climb path.
  const weakPoint = sphere('ArmR_WeakPoint', chest, v(10, 5.4, 3.9), WEAK_POINT_SIZE, {
    color: Color4.create(1, 0.85, 0.1, 1),
    emissive: Color3.create(1, 0.7, 0),
    emissiveIntensity: 4,
    collider: false
  })
  parts.weakPoint = weakPoint
  MeshCollider.setSphere(weakPoint, ColliderLayer.CL_POINTER)
  pointerEventsSystem.onPointerDown(
    {
      entity: weakPoint,
      // The pointer range is measured from the camera, so allow for the third-person boom;
      // the real reach check against the avatar position happens in onWeakPointHit().
      opts: { button: InputAction.IA_POINTER, hoverText: 'Attack weak point', maxDistance: C.weakPointReach + 4 }
    },
    onWeakPointHit
  )

  // Ground danger zone under the slam footprint (forearm + hand), boss-local.
  const zoneStart = 15
  const zoneEnd = 47
  const dz = engine.addEntity()
  parts.dangerZone = dz
  Name.create(dz, { value: 'Slam_DangerZone' })
  Transform.create(dz, { parent: root, position: v(10, 0.05, (zoneStart + zoneEnd) / 2), scale: v(9, 0.02, zoneEnd - zoneStart) })
  MeshRenderer.setBox(dz)
  Material.setPbrMaterial(dz, {
    albedoColor: Color4.create(1, 0, 0, 0.45),
    emissiveColor: Color3.Red(),
    emissiveIntensity: 1.5,
    transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND
  })
  VisibilityComponent.create(dz, { visible: false })
}

/** Remove every boss entity (including detached arm / armor) so the boss can be rebuilt. */
export function destroyBoss() {
  pointerEventsSystem.removeOnPointerDown(parts.weakPoint)
  // Detached pieces live directly under the scene root now.
  const arm = parts.missileArm
  if (arm && Transform.getOrNull(arm.shoulder)?.parent === engine.RootEntity) engine.removeEntityWithChildren(arm.shoulder)
  if (Transform.getOrNull(parts.armor)?.parent === engine.RootEntity) engine.removeEntity(parts.armor)
  engine.removeEntityWithChildren(parts.root)
  parts.stump = undefined
  parts.stumpCore = undefined
}

// ---------------------------------------------------------------------------
// Slam state machine
// ---------------------------------------------------------------------------
let elapsed = 0
let poseFrom: ArmPose = ARM_POSES.rest
let poseTo: ArmPose = ARM_POSES.rest
let blinkClock = 0
let firstDelayDone = false

function applyPose(p: ArmPose) {
  const a = parts.missileArm
  Transform.getMutable(a.shoulder).rotation = pitch(p.shoulder)
  Transform.getMutable(a.elbow).rotation = pitch(p.elbow)
  Transform.getMutable(a.wrist).rotation = pitch(p.wrist)
}

function blendPose(a: ArmPose, b: ArmPose, t: number): ArmPose {
  return { shoulder: lerp(a.shoulder, b.shoulder, t), elbow: lerp(a.elbow, b.elbow, t), wrist: lerp(a.wrist, b.wrist, t) }
}

function phaseDuration(p: bossPhase): number {
  switch (p) {
    case 'IDLE':
      return C.attackInterval
    case 'BARRAGE':
      return 999 // ends when bossMissiles reports the barrage finished
    case 'WINDUP':
      return C.windupTime
    case 'SLAM':
      return C.slamTime
    case 'PINNED':
      return C.pinnedTime
    case 'RETURN':
      return C.returnTime
  }
}
type bossPhase = typeof bossState.phase

function enterPhase(p: bossPhase) {
  bossState.phase = p
  elapsed = 0
  bossState.phaseTimeLeft = phaseDuration(p)
  VisibilityComponent.getMutable(parts.dangerZone).visible = p === 'WINDUP' || p === 'SLAM'
  if (p === 'WINDUP') {
    startTimer() // the fight clock starts with the first attack
    poseFrom = ARM_POSES.rest
    poseTo = ARM_POSES.windup
  } else if (p === 'SLAM') {
    poseFrom = ARM_POSES.windup
    poseTo = ARM_POSES.slam
  } else if (p === 'BARRAGE') {
    applyPose(ARM_POSES.rest)
    startBarrage()
  } else if (p === 'PINNED') {
    applyPose(ARM_POSES.slam)
    checkSlamHit()
    flash('The arm is pinned! Climb it to the shoulder!', 4)
  } else if (p === 'RETURN') {
    poseFrom = ARM_POSES.slam
    poseTo = ARM_POSES.rest
  } else {
    applyPose(ARM_POSES.rest)
  }
  game.attackWarning = p === 'WINDUP' || p === 'SLAM' ? 'SLAM' : p === 'BARRAGE' ? 'MISSILES' : ''
  if (game.phase === 'GROUND_COMBAT' || game.phase === 'ARM_CLIMB') {
    setPhase(p === 'PINNED' || p === 'RETURN' ? 'ARM_CLIMB' : 'GROUND_COMBAT')
  }
  console.log(`[boss] phase -> ${p}`)
}

// The very first attack is the slam (fast route to the climb); afterwards each cycle opens with the missile barrage.
const NEXT: Record<bossPhase, bossPhase> = { IDLE: 'BARRAGE', BARRAGE: 'WINDUP', WINDUP: 'SLAM', SLAM: 'PINNED', PINNED: 'RETURN', RETURN: 'IDLE' }

/** Slam impact: damage whoever stands inside the red zone (same rectangle as the telegraph). */
function checkSlamHit() {
  const p = Transform.getOrNull(engine.PlayerEntity)
  if (!p) return
  const zone = worldPose(parts.dangerZone)
  const s = Transform.get(parts.dangerZone).scale
  const local = worldToLocal(zone, p.position)
  const inside = Math.abs(local.x) <= s.x / 2 && Math.abs(local.z) <= s.z / 2 && p.position.y < 3.5
  console.log(`[boss] slam impact, player in zone: ${inside}`)
  if (inside) {
    // push out sideways from the zone's center line so the landing arm can't trap the avatar
    const center = Vector3.add(zone.position, Vector3.rotate(v(0, 0, local.z), zone.rotation))
    const side = Vector3.rotate(v(local.x >= 0 ? -1 : 1, 0, 0), zone.rotation)
    damagePlayer(COMBAT.slamDamage, 'SLAM', Vector3.add(center, side))
  }
}

export function slamSystem(dt: number) {
  // Once severed, the arm belongs to arm.ts: never touch its transforms again.
  if (bossState.severed || game.phase === 'RESETTING' || game.phase === 'PLAYER_DEAD') return

  if (bossState.phase === 'BARRAGE') {
    bossState.phaseTimeLeft = 0
    if (barrageIdle()) enterPhase('WINDUP')
    return
  }

  elapsed += dt
  const dur = firstDelayDone || bossState.phase !== 'IDLE' ? phaseDuration(bossState.phase) : C.firstAttackDelay
  bossState.phaseTimeLeft = Math.max(0, dur - elapsed)

  const t = Math.min(1, elapsed / dur)
  if (bossState.phase === 'WINDUP' || bossState.phase === 'RETURN') {
    applyPose(blendPose(poseFrom, poseTo, easeInOut(t)))
  } else if (bossState.phase === 'SLAM') {
    applyPose(blendPose(poseFrom, poseTo, easeIn(t)))
  }

  if (bossState.phase === 'WINDUP') {
    blinkClock += dt
    VisibilityComponent.getMutable(parts.dangerZone).visible = Math.floor(blinkClock * 6) % 2 === 0
  }

  if (bossState.phase === 'PINNED' && bossState.holdPinned) {
    elapsed = Math.min(elapsed, dur - 0.01)
    return
  }

  if (elapsed >= dur) {
    // first cycle: IDLE goes straight to the slam
    const next = !firstDelayDone && bossState.phase === 'IDLE' ? 'WINDUP' : NEXT[bossState.phase]
    firstDelayDone = true
    enterPhase(next)
  }
}

/** Permanently stop the slam attack (called when the arm is severed). */
export function stopSlam() {
  bossState.severed = true
  VisibilityComponent.getMutable(parts.dangerZone).visible = false
}

// ---------------------------------------------------------------------------
// Weak point interaction
// ---------------------------------------------------------------------------
const WP_STAGES: Array<{ color: Color4; emissive: Color3; intensity: number }> = [
  { color: Color4.create(0.15, 0.05, 0.02, 1), emissive: Color3.create(1, 0.15, 0), intensity: 0.6 }, // destroyed
  { color: Color4.create(1, 0.2, 0.05, 1), emissive: Color3.create(1, 0.1, 0), intensity: 5 }, // 1 hp: red hot
  { color: Color4.create(1, 0.5, 0.05, 1), emissive: Color3.create(1, 0.4, 0), intensity: 4.5 } // 2 hp: orange
]
let hitFlashLeft = 0
let wpDamageFlicker = 0

function weakPointStageMaterial() {
  const hp = bossState.weakPointHp
  if (hp >= C.weakPointHits || hp > 2) {
    setMat(parts.weakPoint, { color: Color4.create(1, 0.85, 0.1, 1), emissive: Color3.create(1, 0.7, 0), emissiveIntensity: 4 })
  } else {
    const s = WP_STAGES[Math.max(0, hp)]
    setMat(parts.weakPoint, { color: s.color, emissive: s.emissive, emissiveIntensity: s.intensity })
  }
}

function onWeakPointHit() {
  if (bossState.severed || bossState.weakPointHp <= 0 || fightOver()) return
  const player = Transform.getOrNull(engine.PlayerEntity)
  if (!player) return
  const wp = worldPose(parts.weakPoint).position
  const dist = Vector3.distance(player.position, wp)
  if (dist > C.weakPointReach) {
    flash(`Too far - get within ${C.weakPointReach} m of the joint`, 2)
    return
  }
  bossState.weakPointHp -= 1
  console.log(`[boss] weak point hit, hp ${bossState.weakPointHp} (dist ${dist.toFixed(1)})`)

  // Hit feedback: sparks, white flash, shrink pop
  burst(wp, SPARKS(50))
  setMat(parts.weakPoint, { color: Color4.White(), emissive: Color3.White(), emissiveIntensity: 8 })
  const s = WEAK_POINT_SIZE * 0.75
  Transform.getMutable(parts.weakPoint).scale = v(s, s, s)
  hitFlashLeft = 0.12

  if (bossState.weakPointHp <= 0) breakShoulder()
  else flash(`Joint damaged! ${bossState.weakPointHp} more hit(s)`, 1.5)
}

function breakShoulder() {
  bossState.weakPointHp = 0
  pointerEventsSystem.removeOnPointerDown(parts.weakPoint)
  const wp = worldPose(parts.weakPoint).position
  burst(wp, FIRE(80, 1))
  flashSphere(wp, Color3.create(1, 0.6, 0.2), 1, 9, 0.6)
  flash('SHOULDER JOINT DESTROYED!', 4, true)
  onShoulderDestroyed()
}

/** Broken connector left on the shoulder after the arm falls off. */
export function createShoulderStump() {
  if (parts.stump) return
  const stump = pivot('ArmR_ShoulderStump', parts.chest, v(10, 2.5, 0))
  parts.stump = stump
  // jagged torn plates + glowing torn core
  box('ArmR_StumpPlateA', stump, v(0, 0.8, 3.8), v(3.5, 1.2, 1.6), { color: DARK, collider: false }, Quaternion.fromEulerDegrees(20, 15, 10))
  box('ArmR_StumpPlateB', stump, v(-0.6, -1.4, 3.7), v(3, 1, 1.4), { color: DARK, collider: false }, Quaternion.fromEulerDegrees(-25, -10, 30))
  parts.stumpCore = cylinder(
    'ArmR_StumpCore',
    stump,
    v(0, 0, 3.6),
    v(2.2, 0.8, 2.2),
    { color: Color4.create(1, 0.3, 0.05, 1), emissive: Color3.create(1, 0.3, 0), emissiveIntensity: 3, collider: false },
    Quaternion.fromEulerDegrees(90, 0, 0)
  )
  loopEmitter(stump, v(0, 0, 4.2), { ...SPARKS(60), rate: 25, lifetime: 0.6, gravity: 2 })
}

// ---------------------------------------------------------------------------
// Chest hit: armor flies off, core exposed, boss staggers then kneels (bossBody.ts)
// ---------------------------------------------------------------------------
let armorFlying = false
let armorVel = Vector3.Zero()
let armorSpin = Vector3.Zero()

export function onChestHit(hitPoint: Vector3) {
  if (bossState.armorDestroyed) return
  bossState.armorDestroyed = true
  console.log('[boss] chest armor destroyed')

  // Big explosion
  burst(hitPoint, FIRE(160, 2.5))
  burst(hitPoint, SMOKE(70, 3))
  burst(hitPoint, SPARKS(80))
  flashSphere(hitPoint, Color3.create(1, 0.7, 0.3), 2, 22, 0.9)
  shake(0.9, 1.0)

  // Detach the armor plate into world space and let it fly off.
  const pose = worldPose(parts.armor)
  const t = Transform.getMutable(parts.armor)
  t.parent = engine.RootEntity
  t.position = pose.position
  t.rotation = pose.rotation
  MeshCollider.deleteFrom(parts.armor)
  const forward = Vector3.rotate(v(0, 0, 1), worldPose(parts.chest).rotation)
  armorVel = Vector3.add(Vector3.scale(forward, 14), v((Math.random() - 0.5) * 4, 9, 0))
  armorSpin = v(220, 90, 140)
  armorFlying = true

  // Core goes bright (core.ts animates it from here on)
  setMat(parts.core, { color: Color4.create(0.6, 1, 1, 1), emissive: Color3.create(0.3, 1, 1), emissiveIntensity: 12, metallic: 0 })
  startStagger()
}

export function bossReactionSystem(dt: number) {
  if (game.phase === 'RESETTING') return
  // Weak point hit flash recovery + damaged flicker
  if (hitFlashLeft > 0) {
    hitFlashLeft -= dt
    if (hitFlashLeft <= 0) {
      Transform.getMutable(parts.weakPoint).scale = v(WEAK_POINT_SIZE, WEAK_POINT_SIZE, WEAK_POINT_SIZE)
      weakPointStageMaterial()
    }
  } else if (bossState.weakPointHp === 1) {
    wpDamageFlicker += dt
    const s = WEAK_POINT_SIZE * (1 + 0.08 * Math.sin(wpDamageFlicker * 25))
    Transform.getMutable(parts.weakPoint).scale = v(s, s, s)
  }

  // Flying armor plate: ballistic, then lies flat on the ground.
  if (armorFlying) {
    const t = Transform.getMutable(parts.armor)
    armorVel = Vector3.add(armorVel, v(0, -C.gravity * dt, 0))
    t.position = Vector3.add(t.position, Vector3.scale(armorVel, dt))
    t.rotation = Quaternion.multiply(t.rotation, Quaternion.fromEulerDegrees(armorSpin.x * dt, armorSpin.y * dt, armorSpin.z * dt))
    if (t.position.y <= 0.6 && armorVel.y < 0) {
      t.position = v(t.position.x, 0.6, t.position.z)
      const yaw = Quaternion.toEulerAngles(t.rotation).y
      t.rotation = Quaternion.fromEulerDegrees(90, yaw, 0)
      armorFlying = false
      burst(t.position, { ...SMOKE(40, 2), colorStart: Color4.create(0.55, 0.5, 0.45, 0.8) })
      shake(0.3, 0.4)
    }
  }

  // Track whether the player is close to the shoulder joint (objective text)
  const p = Transform.getOrNull(engine.PlayerEntity)
  if (p && !bossState.severed) {
    game.nearShoulder = Vector3.distance(p.position, worldPose(parts.weakPoint).position) < C.weakPointReach + 6
  } else {
    game.nearShoulder = false
  }
}

/** Reset every module-level variable of this file to its initial value. */
export function resetBossModule() {
  Object.assign(bossState, freshBossState())
  elapsed = 0
  poseFrom = ARM_POSES.rest
  poseTo = ARM_POSES.rest
  blinkClock = 0
  firstDelayDone = false
  hitFlashLeft = 0
  wpDamageFlicker = 0
  armorFlying = false
  armorVel = Vector3.Zero()
  armorSpin = Vector3.Zero()
}

// ---------------------------------------------------------------------------
// Debug hooks (used only by debug.ts)
// ---------------------------------------------------------------------------
export function debugSlamNow() {
  if (!bossState.severed && bossState.phase === 'IDLE') {
    firstDelayDone = true
    enterPhase('WINDUP')
  }
}
export function debugToggleHold() {
  bossState.holdPinned = !bossState.holdPinned
  flash(bossState.holdPinned ? 'DEBUG: arm stays pinned' : 'DEBUG: normal pin timer', 2)
}
export function debugBreakShoulder() {
  if (!bossState.severed && bossState.weakPointHp > 0) {
    startTimer()
    weakPointStageMaterial()
    breakShoulder()
  }
}
