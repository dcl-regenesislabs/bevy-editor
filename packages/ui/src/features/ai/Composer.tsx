import type { AiImageAttachment, AiProvider, AiProviderInfo } from '@dcl-editor/contract'
import type { RefObject } from 'react'
import { baseName } from '../../script/project-files'
import { type CodeSelection } from '../../panels/ai-store'
import { type EntityInfo } from '../../ai/context'
import { ModelMenu } from './ModelMenu'
import { ArrowUpIcon, CubeIcon, ImageIcon } from './icons'
import { composerPlaceholder, MAX_ATTACH, QUICK_ACTIONS } from './chat-helpers'

export function Composer(props: {
  available: boolean
  busy: boolean
  input: string
  onInput: (v: string) => void
  inputRef: RefObject<HTMLTextAreaElement>
  onSend: (text: string) => void
  onStop: () => void
  entities: EntityInfo[]
  onUnselectEntity: (id: string) => void
  selection: CodeSelection | null
  onClearSelection: () => void
  attachments: AiImageAttachment[]
  onAddImages: (files: Iterable<File>) => void
  onRemoveImage: (index: number) => void
  fileRef: RefObject<HTMLInputElement>
  providers: AiProviderInfo[]
  provider: AiProvider
  model: string
  current?: AiProviderInfo
  onProvider: (id: AiProvider) => void
  onModel: (m: string) => void
  confirm: { label: string } | null
  onConfirmYes: () => void
  onConfirmCancel: () => void
}): JSX.Element {
  const { entities, selection, attachments } = props
  return (
    <div className="eui-ai-composer">
      {props.confirm !== null && (
        <div className="eui-ai-confirm">
          <span>{props.confirm.label}</span>
          <span style={{ flex: 1 }} />
          <button className="eui-ai-confirm-btn" onClick={props.onConfirmYes}>
            Yes
          </button>
          <button className="eui-ai-confirm-btn ghost" onClick={props.onConfirmCancel}>
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
              <button className="x" onClick={() => props.onUnselectEntity(e.id)} aria-label={`Unselect ${e.name}`}>
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
            <button className="x" onClick={props.onClearSelection} aria-label="Remove code">
              ✕
            </button>
          </span>
        )}
      </div>

      {selection !== null && (
        <div className="eui-ai-quick">
          {QUICK_ACTIONS.map(([label, prompt]) => (
            <button key={label} className="eui-ai-qbtn" disabled={props.busy || !props.available} onClick={() => props.onSend(prompt)}>
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
              <button className="rm" aria-label={`Remove ${img.name}`} onClick={() => props.onRemoveImage(i)}>
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
      <div className={`eui-ai-field ${!props.available ? 'off' : ''}`}>
        <textarea
          ref={props.inputRef}
          className="eui-ai-input"
          placeholder={composerPlaceholder(props.available, selection !== null)}
          value={props.input}
          disabled={!props.available}
          spellCheck={false}
          rows={2}
          onChange={(e) => props.onInput(e.target.value)}
          onPaste={(e) => {
            const files = [...e.clipboardData.items]
              .filter((it) => it.kind === 'file' && it.type.startsWith('image/'))
              .map((it) => it.getAsFile())
              .filter((f): f is File => f !== null)
            if (files.length > 0) {
              e.preventDefault()
              props.onAddImages(files)
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              props.onSend(props.input)
            }
            // Escape is handled globally (close / stop) — see the keydown effect
          }}
        />
        <div className="eui-ai-fieldbar">
          <ModelMenu
            providers={props.providers}
            provider={props.provider}
            model={props.model}
            current={props.current}
            onProvider={props.onProvider}
            onModel={props.onModel}
          />
          <input
            ref={props.fileRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => {
              if (e.target.files !== null) props.onAddImages(e.target.files)
              e.target.value = ''
            }}
          />
          <button
            className="eui-ai-attachbtn"
            disabled={!props.available || props.busy || attachments.length >= MAX_ATTACH}
            data-tip="Attach an image (or paste one)"
            aria-label="Attach image"
            onClick={() => props.fileRef.current?.click()}
          >
            <ImageIcon />
          </button>
          <span style={{ flex: 1 }} />
          {props.busy ? (
            <button className="eui-ai-send busy" onClick={props.onStop} data-tip="Stop (Esc)" aria-label="Stop">
              <span className="ring" />
              <span className="sq" />
            </button>
          ) : (
            <button
              className="eui-ai-send"
              onClick={() => props.onSend(props.input)}
              disabled={!props.available || (props.input.trim() === '' && attachments.length === 0)}
              data-tip="Send (Enter)"
              aria-label="Send"
            >
              <ArrowUpIcon />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
