// In-app AI assistant: drives a local AI *CLI* (Claude Code / Codex) as a child
// process, one per user turn, with the open project as its working directory.
// It runs on the user's own subscription/OAuth session — API keys are stripped
// from the child env on purpose (metered keys are the thing we're avoiding) — and
// edits the scene's src/scripts/*.ts files directly on disk; sdk-commands then
// hot-reloads them. Mirrors servers.ts's spawn/kill discipline (detached POSIX
// process group, killed as a tree). The renderer only sends prompts and renders
// the streamed events; all spawning happens here in the main process.
import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import type { AiEvent, AiProvider, AiProviderInfo, AiSendParams } from '@dcl-editor/contract'

// GUI-launched Electron gets a sparse PATH (no shell profile), so the CLIs — and
// their own node/child lookups — won't be found by name alone. Search these in
// addition to whatever PATH we do have.
const HOME = os.homedir()
const EXTRA_BIN_DIRS = [
  path.join(HOME, '.local', 'bin'),
  '/opt/homebrew/bin',
  '/usr/local/bin',
  '/usr/bin',
  path.join(HOME, '.bun', 'bin'),
  path.join(HOME, '.deno', 'bin'),
  path.join(HOME, '.volta', 'bin')
]

// Find an installed, *runnable* binary by any of its names. realpathSync throws
// on a dangling symlink (e.g. a cask whose target was upgraded away — codex does
// this), so a broken install reads as "not found" instead of spawning garbage.
function findExecutable(names: string[]): string | null {
  const pathDirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)
  const dirs = [...pathDirs, ...EXTRA_BIN_DIRS]
  for (const dir of dirs) {
    for (const name of names) {
      const p = path.join(dir, name)
      try {
        const real = fs.realpathSync(p) // resolves & proves the target exists
        if (fs.statSync(real).isFile()) {
          fs.accessSync(real, fs.constants.X_OK)
          return p // return the found path (spawn follows the symlink itself)
        }
      } catch {
        /* not here, or dangling — keep looking */
      }
    }
  }
  return null
}

// Env vars dropped from the child. Metered API keys → force subscription/OAuth
// auth (the whole point). CLAUDE_CODE_* / CLAUDECODE → don't let the spawned CLI
// think it's nested in another Claude Code session. *BASE_URL / *CUSTOM_HEADERS →
// pin the endpoint to the real provider so an inherited override can't redirect
// the OAuth token to a third party.
const STRIP_ENV = new Set([
  'CLAUDECODE',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_CUSTOM_HEADERS',
  'ANTHROPIC_BEDROCK_BASE_URL',
  'ANTHROPIC_VERTEX_BASE_URL',
  'OPENAI_API_KEY',
  'CODEX_API_KEY',
  'OPENAI_BASE_URL',
  'OPENAI_API_BASE'
])

// The child env: strip the vars above, keep everything else (HOME, keychain
// access, etc.), and widen PATH so the CLI finds node/git under a GUI launch.
function childEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  for (const k of Object.keys(env)) {
    if (k.startsWith('CLAUDE_CODE') || STRIP_ENV.has(k)) delete env[k]
  }
  env.PATH = [...(env.PATH ?? '').split(path.delimiter), ...EXTRA_BIN_DIRS].filter(Boolean).join(path.delimiter)
  return env
}

