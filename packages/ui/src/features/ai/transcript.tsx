import type { AiProviderInfo } from '@dcl-editor/contract'
import { Spinner } from '../../ds'
import { IconBot } from '../../icons'
import { ActivityGroup, groupTools, MUTATION_TOOLS, toolLabel, type ToolUse } from './activity'
import { MarkdownText } from './markdown'
import { CheckIcon } from './icons'
import { EXAMPLES, friendlyError, SETUP } from './chat-helpers'

export type ChatMsg =
  | { role: 'user'; text: string; images?: string[] }
  | { role: 'assistant'; turnId?: string; text: string; tools: ToolUse[]; done: boolean; error?: string }

export function AiSetup(props: {
  providers: AiProviderInfo[]
  current?: AiProviderInfo
  anyAvailable: boolean
  onRecheck: () => void
  rechecking: boolean
}): JSX.Element {
  return (
    <div className="eui-ai-setup">
      <div className="eui-ai-empty-icon">
        <IconBot />
      </div>
      <p className="eui-ai-empty-title">{props.anyAvailable ? `${props.current?.label} isn’t ready` : 'Set up the assistant'}</p>
      <p className="eui-ai-empty-sub">
        It runs a local AI CLI on your own subscription — no API key.{' '}
        {props.anyAvailable ? 'Pick an available provider below, or set this one up:' : 'Install one, sign in, then recheck.'}
      </p>
      <div className="eui-ai-setup-list">
        {props.providers.map((p) => (
          <div key={p.id} className="eui-ai-setup-row">
            <span className="pl">{p.label}</span>
            {p.available ? (
              <span className="ready">✓ ready</span>
            ) : (
              <span className="cmds">
                <code>{SETUP[p.id].install}</code>
                <code>
                  {SETUP[p.id].signIn} <span className="hint">↳ sign in</span>
                </code>
              </span>
            )}
          </div>
        ))}
      </div>
      <button className="eui-ai-recheck" onClick={props.onRecheck} disabled={props.rechecking}>
        {props.rechecking ? 'Looking for it…' : '↻ Recheck'}
      </button>
    </div>
  )
}

export function AiEmpty(props: { current?: AiProviderInfo; studio: boolean; onExample: (text: string) => void }): JSX.Element {
  return (
    <div className="eui-ai-empty">
      <div className="eui-ai-empty-icon">
        <IconBot />
      </div>
      <p className="eui-ai-empty-title">Edit your scripts by chatting</p>
      <p className="eui-ai-empty-sub">
        Runs on your {props.current?.label} subscription — no API key.
        {props.studio ? ' Select code in the editor and it rides along with your next message.' : ' Select an entity and I’ll scope the code to it.'}
      </p>
      {!props.studio && (
        <div className="eui-ai-examples">
          {EXAMPLES.map((ex) => (
            <button key={ex} className="eui-ai-example" onClick={() => props.onExample(ex)}>
              {ex}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function MessageList(props: {
  messages: ChatMsg[]
  onRetry: () => void
  onShowDetail: (detail: string) => void
}): JSX.Element {
  return (
    <>
      {props.messages.map((m, i) =>
        m.role === 'user' ? (
          <div key={i} className="eui-ai-msg user">
            {m.images !== undefined && (
              <span className="eui-ai-msg-imgs">
                {m.images.map((src, j) => (
                  <img key={j} src={src} alt="attached" />
                ))}
              </span>
            )}
            {m.text}
          </div>
        ) : (
          <div key={i} className="eui-ai-msg assistant">
            {m.tools.length > 0 && (
              <div className="eui-ai-tools">
                {groupTools(m.tools).map((g, j, all) => {
                  const inProgress = !m.done && j === all.length - 1
                  return Array.isArray(g) ? (
                    <ActivityGroup key={j} items={g} running={inProgress} />
                  ) : (
                    <span key={j} className={`eui-ai-tool ${MUTATION_TOOLS.has(g.t.tool) ? 'edit' : ''}`}>
                      <span className="ti">{inProgress ? <Spinner size={11} /> : <CheckIcon />}</span>
                      {toolLabel(g.t, inProgress)}
                      {g.n > 1 && <span className="n">×{g.n}</span>}
                    </span>
                  )
                })}
              </div>
            )}
            {m.text !== '' && (
              <div className="eui-ai-text">
                <MarkdownText text={m.text} />
              </div>
            )}
            {!m.done && m.text === '' && m.tools.length === 0 && (
              <span className="eui-ai-thinking">
                <Spinner size={14} /> Thinking…
              </span>
            )}
            {m.error !== undefined && (
              <div className="eui-ai-err">
                <span className="msg">{friendlyError(m.error)}</span>
                <span style={{ flex: 1 }} />
                <button className="eui-ai-retry ghost" onClick={() => props.onShowDetail(m.error ?? '')}>
                  See details
                </button>
                <button className="eui-ai-retry" onClick={props.onRetry}>
                  Retry
                </button>
              </div>
            )}
          </div>
        )
      )}
    </>
  )
}
