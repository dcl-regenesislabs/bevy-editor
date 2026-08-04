// The AI assistant surface. One component, two modes (ai-store.ts):
//  - 'dock'   : a narrow right chat drawer over the live scene (quick asks)
//  - 'studio' : file rail + editor + chat (the scene stays in the left gutter)
// Chat/session state lives here so it follows the creator between modes. It drives
// the Claude/Codex CLI (main process), which edits project files on disk — Scripts
// under src/scripts/ and the scene's entry point src/index.ts; in Studio those
// edits arrive as an accept/reject diff via the CodeEditor handle — nothing runs
// in the scene until the creator accepts. Absent in a browser tab.
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { AiEvent, AiImageAttachment, AiProvider, AiProviderInfo } from '@dcl-editor/contract'
import { AutoSaveChip, Button, Modal, Spinner, useOutsideClose } from '../ds'
import { useStore } from '../store'
import { state, entityLabel, type Snapshot } from '../../../scene/src/state'
import { entityName, NAME_COMPONENT } from '../../../scene/src/custom-components'
import { isAllowedComponent, SCRIPT_COMPONENT } from '../../../scene/src/allowed-components'
import { CodeEditor, type CodeEditorHandle } from '../script/code-editor'
import { IconBot, IconCode } from '../icons'
import { aiStore, clearRevealLine, closeAssistant, closeDoc, openDoc, openStudio, refreshFileRail, setMode, setSelection, setStudioChordHandler, setStudioFile, toggleAssistant, type CodeSelection } from './ai-store'
import { uiSelectEntity } from '../actions'
import { FileRail } from '../features/ai/FileRail'
import { QuickOpen } from '../features/ai/QuickOpen'
import { FilePreview } from '../features/ai/FilePreview'
import { baseName, isEditable } from '../script/project-files'
import { isEntryPoint } from '../script/guarded'
import { attachScript } from '../script/attach'
import { attachablePath } from '../script/template'
import { buildGuideIndex, buildSceneRoster, type GuideEntry } from '../ai/roster'
import { clearEditorRequests, runEditorRequests } from '../ai/requests'
import { ensurePrefabsLoaded, prefabStore } from './prefab-store'

interface ToolUse {
  tool: string
  detail: string
}
type ChatMsg =
  | { role: 'user'; text: string; images?: string[] }
  | { role: 'assistant'; turnId?: string; text: string; tools: ToolUse[]; done: boolean; error?: string }

const MAX_ATTACH = 4
const MAX_ATTACH_BYTES = 8 * 1024 * 1024
// tool chips that changed the project or the scene, highlighted apart from reads
const MUTATION_TOOLS = new Set(['Edit', 'Write', 'Attached', 'Placed'])

function readImages(files: Iterable<File>, room: number): Promise<AiImageAttachment[]> {
  const picked = [...files].filter((f) => f.type.startsWith('image/') && f.size > 0 && f.size <= MAX_ATTACH_BYTES).slice(0, room)
  return Promise.all(
    picked.map(
      (f) =>
        new Promise<AiImageAttachment>((resolve, reject) => {
          const r = new FileReader()
          r.onload = () => resolve({ name: f.name === '' ? 'pasted image' : f.name, dataUrl: String(r.result) })
          r.onerror = () => reject(new Error(`could not read ${f.name}`))
          r.readAsDataURL(f)
        })
    )
  )
}

const isMac = navigator.platform.toLowerCase().includes('mac')

const EXAMPLES = [
  'Make this entity spin slowly around Y',
  'Open the door on pointer down, close it after 3s',
  'Open the door when someone walks up'
]
// One-tap prompts shown when a code range is attached (for creators who don't read TS).
const QUICK_ACTIONS: Array<[string, string]> = [
  ['Explain', 'Explain what the selected code does, in plain language.'],
  ['Fix', 'Find and fix any bugs in the selected code.'],
  ['Comment', 'Add clear, concise comments to the selected code.'],
  ['Improve', 'Improve the selected code — clarity and correctness — keeping its behavior.']
]

// Install + sign-in steps shown when a provider's CLI isn't available.
const SETUP: Record<AiProvider, { install: string; signIn: string }> = {
  claude: { install: 'npm i -g @anthropic-ai/claude-code', signIn: 'claude' },
  codex: { install: 'npm i -g @openai/codex', signIn: 'codex login' }
}

function FileCrumbs(props: { path: string }): JSX.Element {
  const parts = props.path.split('/')
  const dirs = parts.slice(0, -1)
  return (
    <span className="eui-studio-crumbs" title={props.path}>
      {dirs.map((d, i) => (
        <span key={i} className="dir">
          {d}
          <span className="sep">/</span>
        </span>
      ))}
      <span className="base">{parts[parts.length - 1]}</span>
    </span>
  )
}

