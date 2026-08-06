// The AI assistant surface. One component, two modes (ai-store.ts):
//  - 'dock'   : chat under the inspector in the right dock (quick asks)
//  - 'studio' : file rail + editor + chat, full-screen under the topbar
// It is never unmounted while the CLI exists — minimizing or hiding the dock
// only stops it being drawn, so the transcript, the CLI session and a turn
// still streaming all survive.
// Chat/session state lives here so it follows the creator between modes: the
// presentation pieces (features/ai/*) are stateless and are re-parented between
// the two layouts, which would reset any state they owned. It drives the
// Claude/Codex CLI (main process), which edits project files on disk — Scripts
// under src/scripts/ and the scene's entry point src/index.ts; in Studio those
// edits arrive as an accept/reject diff via the CodeEditor handle — nothing runs
// in the scene until the creator accepts. Absent in a browser tab.
import { useEffect, useRef, useState } from 'react'
import type { AiEvent, AiImageAttachment, AiProvider, AiProviderInfo } from '@dcl-editor/contract'
import { Button, Modal } from '../ds'
import { useStore } from '../core/store'
import { state, entityLabel, type Snapshot } from '@scene/state'
import { entityName } from '@scene/custom-components'
import { type CodeEditorHandle } from '../script/code-editor'
import { IconBot, IconChevron } from '../icons'
import { aiStore, clearRevealLine, closeDoc, leaveStudio, openDoc, openStudio, refreshFileRail, setMode, setSelection, setStudioChordHandler, setStudioFile, toggleAssistantCollapsed } from './ai-store'
import { uiSelectEntity } from '../actions/selection'
import { QuickOpen } from '../features/ai/QuickOpen'
import { StudioShell } from '../features/ai/StudioShell'
import { Composer } from '../features/ai/Composer'
import { AiEmpty, AiSetup, MessageList, type ChatMsg } from '../features/ai/transcript'
import { type ToolUse } from '../features/ai/activity'
import { friendlyError, MAX_ATTACH, readImages, sameFile } from '../features/ai/chat-helpers'
import { baseName } from '../script/project-files'
import { attachScript } from '../script/attach'
import { attachablePath } from '../script/template'
import { buildContext, entityScriptFiles, selectedEntities } from '../ai/context'
import { clearEditorRequests, runEditorRequests } from '../ai/requests'
import { ensurePrefabsLoaded } from './prefab-store'
import { isPrimaryMod } from '../lib/keys'

