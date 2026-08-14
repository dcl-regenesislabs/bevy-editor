import { afterEach, describe, expect, it, vi } from 'vitest'
import { readServerPresence } from './server-presence'

type Cap = { authServer: boolean; installed: boolean }

const host = globalThis as {
  window?: { location: { search: string }; editorShell?: { sdkCapability?: (dir: string) => Promise<Cap> } }
}

function shell(cap: Cap | Error | null, search = '?project=/scenes/tower'): (dir: string) => Promise<Cap> {
  const probe = vi.fn(async (_dir: string) => {
    if (cap instanceof Error) throw cap
    return cap as Cap
  })
  host.window = { location: { search }, editorShell: cap === null ? {} : { sdkCapability: probe } }
  return probe
}

afterEach(() => {
  delete host.window
})

describe('asking the scene whether it has a Multiplayer Server', () => {
  it('reads the answer off the same bridge the SDK gate uses', async () => {
    const probe = shell({ authServer: true, installed: true })
    expect(await readServerPresence()).toBe('present')
    expect(probe).toHaveBeenCalledWith('/scenes/tower')
  })

  it('calls a scene without the auth-server SDK serverless', async () => {
    shell({ authServer: false, installed: true })
    expect(await readServerPresence()).toBe('absent')
  })

  it('answers unknown where there is no shell to ask', async () => {
    shell(null)
    expect(await readServerPresence()).toBe('unknown')
  })

  it('answers unknown when no project is open', async () => {
    shell({ authServer: false, installed: true }, '')
    expect(await readServerPresence()).toBe('unknown')
  })

  it('answers unknown rather than guessing when the probe throws', async () => {
    shell(new Error('no such file'))
    expect(await readServerPresence()).toBe('unknown')
  })
})
