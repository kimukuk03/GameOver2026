// Development shortcuts. Disabled by DEBUG_KEYS=false in config.ts; delete this file before submission.
//   1 = slam now   2 = hold the arm pinned   3 = break the shoulder joint   4 = missile hit on the chest
//   F = take 10 damage (tests HP, invulnerability and death)
import { inputSystem, InputAction, PointerEventType } from '@dcl/sdk/ecs'
import { game } from './gameState'
import { debugSlamNow, debugToggleHold, debugBreakShoulder } from './boss'
import { debugHitChest } from './launcher'
import { damagePlayer } from './player'

export function debugSystem() {
  if (game.phase === 'RESETTING') return
  if (inputSystem.isTriggered(InputAction.IA_ACTION_3, PointerEventType.PET_DOWN)) debugSlamNow()
  if (inputSystem.isTriggered(InputAction.IA_ACTION_4, PointerEventType.PET_DOWN)) debugToggleHold()
  if (inputSystem.isTriggered(InputAction.IA_ACTION_5, PointerEventType.PET_DOWN)) debugBreakShoulder()
  if (inputSystem.isTriggered(InputAction.IA_ACTION_6, PointerEventType.PET_DOWN)) debugHitChest()
  if (inputSystem.isTriggered(InputAction.IA_SECONDARY, PointerEventType.PET_DOWN)) damagePlayer(10, 'DEBUG')
}
