import { useEffect, useState } from 'react'

// two-step destructive button: first click arms, second confirms; disarms after 3s
export function ConfirmButton(props: { label: string; confirm?: string; disabled?: boolean; onConfirm: () => void }): JSX.Element {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => setArmed(false), 3000)
    return () => clearTimeout(t)
  }, [armed])
  return (
    <button
      className={`eui-link ${armed ? 'danger' : ''}`}
      disabled={props.disabled}
      onClick={() => {
        if (armed) {
          setArmed(false)
          props.onConfirm()
        } else {
          setArmed(true)
        }
      }}
    >
      {armed ? props.confirm ?? 'Sure?' : props.label}
    </button>
  )
}
