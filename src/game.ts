// Game setup (systems registered exactly once) and PLAY AGAIN reset.
import { engine, MainCamera, InputModifier, PointerLock } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import { movePlayerTo } from '~system/RestrictedActions'
import { SPAWN, DEBUG_KEYS } from './config'
import { game, setPhase, flash, resetGameState, gameClockSystem } from './gameState'
import { createBoss, destroyBoss, resetBossModule, setOnShoulderDestroyed, slamSystem, bossReactionSystem } from './boss'
import { bodySystem, resetBody, setBodyCallbacks } from './bossBody'
import { severArm, resetArm, fallSystem } from './arm'
import { createLauncherEntities, resetLauncher, launcherSystem, missileSystem } from './launcher'
import { onKneelDone, onCollapseDone, coreSystem, resetCore } from './core'
import { resetFx } from './fx'
import { playerSystem } from './player'
import { bossMissileSystem, cancelBarrage } from './bossMissiles'
import { sweepSystem, resetSweep } from './sweep'
import { debugSystem } from './debug'

export function initGame() {
  setOnShoulderDestroyed(severArm)
  setBodyCallbacks(onKneelDone, onCollapseDone)
  createBoss()
  createLauncherEntities()

  // Systems are added once for the whole session; reset only touches state and entities.
  engine.addSystem(gameClockSystem)
  engine.addSystem(slamSystem)
  engine.addSystem(bossReactionSystem)
  engine.addSystem(bodySystem)
  engine.addSystem(fallSystem)
  engine.addSystem(launcherSystem)
  engine.addSystem(missileSystem)
  engine.addSystem(coreSystem)
  engine.addSystem(playerSystem)
  engine.addSystem(bossMissileSystem)
  engine.addSystem(sweepSystem)
  if (DEBUG_KEYS) engine.addSystem(debugSystem)
}

/** PLAY AGAIN: tear down every fight entity and state, rebuild the boss, send the player to the start. */
export function resetGame() {
  if (game.phase === 'RESETTING') return
  setPhase('RESETTING')
  game.aiming = false
  console.log('[game] reset start')

  // 1) release player controls and cameras first
  resetLauncher()
  cancelBarrage()
  resetCore()
  resetFx()
  const mc = MainCamera.getMutableOrNull(engine.CameraEntity)
  if (mc) mc.virtualCameraEntity = undefined
  InputModifier.deleteFrom(engine.PlayerEntity)

  // 2) remove all boss entities (incl. severed arm, flying armor), then reset module state
  destroyBoss()
  resetBossModule()
  resetBody()
  resetArm()
  resetSweep()
  resetGameState() // phase GROUND_COMBAT, timer, player hp / invulnerability / overlays

  // 3) rebuild
  createBoss()
  createLauncherEntities()

  // 4) player back to the start, looking at the boss, cursor locked for play
  void movePlayerTo({
    newRelativePosition: Vector3.create(SPAWN.position.x, SPAWN.position.y, SPAWN.position.z),
    cameraTarget: Vector3.create(SPAWN.lookAt.x, SPAWN.lookAt.y, SPAWN.lookAt.z)
  })
  PointerLock.createOrReplace(engine.CameraEntity, { isPointerLocked: true })
  flash('Round restarted - dodge the slam!', 3)
  console.log(`[game] reset done, phase ${game.phase}`)
}