function sameFile(reported: string, open: string): boolean {
  const a = reported.replace(/\\/g, '/').replace(/^\.\//, '')
  const b = open.replace(/^\.\//, '')
  return a === b || a.endsWith(`/${b}`)
}

function toolLabel(t: ToolUse): string {
  if (t.detail === '') return t.tool
  if (t.tool === 'Attached') return `Attached ${t.detail}`
  if (t.tool === 'Write') return `Created ${t.detail}`
  if (t.tool === 'Edit') return `Edited ${t.detail}`
  if (t.tool === 'Read') return `Read ${t.detail}`
  if (t.tool === 'Run') return `Ran ${t.detail}`
  return `${t.tool} ${t.detail}`
}

function friendlyError(raw: string): string {
  const s = raw.toLowerCase()
  if (s.includes('not found') || s.includes('enoent')) return "The assistant's CLI isn't installed or on PATH."
  if (s.includes('logged in') || s.includes('login') || s.includes('unauthorized') || s.includes('401'))
    return 'Not signed in — sign in to your subscription from a terminal, then try again.'
  if (s.includes('open a scene')) return 'Open a scene first, then ask the assistant.'
  if (s.includes('rate') && s.includes('limit')) return "You've hit your plan's rate limit — wait a moment and retry."
  if (s.includes('timed out') || s.includes('timeout')) return 'The request timed out. Try again.'
  return "The assistant hit an error. Retry, or check it's signed in."
}

function composerPlaceholder(available: boolean, hasSelection: boolean): string {
  if (!available) return 'Assistant unavailable'
  if (hasSelection) return 'Ask about the selected code…'
  return 'Describe the behavior you want…'
}

function displayName(n: string): string {
  if (n === SCRIPT_COMPONENT) return 'Script'
  const i = n.indexOf('::')
  return i === -1 ? n : n.slice(i + 2)
}

// The script files attached to the currently selected entity (its Script
// component's paths) — what the dock's ⤢ Code button opens as tabs.
function entityScriptFiles(): string[] {
  const id = state.activeEntity
  if (id === null) return []
  const comp = state.snapshot[id]?.[SCRIPT_COMPONENT] as { value?: Array<{ path?: string }> } | undefined
  return Array.isArray(comp?.value) ? comp.value.map((s) => s.path).filter((p): p is string => typeof p === 'string') : []
}

interface EntityInfo {
  id: string
  name: string
  comps: Array<[string, unknown]>
}

// All selected entities, active (gizmo anchor) first.
function selectedEntities(): EntityInfo[] {
  const snap = state.snapshot
  const active = state.activeEntity
  const ids: string[] = []
  if (active !== null) ids.push(active)
  for (const id of state.selected) if (id !== active) ids.push(id)
  const out: EntityInfo[] = []
  for (const id of ids) {
    const bag = snap[id]
    if (bag === undefined) continue
    const name = entityName(snap as Snapshot, id) ?? entityLabel(id)
    const comps = Object.entries(bag).filter(([n]) => isAllowedComponent(n) && n !== NAME_COMPONENT)
    out.push({ id, name, comps })
  }
  return out
}

function guideEntries(): GuideEntry[] {
  return prefabStore.items
    .filter((item) => item.hasGuide)
    .map((item) => ({
      folder: item.folder,
      name: item.data.name,
      version: item.data.version ?? '',
      description: item.data.description ?? ''
    }))
}

// Full turn context: the selected entity (+ components), the prefab guides this
// project ships and, if attached, the code range the creator asked about.
// Prepended to the prompt, not shown as the chat bubble.
function buildContext(sel: CodeSelection | null): string | undefined {
  const parts: string[] = [buildSceneRoster(state.snapshot)]
  const guides = buildGuideIndex(guideEntries())
  if (guides !== '') parts.push(guides)
  const open = aiStore.file
  if (open !== null) {
    parts.push(
      isEntryPoint(open)
        ? `[Open file] The user has ${open} open — the scene's ENTRY POINT, not a per-entity script. ` +
            `Code here is scene-global: systems registered with engine.addSystem, shared state, entities the scene ` +
            `creates itself. It must keep exporting a working main(); register systems inside it. ` +
            `Do not turn this file into a Script class.`
        : `[Open file] The user has ${open} open in the editor.`
    )
  }
  const ents = selectedEntities()
  if (ents.length > 0) {
    const compact = (v: unknown): string => {
      try {
        const s = JSON.stringify(v)
        return s.length > 220 ? s.slice(0, 220) + '…' : s
      } catch {
        return String(v)
      }
    }
    const block = (e: EntityInfo): string => {
      const lines = e.comps.map(([n, v]) => `- ${displayName(n)}: ${compact(v)}`)
      return `Entity: "${e.name}" (id ${e.id})\n` + (lines.length > 0 ? `Components on it:\n${lines.join('\n')}` : 'It has no components yet.')
    }
    const many = ents.length > 1
    const scope = many
      ? `has ${ents.length} entities selected. ` +
        `When they say "these", "them", or "the selected entities", they mean all of them; ` +
        `"this" or "it" most likely means the active one, "${ents[0].name}"`
      : `has ONE entity selected. When they say "this", "it", or "this entity", they mean this one`
    const script = many
      ? ' — a Script attached to an entity receives that entity as `this.entity`'
      : ' — a Script for it receives it as `this.entity`'
    parts.push(
      `[Editor context] The user is editing this scene visually and ${scope}` +
        (isEntryPoint(open) ? '' : script) +
        `.\n` +
        ents.map(block).join('\n')
    )
  }
  if (sel !== null) {
    parts.push(
      `[Selected code] The user is asking about THIS code — ${sel.path}, lines ${sel.startLine}–${sel.endLine}. Edit this file directly if a change is needed:\n\`\`\`ts\n${sel.text}\n\`\`\``
    )
  }
  return parts.length > 0 ? parts.join('\n\n') : undefined
}

// ---- tiny, safe markdown (no dep) ----
function inlineMd(s: string, keyBase: string): Array<string | JSX.Element> {
  const out: Array<string | JSX.Element> = []
  const re = /(`[^`]+`|\*\*[^*]+\*\*)/g
  let last = 0
  let m: RegExpExecArray | null
  let k = 0
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) out.push(s.slice(last, m.index))
    const tok = m[0]
    if (tok.startsWith('`')) out.push(<code key={`${keyBase}-${k++}`} className="eui-ai-ic">{tok.slice(1, -1)}</code>)
    else out.push(<strong key={`${keyBase}-${k++}`}>{tok.slice(2, -2)}</strong>)
    last = re.lastIndex
  }
  if (last < s.length) out.push(s.slice(last))
  return out
}
function Prose(props: { text: string }): JSX.Element {
  const lines = props.text.split('\n')
  const blocks: JSX.Element[] = []
  let list: string[] = []
  let k = 0
  const flush = (): void => {
    if (list.length > 0) {
      const items = list
      blocks.push(
        <ul key={`u${k++}`} className="eui-ai-ul">
          {items.map((li, i) => (
            <li key={i}>{inlineMd(li, `u${k}-${i}`)}</li>
          ))}
        </ul>
      )
      list = []
    }
  }
  for (const ln of lines) {
    const t = ln.replace(/\s+$/, '')
    if (/^\s*[-*]\s+/.test(t)) {
      list.push(t.replace(/^\s*[-*]\s+/, ''))
      continue
    }
    flush()
    if (t.trim() === '') continue
    const h = /^(#{1,3})\s+(.*)/.exec(t)
    if (h !== null) blocks.push(<div key={`h${k++}`} className="eui-ai-h">{inlineMd(h[2], `h${k}`)}</div>)
    else blocks.push(<p key={`p${k++}`} className="eui-ai-p">{inlineMd(t, `p${k}`)}</p>)
  }
  flush()
  return <>{blocks}</>
}
function MarkdownText(props: { text: string }): JSX.Element {
  const parts: JSX.Element[] = []
  const re = /```(\w*)\n?([\s\S]*?)```/g
  let last = 0
  let m: RegExpExecArray | null
  let k = 0
  while ((m = re.exec(props.text)) !== null) {
    if (m.index > last) parts.push(<Prose key={k++} text={props.text.slice(last, m.index)} />)
    parts.push(
      <pre key={k++} className="eui-ai-code">
        <code>{m[2].replace(/\n$/, '')}</code>
      </pre>
    )
    last = re.lastIndex
  }
  if (last < props.text.length) parts.push(<Prose key={k++} text={props.text.slice(last)} />)
  return <>{parts}</>
}

const CubeIcon = (): JSX.Element => (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M8 1.6l5.5 3.2v6.4L8 14.4l-5.5-3.2V4.8L8 1.6Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    <path d="M2.6 4.9L8 8l5.4-3.1M8 8v6.2" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
  </svg>
)
const CheckIcon = (): JSX.Element => (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M3 8.5l3.2 3L13 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)
const ImageIcon = (): JSX.Element => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <rect x="1.8" y="2.8" width="12.4" height="10.4" rx="1.6" stroke="currentColor" strokeWidth="1.3" />
    <circle cx="5.7" cy="6.3" r="1.15" fill="currentColor" />
    <path d="M3.6 12.6l3.4-3.6 2.3 2.3 2-2.1 2.9 3.1" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
  </svg>
)
const ArrowUpIcon = (): JSX.Element => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M8 13V3.5M4 7l4-3.8L12 7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

function ModelMenu(props: {
  providers: AiProviderInfo[]
  provider: AiProvider
  model: string
  current?: AiProviderInfo
  onProvider: (id: AiProvider) => void
  onModel: (m: string) => void
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useOutsideClose(open, ref, () => setOpen(false))
  const models = props.current?.models ?? ['default']
  const modelLabel = props.model === 'default' ? 'Default' : props.model
  return (
    <div className="eui-ai-model" ref={ref}>
      <button className="eui-ai-modelbtn" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}>
        <span className="prov">{props.current?.label ?? props.provider}</span>
        <span className="dot">·</span>
        <span className="mdl">{modelLabel}</span>
        <svg className={`chev ${open ? 'open' : ''}`} viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
          <path d="M2.5 4.5L6 8l3.5-3.5" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="eui-ai-menu" role="menu">
          <div className="eui-ai-menu-label">Provider</div>
          {props.providers.map((p) => (
            <button
              key={p.id}
              className={`eui-ai-menu-item ${!p.available ? 'off' : ''}`}
              role="menuitemradio"
              aria-checked={p.id === props.provider}
              disabled={!p.available}
              data-tip={!p.available ? p.reason : undefined}
              onClick={() => {
                props.onProvider(p.id)
                setOpen(false)
              }}
            >
              <span className="tick">{p.id === props.provider && <CheckIcon />}</span>
              <span className="lbl">{p.label}</span>
              {!p.available && <span className="tag">unavailable</span>}
            </button>
          ))}
          <div className="eui-ai-menu-sep" />
          <div className="eui-ai-menu-label">Model</div>
          {models.map((m) => (
            <button
              key={m}
              className="eui-ai-menu-item"
              role="menuitemradio"
              aria-checked={m === props.model}
              onClick={() => {
                props.onModel(m)
                setOpen(false)
              }}
            >
              <span className="tick">{m === props.model && <CheckIcon />}</span>
              <span className="lbl">{m === 'default' ? 'Default' : m}</span>
              {m === 'default' && <span className="tag soft">recommended</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function AiPanel(): JSX.Element | null {
  const shell = window.editorShell
  const open = useStore(() => aiStore.open)
  const mode = useStore(() => aiStore.mode)
  const file = useStore(() => aiStore.file)
  const tabs = useStore(() => aiStore.tabs)
  const selection = useStore(() => aiStore.selection)
  const [providers, setProviders] = useState<AiProviderInfo[]>([])
  const [provider, setProvider] = useState<AiProvider>('claude')
  const [model, setModel] = useState('default')
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [input, setInput] = useState('')
  const [attachments, setAttachments] = useState<AiImageAttachment[]>([])
  const fileRef = useRef<HTMLInputElement>(null)
  const addImages = (files: Iterable<File>): void => {
    void readImages(files, MAX_ATTACH - attachments.length).then(
      (imgs) => imgs.length > 0 && setAttachments((prev) => [...prev, ...imgs].slice(0, MAX_ATTACH))
    )
  }
  const [busy, setBusy] = useState(false)
  const [fileStatus, setFileStatus] = useState<{ text: string; kind: 'dim' | 'ok' | 'err' }>({ text: '', kind: 'dim' })
  const [dirty, setDirty] = useState(false)
  const railKey = useStore(() => aiStore.railVersion)
  const [confirmWipe, setConfirmWipe] = useState<{ kind: 'new' | AiProvider; label: string } | null>(null)
  const [showQuickOpen, setShowQuickOpen] = useState(false)
  const [errorDetail, setErrorDetail] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const lastPrompt = useRef<string | null>(null)
  const activeTurn = useRef<string | null>(null)
  const editorRef = useRef<CodeEditorHandle>(null)
  const openFileTouched = useRef(false)
  const attachTarget = useRef<string | null>(null) // entity active at turn start — selection can move while the CLI works
  const createdScripts = useRef<string[]>([])
  const stopRef = useRef<() => void>(() => {}) // latest stop(), for the Escape handler
  useStore(() => state.activeEntity)
  useStore(() => state.selected)
  useStore(() => state.snapshot)
  const entities = selectedEntities()
  const current = providers.find((p) => p.id === provider)
  const available = current?.available ?? false
  const anyAvailable = providers.some((p) => p.available)

  useEffect(() => {
    if (shell?.onAiEvent === undefined) return
    void shell.aiReset?.()

    const addTools = (turnId: string, items: ToolUse[]): void => {
      if (items.length === 0) return
      setMessages((prev) =>
        prev.map((m) => (m.role === 'assistant' && m.turnId === turnId ? { ...m, tools: [...m.tools, ...items] } : m))
      )
    }

    const autoAttach = async (turnId: string, entityId: string, paths: string[]): Promise<void> => {
      for (const path of paths) {
        let attached = false
        try {
          attached = await attachScript(entityId, path)
        } catch (err) {
          console.error('auto-attach failed:', path, err)
        }
        if (!attached) continue
        const to = entityName(state.snapshot as Snapshot, entityId) ?? entityLabel(entityId)
        addTools(turnId, [{ tool: 'Attached', detail: `${baseName(path)} to ${to}` }])
      }
    }

    const finishTurn = async (turnId: string, target: string | null, paths: string[]): Promise<void> => {
      let claimed: string[] = []
      try {
        const run = await runEditorRequests(target)
        addTools(turnId, run.outcomes)
        if (run.problems.length > 0) addTools(turnId, [{ tool: 'Skipped', detail: run.problems.join('; ') }])
        claimed = run.attached
      } catch (err) {
        console.error('assistant requests failed:', err)
      }
      const rest = paths.filter((p) => !claimed.includes(p))
      if (target !== null && rest.length > 0) await autoAttach(turnId, target, rest)
    }

    shell.onAiEvent((e: AiEvent) => {
      if (e.kind === 'started') activeTurn.current = e.turnId
      else if (e.turnId !== activeTurn.current) return
      if (e.kind === 'tool' && (e.tool === 'Edit' || e.tool === 'Write')) {
        if (aiStore.file !== null && sameFile(e.detail, aiStore.file)) openFileTouched.current = true
        if (e.tool === 'Write') {
          refreshFileRail()
          const p = attachablePath(e.detail)
          if (p !== null && !createdScripts.current.includes(p)) createdScripts.current.push(p)
        }
      }
      setMessages((prev) => {
        const next = [...prev]
        let i = next.findIndex((m) => m.role === 'assistant' && m.turnId === e.turnId)
        if (i < 0)
          for (let j = next.length - 1; j >= 0; j--) {
            const m = next[j]
            if (m.role === 'assistant' && !m.done && m.turnId === undefined) {
              i = j
              break
            }
          }
        if (i < 0) {
          if (e.kind === 'started') next.push({ role: 'assistant', turnId: e.turnId, text: '', tools: [], done: false })
          return next
        }
        const msg = next[i] as Extract<ChatMsg, { role: 'assistant' }>
        if (e.kind === 'started') next[i] = { ...msg, turnId: e.turnId }
        else if (e.kind === 'text') next[i] = { ...msg, turnId: e.turnId, text: msg.text + e.text }
        else if (e.kind === 'tool') next[i] = { ...msg, turnId: e.turnId, tools: [...msg.tools, { tool: e.tool, detail: e.detail }] }
        else if (e.kind === 'error') next[i] = { ...msg, error: e.message }
        else if (e.kind === 'done') next[i] = { ...msg, done: true }
        return next
      })
      if (e.kind === 'done') {
        activeTurn.current = null
        setBusy(false)
        const ed = editorRef.current
        if (ed !== null && aiStore.mode === 'studio' && aiStore.file !== null) {
          ed.freeze(false)
          if (openFileTouched.current) void ed.reviewAgainstDisk()
        }
        openFileTouched.current = false
        const target = attachTarget.current
        const paths = createdScripts.current
        attachTarget.current = null
        createdScripts.current = []
        if (e.ok) void finishTurn(e.turnId, target, paths)
      }
    })
  }, [])

  useEffect(() => {
    if (shell?.aiProviders === undefined) return
    void shell.aiProviders().then((list) => {
      setProviders(list)
      const first = list.find((p) => p.available) ?? list[0]
      if (first !== undefined) {
        setProvider(first.id)
        setModel(first.defaultModel)
      }
    })
  }, [])

  useEffect(() => {
    if (scrollRef.current !== null) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages, open, mode])

  useEffect(() => {
    if (!open) return
    inputRef.current?.focus()
    ensurePrefabsLoaded()
  }, [open])

  // Escape closes the assistant. Layered so it always does the least-destructive
  // useful thing first: dismiss the error modal → cancel a confirm → stop a running
  // turn → close. CodeMirror sees the key first (element handlers run before this
  // document listener); if it consumed it (autocomplete, search…) it preventDefaults
  // and we leave it alone — otherwise Escape closes the Studio even from the editor.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      if (errorDetail !== null) {
        setErrorDetail(null)
        return
      }
      const fromEditor = e.composedPath().some((el) => el instanceof HTMLElement && el.classList.contains('cm-editor'))
      if (fromEditor && e.defaultPrevented) return
      if (showQuickOpen) {
        setShowQuickOpen(false)
        return
      }
      if (confirmWipe !== null) {
        setConfirmWipe(null)
        return
      }
      if (busy) {
        stopRef.current()
        return
      }
      // through the navigation guard: flush a dirty buffer (keep the Studio on a
      // failed save), and never close over a pending AI diff
      leaveTabRef.current(closeAssistant)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, busy, errorDetail, confirmWipe, showQuickOpen])

  const reveal = useStore(() => aiStore.revealLine)
  useEffect(() => {
    if (reveal === null || reveal.file !== file) return
    let cancelled = false
    const t = setTimeout(() => {
      if (cancelled) return
      editorRef.current?.revealLine(reveal.line)
      clearRevealLine()
    }, 120)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [reveal, file])

  const prefill = useStore(() => aiStore.prefill)
  useEffect(() => {
    if (prefill === null) return
    setInput((cur) => (cur.trim() === '' ? prefill : `${cur.replace(/\s*$/, '')}\n\n${prefill}`))
    aiStore.prefill = null
    const ta = inputRef.current
    if (ta !== null) {
      ta.focus()
      requestAnimationFrame(() => ta.setSelectionRange(ta.value.length, ta.value.length))
    }
  }, [prefill])

  // Guard on every way of leaving the current tab (tab click/✕, ⌘W, tab cycling,
  // quick-open, the file rail, Escape-close). A streaming turn owns the editor
  // and a pending AI diff must be accepted or discarded, not navigated away; a
  // dirty buffer is flushed first, and a FAILED flush keeps the tab open — the
  // buffer is the only copy of the edits.
  const leaveTab = (then: () => void): void => {
    const ed = editorRef.current
    if (ed === null) {
      then()
      return
    }
    if (busy) {
      setFileStatus({ text: 'Wait for the assistant to finish', kind: 'dim' })
      return
    }
    if (ed.isReviewing()) {
      setFileStatus({ text: 'Accept or discard the change first', kind: 'dim' })
      return
    }
    if (!ed.isDirty()) {
      then()
      return
    }
    ed.flush().then(then, (err: unknown) => setFileStatus({ text: `Save failed — keeping the tab open: ${String(err)}`, kind: 'err' }))
  }
  const leaveTabRef = useRef(leaveTab)
  leaveTabRef.current = leaveTab

  // Studio keys this window CAN see (not claimed by the main process): ⌘P quick
  // open, ⌘⇧[ / ⌘⇧] tab cycling. e.code, not e.key — shifted brackets produce
  // different characters per layout. Platform-primary modifier only: on a Mac,
  // Ctrl+P is caret-up in text fields and CodeMirror.
  useEffect(() => {
    if (!open || mode !== 'studio') return
    const onKey = (e: KeyboardEvent): void => {
      const primary = isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey
      if (!primary || e.altKey) return
      if (e.code === 'KeyP' && !e.shiftKey) {
        e.preventDefault()
        setShowQuickOpen((v) => !v)
      } else if (e.shiftKey && (e.code === 'BracketLeft' || e.code === 'BracketRight')) {
        e.preventDefault()
        const t = aiStore.tabs
        const f = aiStore.file
        if (t.length < 2 || f === null) return
        const i = t.indexOf(f)
        const next = t[(i + (e.code === 'BracketRight' ? 1 : -1) + t.length) % t.length]
        leaveTabRef.current(() => setStudioFile(next))
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      setShowQuickOpen(false)
    }
  }, [open, mode])

  // ⌘W (close tab), ⌘F (find in file) and ⌘Z/⌘⇧Z (text undo) are intercepted by
  // the main process; boot.ts offers them here first. ⌘W/⌘F are claimed even
  // when they can't act (no file open, read-only preview) — falling through to
  // "switch to the Move tool" / "fly the camera at the selection" behind an open
  // Studio would be far more surprising than a no-op. Undo/redo are claimed only
  // while the code editor has focus, so scene undo still works from the gutter.
  useEffect(() => {
    if (!open || mode !== 'studio') return
    setStudioChordHandler((c) => {
      switch (c) {
        case 'close-tab': {
          const f = aiStore.file
          if (f !== null) leaveTabRef.current(() => closeDoc(f))
          return true
        }
        case 'find':
          editorRef.current?.openSearch()
          return true
        case 'undo':
          return editorRef.current?.textUndo() ?? false
        case 'redo':
          return editorRef.current?.textRedo() ?? false
      }
    })
    return () => setStudioChordHandler(null)
  }, [open, mode])

  if (shell?.aiSend === undefined || !open) return null

  const scriptFiles = entityScriptFiles() // scripts on the selected entity → Studio entry from the dock

  // Re-probe the CLIs (after the user installs/signs in) without restarting.
  const recheck = (): void => {
    void shell.aiProviders?.().then((list) => {
      setProviders(list)
      if (!list.some((p) => p.id === provider && p.available)) {
        const first = list.find((p) => p.available)
        if (first !== undefined) {
          setProvider(first.id)
          setModel(first.defaultModel)
        }
      }
    })
  }

  const send = (text: string): void => {
    const t = text.trim()
    if ((t === '' && attachments.length === 0) || busy || !available) return
    const asked = t === '' ? 'Look at the attached image.' : t
    lastPrompt.current = asked
    const sel = aiStore.selection
    const imgs = attachments
    const run = (): void => {
      openFileTouched.current = false
      attachTarget.current = state.activeEntity
      createdScripts.current = []
      void clearEditorRequests()
      setMessages((prev) => [
        ...prev,
        { role: 'user', text: asked, images: imgs.length > 0 ? imgs.map((i) => i.dataUrl) : undefined },
        { role: 'assistant', text: '', tools: [], done: false }
      ])
      setInput('')
      setAttachments([])
      setBusy(true)
      void shell.aiSend?.({ provider, model, text: asked, context: buildContext(sel), images: imgs.length > 0 ? imgs : undefined }).catch((err: unknown) => {
        setMessages((prev) => {
          const next = [...prev]
          for (let i = next.length - 1; i >= 0; i--) {
            const m = next[i]
            if (m.role === 'assistant' && !m.done) {
              next[i] = { ...m, done: true, error: String(err) }
              break
            }
          }
          return next
        })
        setBusy(false)
        editorRef.current?.freeze(false)
      })
    }
    // Studio + open file: save the buffer so the CLI edits the latest, baseline
    // it for the diff, and freeze the editor so human + AI can't diverge.
    const ed = editorRef.current
    if (mode === 'studio' && file !== null && ed !== null) {
      void ed
        .flush()
        .catch(() => {})
        .then(() => {
          ed.snapshot()
          ed.freeze(true)
          run()
        })
    } else run()
  }

  const retry = (): void => {
    if (lastPrompt.current !== null) send(lastPrompt.current)
  }
  const stop = (): void => {
    void shell.aiStop?.()
    activeTurn.current = null
    setBusy(false)
    editorRef.current?.freeze(false)
    setMessages((prev) => prev.map((m) => (m.role === 'assistant' && !m.done ? { ...m, done: true } : m)))
  }
  stopRef.current = stop
  const doWipe = (kind: 'new' | AiProvider): void => {
    void shell.aiStop?.()
    void shell.aiReset?.()
    activeTurn.current = null
    setMessages([])
    setBusy(false)
    if (kind !== 'new') {
      const p = providers.find((x) => x.id === kind)
      setProvider(kind)
      if (p !== undefined) setModel(p.defaultModel)
    }
  }
  const requestSwitch = (id: AiProvider): void => {
    if (id === provider) return
    if (messages.length > 0) {
      const p = providers.find((x) => x.id === id)
      setConfirmWipe({ kind: id, label: `Switch to ${p?.label ?? id}? This starts a new conversation.` })
    } else doWipe(id)
  }

  // The conversation column (messages + composer) — identical in both modes.
  const chat = (
    <div className="eui-ai-chat">
      <div className="eui-ai-body" ref={scrollRef}>
        {!available && (
          <div className="eui-ai-setup">
            <div className="eui-ai-empty-icon">
              <IconBot />
            </div>
            <p className="eui-ai-empty-title">{anyAvailable ? `${current?.label} isn’t ready` : 'Set up the AI assistant'}</p>
            <p className="eui-ai-empty-sub">
              It runs a local AI CLI on your own subscription — no API key.{' '}
              {anyAvailable ? 'Pick an available provider below, or set this one up:' : 'Install one, sign in, then recheck.'}
            </p>
            <div className="eui-ai-setup-list">
              {providers.map((p) => (
                <div key={p.id} className="eui-ai-setup-row">
                  <span className="pl">{p.label}</span>
                  {p.available ? (
                    <span className="ready">✓ ready</span>
                  ) : (
                    <span className="cmds">
                      <code>{SETUP[p.id].install}</code>
                      <code>
                        {SETUP[p.id].signIn} <span className="hint">↳ sign in</span>
                      </code>
                    </span>
                  )}
                </div>
              ))}
            </div>
            <button className="eui-ai-recheck" onClick={recheck}>
              ↻ Recheck
            </button>
          </div>
        )}
        {available && messages.length === 0 && (
          <div className="eui-ai-empty">
            <div className="eui-ai-empty-icon">
              <IconBot />
            </div>
            <p className="eui-ai-empty-title">Edit your scripts by chatting</p>
            <p className="eui-ai-empty-sub">
              Runs on your {current?.label} subscription — no API key. Edits arrive as a diff you accept.
              {mode === 'studio' ? ' Select code in the editor and it rides along with your next message.' : ' Select an entity and I’ll scope the code to it.'}
            </p>
            {mode !== 'studio' && (
              <div className="eui-ai-examples">
                {EXAMPLES.map((ex) => (
                  <button key={ex} className="eui-ai-example" onClick={() => send(ex)}>
                    {ex}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {messages.map((m, i) =>
          m.role === 'user' ? (
            <div key={i} className="eui-ai-msg user">
              {m.images !== undefined && (
                <span className="eui-ai-msg-imgs">
                  {m.images.map((src, j) => (
                    <img key={j} src={src} alt="attached" />
                  ))}
                </span>
              )}
              {m.text}
            </div>
          ) : (
            <div key={i} className="eui-ai-msg assistant">
              {m.tools.length > 0 && (
                <div className="eui-ai-tools">
                  {m.tools.map((t, j) => {
                    const inProgress = !m.done && j === m.tools.length - 1
                    return (
                      <span
                        key={j}
                        className={`eui-ai-tool ${MUTATION_TOOLS.has(t.tool) ? 'edit' : ''}`}
                      >
                        <span className="ti">{inProgress ? <Spinner size={11} /> : <CheckIcon />}</span>
                        {toolLabel(t)}
                      </span>
                    )
                  })}
                </div>
              )}
              {m.text !== '' && (
                <div className="eui-ai-text">
                  <MarkdownText text={m.text} />
                </div>
              )}
              {!m.done && m.text === '' && m.tools.length === 0 && (
                <span className="eui-ai-thinking">
                  <Spinner size={14} /> Thinking…
                </span>
              )}
              {m.error !== undefined && (
                <div className="eui-ai-err">
                  <span className="msg">{friendlyError(m.error)}</span>
                  <span style={{ flex: 1 }} />
                  <button className="eui-ai-retry ghost" onClick={() => setErrorDetail(m.error ?? '')}>
                    See details
                  </button>
                  <button className="eui-ai-retry" onClick={retry}>
                    Retry
                  </button>
                </div>
              )}
            </div>
          )
        )}
      </div>

      <div className="eui-ai-composer">
        {confirmWipe !== null && (
          <div className="eui-ai-confirm">
            <span>{confirmWipe.label}</span>
            <span style={{ flex: 1 }} />
            <button
              className="eui-ai-confirm-btn"
              onClick={() => {
                doWipe(confirmWipe.kind)
                setConfirmWipe(null)
              }}
            >
              Yes
            </button>
            <button className="eui-ai-confirm-btn ghost" onClick={() => setConfirmWipe(null)}>
              Cancel
            </button>
          </div>
        )}
        <div className="eui-ai-chips">
          {entities.length > 0 ? (
            entities.map((e) => (
              <span key={e.id} className="eui-ai-ctx on" data-tip="The assistant sees this entity and its components">
                <CubeIcon />
                <span className="nm">{e.name}</span>
                {entities.length === 1 && (
                  <span className="ct">
                    #{e.id} · {e.comps.length} comp{e.comps.length === 1 ? '' : 's'}
                  </span>
                )}
                <button className="x" onClick={() => uiSelectEntity(e.id, true, true)} aria-label={`Unselect ${e.name}`}>
                  ✕
                </button>
              </span>
            ))
          ) : (
            <span className="eui-ai-ctx empty" data-tip="Select an entity to scope edits to it">
              <CubeIcon />
              <span className="ct">Whole scene</span>
            </span>
          )}
          {selection !== null && (
            <span className="eui-ai-ctx code on" data-tip={selection.text}>
              <span className="ang">&lt;/&gt;</span>
              <span className="nm">{baseName(selection.path)}</span>
              <span className="ct">
                L{selection.startLine}–{selection.endLine}
              </span>
              <button className="x" onClick={() => setSelection(null)} aria-label="Remove code">
                ✕
              </button>
            </span>
          )}
        </div>

        {selection !== null && (
          <div className="eui-ai-quick">
            {QUICK_ACTIONS.map(([label, prompt]) => (
              <button key={label} className="eui-ai-qbtn" disabled={busy || !available} onClick={() => send(prompt)}>
                {label}
              </button>
            ))}
          </div>
        )}

        {attachments.length > 0 && (
          <div className="eui-ai-attachments">
            {attachments.map((img, i) => (
              <span key={i} className="eui-ai-attachment" title={img.name}>
                <img src={img.dataUrl} alt={img.name} />
                <button
                  className="rm"
                  aria-label={`Remove ${img.name}`}
                  onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}
        <div className={`eui-ai-field ${!available ? 'off' : ''}`}>
          <textarea
            ref={inputRef}
            className="eui-ai-input"
            placeholder={composerPlaceholder(available, selection !== null)}
            value={input}
            disabled={!available}
            spellCheck={false}
            rows={2}
            onChange={(e) => setInput(e.target.value)}
            onPaste={(e) => {
              const files = [...e.clipboardData.items]
                .filter((it) => it.kind === 'file' && it.type.startsWith('image/'))
                .map((it) => it.getAsFile())
                .filter((f): f is File => f !== null)
              if (files.length > 0) {
                e.preventDefault()
                addImages(files)
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send(input)
              }
              // Escape is handled globally (close / stop) — see the keydown effect
            }}
          />
          <div className="eui-ai-fieldbar">
            <ModelMenu providers={providers} provider={provider} model={model} current={current} onProvider={requestSwitch} onModel={setModel} />
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              multiple
              style={{ display: 'none' }}
              onChange={(e) => {
                if (e.target.files !== null) addImages(e.target.files)
                e.target.value = ''
              }}
            />
            <button
              className="eui-ai-attachbtn"
              disabled={!available || busy || attachments.length >= MAX_ATTACH}
              data-tip="Attach an image (or paste one)"
              aria-label="Attach image"
              onClick={() => fileRef.current?.click()}
            >
              <ImageIcon />
            </button>
            <span style={{ flex: 1 }} />
            {busy ? (
              <button className="eui-ai-send busy" onClick={stop} data-tip="Stop (Esc)" aria-label="Stop">
                <span className="ring" />
                <span className="sq" />
              </button>
            ) : (
              <button
                className="eui-ai-send"
                onClick={() => send(input)}
                disabled={!available || (input.trim() === '' && attachments.length === 0)}
                data-tip="Send (Enter)"
                aria-label="Send"
              >
                <ArrowUpIcon />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )

  const errorModal =
    errorDetail !== null ? (
      <Modal
        title="Assistant error"
        className="eui-ai-errmodal"
        onClose={() => setErrorDetail(null)}
        footer={
          <>
            <Button onClick={() => void navigator.clipboard?.writeText(errorDetail)}>Copy</Button>
            <Button variant="primary" onClick={() => setErrorDetail(null)}>Close</Button>
          </>
        }
      >
        <div className="eui-ai-modal-hint">{friendlyError(errorDetail)}</div>
        <pre className="eui-ai-errpre">{errorDetail}</pre>
      </Modal>
    ) : null

  if (mode === 'studio') {
    return (
      <>
        {errorModal}
        {showQuickOpen && <QuickOpen onOpen={(p) => leaveTab(() => openDoc(p))} onClose={() => setShowQuickOpen(false)} />}
        <aside className="eui-ai-panel studio">
        <header className="eui-studio-head">
          <span className="eui-studio-brand">
            <IconCode /> Script Studio
          </span>
          <span style={{ flex: 1 }} />
          <button className="eui-studio-hbtn" onClick={() => leaveTab(() => setMode('dock'))} data-tip="Collapse to chat">
            ⤡
          </button>
          <button className="eui-studio-hbtn" onClick={() => leaveTab(closeAssistant)} data-tip="Close">
            ✕
          </button>
        </header>
        <div className="eui-studio-split">
          <FileRail active={file} reloadKey={railKey} onOpen={(p) => leaveTab(() => openDoc(p))} />
          <div className="eui-studio-left">
            <div className="eui-studio-tabbar" role="tablist">
              {tabs.map((f) => (
                <span key={f} className={`eui-studio-tab ${f === file ? 'on' : ''} ${f === file && dirty ? 'dirty' : ''}`}>
                  <button className="lbl" role="tab" aria-selected={f === file} onClick={() => leaveTab(() => setStudioFile(f))} title={f}>
                    {baseName(f)}
                  </button>
                  <button className="x" onClick={() => leaveTab(() => closeDoc(f))} aria-label={`Close ${baseName(f)}`} data-tip="Close tab">
                    <i className="dot" aria-hidden="true" />
                    <span className="xi" aria-hidden="true">✕</span>
                  </button>
                </span>
              ))}
            </div>
            {file !== null && (
              <div className="eui-studio-filehead">
                <FileCrumbs path={file} />
                {isEntryPoint(file) && <span className="eui-studio-entry" data-tip="The scene's entry point — it must keep a working main()">entry point</span>}
                <span style={{ flex: 1 }} />
                {fileStatus.text !== '' && <AutoSaveChip state={fileStatus.kind}>{fileStatus.text}</AutoSaveChip>}
              </div>
            )}
            {file === null ? (
              <div className="eui-studio-nofile">
                <div className="eui-ai-empty-icon">
                  <IconCode />
                </div>
                <p className="ttl">No file open</p>
                <p className="sub">Pick a file from the tree on the left, or open a script from the entity inspector.</p>
              </div>
            ) : isEditable(file) ? (
              <CodeEditor
                key={file}
                ref={editorRef}
                path={file}
                guarded={isEntryPoint(file)}
                onSelect={setSelection}
                onAsk={(s) => {
                  setSelection(s)
                  inputRef.current?.focus()
                }}
                onDirty={setDirty}
                onResolved={(content) => aiStore.onSaved?.(file, content)}
                onStatus={(text, kind) => setFileStatus({ text, kind })}
              />
            ) : (
              <FilePreview key={file} path={file} />
            )}
          </div>
          <div className="eui-studio-right">{chat}</div>
        </div>
        </aside>
      </>
    )
  }

  return (
    <>
      {errorModal}
      <aside className="eui-ai-panel">
      <header className="eui-ai-head">
        <span className="eui-ai-title">
          <IconBot /> Assistant
        </span>
        <span style={{ flex: 1 }} />
        <button
          className="eui-ai-headbtn eui-ai-studiobtn"
          onClick={() => {
            if (scriptFiles.length > 0 && (file === null || !scriptFiles.includes(file))) openStudio(scriptFiles[0], scriptFiles)
            else setMode('studio')
          }}
          data-tip="Open Studio (files + editor + chat)"
        >
          ⤢ Code
        </button>
        <button className="eui-ai-headbtn" onClick={closeAssistant} data-tip="Close assistant">
          ✕
        </button>
      </header>
      {chat}
      </aside>
    </>
  )
}

// Floating action button that opens the assistant. Draggable to anywhere on
// screen (position persisted); a plain click (no drag) toggles the panel. Lives
// in the Electron shell only, and hides while the assistant is open.
const FAB_POS_KEY = 'eui-ai-fab-pos'
const FAB_SIZE = 54
function loadFabPos(): { right: number; bottom: number } | null {
  try {
    const raw = localStorage.getItem(FAB_POS_KEY)
    if (raw === null) return null
    const p = JSON.parse(raw) as { right: number; bottom: number }
    if (typeof p.right === 'number' && typeof p.bottom === 'number') return p
  } catch {
    /* ignore */
  }
  return null
}

export function AiFab(): JSX.Element | null {
  const open = useStore(() => aiStore.open)
  const [pos, setPos] = useState<{ right: number; bottom: number } | null>(loadFabPos)
  const drag = useRef<{ x: number; y: number; right: number; bottom: number; moved: boolean } | null>(null)
  if (window.editorShell?.aiSend === undefined || open) return null

  const clampR = (r: number): number => Math.max(8, Math.min(window.innerWidth - FAB_SIZE - 8, r))
  const clampB = (b: number): number => Math.max(12, Math.min(window.innerHeight - FAB_SIZE - 12, b))

  const onDown = (e: ReactPointerEvent<HTMLButtonElement>): void => {
    const cur = pos ?? { right: 22, bottom: 22 }
    drag.current = { x: e.clientX, y: e.clientY, right: cur.right, bottom: cur.bottom, moved: false }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onMove = (e: ReactPointerEvent<HTMLButtonElement>): void => {
    const d = drag.current
    if (d === null) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true
    setPos({ right: clampR(d.right - dx), bottom: clampB(d.bottom - dy) }) // right/bottom → -delta
  }
  const onUp = (e: ReactPointerEvent<HTMLButtonElement>): void => {
    const d = drag.current
    drag.current = null
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* not captured */
    }
    if (d === null) return
    if (!d.moved) {
      toggleAssistant()
      return
    }
    setPos((p) => {
      if (p !== null)
        try {
          localStorage.setItem(FAB_POS_KEY, JSON.stringify(p))
        } catch {
          /* storage full/blocked */
        }
      return p
    })
  }

  return (
    <button
      className="eui-ai-fab"
      style={pos !== null ? { right: pos.right, bottom: pos.bottom } : undefined}
      data-tip="AI assistant · drag to move"
      aria-label="Open AI assistant"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
    >
      <IconBot />
    </button>
  )
}