// Injected into every turn so the assistant writes VALID Decentraland SDK7
// scripts without being told the conventions each time. Kept in sync with
// packages/ui/src/script/template.ts and packages/scene/src/allowed-components.ts.
const DCL_SYSTEM_PROMPT = `You are an AI assistant embedded inside a Decentraland (SDK7) scene editor. You help the user author and edit "Script" components: TypeScript files under src/scripts/ that attach behavior to scene entities. sdk-commands hot-reloads them as you save, so your file edits apply live.

Rules you MUST follow:
- Each script is one exported class in src/scripts/<Name>.ts (PascalCase, e.g. src/scripts/Door.ts exporting class DoorScript).
- The constructor's first two params are ALWAYS \`public src: string\` and \`public entity: Entity\` (Entity from '@dcl/sdk/ecs'). Any FURTHER constructor params become typed inspector inputs — keep them primitive (string | number | boolean) with default values.
- Implement start() (runs once on init) and update(dt: number) (runs every frame; dt is seconds). Operate on this.entity.
- Import from '@dcl/sdk/ecs' and '@dcl/sdk/math'.
- Only these SDK7 components may be used: Transform, Animator, AudioSource, AudioStream, AvatarAttach, AvatarModifierArea, AvatarShape, Billboard, CameraModeArea, GltfContainer, GltfNodeModifiers, InputModifier, LightSource, MainCamera, Material, MeshCollider, MeshRenderer, NftShape, PointerEvents, SkyboxTime, TextShape, TriggerArea, Tween, TweenSequence, VideoPlayer, VirtualCamera, VisibilityComponent. Do NOT invent components or use engine-output/UI components.
- Write valid, self-contained TypeScript. Prefer editing existing files in place over creating new ones. Never run shell commands or touch files outside this project.
- Be concise in chat — the user watches your edits apply in the editor. Explain briefly what you changed and why.`

interface TurnCtx {
  text: string
  model?: string
  projectDir: string
  resume?: string
}

// A provider = how to find its binary + how to turn a turn into an argv + how to
// read its streaming stdout. Only these two differ between Claude and Codex.
interface ProviderDef {
  id: AiProvider
  label: string
  binNames: string[]
  models: string[]
  defaultModel: string
  buildArgs: (ctx: TurnCtx) => string[]
  // Parse one NDJSON stdout line. Emit chat events; return a session id to
  // remember (for --resume) when the line carries one, else undefined.
  parseLine: (line: string, projectDir: string, emit: (text: string, tool?: [string, string]) => void) => string | undefined
}

// A short, scene-relative label for a tool's target path. The CLIs report
// absolute, symlink-resolved paths (e.g. macOS /private/var/…), so a naive
// path.relative can climb out with ../../ — prefer the meaningful src/… suffix,
// and fall back to the basename rather than showing a traversal chain.
function rel(projectDir: string, p: unknown): string {
  if (typeof p !== 'string' || p === '') return ''
  const srcIdx = p.lastIndexOf('/src/')
  if (srcIdx >= 0) return p.slice(srcIdx + 1)
  try {
    const r = path.relative(projectDir, p)
    return r === '' || r.startsWith('..') ? path.basename(p) : r
  } catch {
    return path.basename(p)
  }
}

