// Publish job: drive `sdk-commands deploy` for a scene, Creator Hub style.
// Main only builds and hosts — the spawned CLI builds the scene, hashes the
// entity, and serves a local "linker" API on `port`; the RENDERER then signs
// the entity id with the user's AuthIdentity and POSTs to /api/deploy, which
// uploads to the worlds content server. Credentials never touch this process.
// One job at a time (like the AI turn machinery).
import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import { spawn, type ChildProcess } from 'node:child_process'
import type { PublishEvent } from '@dcl-editor/contract'
import { ensureProjectDeps, killChild } from './servers'

let current: { child: ChildProcess; done: boolean } | null = null

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.once('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      if (addr === null || typeof addr === 'string') {
        srv.close(() => reject(new Error('could not allocate a port')))
        return
      }
      srv.close(() => resolve(addr.port))
    })
  })
}

async function probe(url: string, timeoutMs = 1500): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    return res.ok
  } catch {
    return false
  }
}

// Build can take minutes on a large scene; the linker server only comes up after.
const READY_TIMEOUT_S = 300

/**
 * Start a publish job for the scene at `projectDir`, deploying to the content
 * server at `targetContent`. Resolves once the child is spawned; `ready`/`log`/
 * `exit` stream over `emit`. Throws if a job is already running.
 */
export async function publishStart(
  projectDir: string,
  targetContent: string,
  emit: (e: PublishEvent) => void
): Promise<void> {
  if (current !== null && current.child.exitCode === null && !current.done) {
    throw new Error('a publish is already running')
  }
  if (!/^https:\/\//.test(targetContent)) throw new Error('targetContent must be https')
  if (!fs.existsSync(path.join(projectDir, 'scene.json'))) throw new Error('not a scene folder')

  await ensureProjectDeps(projectDir, (line) => emit({ kind: 'log', line }))
  const port = await freePort()

  const args = [
    'exec',
    '--',
    'sdk-commands',
    'deploy',
    '--dir',
    projectDir,
    '--port',
    String(port),
    '--no-browser', // we are the linker dapp — never open one
    '--target-content',
    targetContent
  ]
  // a stray DCL_PRIVATE_KEY would make the CLI sign as some other key locally,
  // bypassing the renderer's identity — never inherit it
  const env = { ...process.env }
  delete env.DCL_PRIVATE_KEY

  emit({ kind: 'log', line: `▶ publish: "npm ${args.join(' ')}"` })
  const child = spawn('npm', args, {
    cwd: projectDir,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32' // own group so killChild reaps children (POSIX)
  })
  const job = { child, done: false }
  current = job
  child.stdout?.on('data', (d: Buffer) => emit({ kind: 'log', line: String(d).trimEnd() }))
  child.stderr?.on('data', (d: Buffer) => emit({ kind: 'log', line: String(d).trimEnd() }))
  child.on('error', (e) => emit({ kind: 'log', line: `✖ failed to spawn npm — ${e.message}` }))
  child.on('exit', (code) => {
    job.done = true
    if (current === job) current = null
    emit({ kind: 'exit', code })
  })

  // Signal `ready` when the linker API answers — that's the renderer's cue to
  // fetch /api/info, sign, and POST /api/deploy. Exit before ready = build or
  // validation failure; the exit event (plus the log stream) reports it.
  void (async () => {
    for (let i = 0; i < READY_TIMEOUT_S; i++) {
      if (job.done) return
      if (await probe(`http://localhost:${port}/api/info`)) {
        emit({ kind: 'ready', port })
        return
      }
      await new Promise((r) => setTimeout(r, 1000))
    }
    if (!job.done) {
      emit({ kind: 'log', line: `✖ publish: linker server did not come up within ${READY_TIMEOUT_S}s` })
      publishStop()
    }
  })()
}

// Kill the running job (user cancel, renderer failure cleanup, app teardown).
export function publishStop(): void {
  if (current === null) return
  const job = current
  current = null
  job.done = true
  killChild(job.child)
}
