// Exposed core fight, approach guides, death sequence and victory trigger.
import {
  engine,
  Entity,
  Transform,
  MeshRenderer,
  MeshCollider,
  Material,
  MaterialTransparencyMode,
  Name,
  ColliderLayer,
  pointerEventsSystem,
  InputAction,
  PointerLock,
  Physics
} from '@dcl/sdk/ecs'
import { Vector3, Color4, Color3, Quaternion } from '@dcl/sdk/math'
import { movePlayerTo } from '~system/RestrictedActions'
import { BOSS_CONFIG as C } from './config'
import { game, setPhase, flash, stopTimer } from './gameState'
import { parts, bossState, coreWorld, CORE_RADIUS } from './bossParts'
import { startCollapse, jointPoints, setInstability, bodyMode } from './bossBody'
import { v, setMat, setSolid, isUnder, worldPose } from './utils'
import { burst, SPARKS, FIRE, SMOKE, DUST, flashSphere, shake, loopEmitter, addTemp } from './fx'

let coreArmed = false
let pulseT = 0
let hitFlash = 0
let guides: Entity[] = []
let lingering: Entity[] = []
let deathT = -1
let chainIdx = 0
let chainPoints: Vector3[] = []
let lightsOff = 0
let collapseStarted = false
let impactDone = false
let chargeSparkClock = 0

export function resetCore() {
  if (coreArmed) pointerEventsSystem.removeOnPointerDown(parts.core)
  coreArmed = false
  for (const e of guides) engine.removeEntity(e)
  for (const e of lingering) engine.removeEntityWithChildren(e)
  guides = []
  lingering = []
  pulseT = 0
  hitFlash = 0
  deathT = -1
  chainIdx = 0
  chainPoints = []
  lightsOff = 0
  collapseStarted = false
  impactDone = false
  chargeSparkClock = 0
}

// ---------------------------------------------------------------------------
// Groggy reached: arm the core and show the way to it
// ---------------------------------------------------------------------------
export function onKneelDone() {
  if (game.phase !== 'BOSS_STAGGERED') return
  setPhase('CORE_COMBAT')
  if (!coreArmed) {
    coreArmed = true
    MeshCollider.setSphere(parts.core, ColliderLayer.CL_POINTER)
    pointerEventsSystem.onPointerDown(
      {
        entity: parts.core,
        // camera-based pointer range; the real 3 m reach check is done against the avatar below
        opts: { button: InputAction.IA_POINTER, hoverText: 'Strike the core', maxDistance: C.coreReach + 9 }
      },
      onCoreHit
    )
  }
  buildGuides()
  flash('The titan is down! Get under its chest and strike the core', 4)
}

function glowMat(e: Entity, c: Color3, alpha: number, intensity: number) {
  Material.setPbrMaterial(e, {
    albedoColor: Color4.create(c.r, c.g, c.b, alpha),
    emissiveColor: c,
    emissiveIntensity: intensity,
    transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND
  })
}

function buildGuides() {
  const core = coreWorld()
  const cyan = Color3.create(0.3, 1, 1)
  // soft glowing ring on the ground right under the core
  const disc = engine.addEntity()
  Name.create(disc, { value: 'Guide_CoreDisc' })
  Transform.create(disc, { position: v(core.x, 0.04, core.z), scale: v(5, 0.02, 5) })
  MeshRenderer.setCylinder(disc)
  glowMat(disc, cyan, 0.3, 1.2)
  guides.push(disc)
  // faint light column from the ground to the core
  const beamH = Math.max(0.5, core.y - CORE_RADIUS)
  const beam = engine.addEntity()
  Name.create(beam, { value: 'Guide_CoreBeam' })
  Transform.create(beam, { position: v(core.x, beamH / 2, core.z), scale: v(0.25, beamH, 0.25) })
  MeshRenderer.setCylinder(beam)
  glowMat(beam, cyan, 0.35, 2)
  guides.push(beam)
  // trail of glowing dots leading in from the open front (boss forward = world -Z)
  for (let i = 1; i <= 4; i++) {
    const dot = engine.addEntity()
    Name.create(dot, { value: `Guide_Dot${i}` })
    Transform.create(dot, { position: v(core.x, 0.04, core.z - 4 - i * 4), scale: v(1.6, 0.02, 1.6) })
    MeshRenderer.setCylinder(dot)
    glowMat(dot, cyan, 0.25, 1)
    guides.push(dot)
  }
}

function removeGuides() {
  for (const e of guides) engine.removeEntity(e)
  guides = []
}

// ---------------------------------------------------------------------------
// Core hits
// ---------------------------------------------------------------------------
/** Distance from the avatar's chest (feet + 1 m) to the core surface. */
function coreDistance(): number {
  const p = Transform.getOrNull(engine.PlayerEntity)
  if (!p) return 999
  return Vector3.distance(Vector3.add(p.position, v(0, 1, 0)), coreWorld()) - CORE_RADIUS
}

