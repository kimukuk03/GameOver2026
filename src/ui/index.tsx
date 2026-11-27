/** @jsx ReactEcs.createElement */
// Scene UI entry point. The Creator Hub UI editor regenerates this file (no backup) whenever src/ui/ contains
// a UI component file, so don't put logic here: put each UI in its own file that exports a component with the
// same name as the file (for example `export const MyHud` in src/ui/MyHud.tsx) and only render it from here.
import ReactEcs, { UiEntity, ReactEcsRenderer } from '@dcl/sdk/react-ecs'
import { BossHud } from './BossHud'

export function setupUi() {
  ReactEcsRenderer.setUiRenderer(() => (
    <UiEntity uiTransform={{ width: '100%', height: '100%' }}>
      <BossHud />
    </UiEntity>
  ))
}
