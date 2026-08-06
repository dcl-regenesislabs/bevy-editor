import { describe, expect, it } from 'vitest'
import { paramMentions, scanScriptSource } from './script-source'

describe('scanScriptSource', () => {
  it('blanks comments without moving anything else', () => {
    const text = "const a = 1 // pool(this.zombie, 'server')\nconst b = 2"
    const source = scanScriptSource(text)
    expect(source.code).toHaveLength(text.length)
    expect(source.code).not.toContain('pool(')
    expect(source.code.split('\n')[1]).toBe('const b = 2')
  })

  it('keeps a block comment’s newlines, so lines still line up', () => {
    const text = 'a\n/* two\nlines */\nb'
    const lines = scanScriptSource(text).code.split('\n')
    expect(lines).toHaveLength(4)
    expect(lines.map((line) => line.trim())).toEqual(['a', '', '', 'b'])
    expect(lines[1]).toHaveLength('/* two'.length)
  })

  it('keeps string contents but marks their offsets', () => {
    const text = `const help = "pool('x', 'server')"`
    const source = scanScriptSource(text)
    expect(source.code).toBe(text)
    expect(source.inString[text.indexOf('pool')]).toBe(1)
    expect(source.inString[text.indexOf('const')]).toBe(0)
    // the quotes themselves are not contents — a match starting there is fine
    expect(source.inString[text.indexOf('"')]).toBe(0)
  })

  it('does not end a string on an escaped quote', () => {
    const text = `const s = 'it\\'s here' + notAString`
    const source = scanScriptSource(text)
    expect(source.inString[text.indexOf('here')]).toBe(1)
    expect(source.inString[text.indexOf('notAString')]).toBe(0)
  })

  it('leaves an unterminated string masked to the end instead of looping', () => {
    const source = scanScriptSource("const s = 'never closed")
    expect(source.inString[source.code.length - 1]).toBe(1)
  })
})

describe('paramMentions', () => {
  it('lists every this.<name> the code reads, once, in order', () => {
    const source = scanScriptSource('start() { this.open(this.arenas); this.arenas.length; this.slotCount }')
    expect(paramMentions(source)).toEqual(['open', 'arenas', 'slotCount'])
  })

  it('ignores one written in a comment or a string', () => {
    const source = scanScriptSource("// reads this.zombie\nconst tip = 'pass this.zombie'\nthis.arenas")
    expect(paramMentions(source)).toEqual(['arenas'])
  })
})
