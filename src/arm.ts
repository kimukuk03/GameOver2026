// Severing the right arm: detach from the body, tumble to the ground, settle into a stable pose.
import { engine, Transform, Physics } from '@dcl/sdk/ecs'
import { Vector3, Quaternion } from '@dcl/sdk/math'
import { movePlayerTo } from '~system/RestrictedActions'
import { BOSS_CONFIG as C } from './config'
import { game, setPhase, flash } from './gameState'
import { stopSlam, createShoulderStump } from './boss'
import { parts, armorWorld } from './bossParts'
import { v, pitch, yawQ, worldPose, setSolid, clamp01, easeOut } from './utils'
import { burst, DUST, SPARKS, shake } from './fx'

/** Settled layout of the fallen arm (filled in when it lands). */
export const fallen = {
  landed: false,
  elbow: Vector3.Zero(),
  shoulderEnd: Vector3.Zero(),
  /** world yaw (deg) the upper arm points along */
  upperYaw: C.fallenUpperArmYaw,
  /** world yaw (deg) of the forearm; changed by aiming */
  forearmYaw: 0,
  /** compass bearing (deg) from the elbow to the chest armor */
  chestBearing: 0
}

type Key = { pos: Vector3; rot: Quaternion; elbow: Quaternion; wrist: Quaternion }

let k0: Key, k1: Key, k2: Key
let fallT = -1
let bounceT = -1
let severed = false

const bearingDeg = (from: Vector3, to: Vector3) => (Math.atan2(to.x - from.x, to.z - from.z) * 180) / Math.PI

export function severArm() {
  if (severed) return
  severed = true
  stopSlam()
  setPhase('ARM_DESTROYED')
  game.armFalling = true
  console.log('[arm] severed')

  const arm = parts.missileArm
  const wp = worldPose(parts.weakPoint).position

  // Knock a nearby player off the arm, and make the arm non-solid while it tumbles so it can't
  // carry, trap or sweep them out of the scene.
  const player = Transform.getOrNull(engine.PlayerEntity)
  if (player && Vector3.distance(player.position, wp) < 15) {
    Physics.applyKnockbackToPlayer(wp, C.severKnockback, 15)
  }
  setSolid(arm.colliders, false)

  // Re-parent the arm root (ArmR_ShoulderPivot) to the scene root, keeping its world pose.
  const start = worldPose(arm.shoulder)
  const st = Transform.getMutable(arm.shoulder)
  st.parent = engine.RootEntity
  st.position = start.position
  st.rotation = start.rotation

  // Final layout: upper arm lies flat toward the elbow; forearm points (roughly) at the chest.
  const armor = armorWorld()
  const elbow = v(C.fallenElbow.x, 2.0, C.fallenElbow.z)
  const upperDir = Vector3.rotate(v(0, 0, 1), yawQ(C.fallenUpperArmYaw))
  const shoulderEnd = Vector3.subtract(elbow, Vector3.scale(upperDir, C.upperArmLength))
  fallen.elbow = elbow
  fallen.shoulderEnd = shoulderEnd
  fallen.chestBearing = bearingDeg(elbow, armor)
  fallen.forearmYaw = fallen.chestBearing + C.fallenAimOffset

  k0 = {
    pos: start.position,
    rot: start.rotation,
    elbow: Transform.get(arm.elbow).rotation,
    wrist: Transform.get(arm.wrist).rotation
  }
  // Mid-air: shoulder end flung up and back, arm hanging down toward the boss side, elbow bent.
  k1 = {
    pos: v(10, 34, 26),
    rot: Quaternion.multiply(yawQ(20), pitch(60)),
    elbow: pitch(-30),
    wrist: pitch(-10)
  }
  k2 = {
    pos: shoulderEnd,
    rot: yawQ(C.fallenUpperArmYaw),
    elbow: yawQ(fallen.forearmYaw - C.fallenUpperArmYaw),
    wrist: Quaternion.Identity()
  }

  createShoulderStump()
  fallT = 0
}

/** Back to the initial state (PLAY AGAIN). Entities are removed by destroyBoss(). */
export function resetArm() {
  severed = false
  fallT = -1
  bounceT = -1
  fallen.landed = false
  fallen.elbow = Vector3.Zero()
  fallen.shoulderEnd = Vector3.Zero()
  fallen.upperYaw = C.fallenUpperArmYaw
  fallen.forearmYaw = 0
  fallen.chestBearing = 0
}

/** Quadratic bezier */
function bez(a: Vector3, b: Vector3, c: Vector3, t: number): Vector3 {
  const u = 1 - t
  return v(u * u * a.x + 2 * u * t * b.x + t * t * c.x, u * u * a.y + 2 * u * t * b.y + t * t * c.y, u * u * a.z + 2 * u * t * b.z + t * t * c.z)
}

