// Hijacking the fallen missile launcher: aim mode, laser sight, missiles and hit detection.
import {
  engine,
  Entity,
  Transform,
  MeshRenderer,
  Material,
  Name,
  VisibilityComponent,
  InputModifier,
  VirtualCamera,
  MainCamera,
  inputSystem,
  InputAction,
  PointerEventType
} from '@dcl/sdk/ecs'
import { Vector3, Quaternion, Color4, Color3 } from '@dcl/sdk/math'
import { BOSS_CONFIG as C } from './config'
import { game, setPhase, flash, fightOver } from './gameState'
import { onChestHit } from './boss'
import { parts, bossState, chestPose, armorWorld, ARMOR_LOCAL, CHEST_LOCAL } from './bossParts'
import { fallen, setForearmYaw, pushPlayerOutOfArm } from './arm'
import { v, yawQ, worldPose, worldToLocal, segmentBoxT, setSolid } from './utils'
import { burst, FIRE, SMOKE, SPARKS, shake, shakeOffset, setExternalCamera, addTemp, loopEmitter } from './fx'

let aiming = false
let aimTime = 0
let aimCam: Entity | undefined
let laser: Entity | undefined
let laserOnTarget: boolean | undefined
let exitAfterHit = -1

type Missile = { e: Entity; pos: Vector3; dir: Vector3; age: number }
let missile: Missile | undefined

const UP = v(0, 1, 0)
const LASER_RANGE = 120

export function createLauncherEntities() {
  laser = engine.addEntity()
  Name.create(laser, { value: 'Launcher_AimLaser' })
  Transform.create(laser, { position: v(0, -10, 0), scale: v(0.12, 0.12, 1) })
  MeshRenderer.setBox(laser)
  VisibilityComponent.create(laser, { visible: false })
  laserOnTarget = undefined
  setLaserColor(false)
}

/** Leave aim mode, drop any missile and the laser, restore camera + movement (PLAY AGAIN). */
export function resetLauncher() {
  game.aiming = false
  if (aiming) {
    aiming = false
    InputModifier.deleteFrom(engine.PlayerEntity)
    const mc = MainCamera.getMutableOrNull(engine.CameraEntity)
    if (mc) mc.virtualCameraEntity = undefined
    setExternalCamera(undefined)
  }
  if (aimCam) engine.removeEntity(aimCam)
  aimCam = undefined
  if (missile) engine.removeEntityWithChildren(missile.e)
  missile = undefined
  if (laser) engine.removeEntity(laser)
  laser = undefined
  laserOnTarget = undefined
  aimTime = 0
  exitAfterHit = -1
}

/** Debug: behave exactly as if a missile had just hit the armor plate. */
export function debugHitChest() {
  if (!fallen.landed || bossState.armorDestroyed) return
  chestHit(armorWorld())
}

function chestHit(point: Vector3) {
  onChestHit(point)
  setPhase('CORE_EXPOSED')
  flash('DIRECT HIT! CORE EXPOSED', 6, true)
  if (aiming) exitAfterHit = 3.5
}

function setLaserColor(onTarget: boolean) {
  if (!laser || laserOnTarget === onTarget) return
  laserOnTarget = onTarget
  const c = onTarget ? Color3.create(0.1, 1, 0.2) : Color3.create(1, 0.1, 0.05)
  // Keep emissive low: strong emissive blooms to white and hides the red/green state.
  Material.setPbrMaterial(laser, { albedoColor: Color4.create(c.r, c.g, c.b, 1), emissiveColor: c, emissiveIntensity: 1.2 })
}

/** Armor box (chest-local) expanded by the hit tolerance. */
function armorHalf(tol: number): Vector3 {
  return v(ARMOR_LOCAL.size.x / 2 + tol, ARMOR_LOCAL.size.y / 2 + tol, ARMOR_LOCAL.size.z / 2 + tol)
}

/** Muzzle position and firing direction for the current forearm yaw (vertical angle auto-aims at chest height). */
function aimRay() {
  const pod = worldPose(parts.missileArm.pod!)
  const h = Vector3.rotate(v(0, 0, 1), yawQ(fallen.forearmYaw))
  const origin = Vector3.add(pod.position, Vector3.scale(h, 5.2))
  const target = armorWorld()
  const along = Math.max(8, (target.x - origin.x) * h.x + (target.z - origin.z) * h.z)
  const elev = Math.atan2(target.y - origin.y, along)
  const dir = Vector3.normalize(Vector3.add(Vector3.scale(h, Math.cos(elev)), Vector3.scale(UP, Math.sin(elev))))
  return { origin, dir, h }
}

