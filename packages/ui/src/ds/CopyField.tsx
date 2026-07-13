import { useState } from 'react'

export function copyText(v: string, done: () => void): void {
  void navigator.clipboard?.writeText(v).then(done)
}

export function CopyField(props: { label: string; value: string; secret?: boolean }): JSX.Element {
  const [reveal, setReveal] = useState(false)
  const [copied, setCopied] = useState(false)
  const masked = props.secret === true && !reveal
  const copy = (): void => {
    void navigator.clipboard?.writeText(props.value).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    })
  }
  return (
    <div className="eui-copyfield">
      <span className="k">{props.label}</span>
      <span className="v">{masked ? '••••••••••••••••' : props.value}</span>
      {props.secret === true && (
        <button className="eui-link" onClick={() => setReveal((v) => !v)}>{reveal ? 'Hide' : 'Reveal'}</button>
      )}
      <button className="eui-link" onClick={copy}>{copied ? 'Copied ✓' : 'Copy'}</button>
    </div>
  )
}
