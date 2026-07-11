// The in-app script editor, extracted from the old ScriptCodeEditor modal into a
// reusable surface for the AI Studio. It owns a CodeMirror 6 view (TS language
// service, violet skin) and, crucially, the AI-reconciliation flow: before a
// turn we snapshot a baseline + save the buffer so the CLI edits the latest; the
// editor is frozen while the AI writes; on `done` we re-read the file and show
// the change as an accept/reject diff (@codemirror/merge) — nothing runs in the
// scene until the creator accepts. Exposes an imperative handle the AiPanel
// drives; renders its own review banner + "Ask AI" selection pill.
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { EditorView, basicSetup } from 'codemirror'
import { EditorState, Compartment } from '@codemirror/state'
import { keymap, tooltips } from '@codemirror/view'
import { indentWithTab } from '@codemirror/commands'
import { javascript } from '@codemirror/lang-javascript'
import { autocompletion } from '@codemirror/autocomplete'
import { oneDark } from '@codemirror/theme-one-dark'
import { unifiedMergeView } from '@codemirror/merge'
import { tsFacet, tsSync, tsLinter, tsAutocomplete, tsHover } from '@valtown/codemirror-ts'
import { createScriptTsEnv } from './ts-env'
import { dataLayerReadFile, dataLayerSaveFile } from '../datalayer'
import { restartScene } from '../boot'
import { uiPlay } from '../actions'
import { state } from '../../../scene/src/state'
import type { CodeSelection } from '../panels/ai-store'

export interface CodeEditorHandle {
  getDoc: () => string
  isDirty: () => boolean
  // save the buffer to disk (no scene restart); used to flush before an AI turn
  flush: () => Promise<void>
  freeze: (on: boolean) => void
  // remember the current on-disk/buffer text as the diff baseline
  snapshot: () => void
  // re-read disk; if it differs from the baseline, enter review and return true
  reviewAgainstDisk: () => Promise<boolean>
}

// design-system skin for CM's popups (autocomplete, hover, diagnostics).
const editorChrome = EditorView.theme({
  '.cm-tooltip': {
    backgroundColor: 'var(--paper-hi, #1d1c21)',
    border: '1px solid var(--divider)',
    borderRadius: '8px',
    boxShadow: 'var(--shadow-float, 0 8px 24px rgba(0,0,0,.5))',
    color: 'var(--text)',
    overflow: 'hidden'
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul': { fontFamily: 'inherit', fontSize: '12px', maxHeight: '260px', padding: '4px' },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li': { display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 8px', borderRadius: '6px', lineHeight: '1.3' },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': { background: 'var(--primary-selected, rgba(152,45,226,.25))', color: 'var(--text)' },
  '.cm-completionLabel': { flex: 'none' },
  '.cm-completionMatchedText': { textDecoration: 'none', color: 'var(--primary, #a24df1)', fontWeight: '700' },
  '.cm-completionDetail': { marginLeft: 'auto', fontStyle: 'normal', fontSize: '10.5px', color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '160px' },
  '.cm-completionIcon': { width: '14px', flex: 'none', fontSize: '11px', opacity: '0.7', paddingRight: '0' },
  '.cm-tooltip .cm-completionInfo': { backgroundColor: 'var(--paper-hi, #1d1c21)', border: '1px solid var(--divider)', borderRadius: '8px', padding: '8px 10px', fontSize: '11.5px', maxWidth: '440px', whiteSpace: 'pre-wrap' },
  '.cm-tooltip.cm-tooltip-hover': { padding: '8px 10px', fontSize: '11.5px', maxWidth: '480px', whiteSpace: 'pre-wrap', fontFamily: 'ui-monospace, monospace' },
  '.cm-diagnostic': { padding: '6px 8px', fontSize: '11.5px', borderLeft: 'none', borderRadius: '6px' },
  '.cm-diagnostic-error': { borderLeft: '3px solid var(--error)' },
  '.cm-lintRange-error': { backgroundImage: 'none', textDecoration: 'underline wavy var(--error) 1px', textUnderlineOffset: '3px' }
})

// Violet re-skin layered over oneDark (keep its syntax colors, swap the chrome to
// our tokens) + accept/reject diff chunk styling.
const violetSkin = EditorView.theme(
  {
    '&': { backgroundColor: 'var(--input)', color: 'var(--text)', height: '100%', fontSize: '13px' },
    '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.7' },
    '.cm-gutters': { backgroundColor: 'var(--input)', borderRight: '1px solid var(--divider-soft)', color: 'var(--text-3)' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--text-2)' },
    '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,0.03)' },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: 'var(--primary-selected) !important' },
    '.cm-cursor': { borderLeftColor: 'var(--primary)' },
    // @codemirror/merge chunks
    '.cm-deletedChunk': { backgroundColor: 'rgba(255,60,60,0.12)' },
    '.cm-deletedChunk .cm-deletedText': { background: 'rgba(255,60,60,0.22)' },
    '.cm-changedLine': { backgroundColor: 'rgba(56,201,110,0.14)' },
    '.cm-changedText': { background: 'rgba(56,201,110,0.28)' },
    '.cm-changeGutter': { width: '3px' },
    '.cm-chunkButtons': { fontFamily: 'var(--font-family)' },
    '.cm-chunkButtons button': { color: 'var(--text-2)', fontSize: '10.5px', cursor: 'pointer' },
    '.cm-chunkButtons button[name=accept]': { color: 'var(--success)' },
    '.cm-chunkButtons button[name=reject]': { color: 'var(--error)' }
  },
  { dark: true }
)