export function AiPanel(props: { shown: boolean; fill: boolean; height: number }): JSX.Element | null {
  const shell = window.editorShell
  const collapsed = useStore(() => aiStore.collapsed)
  const mode = useStore(() => aiStore.mode)
  // Mounted is not visible: minimized to its title bar, or inside a hidden dock,
  // the chat is still alive (transcript, CLI session, a turn mid-flight) — it
  // just isn't on screen, so it must not take focus or claim keys.
  const visible = mode === 'studio' || (props.shown && !collapsed)
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
  }, [messages, visible, mode])

  useEffect(() => {
    if (!visible) return
    inputRef.current?.focus()
    ensurePrefabsLoaded()
  }, [visible])

  // Escape steps back OUT of the assistant, one layer at a time: dismiss the
  // error modal → cancel a confirm → stop a running turn → leave the Studio for
  // the chat dock. It never removes the assistant: the dock is half the right
  // panel, and losing the open file tabs to one keystroke was exactly the bug.
  // In the dock with nothing to unwind, Escape belongs to the editor (clear the
  // selection) — the assistant is always on screen, so it can't own the key.
  // CodeMirror sees the key first (element handlers run before this document
  // listener); if it consumed it (autocomplete, search…) it preventDefaults and
  // we leave it alone — otherwise Escape leaves the Studio even from the editor.
  useEffect(() => {
    if (!visible) return
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
      if (mode !== 'studio') return
      // through the navigation guard: flush a dirty buffer (keep the Studio on a
      // failed save), and never leave over a pending AI diff
      leaveTabRef.current(leaveStudio)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [visible, mode, busy, errorDetail, confirmWipe, showQuickOpen])

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

  // Studio keys this window CAN see (not claimed by the main process): ⌘⇧[ / ⌘⇧]
  // tab cycling. e.code, not e.key — shifted brackets produce different
  // characters per layout. Platform-primary modifier only: on a Mac, Ctrl+[ is
  // an Escape alias in text fields and CodeMirror.
  // (⌘P moved to the main process when it became play/pause outside the Studio;
  // it arrives here as the 'goto-file' studio chord.)
  useEffect(() => {
    if (mode !== 'studio') return
    const onKey = (e: KeyboardEvent): void => {
      if (!isPrimaryMod(e) || e.altKey) return
      if (e.shiftKey && (e.code === 'BracketLeft' || e.code === 'BracketRight')) {
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
  }, [mode])

  // ⌘W (close tab), ⌘F (find in file) and ⌘Z/⌘⇧Z (text undo) are intercepted by
  // the main process; boot.ts offers them here first. ⌘W/⌘F are claimed even
  // when they can't act (no file open, read-only preview) — falling through to
  // "switch to the Move tool" / "fly the camera at the selection" behind an open
  // Studio would be far more surprising than a no-op. Undo/redo are claimed only
  // while the code editor has focus, so scene undo still works from the gutter.
  useEffect(() => {
    if (mode !== 'studio') return
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
        case 'goto-file':
          setShowQuickOpen((v) => !v)
          return true
      }
    })
    return () => setStudioChordHandler(null)
  }, [mode])

  if (shell?.aiSend === undefined) return null

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
      void shell.aiSend?.({ provider, model, text: asked, context: buildContext(sel, aiStore.file), images: imgs.length > 0 ? imgs : undefined }).catch((err: unknown) => {
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
        {!available && <AiSetup providers={providers} current={current} anyAvailable={anyAvailable} onRecheck={recheck} />}
        {available && messages.length === 0 && <AiEmpty current={current} studio={mode === 'studio'} onExample={send} />}
        <MessageList messages={messages} onRetry={retry} onShowDetail={setErrorDetail} />
      </div>
      <Composer
        available={available}
        busy={busy}
        input={input}
        onInput={setInput}
        inputRef={inputRef}
        onSend={send}
        onStop={stop}
        entities={entities}
        onUnselectEntity={(id) => uiSelectEntity(id, true, true)}
        selection={selection}
        onClearSelection={() => setSelection(null)}
        attachments={attachments}
        onAddImages={addImages}
        onRemoveImage={(i) => setAttachments((prev) => prev.filter((_, j) => j !== i))}
        fileRef={fileRef}
        providers={providers}
        provider={provider}
        model={model}
        current={current}
        onProvider={requestSwitch}
        onModel={setModel}
        confirm={confirmWipe}
        onConfirmYes={() => {
          if (confirmWipe !== null) doWipe(confirmWipe.kind)
          setConfirmWipe(null)
        }}
        onConfirmCancel={() => setConfirmWipe(null)}
      />
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
        <StudioShell
          file={file}
          tabs={tabs}
          dirty={dirty}
          railKey={railKey}
          fileStatus={fileStatus}
          editorRef={editorRef}
          onLeaveTab={leaveTab}
          onOpenDoc={openDoc}
          onDirty={setDirty}
          onStatus={(text, kind) => setFileStatus({ text, kind })}
          onAsk={(s) => {
            setSelection(s)
            inputRef.current?.focus()
          }}
          chat={chat}
        />
      </>
    )
  }

  return (
    <>
      {errorModal}
      <aside
        className={`eui-ai-panel${collapsed ? ' min' : ''}`}
        style={collapsed || props.fill ? undefined : { height: props.height, flex: '0 0 auto' }}
      >
      <header className="eui-ai-head">
        <button
          className={`eui-ai-headbtn icon${collapsed ? ' min' : ''}`}
          onClick={toggleAssistantCollapsed}
          data-tip={collapsed ? 'Expand the assistant' : 'Minimize to the title bar'}
          aria-label={collapsed ? 'Expand the assistant' : 'Minimize the assistant'}
        >
          <IconChevron />
        </button>
        <span className="eui-ai-title">
          <IconBot /> Assistant
        </span>
        <span style={{ flex: 1 }} />
        {!collapsed && (
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
        )}
      </header>
      {!collapsed && chat}
      </aside>
    </>
  )
}
