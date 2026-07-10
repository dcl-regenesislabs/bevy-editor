// Right-docked AI assistant chat. Talks to the Electron shell (window.editorShell)
// which drives the Claude/Codex CLI on the user's own subscription and edits the
// scene's src/scripts/*.ts files on disk — sdk-commands hot-reloads them, so the
// inspector reflects the change live. Each turn is scoped with the currently
// selected entity's components so "make this spin" resolves to the real entity.
// Presentational + local chat state only; all spawning is in the main process.
// Absent (returns null) in a plain browser tab where there's no shell.
import { useEffect, useRef, useState } from 'react'
import type { AiEvent, AiProvider, AiProviderInfo } from '@dcl-editor/contract'
import { Spinner, useOutsideClose } from '../ds'
import { useStore } from '../store'
import { state, entityLabel, type Snapshot } from '../../../scene/src/state'
import { entityName, NAME_COMPONENT } from '../../../scene/src/custom-components'
import { isAllowedComponent, SCRIPT_COMPONENT } from '../../../scene/src/allowed-components'

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

function toolLabel(t: ToolUse): string {
  if (t.detail === '') return t.tool
  if (t.tool === 'Write') return `Created ${t.detail}`
  if (t.tool === 'Edit') return `Edited ${t.detail}`
  if (t.tool === 'Read') return `Read ${t.detail}`
  if (t.tool === 'Run') return `Ran ${t.detail}`
  return `${t.tool} ${t.detail}`
}

// Creator-facing component name (strip the wire namespace; Script is just Script).
function displayName(n: string): string {
  if (n === SCRIPT_COMPONENT) return 'Script'
  const i = n.indexOf('::')
  return i === -1 ? n : n.slice(i + 2)
}

// The selected entity + its authorable components, read live from editor state.
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

