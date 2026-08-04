// Tiny, safe markdown for assistant replies — no dependency, no HTML passthrough.
// Handles fenced code blocks, bullet lists, up-to-h3 headings, `code` and **bold**.

function inlineMd(s: string, keyBase: string): Array<string | JSX.Element> {
  const out: Array<string | JSX.Element> = []
  const re = /(`[^`]+`|\*\*[^*]+\*\*)/g
  let last = 0
  let m: RegExpExecArray | null
  let k = 0
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) out.push(s.slice(last, m.index))
    const tok = m[0]
    if (tok.startsWith('`')) out.push(<code key={`${keyBase}-${k++}`} className="eui-ai-ic">{tok.slice(1, -1)}</code>)
    else out.push(<strong key={`${keyBase}-${k++}`}>{tok.slice(2, -2)}</strong>)
    last = re.lastIndex
  }
  if (last < s.length) out.push(s.slice(last))
  return out
}

function Prose(props: { text: string }): JSX.Element {
  const lines = props.text.split('\n')
  const blocks: JSX.Element[] = []
  let list: string[] = []
  let k = 0
  const flush = (): void => {
    if (list.length > 0) {
      const items = list
      blocks.push(
        <ul key={`u${k++}`} className="eui-ai-ul">
          {items.map((li, i) => (
            <li key={i}>{inlineMd(li, `u${k}-${i}`)}</li>
          ))}
        </ul>
      )
      list = []
    }
  }
  for (const ln of lines) {
    const t = ln.replace(/\s+$/, '')
    if (/^\s*[-*]\s+/.test(t)) {
      list.push(t.replace(/^\s*[-*]\s+/, ''))
      continue
    }
    flush()
    if (t.trim() === '') continue
    const h = /^(#{1,3})\s+(.*)/.exec(t)
    if (h !== null) blocks.push(<div key={`h${k++}`} className="eui-ai-h">{inlineMd(h[2], `h${k}`)}</div>)
    else blocks.push(<p key={`p${k++}`} className="eui-ai-p">{inlineMd(t, `p${k}`)}</p>)
  }
  flush()
  return <>{blocks}</>
}

export function MarkdownText(props: { text: string }): JSX.Element {
  const parts: JSX.Element[] = []
  const re = /```(\w*)\n?([\s\S]*?)```/g
  let last = 0
  let m: RegExpExecArray | null
  let k = 0
  while ((m = re.exec(props.text)) !== null) {
    if (m.index > last) parts.push(<Prose key={k++} text={props.text.slice(last, m.index)} />)
    parts.push(
      <pre key={k++} className="eui-ai-code">
        <code>{m[2].replace(/\n$/, '')}</code>
      </pre>
    )
    last = re.lastIndex
  }
  if (last < props.text.length) parts.push(<Prose key={k++} text={props.text.slice(last)} />)
  return <>{parts}</>
}
