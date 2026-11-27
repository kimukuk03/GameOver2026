// Tunable values for the boss fight prototype. Change these to tweak the fight.

export const BOSS_CONFIG = {
  /** World position of the boss root (feet center). The boss faces world -Z (toward the spawn). */
  rootPosition: { x: 32, y: 0, z: 50 },

  // ---- Slam attack timing (seconds) ----
  /** Delay before the very first attack after the scene loads (the first attack is always the slam) */
  firstAttackDelay: 5,
  /** Rest time after the arm returns before the missile barrage starts */
  attackInterval: 3,
  /** Telegraph + wind-up time (danger zone visible, arm raising) */
  windupTime: 2.5,
  /** Downswing duration */
  slamTime: 0.45,
  /** How long the arm stays pinned to the ground (climb window) */
  pinnedTime: 20,
  /** Time for the arm to lift back to its rest pose */
  returnTime: 3.5,

  // ---- Arm geometry (meters) ----
  upperArmLength: 20,
  forearmLength: 22,
  handLength: 8,

  // ---- Shoulder weak point ----
  /** Hits needed to destroy the shoulder joint */
  weakPointHits: 3,
  /** Max distance (m) between the player avatar and the weak point for a hit to count */
  weakPointReach: 7,

  // ---- Severed arm fall ----
  /** Tumble time from the shoulder to the ground (s) */
  armFallTime: 2.4,
  /** Small rebound after the impact (s) */
  armBounceTime: 0.45,
  /** Knockback applied to a player near the shoulder when it breaks (pushes them off the arm) */
  severKnockback: 18,

  // ---- Fallen arm layout (world XZ, degrees). Upper arm stays put; the forearm aims about the elbow. ----
  /** World XZ of the elbow joint once the arm has settled */
  fallenElbow: { x: 20, z: 14 },
  /** Direction the upper arm points from the shoulder end toward the elbow (compass yaw, deg) */
  fallenUpperArmYaw: 53,
  /** Initial forearm yaw offset from a perfect chest aim, so the player has to aim (deg) */
  fallenAimOffset: 16,

  // ---- Missile launcher hijack ----
  /** Distance (m) from the launcher at which the player can press E to take control */
  launcherInteractDistance: 6,
  /** Aim rotation speed with A/D (deg/s) */
  aimYawSpeed: 22,
  /** Max aim deviation either side of the chest bearing (deg) */
  aimYawRange: 40,
  /** Missile speed (m/s) */
  missileSpeed: 32,
  /** Reload time between shots (s) */
  missileReload: 1.5,
  /** A missile is removed after this many seconds */
  missileLifetime: 5,
  /** Extra margin (m) added around the chest armor box for a hit */
  missileHitTolerance: 1.0,
  /** Safety: aim mode releases the camera automatically after this long (s) */
  aimModeTimeout: 180,

  // ---- Chest hit reaction ----
  staggerPushBack: 2.5,
  staggerLeanDeg: 16,
  /** Recoil time after the chest hit before the boss starts to kneel (s) */
  staggerTime: 1.4,
  /** Time to sink to its knees and bow forward (s) */
  kneelTime: 4.0,

  // ---- Core fight ----
  /** Hits needed to destroy the exposed core */
  coreHp: 5,
  /**
   * Max distance (m) from the player to the core for a hit to count.
   * Measured from the avatar's chest (feet + 1 m) to the core's surface.
   */
  coreReach: 3,

  // ---- Death sequence (seconds from the final core hit) ----
  deathChargeTime: 1.2,
  deathChainStart: 1.5,
  deathCollapseStart: 2.6,
  deathCollapseTime: 1.5,
  deathVictoryAt: 5.2,

  gravity: 20
}

/** Player health and boss attack damage. */
export const COMBAT = {
  playerMaxHp: 100,
  /** Invulnerability after any hit (s) */
  invulnTime: 1.0,
  /** Knockback strength applied with a hit (also pushes the player out of the arm) */
  hitKnockback: 12,

  // Slam (right arm) - damage zone = the red rectangle under the forearm + hand
  slamDamage: 40,

  // Missile barrage (right-arm launcher, before the arm is severed)
  barrageDamage: 25,
  barrageCount: 3,
  /** Seconds between launches (keep > invulnTime so every missile counts) */
  barrageInterval: 1.1,
  /** Missile flight time from launch to impact = warning time on the ground marker (s) */
  barrageFlightTime: 1.7,
  /** Radius of the red impact circle and of the damage (m) */
  barrageRadius: 3.5,
  /** Max random offset of an impact point from the player's position at launch (m) */
  barrageSpread: 2.5,
  /** Pause after the last impact before the slam wind-up (s) */
  barrageRecover: 1.0,

  // Left-arm sweep (after the right arm is severed, until the chest armor breaks)
  sweepDamage: 30,
  /** Delay after the severed arm lands before the first sweep (s) */
  sweepFirstDelay: 3,
  /** Rest between sweeps (s) */
  sweepCooldown: 4,
  /** Extra rest after the player leaves launcher aim mode (s) */
  sweepAfterAimGrace: 2.5,
  sweepRaiseTime: 1.8,
  sweepDropTime: 0.35,
  sweepTime: 1.0,
  sweepRecoverTime: 1.2,
  /**
   * Swept fan, measured from the left shoulder: yaw range (deg, 0 = boss forward, + = toward boss right).
   * -30..12 keeps the 40 m arm inside the 64 m scene and covers the path from the spawn to the fallen launcher
   * without touching the launcher itself.
   */
  sweepYawStart: -30,
  sweepYawEnd: 12,
  /** Radial band (m from the shoulder axis) where the arm is low enough to hit a standing player */
  sweepInnerRadius: 23,
  sweepOuterRadius: 40,

  /** Fade to black before the MISSION FAILED panel (s) */
  deathFadeTime: 1.5
}

/** Player start / restart position (world) and where the camera looks */
export const SPAWN = { position: { x: 46, y: 0.2, z: 4.5 }, lookAt: { x: 32, y: 14, z: 50 } }

/** Debug keys 1-4 and the HUD debug line. Set to false before final submission. */
export const DEBUG_KEYS = true

/**
 * Joint pitch angles in degrees (rotation about the local X axis, positive = pointing down).
 * Elbow and wrist angles are relative to the parent segment.
 * The SLAM pose is tuned so the arm forms a continuous ~30° ramp from the ground to the shoulder:
 * absolute segment slopes are upper arm 32°, forearm 28.5°, hand 15°.
 */
export const ARM_POSES = {
  rest: { shoulder: 70, elbow: -95, wrist: -10 },
  windup: { shoulder: -50, elbow: -5, wrist: 0 },
  slam: { shoulder: 32, elbow: -3.5, wrist: -13.5 }
}

export type ArmPose = { shoulder: number; elbow: number; wrist: number }
