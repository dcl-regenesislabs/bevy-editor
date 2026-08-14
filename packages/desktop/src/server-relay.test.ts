import { describe, expect, it } from 'vitest'
import { lineReader } from './servers'

function collect(chunks: string[], flush = true): string[] {
  const out: string[] = []
  const reader = lineReader((line) => out.push(line))
  for (const chunk of chunks) reader.push(Buffer.from(chunk))
  if (flush) reader.flush()
  return out
}

describe('relaying a child’s output line by line', () => {
  it('rejoins a line the pipe cut in two — the bug that lost a [server] tag', () => {
    expect(collect(['Bundle saved\n[ser', 'ver] round 2 started\n'])).toEqual(['Bundle saved', '[server] round 2 started'])
  })

  it('holds a line back until its newline arrives', () => {
    expect(collect(['still typing'], false)).toEqual([])
  })

  it('emits what the stream ended on, unterminated', () => {
    expect(collect(['done'])).toEqual(['done'])
  })

  it('survives a \\r\\n split across two chunks', () => {
    expect(collect(['one\r', '\ntwo\r\n'])).toEqual(['one', 'two'])
  })

  it('keeps blank lines as lines, so the caller decides what to do with them', () => {
    expect(collect(['a\n\nb\n'])).toEqual(['a', '', 'b'])
  })
})