/** Where the segment a->b first hits the armor (with tolerance) / chest body, in world space. */
function traceChest(a: Vector3, b: Vector3) {
  const chest = chestPose()
  const la = worldToLocal(chest, a)
  const lb = worldToLocal(chest, b)
  if (!bossState.armorDestroyed) {
    const t = segmentBoxT(la, lb, ARMOR_LOCAL.center, armorHalf(C.missileHitTolerance))
    if (t >= 0) return { kind: 'armor' as const, t }
  }
  const tb = segmentBoxT(la, lb, CHEST_LOCAL.center, Vector3.scale(CHEST_LOCAL.size, 0.5))
  if (tb >= 0) return { kind: 'body' as const, t: tb }
  return undefined
}

function enterAim() {
  aiming = true
  game.aiming = true
  aimTime = 0
  setPhase(missile ? 'MISSILE_FLIGHT' : 'MISSILE_AIM')
  // Freeze the avatar so A/D only steer the launcher (global input is still readable).
  InputModifier.createOrReplace(engine.PlayerEntity, { mode: InputModifier.Mode.Standard({ disableAll: true }) })
  // The forearm swings around the elbow while aiming; never let it shove the frozen avatar.
  setSolid(parts.missileArm.forearmColliders, false)
  aimCam = engine.addEntity()
  Name.create(aimCam, { value: 'Launcher_AimCamera' })
  Transform.create(aimCam, { position: Transform.get(engine.CameraEntity).position })
  VirtualCamera.create(aimCam, { fov: 60, defaultTransition: { transitionMode: VirtualCamera.Transition.Time(0.6) } })
  updateAimCamera()
  MainCamera.createOrReplace(engine.CameraEntity, { virtualCameraEntity: aimCam })
  setExternalCamera(aimCam)
  VisibilityComponent.getMutable(laser!).visible = true
  flash('A / D: aim    Left click: fire    E: leave', 4)
  console.log('[launcher] aim mode on')
}

function exitAim() {
  if (!aiming) return
  aiming = false
  game.aiming = false
  exitAfterHit = -1
  // a dead player stays frozen (player.ts owns the modifier then)
  if (game.phase !== 'PLAYER_DEAD') InputModifier.deleteFrom(engine.PlayerEntity)
  const mc = MainCamera.getMutableOrNull(engine.CameraEntity)
  if (mc && mc.virtualCameraEntity === aimCam) mc.virtualCameraEntity = undefined
  if (aimCam) addTemp(aimCam, 1.0) // delete after the blend back to the player camera
  aimCam = undefined
  setExternalCamera(undefined)
  setSolid(parts.missileArm.forearmColliders, true)
  pushPlayerOutOfArm()
  VisibilityComponent.getMutable(laser!).visible = false
  game.aimOnTarget = false
  if (game.phase === 'MISSILE_AIM') setPhase('ARM_DESTROYED')
  console.log('[launcher] aim mode off')
}

function updateAimCamera() {
  if (!aimCam) return
  const { origin, dir, h } = aimRay()
  const camPos = Vector3.add(Vector3.add(origin, Vector3.scale(h, -14)), v(0, 6, 0))
  const look = Vector3.add(origin, Vector3.scale(dir, 30))
  const t = Transform.getMutable(aimCam)
  t.position = Vector3.add(camPos, shakeOffset())
  t.rotation = Quaternion.fromLookAt(camPos, look)
}

