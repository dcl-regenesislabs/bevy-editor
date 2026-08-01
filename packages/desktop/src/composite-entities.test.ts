import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { compositeEntityIds } from './composite-entities'

function project(rel: string, doc: unknown): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'composite-'))
  const full = path.join(dir, rel)
  mkdirSync(path.dirname(full), { recursive: true })
  writeFileSync(full, JSON.stringify(doc))
  return dir
}

// Shaped exactly like towerofmadness/assets/scene/main.composite.
const DOC = {
  version: 1,
  components: [
    { name: 'composite::root', data: {} },
    { name: 'core::Transform', data: { '512': {}, '514': {}, '586': {}, '602': {} } },
    { name: 'core-schema::Name', data: { '512': {}, '514': {}, '586': {}, '602': {} } },
    { name: 'inspector::TransformConfig', data: { '512': {}, '513': {}, '514': {}, '586': {}, '602': {} } },
    { name: 'inspector::Nodes', data: { '0': {} } }
  ]
}

describe('compositeEntityIds', () => {
  it('reads every authored id from the Hub layout', () => {
    expect(compositeEntityIds(project('assets/scene/main.composite', DOC))).toEqual([512, 513, 514, 586, 602])
  })

  it('finds a composite at the flat layouts too', () => {
    expect(compositeEntityIds(project('main.composite', DOC))).toEqual([512, 513, 514, 586, 602])
    expect(compositeEntityIds(project('assets/main.composite', DOC))).toEqual([512, 513, 514, 586, 602])
  })

  it('excludes entity 0 — it carries only editor metadata', () => {
    expect(compositeEntityIds(project('main.composite', DOC))).not.toContain(0)
  })

  it('returns empty rather than throwing when there is no composite or it is corrupt', () => {
    expect(compositeEntityIds(mkdtempSync(path.join(tmpdir(), 'empty-')))).toEqual([])
    const dir = mkdtempSync(path.join(tmpdir(), 'bad-'))
    writeFileSync(path.join(dir, 'main.composite'), 'not json')
    expect(compositeEntityIds(dir)).toEqual([])
  })
})
