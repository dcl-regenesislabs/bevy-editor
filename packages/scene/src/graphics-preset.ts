// Force a graphics-quality preset at editor boot.
//
// Why: some scenes crash the WebGPU renderer at the default (Medium) quality —
// a shadow_pass command buffer goes invalid and poisons the whole Queue.Submit
// ("[main_opaque_pass_3d] is invalid due to a previous error"), so the viewport
// never renders. Dropping to the Low preset avoids it (proven by hand in the
// explorer's settings menu). The editor doesn't show that menu, so we apply the
// preset ourselves — via the exact same `~system/BevyExplorerApi` getSettings/
// setSetting surface the explorer's settings scene uses.
//
// "Graphics Preset" is NOT an engine setting; it's a scene-side bundle that maps
// a preset index to a column of individual settings. PRESET_VALUES + resolveValue
// below are copied verbatim from the explorer's settings scene (bridge-scene) so
// our Low is byte-identical to the dropdown's Low. Update if the engine changes.
import { BevyApi } from './bevy-api'
import type { EngineSetting } from './bevy-api/interface'

const PRESET_NAMES = ['Low', 'Medium', 'High'] as const

// { settingName: [low, medium, high] } — from the explorer settings scene.
const PRESET_VALUES: Record<string, [number | string, number | string, number | string]> = {
  'Anti-aliasing': ['FXAA (Low)', 'FXAA (High)', 'FXAA (High)'],
  'Shadow Distance': [20, 100, 200],
  'Shadow settings': ['Low', 'High', 'High'],
  'Light Count': [4, 8, 32],
  'Shadow Caster Count': [0, 4, 8],
  Fog: ['Atmospheric', 'Atmospheric', 'Atmospheric'],
  Bloom: ['High', 'High', 'High'],
  'Depth of Field': ['High', 'High', 'High'],
  'Out-of-bounds Effect': ['On', 'On', 'On'],
  'Scene Load Distance': [10, 25, 100],
  'Scene Unload Distance': [10, 15, 20],
  'Distant Scene Rendering': ['Normal', 'Normal', 'Ultra'],
  'Empty Parcel Props': ['Low', 'Mid', 'High'],
  'Max Avatars': [20, 50, 100],
  'Max Videos': [1, 2, 4]
}

// A named-variant value ("Low") resolves to its index in the setting's variants;
// a numeric value is used directly. Returns undefined if the variant is unknown.
function resolveValue(setting: EngineSetting, value: number | string): number | undefined {
  if (typeof value === 'number') return value
  const ix = setting.namedVariants.findIndex((v) => v.name === value)
  return ix < 0 ? undefined : ix
}

// Drop graphics to Low, dodging the WebGPU shadow-pass crash that hit some heavy
// scenes at the default (Medium) quality. Best-effort and non-blocking; a build
// without the settings API just no-ops.
export async function forceLowGraphics(): Promise<void> {
  const presetIx = PRESET_NAMES.indexOf('Low')
  let settings: EngineSetting[]
  try {
    settings = await BevyApi.getSettings()
  } catch (e) {
    console.error('[graphics] getSettings failed:', e)
    return
  }
  // BevyApi is a Proxy that returns a no-op stub for methods an older engine
  // doesn't expose, so getSettings() resolves to undefined (not a throw) there —
  // this is the real "no settings API → no-op" guard (a typeof check on the
  // Proxy method would always read as a function).
  if (!Array.isArray(settings)) {
    console.log('[graphics] settings API unavailable — skipping preset')
    return
  }
  const targets: Array<{ name: string; value: number }> = []
  for (const [name, values] of Object.entries(PRESET_VALUES)) {
    const setting = settings.find((s) => s.name === name)
    if (setting === undefined) continue
    const value = resolveValue(setting, values[presetIx])
    if (value !== undefined) targets.push({ name, value })
  }
  await Promise.all(
    targets.map(async (t) => {
      try {
        await BevyApi.setSetting(t.name, t.value)
      } catch (e) {
        console.error(`[graphics] setSetting ${t.name}=${t.value} failed:`, e)
      }
    })
  )
  console.log(`[graphics] applied Low preset (${targets.length} settings)`)
}