const PROVIDERS: Record<AiProvider, ProviderDef> = {
  claude: {
    id: 'claude',
    label: 'Claude',
    binNames: ['claude'],
    models: ['default', 'opus', 'sonnet', 'haiku'],
    defaultModel: 'default',
    buildArgs: (ctx) => {
      const args = [
        '-p',
        ctx.text,
        '--output-format',
        'stream-json',
        '--verbose', // required alongside stream-json under -p
        '--permission-mode',
        'acceptEdits', // auto-apply file edits, no interactive prompt (we're headless)
        '--allowedTools',
        'Read,Edit,Write,Glob,Grep', // file tools only — no Bash, no web (no network)
        '--append-system-prompt',
        DCL_SYSTEM_PROMPT
      ]
      if (ctx.model !== undefined && ctx.model !== 'default') args.push('--model', ctx.model)
      if (ctx.resume !== undefined) args.push('--resume', ctx.resume)
      return args
    },
    parseLine: (line, projectDir, emit) => {
      let obj: {
        type?: string
        subtype?: string
        session_id?: string
        is_error?: boolean
        message?: { content?: Array<{ type?: string; text?: string; name?: string; input?: Record<string, unknown> }> }
      }
      try {
        obj = JSON.parse(line)
      } catch {
        return undefined // non-JSON chatter — ignore
      }
      if (obj.type === 'system' && obj.subtype === 'init') return obj.session_id
      if (obj.type === 'assistant' && obj.message?.content !== undefined) {
        for (const block of obj.message.content) {
          if (block.type === 'text' && block.text !== undefined && block.text !== '') emit(block.text)
          else if (block.type === 'tool_use' && block.name !== undefined) {
            const inp = block.input ?? {}
            const target = rel(projectDir, inp.file_path ?? inp.path ?? inp.pattern ?? '')
            emit('', [block.name, target])
          }
        }
      }
      if (obj.type === 'result') return obj.session_id
      return undefined
    }
  },
  // Codex, wired against `codex exec --json` (its non-interactive JSONL mode).
  // Resume is a SUBCOMMAND (`codex exec resume <threadId>`), not a flag; the
  // thread id comes from the `thread.started` event. `--ask-for-approval never`
  // + `--sandbox workspace-write` is the acceptEdits-scoped-to-cwd equivalent
  // (network is off by default in workspace-write); `--skip-git-repo-check`
  // lets it run in a scene folder that isn't a git repo. Disabled in the UI
  // when the binary isn't runnable, so this only matters where codex is set up.
  codex: {
    id: 'codex',
    label: 'Codex',
    binNames: ['codex'],
    models: ['default', 'gpt-5-codex', 'gpt-5'],
    defaultModel: 'default',
    buildArgs: (ctx) => {
      const base = ctx.resume !== undefined ? ['exec', 'resume', ctx.resume] : ['exec']
      const args = [
        ...base,
        '--json',
        '-C',
        ctx.projectDir,
        '--sandbox',
        'workspace-write', // writes confined to cwd, network off by default
        '--ask-for-approval',
        'never', // headless — never block on an approval prompt
        '--skip-git-repo-check'
      ]
      if (ctx.model !== undefined && ctx.model !== 'default') args.push('--model', ctx.model)
      args.push(ctx.text) // prompt is the trailing positional
      return args
    },
    parseLine: (line, projectDir, emit) => {
      let obj: {
        type?: string
        thread_id?: string
        item?: { type?: string; text?: string; command?: string; changes?: Array<{ path?: string }> }
      }
      try {
        obj = JSON.parse(line)
      } catch {
        return undefined
      }
      if (obj.type === 'thread.started') return obj.thread_id
      // act only on completed items (started/updated are partial and would dup)
      if (obj.type === 'item.completed' && obj.item !== undefined) {
        const item = obj.item
        if (item.type === 'agent_message' && item.text !== undefined && item.text !== '') emit(item.text)
        else if (item.type === 'file_change')
          for (const ch of item.changes ?? []) emit('', ['Edit', rel(projectDir, ch.path ?? '')])
        else if (item.type === 'command_execution' && item.command !== undefined) emit('', ['Run', item.command])
      }
      return undefined
    }
  }
}

export function detectProviders(): AiProviderInfo[] {
  return (Object.keys(PROVIDERS) as AiProvider[]).map((id) => {
    const def = PROVIDERS[id]
    const bin = findExecutable(def.binNames)
    return {
      id: def.id,
      label: def.label,
      models: def.models,
      defaultModel: def.defaultModel,
      available: bin !== null,
      reason: bin === null ? `${def.label} CLI not found — install it and sign in` : undefined
    }
  })
}

// One turn at a time. `sessions` holds each provider's resume id so consecutive
// turns chain into a single conversation until aiReset().
let current: { child: ChildProcess; turnId: string; done: boolean } | null = null
const sessions: Partial<Record<AiProvider, string>> = {}
let turnSeq = 0

