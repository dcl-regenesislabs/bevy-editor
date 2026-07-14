import { useRef, useState } from 'react'
import type { EditorShell, ProjectInfo } from '@dcl-editor/contract'
import { Chip, useOutsideClose } from '../../ds'
import { relTime } from '../../lib/format'

export const FolderIcon = (): JSX.Element => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
    <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4l2 2H19.5A1.5 1.5 0 0 1 21 8.5v9A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5v-11Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
  </svg>
)

function sceneSub(p: ProjectInfo): string {
  if (p.missing === true) return 'Folder not found'
  return p.world !== null ? p.world : `${p.parcels} parcel${p.parcels === 1 ? '' : 's'}`
}

export function SceneCard(props: {
  p: ProjectInfo
  shell: EditorShell
  onOpen: () => void
  onChanged: () => void
  onRemove: (p: ProjectInfo) => void
  onPublish: () => void
}): JSX.Element {
  const { p, shell } = props
  const [menu, setMenu] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useOutsideClose(menu, ref, () => setMenu(false))

  const after = (op?: Promise<unknown>): void => {
    setMenu(false)
    void Promise.resolve(op).then(() => props.onChanged())
  }
  const open = (): void => {
    if (!menu && !renaming && p.missing !== true) props.onOpen()
  }

  return (
    <div
      ref={ref}
      className={`eui-scene-card ${p.missing === true ? 'missing' : ''}`}
      role="button"
      tabIndex={0}
      data-tip={p.path}
      onClick={open}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && !renaming) {
          e.preventDefault()
          open()
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        setMenu(true)
      }}
    >
      <div className="eui-scene-thumb">
        {p.thumbnail !== null ? <img src={p.thumbnail} alt="" /> : <div className="eui-scene-thumb-fallback"><FolderIcon /></div>}
      </div>
      {p.favourite === true && <span className="eui-scene-pin" data-tip="Favourite">★</span>}
      <div className="eui-scene-meta">
        {renaming ? (
          <input
            className="eui-scene-rename"
            autoFocus
            defaultValue={p.title}
            onClick={(e) => e.stopPropagation()}
            onBlur={(e) => {
              setRenaming(false)
              const v = e.target.value.trim()
              if (v !== '' && v !== p.title) after(shell.renameProject?.(p.path, v))
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              if (e.key === 'Escape') setRenaming(false)
            }}
          />
        ) : (
          <span className="eui-scene-name">{p.title}</span>
        )}
        {p.world !== null && p.missing !== true ? (
          <span className="eui-scene-sub">
            <Chip tone="primary" tip="This scene publishes to your world">◆ {p.world}</Chip>
          </span>
        ) : (
          <span className="eui-scene-sub">{sceneSub(p)}</span>
        )}
        {p.lastOpened !== undefined && p.missing !== true && (
          <span className="eui-scene-ago">opened {relTime(p.lastOpened)}</span>
        )}
      </div>

      <div className="eui-scene-actions">
        {p.missing !== true && (
          <button
            className={`eui-scene-iact ${p.favourite === true ? 'on' : ''}`}
            data-tip={p.favourite === true ? 'Unfavourite' : 'Favourite'}
            onClick={(e) => {
              e.stopPropagation()
              after(shell.toggleFavourite?.(p.path))
            }}
          >
            {p.favourite === true ? '★' : '☆'}
          </button>
        )}
        <button
          className="eui-scene-iact"
          data-tip="More"
          onClick={(e) => {
            e.stopPropagation()
            setMenu((v) => !v)
          }}
        >
          ⋯
        </button>
      </div>

      {menu && (
        <div className="eui-ctx eui-scene-menu" onClick={(e) => e.stopPropagation()}>
          {p.missing !== true && (
            <>
              <button className="eui-menu-item" onClick={props.onOpen}>Open<span className="hint">↵</span></button>
              <button className="eui-menu-item" onClick={() => after(shell.toggleFavourite?.(p.path))}>
                {p.favourite === true ? 'Unfavourite' : 'Favourite'}
              </button>
              <button className="eui-menu-item" onClick={() => after(shell.revealInFinder?.(p.path))}>Reveal in Finder</button>
              <button
                className="eui-menu-item"
                onClick={() => {
                  setMenu(false)
                  setRenaming(true)
                }}
              >
                Rename
              </button>
              <button className="eui-menu-item" onClick={() => after(shell.duplicateProject?.(p.path))}>Duplicate</button>
              <div className="eui-menu-sep" />
              <button
                className="eui-menu-item"
                onClick={() => {
                  setMenu(false)
                  props.onPublish()
                }}
              >
                {p.world !== null ? `Publish to ${p.world}…` : 'Publish to a world…'}
              </button>
              <div className="eui-menu-sep" />
            </>
          )}
          <button
            className="eui-menu-item"
            onClick={() => {
              setMenu(false)
              props.onRemove(p)
            }}
          >
            Remove from list
          </button>
          {p.missing !== true && (
            <button
              className="eui-menu-item danger"
              onClick={() =>
                after(
                  shell.deleteProject?.(p.path).then((ok) => {
                    if (ok !== true) return
                  })
                )
              }
            >
              Delete from disk…
            </button>
          )}
        </div>
      )}
    </div>
  )
}
