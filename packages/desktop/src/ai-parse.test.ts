// The assistant's whole chat UX rides on these two parsers tracking the output
// of two external CLIs. Recorded lines, so a format change fails here rather
// than silently showing an empty transcript.
import { describe, it, expect } from 'vitest'
import { PROVIDERS } from './ai'

const DIR = '/Users/me/scenes/my-scene'

function run(id: 'claude' | 'codex', lines: string[]): {
  texts: string[]
  tools: Array<[string, string]>
  sessions: Array<string | undefined>
} {
  const texts: string[] = []
  const tools: Array<[string, string]> = []
  const sessions: Array<string | undefined> = []
  for (const line of lines) {
    const session = PROVIDERS[id].parseLine(line, DIR, (text, tool) => {
      if (text !== '') texts.push(text)
      if (tool !== undefined) tools.push(tool)
    })
    if (session !== undefined) sessions.push(session)
  }
  return { texts, tools, sessions }
}

describe('claude parseLine', () => {
  it('takes the session id from the init event', () => {
    const { sessions } = run('claude', [
      JSON.stringify({ type: 'system', subtype: 'init', session_id: 'sess-abc' })
    ])
    expect(sessions).toEqual(['sess-abc'])
  })

  it('emits assistant text and tool uses in order', () => {
    const { texts, tools } = run('claude', [
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'Adding a spin.' },
            { type: 'tool_use', name: 'Edit', input: { file_path: `${DIR}/src/scripts/Spin.ts` } }
          ]
        }
      })
    ])
    expect(texts).toEqual(['Adding a spin.'])
    expect(tools).toHaveLength(1)
    expect(tools[0][0]).toBe('Edit')
    // paths are shown scene-relative, never as a ../../ traversal chain
    expect(tools[0][1]).toBe('src/scripts/Spin.ts')
  })

  it('ignores non-JSON chatter instead of throwing', () => {
    expect(() => run('claude', ['Warning: something on stderr', ''])).not.toThrow()
    expect(run('claude', ['not json']).texts).toEqual([])
  })

  it('skips empty text blocks', () => {
    const { texts } = run('claude', [
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: '' }] } })
    ])
    expect(texts).toEqual([])
  })
})

describe('codex parseLine', () => {
  it('takes the thread id from thread.started', () => {
    const { sessions } = run('codex', [JSON.stringify({ type: 'thread.started', thread_id: 'th-1' })])
    expect(sessions).toEqual(['th-1'])
  })

  it('emits completed agent messages, file changes and commands', () => {
    const { texts, tools } = run('codex', [
      JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'Done.' } }),
      JSON.stringify({
        type: 'item.completed',
        item: { type: 'file_change', changes: [{ path: `${DIR}/src/scripts/Door.ts` }] }
      }),
      JSON.stringify({ type: 'item.completed', item: { type: 'command_execution', command: 'npm run build' } })
    ])
    expect(texts).toEqual(['Done.'])
    expect(tools).toEqual([
      ['Edit', 'src/scripts/Door.ts'],
      ['Run', 'npm run build']
    ])
  })

  // started/updated items are partial — acting on them would duplicate every chip
  it('ignores in-progress items', () => {
    const { texts, tools } = run('codex', [
      JSON.stringify({ type: 'item.started', item: { type: 'agent_message', text: 'partial' } }),
      JSON.stringify({ type: 'item.updated', item: { type: 'agent_message', text: 'partial' } })
    ])
    expect(texts).toEqual([])
    expect(tools).toEqual([])
  })

  it('ignores non-JSON chatter', () => {
    expect(run('codex', ['thinking...']).texts).toEqual([])
  })
})
