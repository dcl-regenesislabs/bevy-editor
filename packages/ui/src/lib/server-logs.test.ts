import { describe, expect, it } from 'vitest'
import { parseServerLogLine } from './server-logs'

describe('parseServerLogLine', () => {
  it('drops SSE comments and blank lines', () => {
    expect(parseServerLogLine(': connected', 0, 1000)).toBeNull()
    expect(parseServerLogLine(': ping', 0, 1000)).toBeNull()
    expect(parseServerLogLine('', 0, 1000)).toBeNull()
    expect(parseServerLogLine('data:', 0, 1000)).toBeNull()
  })

  it('parses a JSON log line with timestamp, level and message', () => {
    const line = parseServerLogLine(
      'data: {"timestamp":"2026-07-27T10:00:00.000Z","level":"error","message":"boom"}',
      3,
      1000
    )
    expect(line).toEqual({
      id: 3,
      timestamp: Date.parse('2026-07-27T10:00:00.000Z'),
      level: 'error',
      message: 'boom',
      extra: undefined
    })
  })

  it('keeps non-standard fields as serialized extra', () => {
    const line = parseServerLogLine('data: {"msg":"joined","sceneId":"bafy123"}', 0, 1000)
    expect(line?.message).toBe('joined')
    expect(line?.extra).toBe('{"sceneId":"bafy123"}')
  })

  it('normalizes warning/trace and unknown levels', () => {
    expect(parseServerLogLine('data: {"message":"m","level":"warning"}', 0, 1000)?.level).toBe('warn')
    expect(parseServerLogLine('data: {"message":"m","level":"trace"}', 0, 1000)?.level).toBe('info')
    expect(parseServerLogLine('data: {"message":"m","level":"whatever"}', 0, 1000)?.level).toBe('info')
  })

  it('treats non-JSON lines as plain info messages stamped with receive time', () => {
    const line = parseServerLogLine('data: plain text output', 7, 4242)
    expect(line).toEqual({ id: 7, timestamp: 4242, level: 'info', message: 'plain text output' })
  })

  it('falls back to receive time when the timestamp is unparseable', () => {
    const line = parseServerLogLine('data: {"message":"m","timestamp":"not-a-date"}', 0, 4242)
    expect(line?.timestamp).toBe(4242)
  })
})
