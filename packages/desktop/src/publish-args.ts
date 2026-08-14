// Can the scene's own `sdk-commands deploy` publish NEXT TO the scenes a world
// already holds — and what do we spawn it with?
//
// 7.25 deploy, when the target world holds scenes on non-overlapping parcels and
// --multi-scene was not passed, warns and then blocks on
// promptUser('Continue? (y/N) '). That is readline over process.stdin: on EOF
// the rl.question callback never fires, the promise never settles, and the
// process EXITS 0 without ever building. --multi-scene gates that entire
// pre-flight off (no world fetch, no warning, no prompt, no delete) and the
// uploaded payload is byte-identical, so we pass it wherever it is understood.
//
// Never --yes: it skips the prompt and then SETS needsDelete, and the CLI hard
// errors when the linker response carries no deleteSignature — which ours never
// does. Never --force-upload or --skip-version-checks: declared and never read.
//
// An unknown flag is an ArgError — the CLI prints help and returns WITHOUT
// deploying — so the flag can only be passed to a build that declares it. Probe
// the installed source rather than a version number: the flag differs per
// project install and channel builds share versions.
import fs from 'node:fs'
import path from 'node:path'
import type { DeployCapability } from '@dcl-editor/contract'
import { resolveSdkCommands } from './servers'

// Both markers are load-bearing strings from the CLI's own dist. publish-args.test.ts
// pins them against a real 7.25.1 excerpt so a rename fails CI instead of quietly
// degrading this probe to "unsupported".
const MULTI_SCENE_FLAG = '--multi-scene'
const CONFIRM_PROMPT = 'Continue? (y/N) '

// Cross-platform recursive scan (Windows has no `grep -r`): does the installed
// deploy command declare the flag, and does it still carry the prompt?
function scanDeploy(dir: string): { flag: boolean; prompt: boolean } {
  const found = { flag: false, prompt: false }
  const walk = (d: string): void => {
    if (found.flag && found.prompt) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (found.flag && found.prompt) return
      const full = path.join(d, e.name)
      if (e.isDirectory()) {
        walk(full)
        continue
      }
      let src: string
      try {
        src = fs.readFileSync(full, 'utf8')
      } catch {
        continue // unreadable — skip
      }
      if (src.includes(MULTI_SCENE_FLAG)) found.flag = true
      if (src.includes(CONFIRM_PROMPT)) found.prompt = true
    }
  }
  walk(dir)
  return found
}

// The flag wins over the prompt: a build that declares --multi-scene keeps the
// prompt in its source for the runs that don't pass it, so finding both is the
// 7.25 shape, not a destructive one.
function capabilityOf(found: { flag: boolean; prompt: boolean }): DeployCapability {
  if (found.flag) return { kind: 'additive' }
  if (found.prompt) return { kind: 'destructive' }
  return { kind: 'legacy-additive' }
}

// Keyed by project dir, but STAMPED with the installed command's own mtime+size.
// A blocked creator's next move is `npm i @dcl/sdk@latest` in that very folder,
// and a cache keyed on the path alone would hand them back the pre-update
// verdict for the life of the process — the block telling them to do the thing
// they just did. The install rewrites index.js, so the stamp moves with it.
interface CachedCapability {
  stamp: string
  cap: DeployCapability
}
const capabilityCache = new Map<string, CachedCapability>()

function stampOf(deployDir: string): string | null {
  try {
    const s = fs.statSync(path.join(deployDir, 'index.js'))
    return `${s.mtimeMs}:${s.size}`
  } catch {
    return null
  }
}

/**
 * Which of the three deploy shapes the project's installed sdk-commands is.
 * Call it only AFTER ensureProjectDeps — see the caching trap below.
 */
export function deployCapability(projectDir: string): DeployCapability {
  // resolve like Node does — a workspace scene's deps live in a parent dir
  const pkgDir = resolveSdkCommands(projectDir)
  const deployDir = path.join(pkgDir ?? projectDir, 'dist', 'commands', 'deploy')
  // Not installed yet: the scan can't know, so don't poison the per-dir cache
  // with a false negative — 'unknown' is deliberately NOT cached.
  if (!fs.existsSync(deployDir)) return { kind: 'unknown' }
  const stamp = stampOf(deployDir)
  const cached = capabilityCache.get(projectDir)
  if (stamp !== null && cached?.stamp === stamp) return cached.cap
  const cap = capabilityOf(scanDeploy(deployDir))
  if (stamp !== null) capabilityCache.set(projectDir, { stamp, cap })
  return cap
}

export interface DeployArgsInput {
  projectDir: string
  port: number
  targetContent: string
  capability: DeployCapability
}

/** The full `npm exec` arg array for one deploy. Additive by construction. */
export function buildDeployArgs(input: DeployArgsInput): string[] {
  return [
    'exec',
    '--',
    'sdk-commands',
    'deploy',
    '--dir',
    input.projectDir,
    '--port',
    String(input.port),
    '--no-browser', // we are the linker dapp — never open one
    '--target-content',
    input.targetContent,
    ...(input.capability.kind === 'additive' ? [MULTI_SCENE_FLAG] : [])
  ]
}

/**
 * Answer the CLI's confirmation prompt with "no" and close the pipe, at once.
 * A stdin pipe left open and unwritten is the one variant that genuinely hangs;
 * an inherited /dev/null exits 0 without building. Writing to an already-dead
 * child raises EPIPE/ENOENT asynchronously, so the listener goes on first.
 */
export function declineStdin(stdin: NodeJS.WritableStream | null | undefined): void {
  if (stdin === null || stdin === undefined) return
  stdin.on('error', () => {})
  try {
    stdin.end('n\n')
  } catch {
    // pipe already torn down — the child is gone, which is the same outcome
  }
}