function onCoreHit() {
  if (game.phase !== 'CORE_COMBAT' || bossState.coreDestroyed || bossState.coreHp <= 0) return
  const d = coreDistance()
  if (d > C.coreReach) {
    flash(`Too far from the core (${d.toFixed(1)} m) - get within ${C.coreReach} m`, 2)
    return
  }
  bossState.coreHp -= 1
  const core = coreWorld()
  console.log(`[core] hit, hp ${bossState.coreHp} (dist ${d.toFixed(1)})`)
  burst(core, SPARKS(45))
  flashSphere(core, Color3.create(1, 1, 1), 2, 6, 0.25)
  shake(0.15, 0.2)
  hitFlash = 0.1
  setInstability(1 - bossState.coreHp / C.coreHp)
  if (bossState.coreHp <= 0) startDeath()
  else if (bossState.coreHp === 1) flash('ONE MORE HIT!', 1.5)
}

/** Core color per remaining hp (index = hp). */
const CORE_COLORS: Color3[] = [
  Color3.create(1, 1, 1),
  Color3.create(1, 0.12, 0.08),
  Color3.create(1, 0.5, 0.1),
  Color3.create(1, 0.9, 0.25),
  Color3.create(0.5, 1, 0.6),
  Color3.create(0.3, 1, 1)
]

function coreColor(hp: number): Color3 {
  return CORE_COLORS[Math.max(0, Math.min(CORE_COLORS.length - 1, Math.round((hp / C.coreHp) * 5)))]
}

// ---------------------------------------------------------------------------
// Death sequence (~5 s)
// ---------------------------------------------------------------------------
function startDeath() {
  if (bossState.coreDestroyed) return
  bossState.coreDestroyed = true
  stopTimer()
  setPhase('BOSS_DYING')
  pointerEventsSystem.removeOnPointerDown(parts.core)
  coreArmed = false
  removeGuides()
  setInstability(1)
  // From here the body is scenery: no collider can trap the player while it falls.
  setSolid(bossColliders(), false)
  deathT = 0
  chainIdx = 0
  chainPoints = jointPoints()
  flashSphere(coreWorld(), Color3.create(0.6, 1, 1), 16, 1.5, C.deathChargeTime) // energy gathering in
  flash('CORE DESTROYED!', 2.5, true)
  console.log('[core] destroyed - death sequence')
}

function bossColliders(): Entity[] {
  const out: Entity[] = []
  for (const [e] of engine.getEntitiesWith(MeshCollider)) if (isUnder(e, parts.root)) out.push(e)
  return out
}

function lightOff(e: Entity | undefined) {
  if (e === undefined || !Transform.has(e)) return
  setMat(e, { color: Color4.create(0.08, 0.08, 0.08, 1), emissive: Color3.Black(), emissiveIntensity: 0 })
}

/** If the avatar is where the torso will land, slide it out to the open front first. */
function clearPlayerFromCollapse() {
  const p = Transform.getOrNull(engine.PlayerEntity)
  if (!p || p.position.y > 9) return
  const chest = worldPose(parts.chest).position
  const dx = p.position.x - chest.x
  const dz = p.position.z - chest.z
  if (Math.hypot(dx, dz) < 13) {
    const target = v(chest.x + (dx >= 0 ? 6 : -6), 0.3, chest.z - 20)
    console.log(`[core] moving player clear of the falling body to ${target.x.toFixed(1)},${target.z.toFixed(1)}`)
    void movePlayerTo({ newRelativePosition: target, cameraTarget: v(chest.x, 6, chest.z) })
  }
}

export function onCollapseDone() {
  if (impactDone) return
  impactDone = true
  const chest = worldPose(parts.chest).position
  const ground = (p: Vector3) => v(p.x, 0.5, p.z)
  burst(ground(chest), DUST(120, 6))
  burst(ground(worldPose(parts.head).position), DUST(60, 3))
  burst(ground(worldPose(parts.pelvis).position), DUST(60, 3))
  burst(ground(worldPose(parts.leftArm.elbow).position), DUST(50, 3))
  shake(0.8, 0.8)
  spawnDebris(chest)
  // only smoke remains
  for (const pos of [v(chest.x, 2, chest.z), v(chest.x - 6, 2, chest.z + 2)]) {
    const holder = engine.addEntity()
    Transform.create(holder, { position: pos })
    loopEmitter(holder, v(0, 0, 0), { ...SMOKE(60, 2), rate: 8, lifetime: 5, speed: [0.5, 1.5], gravity: -0.1 })
    lingering.push(holder)
  }
}

