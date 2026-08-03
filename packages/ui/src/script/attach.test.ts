import { describe, expect, it } from 'vitest'
import { attachablePath } from './template'

describe('attachablePath', () => {
  it('accepts a per-entity script and normalises it to a project path', () => {
    expect(attachablePath('src/scripts/RandomEmote.ts')).toBe('src/scripts/RandomEmote.ts')
    expect(attachablePath('src/scripts/Door.tsx')).toBe('src/scripts/Door.tsx')
  })

  it('trims the absolute prefix the CLIs report', () => {
    expect(attachablePath('/private/var/folders/xy/my-scene/src/scripts/Spin.ts')).toBe('src/scripts/Spin.ts')
    expect(attachablePath('C:\\Users\\me\\scene\\src\\scripts\\Spin.ts')).toBe('src/scripts/Spin.ts')
  })

  it('rejects everything that is not a per-entity script', () => {
    expect(attachablePath('src/index.ts')).toBeNull()
    expect(attachablePath('src/scripts/nested/Deep.ts')).toBeNull()
    expect(attachablePath('src/scripts/notes.md')).toBeNull()
    expect(attachablePath('assets/scene/main.composite')).toBeNull()
    expect(attachablePath('')).toBeNull()
  })
})
