// A script's text prepared for matching: comments blanked out, and the offsets
// that sit inside a string literal marked.
//
// It exists so a chip is never derived from prose. A kit script documents its own
// imports in a comment block, and a doc string can hold a whole example call —
// `'call spawner.pool(this.zombie, "server") from start()'` — which must not make
// a prefab server-owned. String CONTENTS survive, because a real call's mode and
// a literal prefab id live in them, so the caller checks the mask instead.
//
// Offsets are preserved: a comment becomes spaces (newlines kept), never nothing,
// so `code`, `inString` and the original text all index the same positions.
//
// Pure: text in, text + mask out. `vendoring.ts` has its own comment stripper for
// import specifiers, which does not need offsets and cannot use this one.

export interface ScriptSource {
  /** the text with comment characters replaced by spaces */
  code: string
  /** 1 where that offset is inside a string literal's contents */
  inString: Uint8Array
}

export function scanScriptSource(text: string): ScriptSource {
  const out: string[] = []
  const inString = new Uint8Array(text.length)
  let i = 0
  while (i < text.length) {
    const c = text[i]
    if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') {
        out.push(' ')
        i++
      }
      continue
    }
    if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2)
      const stop = end < 0 ? text.length : end + 2
      while (i < stop) {
        out.push(text[i] === '\n' ? '\n' : ' ')
        i++
      }
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      out.push(c)
      i++
      while (i < text.length) {
        if (text[i] === '\\') {
          inString[i] = 1
          inString[i + 1] = 1
          out.push(text[i], text[i + 1] ?? '')
          i += 2
          continue
        }
        const closing = text[i] === c
        inString[i] = closing ? 0 : 1
        out.push(text[i])
        i++
        if (closing) break
      }
      continue
    }
    out.push(c)
    i++
  }
  return { code: out.join(''), inString }
}

/** Every `this.<name>` the script reads in code — never one written in prose. */
export function paramMentions(source: ScriptSource): string[] {
  const names: string[] = []
  for (const m of source.code.matchAll(/this\.(\w+)/g)) {
    const at = m.index ?? 0
    if (source.inString[at] === 1) continue
    if (!names.includes(m[1])) names.push(m[1])
  }
  return names
}
