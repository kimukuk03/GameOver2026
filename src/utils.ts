import { engine, Entity, Transform, MeshRenderer, MeshCollider, Material, Name, ColliderLayer } from '@dcl/sdk/ecs'
import { Vector3, Quaternion, Color4, Color3 } from '@dcl/sdk/math'

export const v = Vector3.create
export const pitch = (deg: number) => Quaternion.fromEulerDegrees(deg, 0, 0)
export const yawQ = (deg: number) => Quaternion.fromEulerDegrees(0, deg, 0)
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
export const clamp01 = (t: number) => Math.max(0, Math.min(1, t))
export const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2)
export const easeIn = (t: number) => t * t * t
export const easeOut = (t: number) => 1 - Math.pow(1 - t, 3)

export const conj = (q: Quaternion) => Quaternion.create(-q.x, -q.y, -q.z, q.w)

export type Pose = { position: Vector3; rotation: Quaternion }

/** World position + rotation of an entity, walking up the Transform parent chain (scale applied to positions). */
export function worldPose(e: Entity): Pose {
  const t = Transform.get(e)
  let pos = Vector3.clone(t.position)
  let rot = Quaternion.create(t.rotation.x, t.rotation.y, t.rotation.z, t.rotation.w)
  let parent = t.parent
  while (parent !== undefined && parent !== engine.RootEntity) {
    const pt = Transform.getOrNull(parent)
    if (!pt) break
    pos = Vector3.add(Vector3.rotate(Vector3.multiply(pos, pt.scale), pt.rotation), pt.position)
    rot = Quaternion.multiply(pt.rotation, rot)
    parent = pt.parent
  }
  return { position: pos, rotation: rot }
}

/** Convert a world point into an entity's local frame (entity assumed to have unit scale). */
export function worldToLocal(pose: Pose, point: Vector3): Vector3 {
  return Vector3.rotate(Vector3.subtract(point, pose.position), conj(pose.rotation))
}

/** Slab test: does the segment a->b (local coords) intersect the axis-aligned box center/half? Returns entry t or -1. */
export function segmentBoxT(a: Vector3, b: Vector3, center: Vector3, half: Vector3): number {
  const d = Vector3.subtract(b, a)
  let tmin = 0
  let tmax = 1
  const axes: Array<'x' | 'y' | 'z'> = ['x', 'y', 'z']
  for (const ax of axes) {
    const min = center[ax] - half[ax]
    const max = center[ax] + half[ax]
    if (Math.abs(d[ax]) < 1e-6) {
      if (a[ax] < min || a[ax] > max) return -1
    } else {
      let t1 = (min - a[ax]) / d[ax]
      let t2 = (max - a[ax]) / d[ax]
      if (t1 > t2) {
        const tmp = t1
        t1 = t2
        t2 = tmp
      }
      tmin = Math.max(tmin, t1)
      tmax = Math.min(tmax, t2)
      if (tmin > tmax) return -1
    }
  }
  return tmin
}

// ---------------------------------------------------------------------------
// Primitive builders. Pivots are unscaled; meshes are leaf children.
// ---------------------------------------------------------------------------
export const PHYS_AND_POINTER = [ColliderLayer.CL_PHYSICS, ColliderLayer.CL_POINTER]

export function pivot(name: string, parent: Entity, pos: Vector3, rot: Quaternion = Quaternion.Identity()): Entity {
  const e = engine.addEntity()
  Name.create(e, { value: name })
  Transform.create(e, { parent, position: pos, rotation: rot })
  return e
}

export type ShapeOpts = {
  color: Color4
  collider?: boolean
  emissive?: Color3
  emissiveIntensity?: number
  metallic?: number
}

export function setMat(e: Entity, o: ShapeOpts) {
  Material.setPbrMaterial(e, {
    albedoColor: o.color,
    metallic: o.metallic ?? 0.6,
    roughness: 0.5,
    emissiveColor: o.emissive,
    emissiveIntensity: o.emissiveIntensity
  })
}

export function box(name: string, parent: Entity, pos: Vector3, size: Vector3, o: ShapeOpts, rot?: Quaternion): Entity {
  const e = engine.addEntity()
  Name.create(e, { value: name })
  Transform.create(e, { parent, position: pos, scale: size, rotation: rot ?? Quaternion.Identity() })
  MeshRenderer.setBox(e)
  if (o.collider !== false) MeshCollider.setBox(e, PHYS_AND_POINTER)
  setMat(e, o)
  return e
}

export function sphere(name: string, parent: Entity, pos: Vector3, diameter: number, o: ShapeOpts): Entity {
  const e = engine.addEntity()
  Name.create(e, { value: name })
  Transform.create(e, { parent, position: pos, scale: Vector3.create(diameter, diameter, diameter) })
  MeshRenderer.setSphere(e)
  if (o.collider !== false) MeshCollider.setSphere(e, PHYS_AND_POINTER)
  setMat(e, o)
  return e
}

export function cylinder(name: string, parent: Entity, pos: Vector3, size: Vector3, o: ShapeOpts, rot?: Quaternion): Entity {
  const e = engine.addEntity()
  Name.create(e, { value: name })
  Transform.create(e, { parent, position: pos, scale: size, rotation: rot ?? Quaternion.Identity() })
  MeshRenderer.setCylinder(e)
  if (o.collider !== false) MeshCollider.setCylinder(e, undefined, undefined, PHYS_AND_POINTER)
  setMat(e, o)
  return e
}

/** True if `e` is `root` or one of its Transform descendants. */
export function isUnder(e: Entity, root: Entity): boolean {
  let cur: Entity | undefined = e
  for (let i = 0; i < 32 && cur !== undefined; i++) {
    if (cur === root) return true
    const t = Transform.getOrNull(cur)
    if (!t || t.parent === undefined || t.parent === engine.RootEntity) return false
    cur = t.parent
  }
  return false
}

/** Switch a set of mesh colliders between solid (physics + pointer) and pointer-only. */
export function setSolid(entities: Entity[], solid: boolean) {
  for (const e of entities) {
    const mc = MeshCollider.getMutableOrNull(e)
    if (mc) mc.collisionMask = solid ? ColliderLayer.CL_PHYSICS | ColliderLayer.CL_POINTER : ColliderLayer.CL_POINTER
  }
}
