// The AI assistant surface. One component, two modes (ai-store.ts):
//  - 'dock'   : a narrow right chat drawer over the live scene (quick asks)
//  - 'studio' : a wide editor+chat workspace (the scene stays in the left gutter)
// Chat/session state lives here so it follows the creator between modes. It drives
// the Claude/Codex CLI (main process) which edits src/scripts/*.ts on disk; in
// Studio those edits arrive as an accept/reject diff via the CodeEditor handle —
// nothing runs in the scene until the creator accepts. Absent in a browser tab.
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { AiEvent, AiProvider, AiProviderInfo } from '@dcl-editor/contract'
import { AutoSaveChip, Spinner, useOutsideClose } from '../ds'
import { useStore } from '../store'
import { state, entityLabel, type Snapshot } from '../../../scene/src/state'
import { entityName, NAME_COMPONENT } from '../../../scene/src/custom-components'
import { isAllowedComponent, SCRIPT_COMPONENT } from '../../../scene/src/allowed-components'
import { CodeEditor, type CodeEditorHandle } from '../script/code-editor'
import { aiStore, closeAssistant, openStudio, setMode, setSelection, setStudioFile, toggleAssistant, type CodeSelection } from './ai-store'

interface ToolUse {
  tool: string
  detail: string
}
type ChatMsg =
  | { role: 'user'; text: string }
  | { role: 'assistant'; turnId?: string; text: string; tools: ToolUse[]; done: boolean; error?: string }

