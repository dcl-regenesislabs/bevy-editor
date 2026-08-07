import { describe, it, expect } from 'vitest'
import { prettyLabel } from './fields'

// The labels are the inspector's whole vocabulary — every component card and
// property row goes through this, so the casing rules are worth pinning.
describe('prettyLabel', () => {
  it('title-cases a single word', () => {
    expect(prettyLabel('Transform')).toBe('Transform')
    expect(prettyLabel('transform')).toBe('Transform')
  })

  it('splits camelCase into words', () => {
    expect(prettyLabel('audioSource')).toBe('Audio Source')
    expect(prettyLabel('MeshRenderer')).toBe('Mesh Renderer')
    expect(prettyLabel('playbackRate')).toBe('Playback Rate')
  })

  it('splits underscores', () => {
    expect(prettyLabel('trigger_area')).toBe('Trigger Area')
  })

  it('keeps an acronym whole and splits it off the next word', () => {
    expect(prettyLabel('GLTFContainer')).toBe('GLTF Container')
    expect(prettyLabel('url')).toBe('Url')
    expect(prettyLabel('URL')).toBe('URL')
  })

  it('keeps trailing digits attached', () => {
    expect(prettyLabel('uv0')).toBe('Uv0')
  })
})
