// Studio layout: file rail, tab bar, the editor (or a read-only preview) and the
// chat column. Every way of leaving the open tab routes through `onLeaveTab`,
// which owns the dirty-buffer / pending-diff guard.
import type { ReactNode, RefObject } from 'react'
import { AutoSaveChip } from '../../ds'
import { IconCode } from '../../icons'
import { CodeEditor, type CodeEditorHandle } from '../../script/code-editor'
import { baseName, isEditable } from '../../script/project-files'
import { isEntryPoint } from '../../script/guarded'
import { aiStore, closeDoc, leaveStudio, setSelection, setStudioFile, type CodeSelection } from '../../panels/ai-store'
import { FileRail } from './FileRail'
import { FilePreview } from './FilePreview'

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

export function StudioShell(props: {
  file: string | null
  tabs: string[]
  dirty: boolean
  railKey: number
  fileStatus: { text: string; kind: 'dim' | 'ok' | 'err' }
  editorRef: RefObject<CodeEditorHandle>
  onLeaveTab: (then: () => void) => void
  onOpenDoc: (path: string) => void
  onDirty: (dirty: boolean) => void
  onStatus: (text: string, kind: 'dim' | 'ok' | 'err') => void
  onAsk: (s: CodeSelection) => void
  chat: ReactNode
}): JSX.Element {
  const { file } = props
  return (
    <aside className="eui-ai-panel studio">
      <header className="eui-studio-head">
        <span className="eui-studio-brand">
          <IconCode /> Script Studio
        </span>
        <span style={{ flex: 1 }} />
        <button className="eui-studio-hbtn" onClick={() => props.onLeaveTab(leaveStudio)} data-tip="Back to the chat dock (Esc)">
          ⤡
        </button>
      </header>
      <div className="eui-studio-split">
        <FileRail active={file} reloadKey={props.railKey} onOpen={(p) => props.onLeaveTab(() => props.onOpenDoc(p))} />
        <div className="eui-studio-left">
          <div className="eui-studio-tabbar" role="tablist">
            {props.tabs.map((f) => (
              <span key={f} className={`eui-studio-tab ${f === file ? 'on' : ''} ${f === file && props.dirty ? 'dirty' : ''}`}>
                <button className="lbl" role="tab" aria-selected={f === file} onClick={() => props.onLeaveTab(() => setStudioFile(f))} title={f}>
                  {baseName(f)}
                </button>
                <button className="x" onClick={() => props.onLeaveTab(() => closeDoc(f))} aria-label={`Close ${baseName(f)}`} data-tip="Close tab">
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
              {props.fileStatus.text !== '' && <AutoSaveChip state={props.fileStatus.kind}>{props.fileStatus.text}</AutoSaveChip>}
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
              ref={props.editorRef}
              path={file}
              guarded={isEntryPoint(file)}
              onSelect={setSelection}
              onAsk={props.onAsk}
              onDirty={props.onDirty}
              onResolved={(content) => aiStore.onSaved?.(file, content)}
              onStatus={props.onStatus}
            />
          ) : (
            <FilePreview key={file} path={file} />
          )}
        </div>
        <div className="eui-studio-right">{props.chat}</div>
      </div>
    </aside>
  )
}
