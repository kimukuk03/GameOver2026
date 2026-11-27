// Temporary VFX: particle bursts, expanding flash spheres, camera shake.
import {
  engine,
  Entity,
  Transform,
  MeshRenderer,
  Material,
  MaterialTransparencyMode,
  ParticleSystem,
  PBParticleSystem_BlendMode,
  PBParticleSystem_SimulationSpace,
  VirtualCamera,
  MainCamera,
  Name
} from '@dcl/sdk/ecs'
import { Vector3, Quaternion, Color4, Color3 } from '@dcl/sdk/math'
import { lerp } from './utils'

// ---------------------------------------------------------------------------
// Lifetime tracking for temporary entities
// ---------------------------------------------------------------------------
type TempUpdate = (age: number, life: number, dt: number) => void
type Temp = { e: Entity; ttl: number; update?: TempUpdate; life: number; age: number }
const temps: Temp[] = []

export function addTemp(e: Entity, life: number, update?: TempUpdate) {
  temps.push({ e, ttl: life, life, age: 0, update })
}

/** Remove every temporary effect entity and release any shake camera (used by PLAY AGAIN). */
export function resetFx() {
  for (const t of temps) engine.removeEntityWithChildren(t.e)
  temps.length = 0
  if (tempCam) {
    const mc = MainCamera.getMutableOrNull(engine.CameraEntity)
    if (mc && mc.virtualCameraEntity === tempCam) mc.virtualCameraEntity = undefined
    engine.removeEntity(tempCam)
    tempCam = undefined
  }
  externalCam = undefined
  shakeLeft = 0
  shakeAmp = 0
}

// ---------------------------------------------------------------------------
// Particle bursts
// ---------------------------------------------------------------------------
export type BurstOpts = {
  count: number
  colorStart: Color4
  colorEnd: Color4
  size: [number, number]
  speed: [number, number]
  lifetime: number
  radius?: number
  gravity?: number
  additive?: boolean
  sizeEnd?: number
}

export function burst(pos: Vector3, o: BurstOpts): Entity {
  const e = engine.addEntity()
  Name.create(e, { value: 'FX_Burst' })
  Transform.create(e, { position: pos })
  ParticleSystem.create(e, {
    active: true,
    loop: false,
    rate: 0,
    lifetime: o.lifetime,
    maxParticles: o.count,
    initialSize: { start: o.size[0], end: o.size[1] },
    sizeOverTime: { start: 1, end: o.sizeEnd ?? 0.2 },
    initialColor: { start: o.colorStart, end: o.colorStart },
    colorOverTime: { start: o.colorStart, end: o.colorEnd },
    initialVelocitySpeed: { start: o.speed[0], end: o.speed[1] },
    gravity: o.gravity ?? 0,
    blendMode: o.additive ? PBParticleSystem_BlendMode.PSB_ADD : PBParticleSystem_BlendMode.PSB_ALPHA,
    simulationSpace: PBParticleSystem_SimulationSpace.PSS_WORLD,
    shape: ParticleSystem.Shape.Sphere({ radius: o.radius ?? 0.5 }),
    bursts: { values: [{ time: 0, count: o.count, cycles: 1, interval: 0.01, probability: 1 }] }
  })
  addTemp(e, o.lifetime + 0.5)
  return e
}

export const SPARKS = (count = 40): BurstOpts => ({
  count,
  colorStart: Color4.create(1, 0.85, 0.3, 1),
  colorEnd: Color4.create(1, 0.3, 0, 0),
  size: [0.12, 0.3],
  speed: [6, 14],
  lifetime: 0.7,
  radius: 0.3,
  gravity: 1.5,
  additive: true
})

export const DUST = (count = 80, radius = 3): BurstOpts => ({
  count,
  colorStart: Color4.create(0.55, 0.5, 0.45, 0.8),
  colorEnd: Color4.create(0.4, 0.38, 0.35, 0),
  size: [2, 4],
  speed: [3, 8],
  lifetime: 2.2,
  radius,
  gravity: -0.05,
  sizeEnd: 1.8
})

export const FIRE = (count = 120, radius = 1.5): BurstOpts => ({
  count,
  colorStart: Color4.create(1, 0.6, 0.15, 1),
  colorEnd: Color4.create(0.3, 0.05, 0, 0),
  size: [1.2, 3],
  speed: [6, 16],
  lifetime: 1.2,
  radius,
  gravity: -0.2,
  additive: true,
  sizeEnd: 0.4
})

export const SMOKE = (count = 60, radius = 2): BurstOpts => ({
  count,
  colorStart: Color4.create(0.2, 0.2, 0.2, 0.8),
  colorEnd: Color4.create(0.1, 0.1, 0.1, 0),
  size: [3, 5],
  speed: [2, 6],
  lifetime: 3,
  radius,
  gravity: -0.15,
  sizeEnd: 2
})

