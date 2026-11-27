// Boss attack after losing the right arm: wide low sweep with the left arm across the approach to the launcher.
import { engine, Entity, Transform, MeshRenderer, Material, MaterialTransparencyMode, Name, VisibilityComponent } from '@dcl/sdk/ecs'
import { Vector3, Quaternion, Color4, Color3 } from '@dcl/sdk/math'
import { COMBAT } from './config'
import { game } from './gameState'
import { parts, bossState } from './bossParts'
import { fallen } from './arm'
import { v, pitch, yawQ, lerp, easeInOut, easeIn, worldPose, worldToLocal, setSolid, clamp01 } from './utils'
import { damagePlayer } from './player'
import { burst, DUST } from './fx'

type SweepState = 'OFF' | 'WAIT' | 'RAISE' | 'DROP' | 'SWEEP' | 'RECOVER'
type ArmCfg = { yaw: number; pitch: number; elbow: number; wrist: number }

/** Left shoulder in boss-local space (chest upright, standing). */
const SHOULDER_X = -10
const REST: ArmCfg = { yaw: 0, pitch: 70, elbow: -95, wrist: -10 }
const RAISED = (yaw: number): ArmCfg => ({ yaw, pitch: -35, elbow: -30, wrist: 0 })
/** Low sweep: upper arm 55° down, forearm 8° down, hand level -> forearm/hand skim 1-4 m above the ground. */
const LOW = (yaw: number): ArmCfg => ({ yaw, pitch: 55, elbow: -47, wrist: -8 })

let state: SweepState = 'OFF'
let t = 0
let wait = 0
let fromCfg: ArmCfg = REST
let curYaw = 0
let prevYaw = 0
let hitDone = false
let harmless = false
let wasAiming = false
let fan: Entity[] = []

function blend(a: ArmCfg, b: ArmCfg, u: number): ArmCfg {
  return { yaw: lerp(a.yaw, b.yaw, u), pitch: lerp(a.pitch, b.pitch, u), elbow: lerp(a.elbow, b.elbow, u), wrist: lerp(a.wrist, b.wrist, u) }
}

function applyArm(c: ArmCfg) {
  const arm = parts.leftArm
  Transform.getMutable(arm.shoulder).rotation = Quaternion.multiply(yawQ(c.yaw), pitch(c.pitch))
  Transform.getMutable(arm.elbow).rotation = pitch(c.elbow)
  Transform.getMutable(arm.wrist).rotation = pitch(c.wrist)
}

// ---------------------------------------------------------------------------
// Fan telegraph: thin red slices covering exactly the damage band and yaw range.
// ---------------------------------------------------------------------------
function buildFan() {
  const rin = COMBAT.sweepInnerRadius
  const rout = COMBAT.sweepOuterRadius
  const n = 12
  const span = COMBAT.sweepYawEnd - COMBAT.sweepYawStart
  const step = span / n
  const width = 2 * rout * Math.tan(((step / 2) * Math.PI) / 180) + 0.3
  for (let i = 0; i < n; i++) {
    const a = COMBAT.sweepYawStart + step * (i + 0.5)
    const rad = (a * Math.PI) / 180
    const rmid = (rin + rout) / 2
    const e = engine.addEntity()
    Name.create(e, { value: `Sweep_Fan${i}` })
    Transform.create(e, {
      parent: parts.root,
      position: v(SHOULDER_X + Math.sin(rad) * rmid, 0.06, Math.cos(rad) * rmid),
      rotation: yawQ(a),
      scale: v(width, 0.02, rout - rin)
    })
    MeshRenderer.setBox(e)
    Material.setPbrMaterial(e, {
      albedoColor: Color4.create(1, 0, 0, 0.3),
      emissiveColor: Color3.Red(),
      emissiveIntensity: 1.2,
      transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND
    })
    VisibilityComponent.create(e, { visible: false })
    fan.push(e)
  }
}

function showFan(visible: boolean) {
  for (const e of fan) {
    const vc = VisibilityComponent.getMutableOrNull(e)
    if (vc && vc.visible !== visible) vc.visible = visible
  }
}

/** Fan entities are children of the boss root and die with it; just forget them on reset. */
export function resetSweep() {
  state = 'OFF'
  t = 0
  wait = 0
  fromCfg = REST
  curYaw = 0
  prevYaw = 0
  hitDone = false
  harmless = false
  wasAiming = false
  fan = []
  if (game.attackWarning === 'SWEEP') game.attackWarning = ''
}

function abort() {
  showFan(false)
  if (game.attackWarning === 'SWEEP') game.attackWarning = ''
}

