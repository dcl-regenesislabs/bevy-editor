// ReactEcsRenderer.setUiRenderer is single-owner per scene: the last caller wins
// and silently blanks whatever the previous one drew. First-wins plus a console
// warning is the v1 answer. The marker lives on globalThis rather than in this
// module so any other prefab following the same convention cooperates, even
// though each prefab bundles its own copy of this file.
const UI_OWNER_KEY = '__dclUiRendererOwner'

export const VIRTUAL_CANVAS = { virtualWidth: 1920, virtualHeight: 1080 }

export function claimUiRenderer(owner: string): boolean {
  const globals = globalThis as unknown as Record<string, unknown>
  const current = globals[UI_OWNER_KEY]
  if (typeof current === 'string') {
    console.log(
      `${owner}: the scene UI is already owned by "${current}" — this panel will not render. Only one UI renderer can be active per scene.`
    )
    return false
  }
  globals[UI_OWNER_KEY] = owner
  return true
}
