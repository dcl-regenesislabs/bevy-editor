// The assistant reads the user's PATH out of their login shell, because a
// GUI-launched app inherits launchd's bare PATH and a CLI installed by
// `npm i -g` lands wherever their version manager points npm's prefix. An
// interactive shell prints whatever the user's profile prints, so the value
// arrives inside markers and everything around it is noise.
import { afterEach, beforeEach, describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { nvmBinDirs, parseShellPath } from './ai'

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

// A lazy-loading nvm profile leaves node off PATH until something triggers it,
// so the shell probe can come back without it. This is the layout a real report
// came from: ~/.nvm/versions/node/v24.18.0/bin/claude.
describe('finding nvm-managed installs without the shell', () => {
  let root = ''
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'nvm-'))
  })
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

  it('offers every installed version, newest first', () => {
    for (const v of ['v20.9.0', 'v24.18.0', 'v22.11.0']) fs.mkdirSync(path.join(root, v, 'bin'), { recursive: true })
    expect(nvmBinDirs(root)).toEqual([
      path.join(root, 'v24.18.0', 'bin'),
      path.join(root, 'v22.11.0', 'bin'),
      path.join(root, 'v20.9.0', 'bin')
    ])
  })

  it('orders by number, not by string — v9 is older than v24', () => {
    for (const v of ['v9.11.2', 'v24.18.0']) fs.mkdirSync(path.join(root, v, 'bin'), { recursive: true })
    expect(nvmBinDirs(root)[0]).toBe(path.join(root, 'v24.18.0', 'bin'))
  })

  it('ignores files and non-version entries', () => {
    fs.mkdirSync(path.join(root, 'v24.18.0', 'bin'), { recursive: true })
    fs.mkdirSync(path.join(root, 'alias'), { recursive: true })
    fs.writeFileSync(path.join(root, 'v-not-a-dir'), '')
    expect(nvmBinDirs(root)).toEqual([path.join(root, 'v24.18.0', 'bin')])
  })

  it('says nothing when nvm was never installed', () => {
    expect(nvmBinDirs(path.join(root, 'nope'))).toEqual([])
  })
})
