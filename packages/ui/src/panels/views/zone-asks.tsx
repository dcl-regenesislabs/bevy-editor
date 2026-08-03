import { canAskAssistant, prefillAssistant } from '../ai-store'

export function ZoneAsks(props: { prompts: string[] }): JSX.Element | null {
  if (!canAskAssistant()) return null
  return (
    <div className="eui-zone-asks">
      {props.prompts.map((prompt) => (
        <button key={prompt} className="eui-zone-ask" onClick={() => prefillAssistant(prompt)}>
          {prompt}
        </button>
      ))}
    </div>
  )
}
