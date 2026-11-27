/** @jsx ReactEcs.createElement */
import ReactEcs, { UiEntity, Label, Button } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
import { bossState } from '../bossParts'
import { game, objectiveText, formatTime } from '../gameState'
import { BOSS_CONFIG as C, COMBAT, DEBUG_KEYS } from '../config'
import { resetGame } from '../game'

function detailText(): string {
  const s = bossState
  switch (game.phase) {
    case 'GROUND_COMBAT':
      if (s.phase === 'BARRAGE') return 'Missiles incoming - get out of the red circles!'
      if (s.phase === 'IDLE') return `Next attack in ${Math.ceil(s.phaseTimeLeft)}s`
      return 'Get out of the red zone!'
    case 'ARM_CLIMB':
      if (s.phase === 'RETURN') return 'The arm is lifting!'
      return `Arm pinned: ${Math.ceil(s.phaseTimeLeft)}s${s.holdPinned ? ' [HOLD]' : ''}  |  Shoulder joint ${s.weakPointHp}/${C.weakPointHits}  (LMB within ${C.weakPointReach} m)`
    case 'ARM_DESTROYED':
      if (game.armFalling) return 'The arm is falling!'
      if (game.attackWarning === 'SWEEP') return 'ARM SWEEP! Get out of the red fan!'
      return game.nearLauncher ? 'Press [E] to take control of the launcher' : 'Find the missile pod on the fallen arm'
    case 'MISSILE_AIM':
      return `A/D: Aim   LMB: Fire   E: Exit${game.reloadLeft > 0 ? `   (reloading ${game.reloadLeft.toFixed(1)}s)` : ''}`
    case 'MISSILE_FLIGHT':
      return 'Missile in flight...'
    case 'CORE_EXPOSED':
      return 'The armor is gone!'
    case 'BOSS_STAGGERED':
      return 'It is falling to its knees...'
    case 'CORE_COMBAT':
      return game.nearCore ? 'LMB: strike the core' : `Walk under its bowed chest - follow the glowing marks (strike within ${C.coreReach} m)`
    case 'BOSS_DYING':
      return 'The core is collapsing...'
    case 'VICTORY':
    case 'PLAYER_DEAD':
    case 'RESETTING':
      return ''
  }
}

const showCoreBar = () => game.phase === 'CORE_COMBAT' || game.phase === 'BOSS_STAGGERED' || game.phase === 'BOSS_DYING'

const CoreBar = () => (
  <UiEntity uiTransform={{ flexDirection: 'row', alignItems: 'center', margin: { top: 6 }, height: 22 }}>
    <Label value="CORE" fontSize={14} color={Color4.create(0.4, 1, 1, 1)} uiTransform={{ width: 50, height: 20 }} />
    {Array.from({ length: C.coreHp }).map((_, i) => (
      <UiEntity
        key={`seg${i}`}
        uiTransform={{ width: 34, height: 14, margin: { left: 3 } }}
        uiBackground={{ color: i < bossState.coreHp ? Color4.create(0.3, 1, 1, 1) : Color4.create(0.25, 0.25, 0.25, 0.8) }}
      />
    ))}
  </UiEntity>
)

/** Player HP bar, bottom center (clear of the explorer's chat on the left). */
const HpBar = () => {
  const frac = Math.max(0, game.hp / COMBAT.playerMaxHp)
  const col = frac > 0.5 ? Color4.create(0.3, 0.9, 0.4, 1) : frac > 0.25 ? Color4.create(1, 0.75, 0.2, 1) : Color4.create(1, 0.25, 0.2, 1)
  return (
    <UiEntity
      uiTransform={{ positionType: 'absolute', position: { bottom: 28, left: '50%' }, margin: { left: -160 }, width: 320, height: 46, flexDirection: 'column', padding: 6 }}
      uiBackground={{ color: Color4.create(0, 0, 0, 0.5) }}
    >
      <Label value={`HP ${Math.ceil(game.hp)} / ${COMBAT.playerMaxHp}`} fontSize={13} color={Color4.White()} uiTransform={{ width: 308, height: 16 }} />
      <UiEntity uiTransform={{ width: 308, height: 12 }} uiBackground={{ color: Color4.create(0.2, 0.2, 0.2, 0.9) }}>
        <UiEntity uiTransform={{ width: `${Math.round(frac * 100)}%`, height: '100%' }} uiBackground={{ color: col }} />
      </UiEntity>
    </UiEntity>
  )
}

/** Short controls guide at the start of a round. */
const Controls = () => (
  <UiEntity
    uiTransform={{ positionType: 'absolute', position: { bottom: 84, left: '50%' }, margin: { left: -260 }, width: 520, height: 30, justifyContent: 'center' }}
    uiBackground={{ color: Color4.create(0, 0, 0, 0.45) }}
  >
    <Label value="WASD: Move    SPACE: Jump    LMB: Attack    E: Interact" fontSize={15} color={Color4.White()} uiTransform={{ width: 520, height: 30 }} />
  </UiEntity>
)

