// Startup handshake for `sdk-commands start`: how long we wait for a scene
// server, and what we call it when the process dies. Both rules produced real
// bugs on Windows — a slow cold start reported as a failure, and a scene the
// user replaced mid-launch reported as a crash of the scene now loading.
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SceneStartSuperseded, startSceneServer, stopAll } from './servers'

class FakeChild extends EventEmitter {
  // undefined so killChild is a no-op — a real pid here would signal a real
  // process group on the machine running the tests
  pid: number | undefined = undefined
  exitCode: number | null = null
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  kill = vi.fn()
  die(code: number): void {
    this.exitCode = code
    this.emit('exit', code, null)
  }
}

// The factory is hoisted above the imports, but its bodies only run once a test
// spawns — by then `FakeChild` and `spawned` are initialized.
const spawned: FakeChild[] = []
vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => {
    const c = new FakeChild()
    spawned.push(c)
    return c
  }),
  execSync: vi.fn(() => Buffer.from('')) // killListener's netstat/lsof
}))

const PORT = 8104
let serverUp = false
let projectDir = ''
const quiet = (): void => undefined

beforeEach(() => {
  vi.useFakeTimers()
  spawned.length = 0
  serverUp = false
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scene-start-'))
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: serverUp }))
  )
})

afterEach(() => {
  stopAll()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  fs.rmSync(projectDir, { recursive: true, force: true })
})

// workspaceDeps skips the npm-install path (which would await a mocked child
// that never exits); the flag itself is not what's under test here.
const start = (dir = projectDir): Promise<void> => startSceneServer(dir, PORT, [], quiet, true, true)

describe('waiting for a scene server to come up', () => {
  it('keeps waiting while the build is still printing, well past the old 120s deadline', async () => {
    const pending = start()
    let settled = false
    void pending.then(
      () => (settled = true),
      () => (settled = true)
    )

    // five minutes of a slow Windows cold start: bundling, type checking, each
    // step reporting progress
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(60_000)
      spawned[0].stdout.emit('data', Buffer.from('[1/2] Bundling file src/index.ts'))
    }
    expect(settled).toBe(false)

    serverUp = true
    await vi.advanceTimersByTimeAsync(2_000)
    await expect(pending).resolves.toBeUndefined()
  })

  it('gives up on a server that goes silent without ever listening', async () => {
    const pending = start()
    const assertion = expect(pending).rejects.toThrow(/printed nothing/)
    await vi.advanceTimersByTimeAsync(160_000)
    await assertion
  })

  it('reports a dead process by its exit code', async () => {
    const pending = start()
    const assertion = expect(pending).rejects.toThrow(/exited with code 1/)
    await vi.advanceTimersByTimeAsync(2_000)
    spawned[0].stdout.emit('data', Buffer.from('Build failed with 2 errors'))
    spawned[0].die(1)
    await vi.advanceTimersByTimeAsync(2_000)
    await assertion
  })

  it('rides out a crash-watchdog restart instead of reporting the dead child', async () => {
    const pending = start()
    let settled: unknown = false
    void pending.then(
      () => (settled = 'resolved'),
      (e: unknown) => (settled = String(e))
    )

    await vi.advanceTimersByTimeAsync(2_000)
    spawned[0].die(1) // a crash the watchdog retries (no build-failure marker)
    await vi.advanceTimersByTimeAsync(3_000)
    expect(spawned).toHaveLength(2) // respawned
    expect(settled).toBe(false)

    serverUp = true
    await vi.advanceTimersByTimeAsync(2_000)
    await expect(pending).resolves.toBeUndefined()
  })
})

describe('relaying sdk-commands output', () => {
  // sdk-commands colours its output, and every QR row arrives wrapped in
  // background/foreground escapes — 18 of the 67 lines a start prints.
  const ESC = '\u001b'
  const qr = [
    'Scan to preview on mobile: ',
    `${ESC}[47m${ESC}[30m ▄▄▄▄▄▄▄ ▄ ▄ ▄ ▄▄ ▄ ▄▄ ▄▄   ▄  ▄▄▄▄▄▄▄ ${ESC}[0m`,
    `${ESC}[47m${ESC}[30m █ ▄▄▄ █ ██ ▀█▀▄▄▀█ █ ▄ █▀▄▄▀█ █ ▄▄▄ █ ${ESC}[0m`,
    'This QR redirects to decentraland://open?preview=http://192.168.0.1:8004 in your phone.'
  ].join('\n')

  // The relay filters one whole line at a time now (server-relay.test.ts covers
  // the reassembly), so the filter is exercised where a start feeds it for real:
  // bytes in on stdout, lines out to onLog.
  const relayed = async (chunk: string): Promise<string[]> => {
    const lines: string[] = []
    const pending = startSceneServer(projectDir, PORT, [], (l) => lines.push(l), true, true)
    void pending.catch(() => undefined) // never settles inside the test; stopAll ends it
    await vi.advanceTimersByTimeAsync(2_000)
    spawned[0].stdout.emit('data', Buffer.from(`${chunk}\n`))
    return lines
  }

  it('drops the mobile QR even when its rows are colour-wrapped', async () => {
    const lines = await relayed(qr)
    expect(lines.some((l) => l.includes('▄'))).toBe(false)
    expect(lines.some((l) => l.includes('Scan to preview on mobile'))).toBe(false)
    expect(lines.some((l) => l.includes('This QR redirects to'))).toBe(false)
  })

  it('keeps the build output the error card is read from', async () => {
    const build = `${ESC}[1m[1/2]${ESC}[22m Bundling file src/index.ts\nERROR: Build failed with 2 errors`
    const lines = await relayed(`${qr}\n${build}`)
    expect(lines.some((l) => l.includes('Build failed with 2 errors'))).toBe(true)
    expect(lines.some((l) => l.includes('Bundling file src/index.ts'))).toBe(true)
  })
})

describe('opening another scene mid-launch', () => {
  it('marks the abandoned launch superseded rather than crashed', async () => {
    const first = start()
    const rejected = expect(first).rejects.toBeInstanceOf(SceneStartSuperseded)
    await vi.advanceTimersByTimeAsync(2_000)

    // the user picks a different scene while the first is still building
    const otherDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scene-start-other-'))
    const second = start(otherDir)
    await vi.advanceTimersByTimeAsync(2_000)
    await rejected

    serverUp = true
    await vi.advanceTimersByTimeAsync(2_000)
    await expect(second).resolves.toBeUndefined()
    fs.rmSync(otherDir, { recursive: true, force: true })
  })

  it('does not blame the superseded scene for the exit code of its own kill', async () => {
    const first = start()
    const failure = first.catch((e: unknown) => String(e))
    await vi.advanceTimersByTimeAsync(2_000)

    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'scene-start-other-'))
    const second = start(other)
    // killChild on Windows is a taskkill, so the abandoned process exits 1
    spawned[0].die(1)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(await failure).not.toMatch(/exited with code/)

    serverUp = true
    await vi.advanceTimersByTimeAsync(2_000)
    await second
    fs.rmSync(other, { recursive: true, force: true })
  })
})