// ---------------------------------------------------------------------------
// Damage: the arm hits a standing player in the band when its yaw passes the player's bearing.
// ---------------------------------------------------------------------------
function checkHit() {
  if (hitDone || harmless) return
  const p = Transform.getOrNull(engine.PlayerEntity)
  if (!p || p.position.y > 4.5) return
  const local = worldToLocal(worldPose(parts.root), p.position)
  const dx = local.x - SHOULDER_X
  const dz = local.z
  const r = Math.hypot(dx, dz)
  if (r < COMBAT.sweepInnerRadius || r > COMBAT.sweepOuterRadius) return
  const bearing = (Math.atan2(dx, dz) * 180) / Math.PI
  const halfWidth = (Math.atan2(3.2, r) * 180) / Math.PI // arm/hand half width at that radius
  const lo = Math.max(COMBAT.sweepYawStart, prevYaw - halfWidth)
  const hi = Math.min(COMBAT.sweepYawEnd, curYaw + halfWidth)
  if (bearing < lo || bearing > hi) return
  hitDone = true
  // knock the avatar along the sweep direction
  const back = ((curYaw - 25) * Math.PI) / 180
  const rootPose = worldPose(parts.root)
  const fromLocal = v(SHOULDER_X + Math.sin(back) * r, 0, Math.cos(back) * r)
  const from = Vector3.add(rootPose.position, Vector3.rotate(fromLocal, rootPose.rotation))
  damagePlayer(COMBAT.sweepDamage, 'SWEEP', from)
}

export function sweepSystem(dt: number) {
  if (game.phase === 'RESETTING') return
  const enabled =
    bossState.severed && fallen.landed && !bossState.armorDestroyed && game.phase !== 'PLAYER_DEAD' && game.phase !== 'VICTORY'
  if (!enabled) {
    if (state !== 'OFF' && state !== 'WAIT') abort()
    // after the chest hit the kneel animation owns the arm; on death the arm simply freezes
    if (bossState.armorDestroyed) state = 'OFF'
    return
  }

  if (state === 'OFF') {
    if (fan.length === 0) buildFan()
    // the remaining arm is scenery from now on: never shove or trap the avatar while it swings
    setSolid(parts.leftArm.colliders, false)
    state = 'WAIT'
    wait = COMBAT.sweepFirstDelay
  }

  // aiming the launcher: never start a sweep, and anything already moving can't hurt the frozen player
  if (game.aiming) harmless = true
  if (wasAiming && !game.aiming) wait = Math.max(wait, COMBAT.sweepAfterAimGrace)
  wasAiming = game.aiming

  if (state === 'WAIT') {
    if (game.aiming) return
    wait -= dt
    if (wait <= 0) {
      state = 'RAISE'
      t = 0
      hitDone = false
      harmless = false
      game.attackWarning = 'SWEEP'
      console.log('[sweep] raise')
    }
    return
  }

  t += dt
  if (state === 'RAISE') {
    const u = clamp01(t / COMBAT.sweepRaiseTime)
    fromCfg = blend(REST, RAISED(COMBAT.sweepYawStart), easeInOut(u))
    applyArm(fromCfg)
    showFan(Math.floor(t * 6) % 2 === 0)
    if (u >= 1) {
      state = 'DROP'
      t = 0
    }
  } else if (state === 'DROP') {
    const u = clamp01(t / COMBAT.sweepDropTime)
    fromCfg = blend(RAISED(COMBAT.sweepYawStart), LOW(COMBAT.sweepYawStart), easeIn(u))
    applyArm(fromCfg)
    showFan(true)
    if (u >= 1) {
      state = 'SWEEP'
      t = 0
      curYaw = prevYaw = COMBAT.sweepYawStart
      console.log('[sweep] sweeping')
    }
  } else if (state === 'SWEEP') {
    const u = clamp01(t / COMBAT.sweepTime)
    prevYaw = curYaw
    curYaw = lerp(COMBAT.sweepYawStart, COMBAT.sweepYawEnd, easeInOut(u))
    fromCfg = LOW(curYaw)
    applyArm(fromCfg)
    checkHit()
    if (Math.random() < 0.25) {
      const rp = worldPose(parts.leftArm.wrist).position
      burst(v(rp.x, 0.3, rp.z), { ...DUST(12, 1.5), lifetime: 1.2 })
    }
    if (u >= 1) {
      state = 'RECOVER'
      t = 0
      showFan(false)
      game.attackWarning = ''
    }
  } else if (state === 'RECOVER') {
    const u = clamp01(t / COMBAT.sweepRecoverTime)
    fromCfg = blend(LOW(COMBAT.sweepYawEnd), REST, easeInOut(u))
    applyArm(fromCfg)
    if (u >= 1) {
      state = 'WAIT'
      wait = COMBAT.sweepCooldown
      applyArm(REST)
    }
  }
}

export function sweepActive() {
  return state === 'RAISE' || state === 'DROP' || state === 'SWEEP'
}