const Victory = () => (
  <UiEntity
    uiTransform={{ width: '100%', height: '100%', positionType: 'absolute', justifyContent: 'center', alignItems: 'center' }}
    uiBackground={{ color: Color4.create(0, 0, 0, 0.55) }}
  >
    <UiEntity
      uiTransform={{ width: 520, height: 330, flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 20 }}
      uiBackground={{ color: Color4.create(0.05, 0.07, 0.1, 0.92) }}
    >
      <Label value="TITAN DESTROYED" fontSize={44} color={Color4.create(1, 0.8, 0.3, 1)} uiTransform={{ width: 480, height: 60 }} />
      <Label value="VICTORY" fontSize={30} color={Color4.create(0.4, 1, 0.5, 1)} uiTransform={{ width: 480, height: 44 }} />
      <Label value={`CLEAR TIME: ${formatTime(game.clearTime)}`} fontSize={24} color={Color4.White()} uiTransform={{ width: 480, height: 40 }} />
      <Button value="PLAY AGAIN" variant="primary" fontSize={24} uiTransform={{ width: 240, height: 56, margin: { top: 24 } }} onMouseDown={() => resetGame()} />
    </UiEntity>
  </UiEntity>
)

/** Darkening + MISSION FAILED panel. */
const Failed = () => (
  <UiEntity
    uiTransform={{ width: '100%', height: '100%', positionType: 'absolute', justifyContent: 'center', alignItems: 'center' }}
    uiBackground={{ color: Color4.create(0, 0, 0, game.deathFade) }}
  >
    {game.failedShown && (
      <UiEntity
        uiTransform={{ width: 520, height: 300, flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 20 }}
        uiBackground={{ color: Color4.create(0.1, 0.03, 0.03, 0.92) }}
      >
        <Label value="MISSION FAILED" fontSize={44} color={Color4.create(1, 0.3, 0.25, 1)} uiTransform={{ width: 480, height: 60 }} />
        <Label value="YOU WERE DEFEATED" fontSize={24} color={Color4.White()} uiTransform={{ width: 480, height: 40 }} />
        <Button value="TRY AGAIN" variant="primary" fontSize={24} uiTransform={{ width: 240, height: 56, margin: { top: 30 } }} onMouseDown={() => resetGame()} />
      </UiEntity>
    )}
  </UiEntity>
)

export const BossHud = () => {
  if (game.phase === 'VICTORY') return <Victory />
  if (game.phase === 'RESETTING') return null
  if (game.phase === 'PLAYER_DEAD') return <Failed />
  const danger =
    (game.phase === 'GROUND_COMBAT' && (bossState.phase === 'WINDUP' || bossState.phase === 'SLAM' || bossState.phase === 'BARRAGE')) ||
    game.attackWarning === 'SWEEP'
  const objColor =
    game.phase === 'CORE_EXPOSED' || game.phase === 'CORE_COMBAT' || game.phase === 'BOSS_STAGGERED'
      ? Color4.create(0.3, 1, 1, 1)
      : game.phase === 'MISSILE_AIM' && game.aimOnTarget
        ? Color4.create(0.3, 1, 0.4, 1)
        : danger
          ? Color4.Red()
          : Color4.White()
  return (
    <UiEntity uiTransform={{ width: '100%', height: '100%', positionType: 'absolute', flexDirection: 'column', alignItems: 'center' }}>
      {game.hurtFlash > 0 && (
        <UiEntity
          uiTransform={{ width: '100%', height: '100%', positionType: 'absolute' }}
          uiBackground={{ color: Color4.create(0.9, 0, 0, 0.45 * game.hurtFlash) }}
        />
      )}
      <UiEntity
        uiTransform={{ margin: { top: 16 }, padding: 8, flexDirection: 'column', alignItems: 'center' }}
        uiBackground={{ color: Color4.create(0, 0, 0, 0.5) }}
      >
        <Label value={objectiveText()} fontSize={26} color={objColor} />
        <Label value={detailText()} fontSize={14} color={Color4.create(1, 0.85, 0.3, 1)} />
        {showCoreBar() && <CoreBar />}
        {DEBUG_KEYS && (
          <Label value="Debug: [1] slam  [2] hold pin  [3] break shoulder  [4] chest hit  [F] -10 HP" fontSize={11} color={Color4.Gray()} />
        )}
      </UiEntity>
      {game.timerStarted && (
        <UiEntity
          uiTransform={{ positionType: 'absolute', position: { top: 16, right: 220 }, padding: 6 }}
          uiBackground={{ color: Color4.create(0, 0, 0, 0.5) }}
        >
          <Label value={formatTime(game.timerRunning ? game.elapsed : game.clearTime)} fontSize={20} color={Color4.White()} />
        </UiEntity>
      )}
      {game.message !== '' && (
        <UiEntity uiTransform={{ positionType: 'absolute', position: { top: '38%' }, padding: 12 }} uiBackground={{ color: Color4.create(0, 0, 0, 0.55) }}>
          <Label value={game.message} fontSize={game.messageBig ? 38 : 22} color={game.messageBig ? Color4.create(0.3, 1, 0.4, 1) : Color4.White()} />
        </UiEntity>
      )}
      {game.guideLeft > 0 && game.phase === 'GROUND_COMBAT' && <Controls />}
      <HpBar />
    </UiEntity>
  )
}