const EXAMPLES = [
  'Make this entity spin slowly around Y',
  'Open the door on pointer down, close it after 3s',
  'Play a sound when the player enters the trigger'
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

const baseName = (p: string): string => p.split('/').pop() ?? p

function toolLabel(t: ToolUse): string {
  if (t.detail === '') return t.tool
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

function displayName(n: string): string {
  if (n === SCRIPT_COMPONENT) return 'Script'
  const i = n.indexOf('::')
  return i === -1 ? n : n.slice(i + 2)
}

// The script files attached to the currently selected entity (its Script
// component's paths) — drives the Studio tab strip and follow-selection.
function entityScriptFiles(): string[] {
  const id = state.activeEntity
  if (id === null) return []
  const comp = state.snapshot[id]?.[SCRIPT_COMPONENT] as { value?: Array<{ path?: string }> } | undefined
  return Array.isArray(comp?.value) ? comp.value.map((s) => s.path).filter((p): p is string => typeof p === 'string') : []
}

function selectedEntity(): { id: string; name: string; comps: Array<[string, unknown]> } | null {
  const id = state.activeEntity
  if (id === null) return null
  const snap = state.snapshot
  const bag = snap[id]
  if (bag === undefined) return null
  const name = entityName(snap as Snapshot, id) ?? entityLabel(id)
  const comps = Object.entries(bag).filter(([n]) => isAllowedComponent(n) && n !== NAME_COMPONENT)
  return { id, name, comps }
}

// Full turn context: the selected entity (+ components) and, if attached, the
// code range the creator asked about. Prepended to the prompt, not shown as the
// chat bubble.
function buildContext(sel: CodeSelection | null): string | undefined {
  const parts: string[] = []
  const e = selectedEntity()
  if (e !== null) {
    const compact = (v: unknown): string => {
      try {
        const s = JSON.stringify(v)
        return s.length > 220 ? s.slice(0, 220) + '…' : s
      } catch {
        return String(v)
      }
    }
    const lines = e.comps.map(([n, v]) => `- ${displayName(n)}: ${compact(v)}`)
    parts.push(
      `[Editor context] The user is editing this scene visually and has ONE entity selected. ` +
        `When they say "this", "it", or "this entity", they mean this one — a Script for it receives it as \`this.entity\`.\n` +
        `Entity: "${e.name}" (id ${e.id})\n` +
        (lines.length > 0 ? `Components on it:\n${lines.join('\n')}` : 'It has no components yet.')
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

const SparkleIcon = (): JSX.Element => (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M8 1.5l1.4 3.7L13 6.6 9.4 8 8 11.7 6.6 8 3 6.6l3.6-1.4L8 1.5Z" fill="currentColor" />
    <path d="M12.7 10.5l.6 1.5 1.5.6-1.5.6-.6 1.5-.6-1.5-1.5-.6 1.5-.6.6-1.5Z" fill="currentColor" opacity="0.7" />
  </svg>
)
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
  const files = useStore(() => aiStore.files)
  const selection = useStore(() => aiStore.selection)
  const [providers, setProviders] = useState<AiProviderInfo[]>([])
  const [provider, setProvider] = useState<AiProvider>('claude')
  const [model, setModel] = useState('default')
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [fileStatus, setFileStatus] = useState<{ text: string; kind: 'dim' | 'ok' | 'err' }>({ text: '', kind: 'dim' })
  const [confirmWipe, setConfirmWipe] = useState<{ kind: 'new' | AiProvider; label: string } | null>(null)
  const [errorDetail, setErrorDetail] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const lastPrompt = useRef<string | null>(null)
  const activeTurn = useRef<string | null>(null)
  const editorRef = useRef<CodeEditorHandle>(null)
  const openFileTouched = useRef(false)
  const stopRef = useRef<() => void>(() => {}) // latest stop(), for the Escape handler
  const activeEntity = useStore(() => state.activeEntity)
  const snapshot = useStore(() => state.snapshot)
  const entity = activeEntity !== null && snapshot[activeEntity] !== undefined ? selectedEntity() : null

  useEffect(() => {
    if (shell?.onAiEvent === undefined) return
    void shell.aiReset?.()
    shell.onAiEvent((e: AiEvent) => {
      if (e.kind === 'started') activeTurn.current = e.turnId
      else if (e.turnId !== activeTurn.current) return
      if (e.kind === 'tool' && (e.tool === 'Edit' || e.tool === 'Write') && aiStore.file !== null && baseName(e.detail) === baseName(aiStore.file))
        openFileTouched.current = true
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
    if (open) inputRef.current?.focus()
  }, [open, selection])

  // Escape closes the assistant. Layered so it always does the least-destructive
  // useful thing first: dismiss the error modal → cancel a confirm → stop a running
  // turn → close. The code editor keeps its own Escape (autocomplete, etc.).
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      if (errorDetail !== null) {
        setErrorDetail(null)
        return
      }
      if (e.composedPath().some((el) => el instanceof HTMLElement && el.classList.contains('cm-editor'))) return
      if (confirmWipe !== null) {
        setConfirmWipe(null)
        return
      }
      if (busy) {
        stopRef.current()
        return
      }
      closeAssistant()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, busy, errorDetail, confirmWipe])

  // The Studio follows the selected entity: picking another entity retargets the
  // editor to its scripts (saving any unsaved edits first), or collapses to the
  // chat dock when the new entity has none — so the editor never lingers on a
  // script that belongs to a different entity.
  useEffect(() => {
    if (aiStore.mode !== 'studio') return
    const files = entityScriptFiles()
    const apply = (): void => {
      if (files.length === 0) {
        setMode('dock')
        return
      }
      aiStore.files = files
      if (aiStore.file === null || !files.includes(aiStore.file)) setStudioFile(files[0])
    }
    const ed = editorRef.current
    if (ed !== null && ed.isDirty()) void ed.flush().catch(() => {}).then(apply)
    else apply()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeEntity])

  if (shell?.aiSend === undefined || !open) return null

  const current = providers.find((p) => p.id === provider)
  const available = current?.available ?? false
  const anyAvailable = providers.some((p) => p.available)
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
    if (t === '' || busy || !available) return
    lastPrompt.current = t
    const sel = aiStore.selection
    const run = (): void => {
      openFileTouched.current = false
      setMessages((prev) => [...prev, { role: 'user', text: t }, { role: 'assistant', text: '', tools: [], done: false }])
      setInput('')
      setBusy(true)
      void shell.aiSend?.({ provider, model, text: t, context: buildContext(sel) }).catch((err: unknown) => {
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
              <SparkleIcon />
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
              <SparkleIcon />
            </div>
            <p className="eui-ai-empty-title">Edit your scripts by chatting</p>
            <p className="eui-ai-empty-sub">
              Runs on your {current?.label} subscription — no API key. Edits arrive as a diff you accept.
              {mode === 'studio' ? ' Select code and press ⌘K to ask about it.' : ' Select an entity and I’ll scope the code to it.'}
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
              {m.text}
            </div>
          ) : (
            <div key={i} className="eui-ai-msg assistant">
              {m.tools.length > 0 && (
                <div className="eui-ai-tools">
                  {m.tools.map((t, j) => {
                    const inProgress = !m.done && j === m.tools.length - 1
                    return (
                      <span key={j} className={`eui-ai-tool ${t.tool === 'Edit' || t.tool === 'Write' ? 'edit' : ''}`}>
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
          <span
            className={`eui-ai-ctx ${entity !== null ? 'on' : ''}`}
            data-tip={entity !== null ? 'The assistant sees this entity and its components' : 'Select an entity to scope edits to it'}
          >
            <CubeIcon />
            {entity !== null ? (
              <>
                <span className="nm">{entity.name}</span>
                <span className="ct">
                  #{entity.id} · {entity.comps.length} comp{entity.comps.length === 1 ? '' : 's'}
                </span>
              </>
            ) : (
              <span className="ct">No entity selected</span>
            )}
          </span>
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

        <div className={`eui-ai-field ${!available ? 'off' : ''}`}>
          <textarea
            ref={inputRef}
            className="eui-ai-input"
            placeholder={available ? (selection !== null ? 'Ask about the selected code…' : 'Describe the behavior you want…') : 'Assistant unavailable'}
            value={input}
            disabled={!available}
            spellCheck={false}
            rows={2}
            onChange={(e) => setInput(e.target.value)}
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
            <span style={{ flex: 1 }} />
            {busy ? (
              <button className="eui-ai-send busy" onClick={stop} data-tip="Stop (Esc)" aria-label="Stop">
                <span className="ring" />
                <span className="sq" />
              </button>
            ) : (
              <button className="eui-ai-send" onClick={() => send(input)} disabled={!available || input.trim() === ''} data-tip="Send (Enter)" aria-label="Send">
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
      <div className="eui-ai-modal-backdrop" onClick={() => setErrorDetail(null)}>
        <div className="eui-ai-modal" onClick={(e) => e.stopPropagation()}>
          <div className="eui-ai-modal-head">
            <span className="t">Assistant error</span>
            <span style={{ flex: 1 }} />
            <button className="eui-ai-modal-btn" onClick={() => void navigator.clipboard?.writeText(errorDetail)}>
              Copy
            </button>
            <button className="eui-ai-modal-btn" onClick={() => setErrorDetail(null)}>
              Close
            </button>
          </div>
          <div className="eui-ai-modal-hint">{friendlyError(errorDetail)}</div>
          <pre className="eui-ai-modal-body">{errorDetail}</pre>
        </div>
      </div>
    ) : null

  if (mode === 'studio') {
    return (
      <>
        {errorModal}
        <aside className="eui-ai-panel studio">
        <header className="eui-studio-head">
          <span className="eui-studio-brand">
            <SparkleIcon /> Script Studio
          </span>
          <div className="eui-studio-tabs">
            {files.map((f) => (
              <button key={f} className={`eui-studio-tab ${f === file ? 'on' : ''}`} onClick={() => setStudioFile(f)}>
                {baseName(f)}
              </button>
            ))}
          </div>
          <span style={{ flex: 1 }} />
          <button className="eui-studio-hbtn" onClick={() => setMode('dock')} data-tip="Collapse to chat">
            ⤡
          </button>
          <button className="eui-studio-hbtn" onClick={closeAssistant} data-tip="Close">
            ✕
          </button>
        </header>
        <div className="eui-studio-split">
          <div className="eui-studio-left">
            <div className="eui-studio-filehead">
              <span className="nm">{file !== null ? baseName(file) : 'No script'}</span>
              {fileStatus.text !== '' && (
                <AutoSaveChip state={fileStatus.kind}>{fileStatus.text}</AutoSaveChip>
              )}
            </div>
            {file !== null ? (
              <CodeEditor
                key={file}
                ref={editorRef}
                path={file}
                onSelect={(s) => setSelection(s)}
                onResolved={(content) => aiStore.onSaved?.(file, content)}
                onStatus={(text, kind) => setFileStatus({ text, kind })}
              />
            ) : (
              <div className="eui-studio-nofile">Open a script from the inspector to edit it here.</div>
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
          <SparkleIcon /> Assistant
        </span>
        <span style={{ flex: 1 }} />
        {scriptFiles.length > 0 && (
          <button
            key={activeEntity ?? ''}
            className="eui-ai-headbtn eui-ai-studiobtn"
            onClick={() => {
              if (file !== null && scriptFiles.includes(file)) setMode('studio')
              else openStudio(scriptFiles[0], scriptFiles)
            }}
            data-tip="Open Studio (editor + chat)"
          >
            ⤢ Studio
          </button>
        )}
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
      <SparkleIcon />
    </button>
  )
}

// Injected into the shadow-root stylesheet by main-embed (appended to PICKER_CSS).
export const AI_CSS = `
/* floats like the inspector (.eui-panel / .eui-right): inset, rounded, surface
   gradient + panel shadow — same design-system surface language. */
.eui-ai-panel {
  pointer-events: auto;
  position: fixed; top: 58px; right: 12px; bottom: 12px; width: 384px; z-index: 78;
  display: flex; flex-direction: column; overflow: hidden;
  background: var(--surface); border: 1px solid var(--divider);
  border-radius: var(--r-panel); box-shadow: var(--shadow-panel);
  font-family: var(--font-family); color: var(--text);
  animation: eui-rise 0.28s cubic-bezier(0.2, 0.9, 0.3, 1) backwards;
}
.eui-ai-panel.studio { width: min(1120px, 86vw); }
.eui-ai-chat { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.eui-ai-head {
  position: relative; display: flex; align-items: center; gap: 8px;
  height: 52px; padding: 0 10px 0 14px; flex: none;
  border-bottom: 1px solid var(--divider); user-select: none;
}
.eui-ai-head::after {
  content: ''; position: absolute; left: 14px; bottom: -1px; height: 1px; width: 56px;
  background: linear-gradient(90deg, var(--primary), transparent);
}
.eui-ai-title { display: flex; align-items: center; gap: 7px; font-weight: 700; font-size: 13.5px; }
.eui-ai-title svg { color: var(--primary); }
.eui-ai-headbtn {
  background: none; border: 1px solid var(--divider); color: var(--text-2);
  border-radius: 7px; padding: 4px 9px; cursor: pointer; font: 600 11.5px/1 var(--font-family);
}
.eui-ai-headbtn:hover { color: var(--text); background: var(--paper-hi); }
/* the Studio entry stays violet-tinted and pulses briefly when a scripted entity
   is selected (keyed by entity → remounts → replays), so it's noticed */
@keyframes eui-ai-studio-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(152,45,226,0); }
  50% { box-shadow: 0 0 12px 2px rgba(152,45,226,0.55); }
}
.eui-ai-studiobtn { color: var(--primary); border-color: var(--primary-border); animation: eui-ai-studio-pulse 1s ease-in-out 3; }
.eui-ai-studiobtn:hover { color: #fff; background: var(--primary); animation: none; }
@media (prefers-reduced-motion: reduce) { .eui-ai-studiobtn { animation: none; } }
.eui-ai-body { flex: 1; overflow-y: auto; padding: 14px 12px; display: flex; flex-direction: column; gap: 12px; }
.eui-ai-notice {
  font-size: 12.5px; line-height: 1.5; color: var(--text-2);
  background: var(--input); border: 1px solid var(--divider-soft); border-radius: 10px; padding: 12px 14px;
}
.eui-ai-notice code, .eui-ai-empty-sub code {
  font-family: var(--font-mono); font-size: 11.5px; color: var(--text);
  background: var(--paper-hi); padding: 1px 5px; border-radius: 5px;
}
.eui-ai-empty { text-align: center; margin: auto 0; display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 8px; }
.eui-ai-empty-icon {
  width: 42px; height: 42px; border-radius: 12px; display: flex; align-items: center; justify-content: center;
  background: var(--primary-selected); color: var(--primary); margin-bottom: 4px;
}
.eui-ai-empty-icon svg { width: 22px; height: 22px; }
.eui-ai-empty-title { font-weight: 700; font-size: 15px; margin: 0; }
.eui-ai-empty-sub { font-size: 12.5px; color: var(--text-3); margin: 0; line-height: 1.5; max-width: 300px; }
.eui-ai-examples { display: flex; flex-direction: column; gap: 7px; width: 100%; margin-top: 10px; }
.eui-ai-example {
  text-align: left; background: var(--paper-hi); border: 1px solid var(--divider-soft); color: var(--text-2);
  border-radius: 9px; padding: 9px 12px; cursor: pointer; font: 12.5px/1.4 var(--font-family);
  transition: border-color .12s, color .12s;
}
.eui-ai-example:hover { border-color: var(--primary-border); color: var(--text); }
.eui-ai-msg { font-size: 13px; line-height: 1.55; }
.eui-ai-msg.user {
  align-self: flex-end; max-width: 88%; background: var(--brand); color: #fff;
  padding: 8px 12px; border-radius: 12px 12px 3px 12px; white-space: pre-wrap; word-break: break-word;
}
.eui-ai-msg.assistant { align-self: stretch; display: flex; flex-direction: column; gap: 7px; }
.eui-ai-text { color: var(--text); word-break: break-word; }
.eui-ai-text .eui-ai-p { margin: 0 0 7px; }
.eui-ai-text .eui-ai-p:last-child { margin-bottom: 0; }
.eui-ai-text .eui-ai-h { font-weight: 700; font-size: 13px; margin: 4px 0 6px; }
.eui-ai-text .eui-ai-ul { margin: 4px 0 7px; padding-left: 18px; display: flex; flex-direction: column; gap: 3px; }
.eui-ai-text .eui-ai-ic {
  font-family: var(--font-mono); font-size: 11.5px; color: var(--text);
  background: var(--input); border: 1px solid var(--divider-soft); padding: 1px 5px; border-radius: 5px;
}
.eui-ai-code {
  margin: 4px 0; padding: 10px 11px; overflow-x: auto; border-radius: 9px;
  background: var(--input); border: 1px solid var(--divider-soft);
  font: 11.5px/1.5 var(--font-mono); color: var(--text-2); white-space: pre;
}
.eui-ai-tools { display: flex; flex-direction: column; gap: 4px; }
.eui-ai-tool {
  display: flex; align-items: center; gap: 6px;
  font: 11.5px/1.3 var(--font-mono); color: var(--text-3);
  background: var(--input); border: 1px solid var(--divider-soft); border-radius: 7px; padding: 4px 9px;
  align-self: flex-start; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.eui-ai-tool .ti { display: inline-flex; color: var(--text-3); flex: none; }
.eui-ai-tool.edit { color: var(--primary); border-color: var(--primary-border); }
.eui-ai-tool.edit .ti { color: var(--primary); }
.eui-ai-thinking { display: flex; align-items: center; gap: 8px; color: var(--text-3); font-size: 12.5px; }
.eui-ai-err {
  display: flex; align-items: center; gap: 10px;
  font-size: 12px; color: var(--error); background: color-mix(in srgb, var(--error) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--error) 30%, transparent); border-radius: 8px; padding: 8px 10px;
}
.eui-ai-retry {
  flex: none; background: none; border: 1px solid color-mix(in srgb, var(--error) 45%, transparent);
  color: var(--error); border-radius: 6px; padding: 3px 9px; cursor: pointer; font: 600 11px/1 var(--font-family);
}
.eui-ai-retry:hover { background: color-mix(in srgb, var(--error) 16%, transparent); }

/* ---- composer ---- */
.eui-ai-composer { border-top: 1px solid var(--divider-soft); background: var(--paper); padding: 10px 12px 12px; }
.eui-ai-confirm {
  display: flex; align-items: center; gap: 8px; margin-bottom: 9px; padding: 8px 10px;
  background: var(--paper-hi); border: 1px solid var(--divider); border-radius: 9px;
  font-size: 12px; color: var(--text-2);
}
.eui-ai-confirm-btn { background: var(--brand); color: #fff; border: 0; border-radius: 6px; padding: 4px 11px; cursor: pointer; font: 600 11.5px/1 var(--font-family); }
.eui-ai-confirm-btn.ghost { background: none; border: 1px solid var(--divider); color: var(--text-2); }
.eui-ai-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
.eui-ai-ctx {
  display: inline-flex; align-items: center; gap: 6px; min-width: 0; max-width: 100%;
  padding: 4px 9px; border-radius: 8px; font-size: 11.5px;
  background: var(--input); border: 1px solid var(--divider-soft); color: var(--text-3);
}
.eui-ai-ctx.on { color: var(--text-2); border-color: var(--primary-border); }
.eui-ai-ctx.on svg { color: var(--primary); }
.eui-ai-ctx .ang { color: var(--primary); font-family: var(--font-mono); font-size: 11px; }
.eui-ai-ctx .nm { font-weight: 600; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.eui-ai-ctx .ct { color: var(--text-3); white-space: nowrap; }
.eui-ai-ctx .x { background: none; border: 0; color: var(--text-3); cursor: pointer; padding: 0 0 0 2px; font-size: 11px; }
.eui-ai-ctx .x:hover { color: var(--text); }
.eui-ai-quick { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
.eui-ai-qbtn {
  font: 12px/1 var(--font-family); color: var(--text-2); background: var(--paper-hi);
  border: 1px solid var(--divider-soft); border-radius: 8px; padding: 6px 11px; cursor: pointer;
}
.eui-ai-qbtn:first-child { color: var(--primary); border-color: var(--primary-border); }
.eui-ai-qbtn:hover:not(:disabled) { color: var(--text); border-color: var(--primary-border); }
.eui-ai-qbtn:disabled { opacity: .5; cursor: default; }

.eui-ai-field {
  display: flex; flex-direction: column; gap: 6px;
  background: var(--input); border: 1px solid var(--divider); border-radius: var(--r-control); padding: 8px 8px 8px 11px;
  transition: border-color .12s;
}
.eui-ai-field:focus-within { border-color: var(--primary-border); }
.eui-ai-field.off { opacity: .55; }
.eui-ai-input {
  width: 100%; resize: none; background: none; color: var(--text); border: 0; outline: none;
  font: 13px/1.45 var(--font-family); max-height: 160px; padding: 2px 0 0;
}
.eui-ai-fieldbar { display: flex; align-items: center; gap: 8px; }
.eui-ai-send {
  flex: none; position: relative; width: 30px; height: 30px; border-radius: 50%; cursor: pointer;
  display: flex; align-items: center; justify-content: center; padding: 0;
  background: var(--brand); border: 0; color: #fff;
  transition: background .12s, opacity .12s, transform .12s;
}
.eui-ai-send:hover:not(:disabled):not(.busy) { background: var(--brand-hover); }
.eui-ai-send:disabled { background: none; border: 1px solid var(--divider); color: var(--text-3); cursor: default; }
.eui-ai-send.busy { background: var(--paper-hi); border: 0; color: var(--primary); }
.eui-ai-send.busy .ring {
  position: absolute; inset: 2px; border-radius: 50%;
  border: 2px solid rgba(152,45,226,0.22); border-top-color: var(--primary);
  animation: eui-spin 0.7s linear infinite;
}
.eui-ai-send.busy .sq { position: relative; width: 9px; height: 9px; border-radius: 2px; background: var(--primary); }

/* ---- model menu ---- */
.eui-ai-model { position: relative; }
.eui-ai-modelbtn {
  display: inline-flex; align-items: center; gap: 5px; cursor: pointer;
  background: none; border: 1px solid var(--divider); color: var(--text-2);
  border-radius: 8px; padding: 5px 9px; font: 12px/1 var(--font-family);
}
.eui-ai-modelbtn:hover { color: var(--text); border-color: var(--primary-border); }
.eui-ai-modelbtn .prov { font-weight: 600; color: var(--text); }
.eui-ai-modelbtn .dot { color: var(--text-3); }
.eui-ai-modelbtn .chev { transition: transform .15s; opacity: .7; }
.eui-ai-modelbtn .chev.open { transform: rotate(180deg); }
.eui-ai-menu {
  position: absolute; left: 0; bottom: calc(100% + 6px); z-index: 5; min-width: 210px;
  background: var(--paper-hi); border: 1px solid var(--divider); border-radius: 11px;
  padding: 6px; box-shadow: 0 14px 36px rgba(0,0,0,0.55); display: flex; flex-direction: column; gap: 1px;
}
.eui-ai-menu-label { font-size: 9.5px; letter-spacing: .14em; text-transform: uppercase; color: var(--text-3); padding: 8px 10px 4px; }
.eui-ai-menu-sep { height: 1px; background: var(--divider-soft); margin: 5px 2px; }
.eui-ai-menu-item {
  display: flex; align-items: center; gap: 8px; text-align: left; width: 100%;
  background: none; border: 0; color: var(--text); cursor: pointer;
  padding: 7px 10px; border-radius: 7px; font: 13px/1 var(--font-family);
}
.eui-ai-menu-item:hover:not(:disabled) { background: var(--hover); }
.eui-ai-menu-item:disabled { cursor: default; }
.eui-ai-menu-item .tick { width: 14px; display: inline-flex; color: var(--primary); flex: none; }
.eui-ai-menu-item .lbl { flex: 1; }
.eui-ai-menu-item .tag { font-size: 9.5px; text-transform: uppercase; letter-spacing: .06em; color: var(--text-3); border: 1px solid var(--divider-soft); border-radius: 5px; padding: 2px 5px; }
.eui-ai-menu-item .tag.soft { border: 0; color: var(--primary); background: var(--primary-selected); }
.eui-ai-menu-item.off { color: var(--text-3); }
.eui-ai-menu-item.off .lbl { opacity: .7; }

/* ---- studio ---- */
.eui-studio-head {
  position: relative; display: flex; align-items: center; gap: 10px; padding: 0 10px 0 14px; height: 52px;
  flex: none; user-select: none; border-bottom: 1px solid var(--divider);
}
.eui-studio-head::after {
  content: ''; position: absolute; left: 14px; bottom: -1px; height: 1px; width: 56px;
  background: linear-gradient(90deg, var(--primary), transparent);
}
.eui-studio-brand { display: flex; align-items: center; gap: 7px; font-weight: 700; font-size: 13px; }
.eui-studio-brand svg { color: var(--primary); }
.eui-studio-tabs { display: flex; gap: 3px; }
.eui-studio-tab {
  background: none; border: 1px solid transparent; color: var(--text-3); cursor: pointer;
  padding: 5px 11px; border-radius: 8px; font: 12.5px/1 var(--font-family);
}
.eui-studio-tab:hover { color: var(--text-2); }
.eui-studio-tab.on { color: var(--text); background: var(--input); border-color: var(--divider-soft); }
.eui-studio-hbtn {
  width: 28px; height: 28px; border-radius: 7px; border: 1px solid var(--divider); background: var(--paper);
  color: var(--text-2); cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 13px;
}
.eui-studio-hbtn:hover { color: var(--text); background: var(--paper-hi); }
.eui-studio-split { flex: 1; min-height: 0; display: flex; }
.eui-studio-left { flex: 1; min-width: 0; display: flex; flex-direction: column; background: var(--input); border-right: 1px solid var(--divider); }
.eui-studio-right { width: 400px; flex: none; display: flex; flex-direction: column; }
.eui-studio-filehead {
  display: flex; align-items: center; gap: 10px; padding: 9px 14px; border-bottom: 1px solid var(--divider-soft);
}
.eui-studio-filehead .nm { font-weight: 600; font-size: 13px; }
.eui-studio-nofile { padding: 24px; color: var(--text-3); font-size: 13px; }

.eui-studio-code { flex: 1; min-height: 0; display: flex; flex-direction: column; position: relative; }
.eui-studio-review {
  display: flex; align-items: center; gap: 9px; padding: 9px 14px;
  background: var(--primary-selected); border-bottom: 1px solid var(--primary-border); font-size: 12.5px;
}
.eui-studio-review .dot { width: 7px; height: 7px; border-radius: 50%; background: #e7b34a; flex: none; }
.eui-studio-review b { font-weight: 600; }
.eui-studio-review .sub { color: var(--text-3); }
.eui-studio-review .acc { background: var(--brand); color: #fff; border: 0; border-radius: 7px; padding: 5px 12px; cursor: pointer; font: 600 11.5px/1 var(--font-family); }
.eui-studio-review .dis { background: none; border: 1px solid var(--divider); color: var(--text-2); border-radius: 7px; padding: 5px 12px; cursor: pointer; font: 600 11.5px/1 var(--font-family); }
.eui-studio-cm { flex: 1; min-height: 0; position: relative; overflow: hidden; }
.eui-studio-cm .cm-editor { height: 100%; }
.eui-studio-cmloading { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: var(--text-3); font-size: 12.5px; }
.eui-studio-askpill {
  position: absolute; z-index: 6; display: inline-flex; align-items: center; gap: 6px;
  background: var(--brand); color: #fff; border: 0; border-radius: 8px; padding: 5px 10px;
  font: 600 11.5px/1 var(--font-family); cursor: pointer; box-shadow: 0 6px 18px rgba(0,0,0,.5);
}
.eui-studio-askpill .k { font-size: 10px; opacity: .8; font-family: var(--font-mono); }

/* ---- setup / onboarding (no CLI available) ---- */
.eui-ai-setup { margin: auto 0; display: flex; flex-direction: column; align-items: center; gap: 8px; text-align: center; padding: 8px; }
.eui-ai-setup-list { display: flex; flex-direction: column; gap: 8px; width: 100%; margin-top: 6px; }
.eui-ai-setup-row { display: flex; align-items: center; gap: 10px; text-align: left; background: var(--input); border: 1px solid var(--divider-soft); border-radius: 10px; padding: 9px 11px; }
.eui-ai-setup-row .pl { font-weight: 600; font-size: 12.5px; flex: none; width: 52px; }
.eui-ai-setup-row .ready { color: var(--primary); font-size: 12px; }
.eui-ai-setup-row .cmds { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.eui-ai-setup-row code { font-family: var(--font-mono); font-size: 11px; color: var(--text-2); background: var(--paper-hi); padding: 2px 6px; border-radius: 5px; overflow-x: auto; white-space: nowrap; }
.eui-ai-setup-row code .hint { color: var(--text-3); }
.eui-ai-recheck { margin-top: 6px; background: var(--primary-selected); border: 1px solid var(--primary-border); color: var(--primary); border-radius: 8px; padding: 7px 14px; cursor: pointer; font: 600 12px/1 var(--font-family); }
.eui-ai-recheck:hover { background: var(--primary); color: #fff; }

/* ---- error detail modal ---- */
.eui-ai-err .msg { min-width: 0; }
.eui-ai-retry.ghost { color: var(--text-2); border-color: var(--divider); }
.eui-ai-retry.ghost:hover { background: var(--hover); color: var(--text); }
.eui-ai-modal-backdrop { position: fixed; inset: 0; z-index: 90; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; pointer-events: auto; }
.eui-ai-modal { width: min(620px, 86vw); max-height: 78vh; display: flex; flex-direction: column; background: var(--surface); border: 1px solid var(--divider); border-radius: var(--r-panel); box-shadow: var(--shadow-float); overflow: hidden; }
.eui-ai-modal-head { display: flex; align-items: center; gap: 8px; padding: 12px 14px; border-bottom: 1px solid var(--divider); }
.eui-ai-modal-head .t { font-weight: 700; font-size: 13.5px; }
.eui-ai-modal-btn { background: none; border: 1px solid var(--divider); color: var(--text-2); border-radius: 7px; padding: 4px 11px; cursor: pointer; font: 600 11.5px/1 var(--font-family); }
.eui-ai-modal-btn:hover { color: var(--text); background: var(--paper-hi); }
.eui-ai-modal-hint { padding: 12px 14px 0; color: var(--text-2); font-size: 12.5px; }
.eui-ai-modal-body { margin: 10px 14px 14px; padding: 12px; overflow: auto; background: var(--input); border: 1px solid var(--divider-soft); border-radius: 10px; font: 11.5px/1.5 var(--font-mono); color: var(--text-2); white-space: pre-wrap; word-break: break-word; }

/* ---- floating action button (open the assistant) ---- */
.eui-ai-fab {
  pointer-events: auto; position: fixed; right: 22px; bottom: 22px; z-index: 77;
  width: 54px; height: 54px; border-radius: 50%; border: 0; cursor: grab; padding: 0;
  touch-action: none; color: #fff; display: flex; align-items: center; justify-content: center;
  background: radial-gradient(130% 130% at 30% 22%, #b667f5 0%, #982de2 46%, #7a1fc4 100%);
  box-shadow:
    0 6px 18px rgba(122,31,196,0.5),
    0 2px 6px rgba(0,0,0,0.35),
    inset 0 1px 0 rgba(255,255,255,0.28);
  transition: transform .16s cubic-bezier(0.2,0.9,0.3,1), box-shadow .16s;
  animation: eui-pop 0.24s ease backwards;
}
/* a soft attention halo that breathes out and fades */
.eui-ai-fab::before {
  content: ''; position: absolute; inset: -3px; border-radius: 50%;
  border: 1.5px solid rgba(152,45,226,0.55); opacity: 0;
  animation: eui-fab-halo 2.8s ease-out infinite;
}
@keyframes eui-fab-halo {
  0% { transform: scale(0.92); opacity: 0.55; }
  70% { transform: scale(1.4); opacity: 0; }
  100% { opacity: 0; }
}
.eui-ai-fab:hover {
  transform: translateY(-3px) scale(1.05);
  box-shadow:
    0 12px 26px rgba(122,31,196,0.6),
    0 3px 8px rgba(0,0,0,0.4),
    inset 0 1px 0 rgba(255,255,255,0.35);
}
.eui-ai-fab:active { cursor: grabbing; transform: scale(1.06); }
.eui-ai-fab svg { width: 25px; height: 25px; filter: drop-shadow(0 1px 1px rgba(0,0,0,0.28)); }
@media (prefers-reduced-motion: reduce) { .eui-ai-fab::before { animation: none; display: none; } }
`
