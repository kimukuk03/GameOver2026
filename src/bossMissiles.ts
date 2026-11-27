// Boss attack: missile barrage fired from the right-arm launcher (separate from the player's launcher missiles).
import {
  engine,
  Entity,
  Transform,
  MeshRenderer,
  Material,
  MaterialTransparencyMode,
  Name,
  VisibilityComponent
} from '@dcl/sdk/ecs'
import { Vector3, Quaternion, Color4, Color3 } from '@dcl/sdk/math'
import { COMBAT } from './config'
import { game } from './gameState'
import { parts, bossState } from './bossParts'
import { v, worldPose } from './utils'
import { burst, FIRE, DUST, SMOKE, loopEmitter } from './fx'
import { damagePlayer } from './player'

type BossMissile = { e: Entity; marker: Entity; start: Vector3; ctrl: Vector3; target: Vector3; t: number }

let missiles: BossMissile[] = []
let active = false
let launched = 0
let launchClock = 0
let recoverLeft = -1

export function startBarrage() {
  if (active || bossState.severed) return
  active = true
  launched = 0
  launchClock = 0.4
  recoverLeft = -1
  game.attackWarning = 'MISSILES'
  console.log('[barrage] start')
}

/** True when no barrage is running (all missiles resolved). */
export function barrageIdle() {
  return !active
}

/** Remove every boss missile and impact marker immediately (sever, death, reset). */
export function cancelBarrage() {
  for (const m of missiles) {
    engine.removeEntityWithChildren(m.e)
    engine.removeEntity(m.marker)
  }
  missiles = []
  active = false
  launched = 0
  recoverLeft = -1
  if (game.attackWarning === 'MISSILES') game.attackWarning = ''
}

function bez(a: Vector3, b: Vector3, c: Vector3, t: number): Vector3 {
  const u = 1 - t
  return v(u * u * a.x + 2 * u * t * b.x + t * t * c.x, u * u * a.y + 2 * u * t * b.y + t * t * c.y, u * u * a.z + 2 * u * t * b.z + t * t * c.z)
}
function bezTangent(a: Vector3, b: Vector3, c: Vector3, t: number): Vector3 {
  return v(
    2 * (1 - t) * (b.x - a.x) + 2 * t * (c.x - b.x),
    2 * (1 - t) * (b.y - a.y) + 2 * t * (c.y - b.y),
    2 * (1 - t) * (b.z - a.z) + 2 * t * (c.z - b.z)
  )
}

function launchOne() {
  const pod = parts.missileArm.pod
  const player = Transform.getOrNull(engine.PlayerEntity)
  if (!pod || !player) return
  const podPose = worldPose(pod)
  const fwd = Vector3.rotate(v(0, 0, 1), podPose.rotation)
  const start = Vector3.add(podPose.position, Vector3.scale(fwd, 5))
  // Target is locked now (player position + small random offset); it never follows the player afterwards.
  const ang = Math.random() * Math.PI * 2
  const off = Math.random() * COMBAT.barrageSpread
  const target = v(
    Math.max(3, Math.min(61, player.position.x + Math.cos(ang) * off)),
    0.05,
    Math.max(3, Math.min(61, player.position.z + Math.sin(ang) * off))
  )
  const mid = Vector3.lerp(start, target, 0.5)
  const ctrl = v(mid.x, Math.max(start.y, target.y) + 14, mid.z)

  // red impact circle
  const marker = engine.addEntity()
  Name.create(marker, { value: 'BossMissile_Marker' })
  const d = COMBAT.barrageRadius * 2
  Transform.create(marker, { position: target, scale: v(d, 0.02, d) })
  MeshRenderer.setCylinder(marker)
  Material.setPbrMaterial(marker, {
    albedoColor: Color4.create(1, 0, 0, 0.45),
    emissiveColor: Color3.Red(),
    emissiveIntensity: 1.5,
    transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND
  })
  VisibilityComponent.create(marker, { visible: true })

  // missile body + trail
  const e = engine.addEntity()
  Name.create(e, { value: 'BossMissile' })
  Transform.create(e, { position: start, scale: v(0.8, 0.8, 2.6) })
  MeshRenderer.setBox(e)
  Material.setPbrMaterial(e, { albedoColor: Color4.create(0.3, 0.3, 0.3, 1), emissiveColor: Color3.create(1, 0.3, 0.1), emissiveIntensity: 2 })
  loopEmitter(e, v(0, 0, -0.5), {
    count: 70,
    rate: 50,
    colorStart: Color4.create(1, 0.5, 0.2, 1),
    colorEnd: Color4.create(0.3, 0.3, 0.3, 0),
    size: [0.6, 1],
    speed: [0.2, 0.6],
    lifetime: 1.2,
    radius: 0.2,
    sizeEnd: 3
  })
  burst(start, { ...SMOKE(15, 0.6), lifetime: 1.2 })
  missiles.push({ e, marker, start, ctrl, target, t: 0 })
}

function impact(m: BossMissile) {
  burst(m.target, FIRE(50, 1.2))
  burst(m.target, DUST(40, 2))
  const p = Transform.getOrNull(engine.PlayerEntity)
  if (p) {
    const dist = Math.hypot(p.position.x - m.target.x, p.position.z - m.target.z)
    if (dist <= COMBAT.barrageRadius && p.position.y < m.target.y + 4) {
      damagePlayer(COMBAT.barrageDamage, 'MISSILE', m.target)
    }
  }
}

export function bossMissileSystem(dt: number) {
  if (game.phase === 'RESETTING') return
  // sealed for good once the arm is gone; stop on player death
  if (bossState.severed || game.phase === 'PLAYER_DEAD') {
    if (active || missiles.length) cancelBarrage()
    return
  }
  if (!active) return

  if (launched < COMBAT.barrageCount) {
    launchClock -= dt
    if (launchClock <= 0) {
      launchOne()
      launched++
      launchClock = COMBAT.barrageInterval
    }
  }

  for (let i = missiles.length - 1; i >= 0; i--) {
    const m = missiles[i]
    m.t += dt / COMBAT.barrageFlightTime
    const k = Math.min(1, m.t)
    const t = Transform.getMutable(m.e)
    t.position = bez(m.start, m.ctrl, m.target, k)
    const tan = bezTangent(m.start, m.ctrl, m.target, k)
    if (Vector3.length(tan) > 0.01) t.rotation = Quaternion.lookRotation(tan)
    // marker blinks faster as the impact nears
    VisibilityComponent.getMutable(m.marker).visible = Math.floor(k * (6 + 14 * k)) % 2 === 0 || k > 0.85
    if (m.t >= 1) {
      impact(m)
      engine.removeEntityWithChildren(m.e)
      engine.removeEntity(m.marker)
      missiles.splice(i, 1)
    }
  }

  if (launched >= COMBAT.barrageCount && missiles.length === 0) {
    if (recoverLeft < 0) recoverLeft = COMBAT.barrageRecover
    recoverLeft -= dt
    if (recoverLeft <= 0) {
      active = false
      if (game.attackWarning === 'MISSILES') game.attackWarning = ''
      console.log('[barrage] done')
    }
  }
}