// Compact context block prepended to the prompt (not shown in the chat bubble).
function buildContext(): string | undefined {
  const e = selectedEntity()
  if (e === null) return undefined
  const compact = (v: unknown): string => {
    try {
      const s = JSON.stringify(v)
      return s.length > 220 ? s.slice(0, 220) + '…' : s
    } catch {
      return String(v)
    }
  }
  const lines = e.comps.map(([n, v]) => `- ${displayName(n)}: ${compact(v)}`)
  return (
    `[Editor context] The user is editing this scene visually and has ONE entity selected. ` +
    `When they say "this", "it", or "this entity", they mean this one — a Script you write for it receives it as \`this.entity\`.\n` +
    `Entity: "${e.name}" (id ${e.id})\n` +
    (lines.length > 0 ? `Components on it:\n${lines.join('\n')}` : 'It has no components yet.')
  )
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
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M3 8.5l3.2 3L13 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

// Compact model/provider picker modeled on the Claude app: one pill that opens a
// popover with a Provider section and a Model section, each with a check on the
// active choice; unavailable providers are dimmed.
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
              onClick={() => {
                props.onProvider(p.id)
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

export function AiPanel(props: { open: boolean; onClose: () => void }): JSX.Element | null {
  const shell = window.editorShell
  const [providers, setProviders] = useState<AiProviderInfo[]>([])
  const [provider, setProvider] = useState<AiProvider>('claude')
  const [model, setModel] = useState('default')
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  // The turn currently accepting events. Set on 'started', cleared on done/stop,
  // so late events from a superseded/stopped turn are dropped instead of bleeding
  // into the next turn's bubble.
  const activeTurn = useRef<string | null>(null)
  // Selected entity, live — drives the context chip and what gets sent.
  const activeEntity = useStore(() => state.activeEntity)
  const snapshot = useStore(() => state.snapshot)
  const entity = activeEntity !== null && snapshot[activeEntity] !== undefined ? selectedEntity() : null

  useEffect(() => {
    if (shell?.onAiEvent === undefined) return
    // A stale backend session can outlive the chat (a plain renderer reload wipes
    // `messages` but not the main-process session) — reset so an empty pane
    // always maps to a fresh conversation.
    void shell.aiReset?.()
    shell.onAiEvent((e: AiEvent) => {
      if (e.kind === 'started') activeTurn.current = e.turnId
      else if (e.turnId !== activeTurn.current) return // superseded / stopped turn
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
  }, [messages, props.open])

  if (shell?.aiSend === undefined) return null
  if (!props.open) return null

  const current = providers.find((p) => p.id === provider)
  const available = current?.available ?? false

  const send = (text: string): void => {
    const t = text.trim()
    if (t === '' || busy || !available) return
    setMessages((prev) => [...prev, { role: 'user', text: t }, { role: 'assistant', text: '', tools: [], done: false }])
    setInput('')
    setBusy(true)
    void shell.aiSend?.({ provider, model, text: t, context: buildContext() }).catch((err: unknown) => {
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
    })
  }

  const stop = (): void => {
    void shell.aiStop?.()
    activeTurn.current = null
    setBusy(false)
    setMessages((prev) => prev.map((m) => (m.role === 'assistant' && !m.done ? { ...m, done: true } : m)))
  }

  const newChat = (): void => {
    void shell.aiReset?.()
    activeTurn.current = null
    setMessages([])
    setBusy(false)
  }

  const switchProvider = (id: AiProvider): void => {
    if (id === provider) return
    const p = providers.find((x) => x.id === id)
    setProvider(id)
    if (p !== undefined) setModel(p.defaultModel)
    // switching backend = fresh conversation: each provider keeps its own session
    void shell.aiStop?.()
    void shell.aiReset?.()
    activeTurn.current = null
    setMessages([])
    setBusy(false)
  }

  return (
    <aside className="eui-ai-panel">
      <header className="eui-ai-head">
        <span className="eui-ai-title">
          <SparkleIcon /> Assistant
        </span>
        <span style={{ flex: 1 }} />
        <button className="eui-ai-headbtn" onClick={newChat} data-tip="New chat">
          New
        </button>
        <button className="eui-ai-headbtn" onClick={props.onClose} data-tip="Close assistant">
          ✕
        </button>
      </header>

      <div className="eui-ai-body" ref={scrollRef}>
        {!available && (
          <div className="eui-ai-notice">
            {current?.reason ?? 'This assistant is unavailable.'} Sign in from a terminal with{' '}
            <code>{provider} login</code>, then reopen this panel.
          </div>
        )}
        {available && messages.length === 0 && (
          <div className="eui-ai-empty">
            <div className="eui-ai-empty-icon">
              <SparkleIcon />
            </div>
            <p className="eui-ai-empty-title">Edit your scripts by chatting</p>
            <p className="eui-ai-empty-sub">
              Runs on your {current?.label} subscription — no API key. Edits land in <code>src/scripts/</code> and
              hot-reload live. Select an entity and I'll scope the code to it.
            </p>
            <div className="eui-ai-examples">
              {EXAMPLES.map((ex) => (
                <button key={ex} className="eui-ai-example" onClick={() => send(ex)}>
                  {ex}
                </button>
              ))}
            </div>
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
                  {m.tools.map((t, j) => (
                    <span key={j} className={`eui-ai-tool ${t.tool === 'Edit' || t.tool === 'Write' ? 'edit' : ''}`}>
                      {toolLabel(t)}
                    </span>
                  ))}
                </div>
              )}
              {m.text !== '' && <div className="eui-ai-text">{m.text}</div>}
              {!m.done && m.text === '' && m.tools.length === 0 && (
                <span className="eui-ai-thinking">
                  <Spinner size={14} /> Thinking…
                </span>
              )}
              {m.error !== undefined && <div className="eui-ai-err">{m.error}</div>}
            </div>
          )
        )}
      </div>

      <div className="eui-ai-composer">
        <div className="eui-ai-ctxrow">
          <span className={`eui-ai-ctx ${entity !== null ? 'on' : ''}`} data-tip={entity !== null ? 'The assistant sees this entity and its components' : 'Select an entity to scope edits to it'}>
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
          <span style={{ flex: 1 }} />
          <ModelMenu
            providers={providers}
            provider={provider}
            model={model}
            current={current}
            onProvider={switchProvider}
            onModel={setModel}
          />
        </div>
        <div className="eui-ai-input-row">
          <textarea
            className="eui-ai-input"
            placeholder={available ? 'Describe the behavior you want…' : 'Assistant unavailable'}
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
            }}
          />
          {busy ? (
            <button className="eui-ai-send stop" onClick={stop} data-tip="Stop">
              ■
            </button>
          ) : (
            <button
              className="eui-ai-send"
              onClick={() => send(input)}
              disabled={!available || input.trim() === ''}
              data-tip="Send (Enter)"
            >
              ↑
            </button>
          )}
        </div>
      </div>
    </aside>
  )
}

