// The assistant reads the user's PATH out of their login shell, because a
// GUI-launched app inherits launchd's bare PATH and a CLI installed by
// `npm i -g` lands wherever their version manager points npm's prefix. An
// interactive shell prints whatever the user's profile prints, so the value
// arrives inside markers and everything around it is noise.
import { describe, it, expect } from 'vitest'
import { parseShellPath } from './ai'

describe('reading PATH out of a login shell', () => {
  it('takes the marked value', () => {
    expect(parseShellPath('<<</Users/me/.n/bin:/usr/bin>>>')).toEqual(['/Users/me/.n/bin', '/usr/bin'])
  })

  it('ignores a chatty profile around it', () => {
    const noisy = ['Welcome back!', 'nvm: now using node v22.11.0', '<<</Users/me/.nvm/versions/node/v22.11.0/bin:/usr/bin>>>', '[0m'].join('\n')
    expect(parseShellPath(noisy)).toEqual(['/Users/me/.nvm/versions/node/v22.11.0/bin', '/usr/bin'])
  })

  it('reports nothing when the shell never answered, so the static list still stands', () => {
    expect(parseShellPath('')).toEqual([])
    expect(parseShellPath('zsh: command not found: printf')).toEqual([])
    expect(parseShellPath('<<<>>>')).toEqual([])
  })

  it('drops the empty entries a trailing colon leaves behind', () => {
    expect(parseShellPath('<<</usr/bin::/bin:>>>')).toEqual(['/usr/bin', '/bin'])
  })
})
