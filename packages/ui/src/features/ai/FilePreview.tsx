import { useEffect, useState } from 'react'
import { Spinner } from '../../ds'
import { dataLayerReadFileBytes } from '../../engine/datalayer'
import { fileKind, mimeFor, looksBinary, MAX_PREVIEW_BYTES } from '../../script/project-files'

type Shown = { kind: 'text'; text: string } | { kind: 'image'; url: string } | { kind: 'none'; why: string }

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function FilePreview(props: { path: string }): JSX.Element {
  const { path } = props
  const [shown, setShown] = useState<Shown | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    let revoke: string | null = null
    setShown(null)
    setErr(null)

    dataLayerReadFileBytes(path).then(
      (bytes) => {
        if (!live) return
        if (bytes.length > MAX_PREVIEW_BYTES) {
          setShown({ kind: 'none', why: `Too big to preview (${formatSize(bytes.length)}).` })
          return
        }
        if (fileKind(path) === 'image') {
          const blob = new Blob([new Uint8Array(bytes)], { type: mimeFor(path) })
          revoke = URL.createObjectURL(blob)
          setShown({ kind: 'image', url: revoke })
          return
        }
        if (looksBinary(bytes)) {
          setShown({ kind: 'none', why: `Binary file (${formatSize(bytes.length)}) — nothing readable to show.` })
          return
        }
        setShown({ kind: 'text', text: new TextDecoder().decode(bytes) })
      },
      (e: unknown) => live && setErr(e instanceof Error ? e.message : String(e))
    )

    return () => {
      live = false
      if (revoke !== null) URL.revokeObjectURL(revoke)
    }
  }, [path])

  if (err !== null) return <div className="eui-preview-msg">Couldn’t read this file — {err}</div>
  if (shown === null)
    return (
      <div className="eui-preview-msg">
        <Spinner size={16} /> Loading…
      </div>
    )
  if (shown.kind === 'none') return <div className="eui-preview-msg">{shown.why}</div>
  if (shown.kind === 'image')
    return (
      <div className="eui-preview img">
        <img src={shown.url} alt={path} />
      </div>
    )
  return (
    <div className="eui-preview">
      <pre className="eui-preview-text">{shown.text}</pre>
    </div>
  )
}
