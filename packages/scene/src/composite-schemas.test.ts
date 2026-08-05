// The e2e probes write a scene's main.composite by hand, and sdk-commands
// instances every .composite it finds in a bare engine to collect the Script
// rows a scene has to bundle. `core::*` components resolve from the SDK's own
// table; a custom one is only defined from the composite's embedded jsonSchema,
// and one missing schema fails the WHOLE composite — the build still writes
// bin/index.js, just with none of the scene's scripts in it.
//
// So the probes carry a dump of this registry. This test is what stops the dump
// from drifting: field order IS the wire encoding (impl-plan R3), so a schema
// that changed here and not there would have the probe write composites the
// engine decodes differently from every saved scene.
//
//   UPDATE_GOLDENS=1 npx vitest run packages/scene/src/composite-schemas.test.ts
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { customComponentDefs } from './custom-components'

const DUMP = fileURLToPath(
  new URL('../../desktop/validate/fixtures/composite-schemas.json', import.meta.url)
)

function current(): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const def of customComponentDefs()) out[def.componentName] = def.jsonSchema
  return out
}

describe('the composite schema dump the probes write with', () => {
  it('is exactly this registry, name for name and field for field', () => {
    const text = `${JSON.stringify(current(), null, 2)}\n`
    if (process.env.UPDATE_GOLDENS === '1') writeFileSync(DUMP, text)
    expect(readFileSync(DUMP, 'utf8')).toBe(text)
  })

  it('covers every component an editor-written composite can carry', () => {
    const dumped = Object.keys(JSON.parse(readFileSync(DUMP, 'utf8')) as Record<string, unknown>)
    expect(dumped).toContain('asset-packs::Script')
    expect(dumped).toContain('core-schema::Name')
    expect(dumped).toContain('inspector::CustomAsset')
    expect(dumped).toContain('editor::GameConfig')
  })
})