// Injected into the shadow-root stylesheet by main-embed (appended to PICKER_CSS).
// Uses the same violet theme tokens as the rest of the editor chrome.
export const AI_CSS = `
.eui-ai-panel {
  pointer-events: auto;
  position: fixed; top: 58px; right: 0; bottom: 0; width: 384px; z-index: 78;
  display: flex; flex-direction: column;
  background: var(--paper); border-left: 1px solid var(--divider);
  font-family: var(--font-family); color: var(--text);
  box-shadow: -14px 0 40px rgba(0,0,0,0.35);
}
.eui-ai-head {
  display: flex; align-items: center; gap: 8px; padding: 11px 12px;
  border-bottom: 1px solid var(--divider-soft); user-select: none;
}
.eui-ai-title { display: flex; align-items: center; gap: 7px; font-weight: 700; font-size: 13.5px; }
.eui-ai-title svg { color: var(--primary); }
.eui-ai-headbtn {
  background: none; border: 1px solid var(--divider); color: var(--text-2);
  border-radius: 7px; padding: 4px 9px; cursor: pointer; font: 600 11.5px/1 var(--font-family);
}
.eui-ai-headbtn:hover { color: var(--text); background: var(--paper-hi); }
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
.eui-ai-text { white-space: pre-wrap; word-break: break-word; color: var(--text); }
.eui-ai-tools { display: flex; flex-direction: column; gap: 4px; }
.eui-ai-tool {
  font: 11.5px/1.3 var(--font-mono); color: var(--text-3);
  background: var(--input); border: 1px solid var(--divider-soft); border-radius: 7px; padding: 4px 9px;
  align-self: flex-start; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.eui-ai-tool.edit { color: var(--primary); border-color: var(--primary-border); }
.eui-ai-thinking { display: flex; align-items: center; gap: 8px; color: var(--text-3); font-size: 12.5px; }
.eui-ai-err {
  font-size: 12px; color: var(--error); background: color-mix(in srgb, var(--error) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--error) 30%, transparent); border-radius: 8px; padding: 8px 10px;
  white-space: pre-wrap; word-break: break-word;
}

/* ---- composer: context chip + model menu + input ---- */
.eui-ai-composer { border-top: 1px solid var(--divider-soft); background: var(--paper); padding: 9px 12px 11px; }
.eui-ai-ctxrow { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.eui-ai-ctx {
  display: inline-flex; align-items: center; gap: 6px; min-width: 0; max-width: 60%;
  padding: 4px 9px; border-radius: 8px; font-size: 11.5px;
  background: var(--input); border: 1px solid var(--divider-soft); color: var(--text-3);
}
.eui-ai-ctx.on { color: var(--text-2); border-color: var(--primary-border); }
.eui-ai-ctx.on svg { color: var(--primary); }
.eui-ai-ctx .nm { font-weight: 600; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.eui-ai-ctx .ct { color: var(--text-3); white-space: nowrap; }

.eui-ai-model { position: relative; }
.eui-ai-modelbtn {
  display: inline-flex; align-items: center; gap: 5px; cursor: pointer;
  background: var(--input); border: 1px solid var(--divider); color: var(--text-2);
  border-radius: 8px; padding: 5px 9px; font: 12px/1 var(--font-family);
}
.eui-ai-modelbtn:hover { color: var(--text); border-color: var(--primary-border); }
.eui-ai-modelbtn .prov { font-weight: 600; color: var(--text); }
.eui-ai-modelbtn .dot { color: var(--text-3); }
.eui-ai-modelbtn .chev { transition: transform .15s; opacity: .7; }
.eui-ai-modelbtn .chev.open { transform: rotate(180deg); }
.eui-ai-menu {
  position: absolute; right: 0; bottom: calc(100% + 6px); z-index: 5; min-width: 210px;
  background: var(--paper-hi); border: 1px solid var(--divider); border-radius: 11px;
  padding: 6px; box-shadow: 0 14px 36px rgba(0,0,0,0.55); display: flex; flex-direction: column; gap: 1px;
}
.eui-ai-menu-label {
  font-size: 9.5px; letter-spacing: .14em; text-transform: uppercase; color: var(--text-3);
  padding: 8px 10px 4px;
}
.eui-ai-menu-sep { height: 1px; background: var(--divider-soft); margin: 5px 2px; }
.eui-ai-menu-item {
  display: flex; align-items: center; gap: 8px; text-align: left; width: 100%;
  background: none; border: 0; color: var(--text); cursor: pointer;
  padding: 7px 10px; border-radius: 7px; font: 13px/1 var(--font-family);
}
.eui-ai-menu-item:hover { background: var(--hover); }
.eui-ai-menu-item .tick { width: 14px; display: inline-flex; color: var(--primary); flex: none; }
.eui-ai-menu-item .lbl { flex: 1; }
.eui-ai-menu-item .tag {
  font-size: 9.5px; text-transform: uppercase; letter-spacing: .06em; color: var(--text-3);
  border: 1px solid var(--divider-soft); border-radius: 5px; padding: 2px 5px;
}
.eui-ai-menu-item .tag.soft { border: 0; color: var(--primary); background: var(--primary-selected); }
.eui-ai-menu-item.off { color: var(--text-3); }
.eui-ai-menu-item.off .lbl { opacity: .7; }

.eui-ai-input-row { display: flex; gap: 8px; align-items: flex-end; }
.eui-ai-input {
  flex: 1; resize: none; background: var(--input); color: var(--text);
  border: 1px solid var(--divider); border-radius: 10px; padding: 9px 11px;
  font: 13px/1.45 var(--font-family); outline: none; max-height: 140px;
}
.eui-ai-input:focus { border-color: var(--primary-border); }
.eui-ai-input:disabled { opacity: .5; }
.eui-ai-send {
  flex: none; width: 36px; height: 36px; border-radius: 10px; border: 0; cursor: pointer;
  background: var(--brand); color: #fff; font-size: 17px; font-weight: 700;
  display: flex; align-items: center; justify-content: center;
}
.eui-ai-send:hover:not(:disabled) { background: var(--brand-hover); }
.eui-ai-send:disabled { opacity: .4; cursor: default; }
.eui-ai-send.stop { background: var(--error); font-size: 13px; }
`
