// Publish job: drive `sdk-commands deploy` for a scene, Creator Hub style.
// Main only builds and hosts — the spawned CLI builds the scene, hashes the
// entity, and serves a local "linker" API on a port; the RENDERER then signs
// the entity id with the user's AuthIdentity and POSTs to /api/deploy, which
// uploads to the worlds content server. Credentials never touch this process.
//
// One job at a time. The job is registered SYNCHRONOUSLY (before any await) so
// publishStop() can cancel it at every stage — including mid npm-install — and
// a second publishStart can never sneak past the guard. Every event carries the
// job's id: the renderer ignores events from a job it didn't start (a late exit
// from a killed child must not be pinned on the next publish).
import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import { spawn, type ChildProcess } from 'node:child_process'
import type { PublishEvent } from '@dcl-editor/contract'
import { ensureProjectDeps, killChild } from './servers'

interface Job {
  id: string
  child: ChildProcess | null
  cancelled: boolean
  done: boolean
}
let current: Job | null = null
let seq = 0

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
 * server at `targetContent`. Resolves with the job id once the child is
 * spawned; `ready`/`log`/`exit` (tagged with that id) stream over `emit`.
 * Throws if a job is already running.
 */
export async function publishStart(
  projectDir: string,
  targetContent: string,
  emit: (e: PublishEvent) => void
): Promise<{ jobId: string }> {
  if (current !== null && !current.done) throw new Error('a publish is already running')
  if (!/^https:\/\//.test(targetContent)) throw new Error('targetContent must be https')
  if (!fs.existsSync(path.join(projectDir, 'scene.json'))) throw new Error('not a scene folder')

  const job: Job = { id: `pub-${++seq}`, child: null, cancelled: false, done: false }
  current = job
  const log = (line: string): void => emit({ kind: 'log', jobId: job.id, line })
  const finish = (code: number | null): void => {
    if (job.done) return
    job.done = true
    if (current === job) current = null
    emit({ kind: 'exit', jobId: job.id, code })
  }

  await ensureProjectDeps(projectDir, log)
  if (job.cancelled) {
    finish(null)
    return { jobId: job.id }
  }
  const port = await freePort()
  if (job.cancelled) {
    finish(null)
    return { jobId: job.id }
  }

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

  log(`▶ publish: "npm ${args.join(' ')}"`)
  const child = spawn('npm', args, {
    cwd: projectDir,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32' // own group so killChild reaps children (POSIX)
  })
  job.child = child

  // `ready` = the renderer's cue to sign + POST. Preferred signal: the CLI's own
  // "App ready at http://localhost:<port>" line — authoritative even if our
  // requested port was taken and the CLI picked another (and immune to a local
  // squatter answering our probe). The probe loop below is a fallback for CLI
  // versions with different wording.
  let readySent = false
  const emitReady = (p: number): void => {
    if (readySent || job.done || job.cancelled) return
    readySent = true
    emit({ kind: 'ready', jobId: job.id, port: p })
  }
  const watchLine = (line: string): void => {
    const m = line.match(/ready at https?:\/\/localhost:(\d+)/i)
    if (m !== null) emitReady(Number(m[1]))
  }
  const onData = (d: Buffer): void => {
    const text = String(d).trimEnd()
    log(text)
    watchLine(text)
  }
  child.stdout?.on('data', onData)
  child.stderr?.on('data', onData)
  child.on('error', (e) => {
    log(`✖ failed to spawn npm — ${e.message}`)
    finish(-1)
  })
  child.on('exit', (code) => finish(code))

  void (async () => {
    for (let i = 0; i < READY_TIMEOUT_S; i++) {
      if (job.done || readySent) return
      if (await probe(`http://localhost:${port}/api/info`)) {
        emitReady(port)
        return
      }
      await new Promise((r) => setTimeout(r, 1000))
    }
    if (!job.done && !readySent) {
      log(`✖ publish: linker server did not come up within ${READY_TIMEOUT_S}s`)
      publishStop()
    }
  })()

  return { jobId: job.id }
}

// Cancel the running job at any stage (user cancel, renderer failure cleanup,
// app teardown). Safe mid-install: the pending publishStart sees `cancelled`
// after its awaits and finishes without spawning.
export function publishStop(): void {
  const job = current
  if (job === null) return
  current = null
  job.cancelled = true
  if (job.child !== null) killChild(job.child) // its exit handler emits the tagged exit event
}
