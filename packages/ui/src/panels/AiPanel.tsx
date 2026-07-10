// Right-docked AI assistant chat. Talks to the Electron shell (window.editorShell)
// which drives the Claude/Codex CLI on the user's own subscription and edits the
// scene's src/scripts/*.ts files on disk — sdk-commands hot-reloads them, so the
// inspector reflects the change live. Presentational + local chat state only;
// all spawning is in the main process. Absent (returns null) in a plain browser
// tab where there's no shell.
import { useEffect, useRef, useState } from 'react'
import type { AiEvent, AiProvider, AiProviderInfo } from '@dcl-editor/contract'
import { Select, Spinner } from '../ds'

// A tool the assistant used this turn (a file it read or edited), shown as a chip.
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
  'Add a script that plays a sound when the player enters the trigger'
]

// Verbs that read as edits vs. reads — drives the chip icon/emphasis.
function toolLabel(t: ToolUse): string {
  if (t.detail === '') return t.tool
  if (t.tool === 'Write') return `Created ${t.detail}`
  if (t.tool === 'Edit') return `Edited ${t.detail}`
  if (t.tool === 'Read') return `Read ${t.detail}`
  if (t.tool === 'Run') return `Ran ${t.detail}`
  return `${t.tool} ${t.detail}`
}

const SparkleIcon = (): JSX.Element => (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path
      d="M8 1.5l1.4 3.7L13 6.6 9.4 8 8 11.7 6.6 8 3 6.6l3.6-1.4L8 1.5Z"
      fill="currentColor"
    />
    <path d="M12.7 10.5l.6 1.5 1.5.6-1.5.6-.6 1.5-.6-1.5-1.5-.6 1.5-.6.6-1.5Z" fill="currentColor" opacity="0.7" />
  </svg>
)

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
  // so late events from a superseded or stopped turn are dropped instead of
  // bleeding into the next turn's bubble.
  const activeTurn = useRef<string | null>(null)

  // Subscribe once to the streamed events; route each by turnId to its bubble.
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
        // the bubble already stamped with this turnId, else the pending placeholder
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

  // Enumerate backends on mount; default to the first available one.
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

  if (shell?.aiSend === undefined) return null // browser tab / older shell — no assistant
  if (!props.open) return null

  const current = providers.find((p) => p.id === provider)
  const available = current?.available ?? false
  const models = current?.models ?? ['default']

  const send = (text: string): void => {
    const t = text.trim()
    if (t === '' || busy || !available) return
    setMessages((prev) => [...prev, { role: 'user', text: t }, { role: 'assistant', text: '', tools: [], done: false }])
    setInput('')
    setBusy(true)
    void shell.aiSend?.({ provider, model, text: t }).catch((err: unknown) => {
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
    setMessages((prev) =>
      prev.map((m) => (m.role === 'assistant' && !m.done ? { ...m, done: true } : m))
    )
  }

  const newChat = (): void => {
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

      <div className="eui-ai-controls">
        <Select
          value={provider}
          onChange={(v) => {
            const id = v as AiProvider
            if (id === provider) return
            const p = providers.find((x) => x.id === id)
            setProvider(id)
            if (p !== undefined) setModel(p.defaultModel)
            // switching backend = fresh conversation: each provider keeps its own
            // session, so leaving the old transcript up would misrepresent context
            void shell.aiStop?.()
            void shell.aiReset?.()
            activeTurn.current = null
            setMessages([])
            setBusy(false)
          }}
          options={providers.map((p) => ({ value: p.id, label: p.available ? p.label : `${p.label} (unavailable)` }))}
          aria-label="AI provider"
        />
        <Select
          value={model}
          onChange={setModel}
          options={models.map((m) => ({ value: m, label: m === 'default' ? 'Default model' : m }))}
          aria-label="Model"
        />
      </div>

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
              Runs on your {current?.label} subscription — no API key. Edits land in{' '}
              <code>src/scripts/</code> and hot-reload live.
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
    </aside>
  )
}

// Injected into the shadow-root stylesheet by main-embed (appended to PICKER_CSS).
// Uses the same violet theme tokens as the rest of the editor chrome.
export const AI_CSS = `
.eui-ai-panel {
  pointer-events: auto;
  position: fixed; top: 58px; right: 0; bottom: 0; width: 380px; z-index: 78;
  display: flex; flex-direction: column;
  background: var(--paper); border-left: 1px solid var(--divider);
  font-family: var(--font-family); color: var(--text);
  box-shadow: -14px 0 40px rgba(0,0,0,0.35);
}
.eui-ai-head {
  display: flex; align-items: center; gap: 8px; padding: 10px 12px;
  border-bottom: 1px solid var(--divider-soft);
}
.eui-ai-title { display: flex; align-items: center; gap: 7px; font-weight: 700; font-size: 13.5px; }
.eui-ai-title svg { color: var(--primary); }
.eui-ai-headbtn {
  background: none; border: 1px solid var(--divider); color: var(--text-2);
  border-radius: 7px; padding: 4px 9px; cursor: pointer; font: 600 11.5px/1 var(--font-family);
}
.eui-ai-headbtn:hover { color: var(--text); background: var(--paper-hi); }
.eui-ai-controls { display: flex; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--divider-soft); }
.eui-ai-controls .eui-ds-select { flex: 1; min-width: 0; }
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
.eui-ai-input-row {
  display: flex; gap: 8px; align-items: flex-end; padding: 10px 12px;
  border-top: 1px solid var(--divider-soft); background: var(--paper);
}
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
