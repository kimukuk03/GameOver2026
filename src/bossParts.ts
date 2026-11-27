// Shared references to the boss entities and the boss state. No logic here (avoids import cycles).
import { Entity } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import { BOSS_CONFIG as C } from './config'
import { v, worldPose } from './utils'

export type SlamPhase = 'IDLE' | 'BARRAGE' | 'WINDUP' | 'SLAM' | 'PINNED' | 'RETURN'

export type Arm = {
  shoulder: Entity
  elbow: Entity
  wrist: Entity
  pod?: Entity
  /** every mesh with a collider in this arm (for toggling physics during the fall) */
  colliders: Entity[]
  /** forearm-side colliders (forearm, launcher, wrist, hand) that move when aiming */
  forearmColliders: Entity[]
}

export type Leg = { hip: Entity; knee: Entity; ankle: Entity }

export const parts = {
  root: 0 as Entity,
  pelvis: 0 as Entity,
  chest: 0 as Entity,
  head: 0 as Entity,
  visor: 0 as Entity,
  armor: 0 as Entity,
  core: 0 as Entity,
  weakPoint: 0 as Entity,
  stump: undefined as Entity | undefined,
  stumpCore: undefined as Entity | undefined,
  missileArm: undefined as unknown as Arm,
  leftArm: undefined as unknown as Arm,
  legL: undefined as unknown as Leg,
  legR: undefined as unknown as Leg,
  dangerZone: 0 as Entity
}

export function freshBossState() {
  return {
    phase: 'IDLE' as SlamPhase,
    phaseTimeLeft: C.firstAttackDelay,
    weakPointHp: C.weakPointHits,
    /** right arm detached: slam attack permanently stopped */
    severed: false,
    armorDestroyed: false,
    coreHp: C.coreHp,
    coreDestroyed: false,
    /** Debug: keep the arm pinned indefinitely (toggle with key 2) */
    holdPinned: false
  }
}
export const bossState = freshBossState()

/** Chest armor box in chest-local space (center / size), used for missile hit tests. */
export const ARMOR_LOCAL = { center: v(0, 0.5, 5.1), size: v(8, 7, 1.2) }
/** Chest body box in chest-local space. */
export const CHEST_LOCAL = { center: v(0, 0, 0), size: v(15, 11, 9) }
/** Core sphere position (chest-local) and exposed radius. */
export const CORE_LOCAL = v(0, 0.5, 3.6)
export const CORE_RADIUS = 1.8

export function chestPose() {
  return worldPose(parts.chest)
}

export function armorWorld(): Vector3 {
  const chest = chestPose()
  return Vector3.add(chest.position, Vector3.rotate(ARMOR_LOCAL.center, chest.rotation))
}

export function coreWorld(): Vector3 {
  return worldPose(parts.core).position
}