export function fallSystem(dt: number) {
  if (game.phase === 'RESETTING') return
  const arm = parts.missileArm
  if (fallT >= 0) {
    fallT += dt
    const raw = clamp01(fallT / C.armFallTime)
    // ease-in on the way down (gravity feel)
    const t = raw * raw * (1.6 - 0.6 * raw)
    const pos = bez(k0.pos, k1.pos, k2.pos, t)
    const seg = t < 0.45 ? t / 0.45 : (t - 0.45) / 0.55
    const a = t < 0.45 ? k0 : k1
    const b = t < 0.45 ? k1 : k2
    const s = easeOut(seg)
    // one full roll around the arm's long axis during the tumble (ends at identity)
    const roll = Quaternion.fromEulerDegrees(0, 0, 360 * t)
    const st = Transform.getMutable(arm.shoulder)
    st.position = pos
    st.rotation = Quaternion.multiply(Quaternion.slerp(a.rot, b.rot, s), roll)
    Transform.getMutable(arm.elbow).rotation = Quaternion.slerp(a.elbow, b.elbow, s)
    Transform.getMutable(arm.wrist).rotation = Quaternion.slerp(a.wrist, b.wrist, s)

    if (raw >= 1) {
      fallT = -1
      bounceT = 0
      setKeyPose(k2)
      onImpact()
    }
    return
  }

  if (bounceT >= 0) {
    bounceT += dt
    const u = clamp01(bounceT / C.armBounceTime)
    const lift = 1.2 * Math.sin(Math.PI * u)
    Transform.getMutable(arm.shoulder).position = v(k2.pos.x, k2.pos.y + lift, k2.pos.z)
    Transform.getMutable(arm.shoulder).rotation = Quaternion.multiply(k2.rot, pitch(-2 * Math.sin(Math.PI * u)))
    if (u >= 1) {
      bounceT = -1
      setKeyPose(k2)
      onSettled()
    }
  }
}

function setKeyPose(k: Key) {
  const arm = parts.missileArm
  const st = Transform.getMutable(arm.shoulder)
  st.position = k.pos
  st.rotation = k.rot
  Transform.getMutable(arm.elbow).rotation = k.elbow
  Transform.getMutable(arm.wrist).rotation = k.wrist
}

function onImpact() {
  const tip = forearmPoint(C.forearmLength + C.handLength)
  burst(fallen.shoulderEnd, DUST(70, 3))
  burst(fallen.elbow, DUST(70, 3))
  burst(tip, DUST(70, 3))
  burst(fallen.elbow, SPARKS(60))
  shake(0.7, 0.8)
  console.log('[arm] impact')
}

function onSettled() {
  const arm = parts.missileArm
  setSolid(arm.colliders, true)
  pushPlayerOutOfArm()
  fallen.landed = true
  game.armFalling = false
  flash('The launcher survived! Go hijack it.', 4)
  console.log('[arm] settled')
}

/** World point along the forearm axis at distance d from the elbow. */
export function forearmPoint(d: number): Vector3 {
  const dir = Vector3.rotate(v(0, 0, 1), yawQ(fallen.forearmYaw))
  return Vector3.add(fallen.elbow, Vector3.scale(dir, d))
}

/** Rotate the fallen forearm (and launcher) about the elbow joint. */
export function setForearmYaw(yaw: number) {
  fallen.forearmYaw = yaw
  Transform.getMutable(parts.missileArm.elbow).rotation = yawQ(yaw - fallen.upperYaw)
}

/** Closest point on segment a-b (XZ plane) to p, and its distance. */
function closestXZ(p: Vector3, a: Vector3, b: Vector3) {
  const abx = b.x - a.x
  const abz = b.z - a.z
  const len2 = abx * abx + abz * abz
  const t = len2 > 0 ? clamp01(((p.x - a.x) * abx + (p.z - a.z) * abz) / len2) : 0
  const cx = a.x + abx * t
  const cz = a.z + abz * t
  return { cx, cz, dist: Math.hypot(p.x - cx, p.z - cz) }
}

/**
 * If the player ended up inside the settled arm (e.g. landed on its footprint while it was non-solid),
 * slide them out to the nearest side. Only used as a safety net.
 */
export function pushPlayerOutOfArm() {
  const p = Transform.getOrNull(engine.PlayerEntity)
  if (!p || p.position.y > 5) return
  const segs: Array<[Vector3, Vector3, number]> = [
    [fallen.shoulderEnd, fallen.elbow, 2.5],
    [fallen.elbow, forearmPoint(C.forearmLength + C.handLength), 3.2]
  ]
  for (const [a, b, half] of segs) {
    const c = closestXZ(p.position, a, b)
    if (c.dist < half + 0.4) {
      let nx = p.position.x - c.cx
      let nz = p.position.z - c.cz
      const n = Math.hypot(nx, nz)
      if (n < 0.01) {
        // dead center: push perpendicular to the segment
        nx = -(b.z - a.z)
        nz = b.x - a.x
      }
      const k = (half + 2) / Math.max(0.01, Math.hypot(nx, nz))
      const target = v(c.cx + nx * k, 0.5, c.cz + nz * k)
      console.log(`[arm] player inside arm footprint, moving to ${target.x.toFixed(1)},${target.z.toFixed(1)}`)
      void movePlayerTo({ newRelativePosition: target })
      return
    }
  }
}

export function isSevered() {
  return severed
}
