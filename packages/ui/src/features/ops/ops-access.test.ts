import { describe, expect, it } from 'vitest'
import { canSeeOps } from './ops-access'

describe('canSeeOps', () => {
  it('admits the operator wallet case-insensitively', () => {
    expect(canSeeOps('0xB8C4DF381C6C305758F806C3AA71F37AABBCBD92')).toBe(true)
    expect(canSeeOps('0xb8c4df381c6c305758f806c3aa71f37aabbcbd92')).toBe(true)
  })

  it('refuses everyone else, including signed-out', () => {
    expect(canSeeOps('0xedae96f7739af8a7fb16e2a888c1e578e1328299')).toBe(false)
    expect(canSeeOps(null)).toBe(false)
  })
})