function selectionOf(view: EditorView, path: string): CodeSelection | null {
  const range = view.state.selection.main
  const from = range.empty ? view.state.doc.lineAt(range.head).from : range.from
  const to = range.empty ? view.state.doc.lineAt(range.head).to : range.to
  const startLine = view.state.doc.lineAt(from).number
  const endLine = view.state.doc.lineAt(to).number
  const text = view.state.doc.sliceString(from, to)
  if (text.trim() === '') return null
  return { path, startLine, endLine, text }
}

export const CodeEditor = forwardRef<
  CodeEditorHandle,
  {
    path: string
    onDirty?: (dirty: boolean) => void
    onSelect?: (sel: CodeSelection) => void
    // final content after the creator accepts/discards a diff → trigger rebuild
    onResolved?: (content: string) => void
    onStatus?: (status: string, kind: 'dim' | 'ok' | 'err') => void
  }
>(function CodeEditor(props, ref): JSX.Element {
  const { path, onDirty, onSelect, onResolved, onStatus } = props
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const baselineRef = useRef<string>('')
  const dirtyRef = useRef(false)
  const merge = useRef(new Compartment())
  const readonly = useRef(new Compartment())
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [reviewing, setReviewing] = useState(false)
  const [pill, setPill] = useState<{ top: number; left: number } | null>(null)

  const setDirty = (d: boolean): void => {
    if (dirtyRef.current === d) return
    dirtyRef.current = d
    onDirty?.(d)
  }

  // save the buffer to disk, then rebuild + restart the scene so the new code
  // actually runs. Used on accept/⌘S — NOT on the pre-turn flush.
  const commit = async (content: string): Promise<void> => {
    onStatus?.('Saving…', 'dim')
    await dataLayerSaveFile(path, content)
    baselineRef.current = content
    setDirty(false)
    onStatus?.('Building…', 'dim')
    const wasPlaying = !state.frozen
    await waitForRebuild()
    await restartScene()
    if (wasPlaying) await uiPlay()
    // Re-derive the inspector's params AFTER the scene reloaded, so the fresh
    // layout is the last write and isn't clobbered by the reload's snapshot.
    props.onResolved?.(content)
    onStatus?.(wasPlaying ? 'Running the new code' : 'Saved — runs on ▶ play', 'ok')
  }
  const commitRef = useRef(commit)
  commitRef.current = commit

  useImperativeHandle(
    ref,
    (): CodeEditorHandle => ({
      getDoc: () => viewRef.current?.state.doc.toString() ?? '',
      isDirty: () => dirtyRef.current,
      flush: async () => {
        const view = viewRef.current
        if (view === null || !dirtyRef.current) return
        await dataLayerSaveFile(path, view.state.doc.toString())
        setDirty(false)
      },
      freeze: (on) => {
        const view = viewRef.current
        if (view === null) return
        view.dispatch({ effects: readonly.current.reconfigure(EditorState.readOnly.of(on)) })
      },
      snapshot: () => {
        baselineRef.current = viewRef.current?.state.doc.toString() ?? baselineRef.current
      },
      reviewAgainstDisk: async () => {
        const view = viewRef.current
        if (view === null) return false
        let disk: string
        try {
          disk = await dataLayerReadFile(path)
        } catch {
          return false
        }
        if (disk === baselineRef.current) return false // AI didn't change this file
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: disk },
          effects: merge.current.reconfigure(unifiedMergeView({ original: baselineRef.current }))
        })
        setDirty(false)
        setReviewing(true)
        onStatus?.('Review the assistant’s change', 'dim')
        return true
      }
    }),
    [path]
  )

  const acceptAll = (): void => {
    const view = viewRef.current
    if (view === null) return
    const final = view.state.doc.toString()
    view.dispatch({ effects: merge.current.reconfigure([]) })
    setReviewing(false)
    void commitRef.current(final)
  }
  const discard = (): void => {
    const view = viewRef.current
    if (view === null) return
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: baselineRef.current },
      effects: merge.current.reconfigure([])
    })
    setReviewing(false)
    void commitRef.current(baselineRef.current) // revert on disk + rebuild
  }

  useEffect(() => {
    let cancelled = false
    const host = hostRef.current
    if (host === null) return
    setStatus('loading')
    setReviewing(false)
    setPill(null)
    void dataLayerReadFile(path)
      .then(async (content) => {
        const tsEnv = await createScriptTsEnv(path, content).catch(() => null)
        return { content, tsEnv }
      })
      .then(({ content, tsEnv }) => {
        if (cancelled) return
        baselineRef.current = content
        dirtyRef.current = false
        const root = host.getRootNode()
        const view = new EditorView({
          parent: host,
          root: root instanceof ShadowRoot ? root : undefined,
          state: EditorState.create({
            doc: content,
            extensions: [
              basicSetup,
              readonly.current.of(EditorState.readOnly.of(false)),
              merge.current.of([]),
              keymap.of([
                { key: 'Mod-s', run: () => { void commitRef.current(viewRef.current?.state.doc.toString() ?? ''); return true } },
                { key: 'Mod-k', run: (v) => { const s = selectionOf(v, path); if (s !== null) onSelect?.(s); return true } },
                indentWithTab
              ]),
              javascript({ typescript: true }),
              oneDark,
              violetSkin,
              editorChrome,
              tooltips({ position: 'fixed' }),
              ...(tsEnv !== null
                ? [tsFacet.of({ env: tsEnv.env, path: tsEnv.path }), tsSync(), tsLinter(), autocompletion({ override: [tsAutocomplete()] }), tsHover()]
                : []),
              EditorView.updateListener.of((u) => {
                if (u.docChanged) setDirty(true)
                if (u.selectionSet || u.docChanged || u.focusChanged) {
                  const r = u.state.selection.main
                  const host2 = hostRef.current
                  if (r.empty || host2 === null) {
                    setPill(null)
                  } else {
                    const c = u.view.coordsAtPos(r.head)
                    const box = host2.getBoundingClientRect()
                    if (c !== null) setPill({ top: c.top - box.top - 34, left: Math.min(c.left - box.left, box.width - 96) })
                  }
                }
              })
            ]
          })
        })
        viewRef.current = view
        setStatus('ready')
        if (tsEnv === null) onStatus?.('Types unavailable — editing without checks', 'dim')
        else onStatus?.('Ready', 'ok')
      })
      .catch((e) => {
        if (cancelled) return
        setStatus('error')
        onStatus?.(`Could not open ${path}: ${String(e)}`, 'err')
      })
    return () => {
      cancelled = true
      viewRef.current?.destroy()
      viewRef.current = null
    }
  }, [path])

  return (
    <div className="eui-studio-code">
      {reviewing && (
        <div className="eui-studio-review">
          <span className="dot" />
          <b>The assistant changed this script.</b>
          <span className="sub">Review before it runs in the scene.</span>
          <span style={{ flex: 1 }} />
          <button className="acc" onClick={acceptAll}>Accept all</button>
          <button className="dis" onClick={discard}>Discard</button>
        </div>
      )}
      <div className="eui-studio-cm" ref={hostRef}>
        {status === 'loading' && <div className="eui-studio-cmloading">loading…</div>}
        {pill !== null && !reviewing && (
          <button
            className="eui-studio-askpill"
            style={{ top: pill.top, left: pill.left }}
            onMouseDown={(e) => {
              e.preventDefault()
              const view = viewRef.current
              if (view === null) return
              const s = selectionOf(view, path)
              if (s !== null) onSelect?.(s)
              setPill(null)
            }}
          >
            ✦ Ask AI <span className="k">⌘K</span>
          </button>
        )}
      </div>
    </div>
  )
})

// Watch the dev-server rebuild log; resolve when a build line lands, else fall
// back after 2.5s. One listener guarded per call is fine — onStackLog is a
// broadcast the shell already emits. (Preload can't unsubscribe, so we gate on a
// timestamp instead of adding/removing listeners per save.)
let lastBuildAt = 0
let stackWired = false
function wireBuildSignal(): void {
  if (stackWired) return
  const shell = window.editorShell
  if (shell?.onStackLog === undefined) return
  stackWired = true
  shell.onStackLog((line) => {
    if (/rebuil|recompil|compiled|built in|updated|hmr|watch/i.test(line)) lastBuildAt = Date.now()
  })
}
async function waitForRebuild(): Promise<void> {
  wireBuildSignal()
  const t0 = Date.now()
  for (let i = 0; i < 24; i++) {
    if (lastBuildAt > t0) return
    await new Promise((r) => setTimeout(r, 120))
  }
  // no signal (or no shell) — small settle so the engine fetches the new bundle
  await new Promise((r) => setTimeout(r, 400))
}
