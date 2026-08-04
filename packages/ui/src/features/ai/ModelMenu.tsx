// Provider + model picker in the composer bar. Switching provider starts a new
// conversation, so the caller confirms first (see requestSwitch in AiPanel).
import { useRef, useState } from 'react'
import type { AiProvider, AiProviderInfo } from '@dcl-editor/contract'
import { useOutsideClose } from '../../ds'
import { CheckIcon } from './icons'

export function ModelMenu(props: {
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