/** Looping emitter (caller owns it). */
export function loopEmitter(parent: Entity, pos: Vector3, o: BurstOpts & { rate: number }): Entity {
  const e = engine.addEntity()
  Name.create(e, { value: 'FX_Loop' })
  Transform.create(e, { parent, position: pos })
  ParticleSystem.create(e, {
    active: true,
    loop: true,
    rate: o.rate,
    lifetime: o.lifetime,
    maxParticles: o.count,
    initialSize: { start: o.size[0], end: o.size[1] },
    sizeOverTime: { start: 1, end: o.sizeEnd ?? 0.2 },
    initialColor: { start: o.colorStart, end: o.colorStart },
    colorOverTime: { start: o.colorStart, end: o.colorEnd },
    initialVelocitySpeed: { start: o.speed[0], end: o.speed[1] },
    gravity: o.gravity ?? 0,
    blendMode: o.additive ? PBParticleSystem_BlendMode.PSB_ADD : PBParticleSystem_BlendMode.PSB_ALPHA,
    simulationSpace: PBParticleSystem_SimulationSpace.PSS_WORLD,
    shape: ParticleSystem.Shape.Sphere({ radius: o.radius ?? 0.3 })
  })
  return e
}

// ---------------------------------------------------------------------------
// Expanding flash sphere
// ---------------------------------------------------------------------------
export function flashSphere(pos: Vector3, color: Color3, fromSize: number, toSize: number, duration: number) {
  const e = engine.addEntity()
  Name.create(e, { value: 'FX_Flash' })
  Transform.create(e, { position: pos, scale: Vector3.create(fromSize, fromSize, fromSize) })
  MeshRenderer.setSphere(e)
  const apply = (alpha: number) =>
    Material.setPbrMaterial(e, {
      albedoColor: Color4.create(color.r, color.g, color.b, alpha),
      emissiveColor: color,
      emissiveIntensity: 6 * alpha,
      transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND
    })
  apply(0.9)
  addTemp(e, duration, (age, life) => {
    const t = age / life
    const s = lerp(fromSize, toSize, 1 - Math.pow(1 - t, 2))
    Transform.getMutable(e).scale = Vector3.create(s, s, s)
    apply(0.9 * (1 - t))
  })
}

// ---------------------------------------------------------------------------
// Camera shake
// A scene cannot move the player's own camera, so shaking uses a VirtualCamera:
// - when another module owns an active VirtualCamera (the launcher aim cam) it reads shakeOffset()
// - otherwise a temporary VirtualCamera is placed at the current camera pose, jittered, then released.
// ---------------------------------------------------------------------------
let shakeLeft = 0
let shakeDur = 1
let shakeAmp = 0
let externalCam: Entity | undefined
let tempCam: Entity | undefined
let tempBase = Vector3.Zero()

export function setExternalCamera(e: Entity | undefined) {
  externalCam = e
}

export function shake(amplitude: number, duration: number) {
  shakeAmp = Math.max(amplitude, shakeLeft > 0 ? shakeAmp : 0)
  shakeLeft = Math.max(duration, shakeLeft)
  shakeDur = shakeLeft
  if (externalCam || tempCam) return
  const cam = Transform.getOrNull(engine.CameraEntity)
  if (!cam) return
  tempBase = Vector3.clone(cam.position)
  tempCam = engine.addEntity()
  Name.create(tempCam, { value: 'FX_ShakeCam' })
  Transform.create(tempCam, { position: tempBase, rotation: cam.rotation })
  VirtualCamera.create(tempCam, { fov: 60, defaultTransition: { transitionMode: VirtualCamera.Transition.Time(0) } })
  MainCamera.createOrReplace(engine.CameraEntity, { virtualCameraEntity: tempCam })
}

export function shakeOffset(): Vector3 {
  if (shakeLeft <= 0) return Vector3.Zero()
  const a = shakeAmp * (shakeLeft / shakeDur)
  return Vector3.create((Math.random() - 0.5) * 2 * a, (Math.random() - 0.5) * 2 * a, (Math.random() - 0.5) * 2 * a)
}

function releaseTempCam() {
  if (!tempCam) return
  const cam = tempCam
  tempCam = undefined
  const mc = MainCamera.getMutableOrNull(engine.CameraEntity)
  if (mc && mc.virtualCameraEntity === cam) mc.virtualCameraEntity = undefined
  // Delete after the 0.5 s blend back to the player camera.
  addTemp(cam, 1.0)
}

/** Yaw-only look rotation helper used by cameras. */
export function lookRotation(from: Vector3, to: Vector3): Quaternion {
  return Quaternion.fromLookAt(from, to)
}

engine.addSystem((dt: number) => {
  for (let i = temps.length - 1; i >= 0; i--) {
    const t = temps[i]
    t.age += dt
    t.ttl -= dt
    if (t.update && t.ttl > 0) t.update(t.age, t.life, dt)
    if (t.ttl <= 0) {
      engine.removeEntity(t.e)
      temps.splice(i, 1)
    }
  }

  if (shakeLeft > 0) {
    shakeLeft -= dt
    if (tempCam) {
      Transform.getMutable(tempCam).position = Vector3.add(tempBase, shakeOffset())
      if (shakeLeft <= 0) releaseTempCam()
    }
  }
})