export function launcherSystem(dt: number) {
  if (game.phase === 'RESETTING') return
  if (fightOver() && aiming) exitAim()
  if (!fallen.landed || !parts.missileArm.pod || !laser) {
    game.nearLauncher = false
    return
  }
  const podPos = worldPose(parts.missileArm.pod).position
  const player = Transform.getOrNull(engine.PlayerEntity)
  const ePressed = inputSystem.isTriggered(InputAction.IA_PRIMARY, PointerEventType.PET_DOWN)
  const canHijack = game.phase === 'ARM_DESTROYED' || (game.phase === 'MISSILE_FLIGHT' && !aiming)
  game.nearLauncher = !aiming && canHijack && !!player && Vector3.distance(player.position, podPos) <= C.launcherInteractDistance

  if (!aiming) {
    if (game.nearLauncher && ePressed) enterAim()
    return
  }

  aimTime += dt
  if (exitAfterHit >= 0) {
    exitAfterHit -= dt
    updateAimCamera()
    if (exitAfterHit < 0) exitAim()
    return
  }
  if (ePressed || aimTime > C.aimModeTimeout) {
    exitAim()
    return
  }

  // A/D steer the forearm about the elbow, limited to a cone around the chest bearing.
  let turn = 0
  if (inputSystem.isPressed(InputAction.IA_LEFT)) turn -= 1
  if (inputSystem.isPressed(InputAction.IA_RIGHT)) turn += 1
  if (turn !== 0) {
    const min = fallen.chestBearing - C.aimYawRange
    const max = fallen.chestBearing + C.aimYawRange
    setForearmYaw(Math.max(min, Math.min(max, fallen.forearmYaw + turn * C.aimYawSpeed * dt)))
  }

  // Laser sight
  const { origin, dir } = aimRay()
  const far = Vector3.add(origin, Vector3.scale(dir, LASER_RANGE))
  const hit = traceChest(origin, far)
  const len = hit ? Math.max(1, hit.t * LASER_RANGE) : 60
  const onTarget = hit?.kind === 'armor'
  game.aimOnTarget = onTarget
  setLaserColor(onTarget)
  const lt = Transform.getMutable(laser!)
  lt.position = Vector3.add(origin, Vector3.scale(dir, len / 2))
  lt.rotation = Quaternion.lookRotation(dir)
  lt.scale = v(0.25, 0.25, len)

  if (game.reloadLeft > 0) game.reloadLeft = Math.max(0, game.reloadLeft - dt)

  if (inputSystem.isTriggered(InputAction.IA_POINTER, PointerEventType.PET_DOWN)) {
    if (missile) {
      flash('Missile already in flight', 1)
    } else if (game.reloadLeft > 0) {
      flash(`Reloading... ${game.reloadLeft.toFixed(1)}s`, 1)
    } else if (!bossState.armorDestroyed) {
      fire(origin, dir)
    }
  }
  updateAimCamera()
}

function fire(origin: Vector3, dir: Vector3) {
  const e = engine.addEntity()
  Name.create(e, { value: 'Missile' })
  Transform.create(e, { position: origin, rotation: Quaternion.lookRotation(dir), scale: v(0.6, 0.6, 2.4) })
  MeshRenderer.setBox(e)
  Material.setPbrMaterial(e, {
    albedoColor: Color4.create(0.9, 0.9, 0.85, 1),
    emissiveColor: Color3.create(1, 0.4, 0.1),
    emissiveIntensity: 1.5
  })
  // Fire + smoke trail (particle size ignores Transform.scale, so parenting to the scaled body is fine)
  loopEmitter(e, v(0, 0, -0.5), {
    count: 150,
    rate: 90,
    colorStart: Color4.create(1, 0.7, 0.3, 1),
    colorEnd: Color4.create(0.35, 0.35, 0.35, 0),
    size: [0.5, 0.9],
    speed: [0.2, 0.8],
    lifetime: 1.4,
    radius: 0.15,
    gravity: -0.05,
    sizeEnd: 3
  })
  missile = { e, pos: origin, dir, age: 0 }
  game.reloadLeft = C.missileReload
  setPhase('MISSILE_FLIGHT')
  burst(origin, { ...SMOKE(25, 0.8), lifetime: 1.5 })
  shake(0.15, 0.25)
  console.log('[launcher] missile fired')
}

function endMissile() {
  if (!missile) return
  engine.removeEntityWithChildren(missile.e)
  missile = undefined
}

export function missileSystem(dt: number) {
  if (!missile || game.phase === 'RESETTING') return
  if (game.phase === 'PLAYER_DEAD') {
    endMissile()
    return
  }
  const m = missile
  m.age += dt
  const prev = m.pos
  const next = Vector3.add(prev, Vector3.scale(m.dir, C.missileSpeed * dt))
  m.pos = next
  Transform.getMutable(m.e).position = next

  const hit = traceChest(prev, next)
  if (hit) {
    const point = Vector3.lerp(prev, next, hit.t)
    endMissile()
    if (hit.kind === 'armor') {
      console.log('[launcher] HIT armor')
      chestHit(point)
    } else {
      missExplosion(point, 'Hit the hull, not the armor plate!')
    }
    return
  }

  const out = next.x < 0 || next.x > 64 || next.z < 0 || next.z > 64 || next.y > 80
  if (next.y <= 0.2) {
    missExplosion(v(next.x, 0.3, next.z), 'Missed!')
  } else if (out || m.age > C.missileLifetime) {
    endMissile()
    afterMiss('Missed!')
  }
}

function missExplosion(point: Vector3, msg: string) {
  endMissile()
  burst(point, FIRE(70, 1))
  burst(point, SMOKE(30, 1.5))
  burst(point, SPARKS(30))
  shake(0.25, 0.35)
  afterMiss(msg)
}

function afterMiss(msg: string) {
  console.log(`[launcher] ${msg}`)
  flash(`${msg} Reload and try again.`, 2)
  if (game.phase === 'MISSILE_FLIGHT') setPhase(aiming ? 'MISSILE_AIM' : 'ARM_DESTROYED')
}

export function isAiming() {
  return aiming
}
