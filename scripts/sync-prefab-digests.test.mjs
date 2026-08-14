// The guard that would have caught "the master changed but no version bumped".
//
// Seven built-in prefabs lost the runtime modules they carried without one of
// them bumping data.json's `version` — which is the only thing the update offer
// reads, so no project holding the old folders would ever have been offered the
// new ones. Nothing was watching that. This is what watches it.
import { describe, it, expect } from 'vitest'
import { currentDigests, digestOf, digestPlan, recordedDigests, staleMessage } from './sync-prefab-digests.mjs'

const bytes = (text) => Buffer.from(text, 'utf8')

describe('digestOf', () => {
  it('is order-independent and covers path as well as content', () => {
    const a = [['scripts/x.ts', bytes('one')], ['data.json', bytes('two')]]
    expect(digestOf(a)).toBe(digestOf([...a].reverse()))
    expect(digestOf(a)).not.toBe(digestOf([['scripts/y.ts', bytes('one')], ['data.json', bytes('two')]]))
    expect(digestOf(a)).not.toBe(digestOf([['scripts/x.ts', bytes('ONE')], ['data.json', bytes('two')]]))
  })
})

describe('digestPlan', () => {
  const recorded = { 'trigger-zone': { version: '0.3.0', digest: 'aaa' } }

  it('refuses a folder whose files moved under an unchanged version', () => {
    const current = new Map([['trigger-zone', { version: '0.3.0', digest: 'bbb' }]])
    expect(digestPlan(current, recorded).stale).toEqual(['trigger-zone'])
  })

  it('records the new digest once the version moves with it', () => {
    const current = new Map([['trigger-zone', { version: '0.4.0', digest: 'bbb' }]])
    const plan = digestPlan(current, recorded)
    expect(plan.stale).toEqual([])
    expect(plan.changed).toBe(true)
    expect(plan.next['trigger-zone']).toEqual({ version: '0.4.0', digest: 'bbb' })
  })

  it('says nothing changed when the file already agrees', () => {
    const plan = digestPlan(new Map([['trigger-zone', { version: '0.3.0', digest: 'aaa' }]]), recorded)
    expect(plan.stale).toEqual([])
    expect(plan.changed).toBe(false)
  })

  // a prefab added this commit has no earlier shape to have drifted from
  it('records a prefab it has never seen without complaint', () => {
    const current = new Map([['jukebox', { version: '0.1.0', digest: 'ccc' }]])
    expect(digestPlan(current, {}).stale).toEqual([])
    expect(digestPlan(current, {}).changed).toBe(true)
  })

  // one sentence: the rule, then the exact next gesture
  it('names the bump and the changelog in its message', () => {
    const message = staleMessage(['trigger-zone'])
    expect(message).toContain('trigger-zone')
    expect(message).toContain('bump it and add a changelog entry')
  })
})

describe('this working tree', () => {
  it('records every built-in prefab against the version it ships under', () => {
    const plan = digestPlan(currentDigests(), recordedDigests())
    expect(plan.stale, `run \`node scripts/sync-prefab-digests.mjs\` after bumping: ${plan.stale.join(', ')}`).toEqual([])
    expect(plan.changed, 'packages/desktop/prefab-digests.json is out of date — run `node scripts/sync-prefab-digests.mjs`').toBe(false)
  })
})
