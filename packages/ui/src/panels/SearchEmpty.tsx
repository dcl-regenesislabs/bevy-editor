import { Fragment } from 'react'
import { LinkButton } from '../ds'
import { canAskAssistant, prefillAssistant } from './ai-store'
import type { SearchHint } from './search-hints'

export function SearchEmpty(props: { message: string; query: string; hints: SearchHint[] }): JSX.Element {
  return (
    <div className="eui-empty">
      <p className="eui-empty-line">{props.message}</p>
      {props.hints.length > 0 && (
        <p className="eui-empty-hints">
          {props.hints.map((h, i) => (
            <Fragment key={h.label}>
              {i > 0 && <span className="sep">·</span>}
              <LinkButton onClick={h.onClick}>{h.label}</LinkButton>
            </Fragment>
          ))}
        </p>
      )}
      {props.query !== '' && canAskAssistant() && (
        <LinkButton
          className="eui-empty-ask"
          onClick={() => prefillAssistant(`I'm looking for ${props.query} — what could I use, or can you make one?`)}
        >
          Ask the assistant
        </LinkButton>
      )}
    </div>
  )
}