function killTree(child: ChildProcess): void {
  child.stdout?.removeAllListeners('data')
  child.stderr?.removeAllListeners('data')
  if (child.pid === undefined) return
  try {
    if (process.platform === 'win32') child.kill()
    else process.kill(-child.pid, 'SIGKILL') // whole detached group
  } catch {
    try {
      child.kill('SIGKILL')
    } catch {
      /* already gone */
    }
  }
}

export function aiStop(): void {
  if (current === null) return
  const c = current
  current = null
  if (!c.done) {
    c.done = true
    killTree(c.child)
  }
}

export function aiReset(): void {
  aiStop()
  delete sessions.claude
  delete sessions.codex
}

// Spawn one turn and stream its events through `emit`. Resolves as soon as the
// child is running (with the turn id) — the conversation streams asynchronously;
// it does NOT wait for the turn to finish.
export function aiSend(
  params: AiSendParams,
  projectDir: string | null,
  emit: (e: AiEvent) => void
): { turnId: string } {
  if (projectDir === null) throw new Error('Open a scene before using the assistant.')
  const def = PROVIDERS[params.provider]
  if (def === undefined) throw new Error(`Unknown assistant "${params.provider}".`)
  const bin = findExecutable(def.binNames)
  if (bin === null) throw new Error(`${def.label} CLI not found — install it and sign in.`)

  aiStop() // supersede any in-flight turn
  const turnId = `t${++turnSeq}`
  // Prepend editor context (selected entity + components) to the prompt so the
  // assistant knows what "this entity" means, without the user retyping it.
  const prompt = params.context !== undefined && params.context !== '' ? `${params.context}\n\n---\n\n${params.text}` : params.text
  const args = def.buildArgs({ text: prompt, model: params.model, projectDir, resume: sessions[params.provider] })

  let child: ChildProcess
  try {
    child = spawn(bin, args, {
      cwd: projectDir,
      env: childEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32' // own process group so killTree reaps children
    })
  } catch (e) {
    throw new Error(`failed to launch ${def.label}: ${String(e)}`)
  }

  const turn = { child, turnId, done: false }
  current = turn
  emit({ kind: 'started', turnId })

  const finish = (ok: boolean, message?: string): void => {
    if (turn.done) return
    turn.done = true
    if (message !== undefined) emit({ kind: 'error', turnId, message })
    emit({ kind: 'done', turnId, ok })
    if (current === turn) current = null
  }

  let stderr = ''
  let buf = ''
  // StringDecoder buffers a multibyte UTF-8 codepoint split across two stdout
  // chunks; a plain buf += d.toString() would decode each half alone and emit
  // U+FFFD, corrupting emoji/i18n text mid-stream.
  const outDec = new StringDecoder('utf8')
  const errDec = new StringDecoder('utf8')
  const onLine = (line: string): void => {
    if (line === '') return
    const session = def.parseLine(line, projectDir, (text, tool) => {
      if (text !== '') emit({ kind: 'text', turnId, text })
      if (tool !== undefined) emit({ kind: 'tool', turnId, tool: tool[0], detail: tool[1] })
    })
    if (session !== undefined) sessions[params.provider] = session
  }

  child.stdout?.on('data', (d: Buffer) => {
    buf += outDec.write(d)
    let nl: number
    while ((nl = buf.indexOf('\n')) >= 0) {
      onLine(buf.slice(0, nl).trim())
      buf = buf.slice(nl + 1)
    }
  })
  child.stderr?.on('data', (d: Buffer) => {
    stderr += errDec.write(d)
    if (stderr.length > 8000) stderr = stderr.slice(-8000)
  })
  child.on('error', (e) => finish(false, `assistant failed to start: ${e.message}`))
  child.on('exit', (code) => {
    buf += outDec.end()
    if (buf.trim() !== '') onLine(buf.trim()) // flush a trailing partial line
    if (code === 0 || code === null) finish(true)
    else finish(false, (stderr + errDec.end()).trim() || `assistant exited with code ${code}`)
  })

  return { turnId }
}
