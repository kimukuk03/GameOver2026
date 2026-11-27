// Overall fight progression shared by every module and the HUD.
import { COMBAT } from './config'

export type GamePhase =
  | 'GROUND_COMBAT' // arm free: dodge the slam
  | 'ARM_CLIMB' // arm pinned / lifting: climb it and break the shoulder joint
  | 'ARM_DESTROYED' // arm severed (falling, then lying on the ground): reach the launcher
  | 'MISSILE_AIM' // player is driving the fallen launcher
  | 'MISSILE_FLIGHT' // a missile is in the air
  | 'CORE_EXPOSED' // chest armor just destroyed (recoil)
  | 'BOSS_STAGGERED' // sinking to its knees
  | 'CORE_COMBAT' // kneeling and bowed: reach and destroy the core
  | 'BOSS_DYING' // death sequence
  | 'VICTORY'
  | 'PLAYER_DEAD' // player HP reached 0: fade out, MISSION FAILED
  | 'RESETTING'

function fresh() {
  return {
    phase: 'GROUND_COMBAT' as GamePhase,
    /** true while the severed arm is still tumbling */
    armFalling: false,
    /** player is close enough to the shoulder weak point to strike it */
    nearShoulder: false,
    /** player is close enough to hijack the fallen launcher */
    nearLauncher: false,
    /** current aim ray would hit the chest armor */
    aimOnTarget: false,
    /** player is within striking distance of the exposed core */
    nearCore: false,
    /** seconds until the launcher can fire again */
    reloadLeft: 0,
    /** clear timer: starts with the first slam, stops when the core is destroyed */
    timerRunning: false,
    timerStarted: false,
    elapsed: 0,
    clearTime: 0,
    // ---- player ----
    hp: COMBAT.playerMaxHp,
    invulnLeft: 0,
    /** 0..1 red screen overlay after a hit */
    hurtFlash: 0,
    /** 0..1 black overlay after death */
    deathFade: 0,
    failedShown: false,
    /** player is driving the launcher (avatar frozen - never damaged) */
    aiming: false,
    /** boss attack currently threatening the player (objective / warnings) */
    attackWarning: '' as '' | 'MISSILES' | 'SLAM' | 'SWEEP',
    /** controls guide shown at the start of a round */
    guideLeft: 15,
    message: '',
    messageTimeLeft: 0,
    messageBig: false
  }
}

export const game = fresh()

export function resetGameState() {
  Object.assign(game, fresh())
}

export function setPhase(p: GamePhase) {
  if (game.phase === p) return
  console.log(`[game] ${game.phase} -> ${p}`)
  game.phase = p
}

/** Fight is over or being reset: gameplay input must be ignored. */
export function fightOver() {
  return game.phase === 'BOSS_DYING' || game.phase === 'VICTORY' || game.phase === 'RESETTING' || game.phase === 'PLAYER_DEAD'
}

export function flash(msg: string, seconds = 3, big = false) {
  game.message = msg
  game.messageTimeLeft = seconds
  game.messageBig = big
}

export function startTimer() {
  if (game.timerStarted) return
  game.timerStarted = true
  game.timerRunning = true
  game.elapsed = 0
}

export function stopTimer() {
  if (!game.timerRunning) return
  game.timerRunning = false
  game.clearTime = game.elapsed
}

export function formatTime(sec: number): string {
  const s = Math.floor(sec)
  const mm = Math.floor(s / 60)
  const ss = s % 60
  return `${mm < 10 ? '0' : ''}${mm}:${ss < 10 ? '0' : ''}${ss}`
}

export function gameClockSystem(dt: number) {
  if (game.messageTimeLeft > 0) {
    game.messageTimeLeft -= dt
    if (game.messageTimeLeft <= 0) game.message = ''
  }
  if (game.timerRunning) game.elapsed += dt
  if (game.guideLeft > 0) game.guideLeft -= dt
}

/** Objective line shown at the top of the screen. */
export function objectiveText(): string {
  switch (game.phase) {
    case 'GROUND_COMBAT':
      return game.attackWarning === 'MISSILES' ? 'DODGE THE MISSILES' : 'DODGE THE SLAM'
    case 'ARM_CLIMB':
      return game.nearShoulder ? 'DESTROY THE SHOULDER JOINT' : 'CLIMB THE ARM'
    case 'ARM_DESTROYED':
      return 'HIJACK THE MISSILE LAUNCHER'
    case 'MISSILE_AIM':
      return game.aimOnTarget ? 'FIRE!' : 'AIM AT THE CHEST'
    case 'MISSILE_FLIGHT':
      return 'FIRE!'
    case 'CORE_EXPOSED':
      return 'CORE EXPOSED'
    case 'BOSS_STAGGERED':
      return 'THE TITAN IS DOWN!'
    case 'CORE_COMBAT':
      return game.nearCore ? 'DESTROY THE CORE' : 'APPROACH THE CORE'
    case 'BOSS_DYING':
    case 'VICTORY':
      return 'TITAN DESTROYED'
    case 'PLAYER_DEAD':
      return 'MISSION FAILED'
    case 'RESETTING':
      return ''
  }
}
