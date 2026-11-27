// Player health kept by the scene (the Decentraland avatar itself has no HP).
import { engine, Transform, InputModifier, PointerLock, Physics } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import { movePlayerTo } from '~system/RestrictedActions'
import { COMBAT } from './config'
import { game, setPhase, flash, fightOver, stopTimer } from './gameState'

export type DamageSource = 'SLAM' | 'MISSILE' | 'SWEEP' | 'DEBUG'

/** Can the player be hurt right now? (alive, fight running, not frozen in launcher aim mode) */
export function canBeHurt(): boolean {
  return !fightOver() && !game.aiming && game.hp > 0
}

/**
 * Apply boss damage. Returns true if it landed.
 * `from` is the hit origin used for a small knockback (also pushes the avatar out of the attacking limb).
 */
export function damagePlayer(amount: number, source: DamageSource, from?: Vector3): boolean {
  if (!canBeHurt()) return false
  if (game.invulnLeft > 0) {
    console.log(`[player] ${source} blocked by invulnerability (${game.invulnLeft.toFixed(2)}s left)`)
    return false
  }
  game.hp = Math.max(0, game.hp - amount)
  game.invulnLeft = COMBAT.invulnTime
  game.hurtFlash = 1
  console.log(`[player] hit by ${source} for ${amount}, hp ${game.hp}`)
  if (from) {
    const p = Transform.getOrNull(engine.PlayerEntity)
    if (p) {
      // knock away horizontally only (source at the player's height): no lift that could carry them over a wall
      Physics.applyKnockbackToPlayer(Vector3.create(from.x, p.position.y, from.z), COMBAT.hitKnockback, 30)
    }
  }
  if (game.hp <= 0) killPlayer()
  return true
}

function killPlayer() {
  console.log('[player] defeated')
  setPhase('PLAYER_DEAD')
  stopTimer()
  game.attackWarning = ''
  game.deathFade = 0
  game.failedShown = false
  // no more movement or attacks; launcher aim mode is closed by launcherSystem (fightOver)
  InputModifier.createOrReplace(engine.PlayerEntity, { mode: InputModifier.Mode.Standard({ disableAll: true }) })
  flash('YOU WERE DEFEATED', 2, false)
}

// Invisible barriers (main.composite) stand at 0.6-1.1 m from each scene edge. This guard only fires if the avatar
// still got past them while it is inside the scene (restricted actions do nothing once the player has left the scene).
const ARENA_MIN = 0.9
const ARENA_MAX = 63.1
let boundsCooldown = 0

/** Knockback (or a jump over the 1 m wall) must never leave the player outside the arena during the fight. */
function keepInArena(dt: number) {
  if (boundsCooldown > 0) {
    boundsCooldown -= dt
    return
  }
  const p = Transform.getOrNull(engine.PlayerEntity)
  if (!p) return
  const { x, z } = p.position
  if (x >= ARENA_MIN && x <= ARENA_MAX && z >= ARENA_MIN && z <= ARENA_MAX) return
  const cx = Math.max(2.5, Math.min(61.5, x))
  const cz = Math.max(2.5, Math.min(61.5, z))
  console.log(`[player] left the arena at ${x.toFixed(1)},${z.toFixed(1)} - bringing back to ${cx.toFixed(1)},${cz.toFixed(1)}`)
  void movePlayerTo({ newRelativePosition: Vector3.create(cx, Math.max(0.3, p.position.y), cz) })
  boundsCooldown = 1
}

export function playerSystem(dt: number) {
  if (game.phase === 'RESETTING') return
  keepInArena(dt)
  if (game.invulnLeft > 0) game.invulnLeft = Math.max(0, game.invulnLeft - dt)
  if (game.hurtFlash > 0) game.hurtFlash = Math.max(0, game.hurtFlash - dt / 0.45)
  if (game.phase === 'PLAYER_DEAD' && !game.failedShown) {
    game.deathFade = Math.min(0.75, game.deathFade + (0.75 * dt) / COMBAT.deathFadeTime)
    if (game.deathFade >= 0.75) {
      game.failedShown = true
      // free the cursor so TRY AGAIN can be clicked
      PointerLock.createOrReplace(engine.CameraEntity, { isPointerLocked: false })
    }
  }
}