function spawnDebris(center: Vector3) {
  for (let i = 0; i < 10; i++) {
    const e = engine.addEntity()
    Name.create(e, { value: 'FX_Debris' })
    const s = 0.5 + Math.random() * 1.2
    Transform.create(e, {
      position: v(center.x + (Math.random() - 0.5) * 6, 1.5, center.z + (Math.random() - 0.5) * 6),
      scale: v(s, s * 0.6, s * 1.3)
    })
    MeshRenderer.setBox(e)
    Material.setPbrMaterial(e, { albedoColor: Color4.create(0.22, 0.23, 0.26, 1), metallic: 0.6, roughness: 0.6 })
    let vel = v((Math.random() - 0.5) * 16, 8 + Math.random() * 8, (Math.random() - 0.5) * 16)
    const spin = v(Math.random() * 360, Math.random() * 360, 0)
    let resting = false
    addTemp(e, 25, (_age, _life, dt) => {
      if (resting) return
      const t = Transform.getMutable(e)
      vel = Vector3.add(vel, v(0, -C.gravity * dt, 0))
      t.position = Vector3.add(t.position, Vector3.scale(vel, dt))
      t.rotation = Quaternion.multiply(t.rotation, Quaternion.fromEulerDegrees(spin.x * dt, spin.y * dt, 0))
      if (t.position.y < 0.3) {
        t.position = v(Math.max(1, Math.min(63, t.position.x)), 0.3, Math.max(1, Math.min(63, t.position.z)))
        resting = true
      }
    })
  }
}

// ---------------------------------------------------------------------------
// Per-frame: core glow / pulse, proximity, death timeline
// ---------------------------------------------------------------------------
export function coreSystem(dt: number) {
  if (game.phase === 'RESETTING' || !bossState.armorDestroyed) {
    game.nearCore = false
    return
  }
  const core = parts.core

  if (!bossState.coreDestroyed) {
    // glow color and pulse speed follow the remaining hp; last hp blinks hard
    const hp = bossState.coreHp
    pulseT += dt * (5 + (C.coreHp - hp) * 3)
    const s = 3.6 + 0.35 * Math.sin(pulseT)
    Transform.getMutable(core).scale = v(s, s, s)
    const c = coreColor(hp)
    let intensity = 10 + 3 * Math.sin(pulseT)
    if (hp === 1) intensity = Math.sin(pulseT * 2.5) > 0 ? 22 : 1.5
    if (hitFlash > 0) {
      hitFlash -= dt
      setMat(core, { color: Color4.White(), emissive: Color3.White(), emissiveIntensity: 25, metallic: 0 })
    } else {
      setMat(core, { color: Color4.create(c.r, c.g, c.b, 1), emissive: c, emissiveIntensity: intensity, metallic: 0 })
    }
    game.nearCore = game.phase === 'CORE_COMBAT' && coreDistance() <= C.coreReach
    return
  }

  game.nearCore = false
  if (deathT < 0) return
  deathT += dt

  // 1) energy concentrates: wild flicker, core shrinks, sparks
  if (deathT < C.deathChargeTime) {
    const k = deathT / C.deathChargeTime
    const s = 3.6 - 1.4 * k + (Math.random() - 0.5) * 0.6
    Transform.getMutable(core).scale = v(s, s, s)
    const on = Math.random() < 0.6
    setMat(core, { color: Color4.White(), emissive: Color3.create(0.6, 1, 1), emissiveIntensity: on ? 30 : 2, metallic: 0 })
    chargeSparkClock -= dt
    if (chargeSparkClock <= 0) {
      chargeSparkClock = 0.15
      burst(coreWorld(), SPARKS(20))
    }
    return
  }

  // 2) chest blows out (once)
  if (Transform.get(core).scale.x > 0.05) {
    const p = coreWorld()
    burst(p, FIRE(200, 3))
    burst(p, SMOKE(80, 4))
    burst(p, SPARKS(100))
    flashSphere(p, Color3.create(1, 0.8, 0.5), 2, 26, 1.0)
    shake(1.0, 0.9)
    Transform.getMutable(core).scale = v(0.01, 0.01, 0.01)
    lightOff(core)
    // blast pushes the avatar out from under the chest
    const pl = Transform.getOrNull(engine.PlayerEntity)
    if (pl && Vector3.distance(pl.position, p) < 14) Physics.applyKnockbackToPlayer(p, 22, 14)
    console.log('[core] chest explosion')
  }

  // 3) chain of small explosions along the joints
  const chainTime = C.deathChainStart + chainIdx * 0.22
  if (chainIdx < chainPoints.length && deathT >= chainTime) {
    const p = chainPoints[chainIdx]
    burst(p, FIRE(45, 0.8))
    burst(p, SPARKS(25))
    chainIdx++
  }

  // 4) lights go out one after another
  const offs: Array<[number, Entity | undefined]> = [
    [2.0, parts.visor],
    [2.25, parts.stumpCore],
    [2.5, parts.weakPoint]
  ]
  while (lightsOff < offs.length && deathT >= offs[lightsOff][0]) {
    lightOff(offs[lightsOff][1])
    lightsOff++
  }

  // 5) collapse to the ground (impact effects fire from onCollapseDone)
  if (!collapseStarted && deathT >= C.deathCollapseStart) {
    collapseStarted = true
    clearPlayerFromCollapse()
    startCollapse()
  }

  // 6) victory screen
  if (deathT >= C.deathVictoryAt && bodyMode() === 'DEAD' && game.phase === 'BOSS_DYING') {
    setPhase('VICTORY')
    // free the cursor so the PLAY AGAIN button can be clicked
    PointerLock.createOrReplace(engine.CameraEntity, { isPointerLocked: false })
    console.log('[core] victory')
  }
}
