// Open/save UI .tsx via the TS-AST round-trip (desktop main does the parsing &
// file IO). Open reads ONE component's JSX into the builder (keeping its props,
// imports, span); Save re-emits just the JSX and splices it back into the original
// source, leaving imports/props/surrounding code untouched.
import { emitJsx } from './codegen'
import { ui, loadTree, type UiNode } from './model'

export async function listUiFiles(): Promise<string[]> {
  return (await window.editorShell?.listUiFiles?.()) ?? []
}

export function importAvailable(): boolean {
  return typeof window.editorShell?.parseUiFile === 'function'
}

export function canSave(): boolean {
  return typeof window.editorShell?.writeUiFile === 'function' && ui.sourcePath !== null && ui.sourceText !== null
}

export async function openUiFromFile(relPath: string): Promise<{ ok: boolean; error?: string }> {
  const shell = window.editorShell
  if (!shell?.parseUiFile) return { ok: false, error: 'Open needs the desktop app' }
  const res = await shell.parseUiFile(relPath)
  if (!res.ok || res.tree === undefined) return { ok: false, error: res.error ?? 'Parse failed' }
  loadTree(res.tree as UiNode, {
    sourcePath: relPath,
    componentName: res.componentName,
    importLines: res.importLines,
    propsType: res.propsType,
    sourceText: res.sourceText,
    jsxStart: res.jsxStart,
    jsxEnd: res.jsxEnd
  })
  return { ok: true }
}

export async function saveUiToFile(): Promise<{ ok: boolean; error?: string }> {
  const shell = window.editorShell
  if (!shell?.writeUiFile || ui.sourcePath === null || ui.sourceText === null) {
    return { ok: false, error: 'Open a file first' }
  }
  // emit at the original column so the spliced JSX stays aligned
  const lineStart = ui.sourceText.lastIndexOf('\n', ui.jsxStart - 1) + 1
  const indent = ' '.repeat(ui.jsxStart - lineStart)
  const jsx = emitJsx(ui.root, 0).split('\n').map((l, i) => (i === 0 ? l : indent + l)).join('\n')
  const spliced = ui.sourceText.slice(0, ui.jsxStart) + jsx + ui.sourceText.slice(ui.jsxEnd)
  // reconcile the SDK imports with what the regenerated JSX now uses (added a
  // Label/Input/Dropdown/Color4? make sure it's imported, or the file won't compile)
  const newSource = ensureImports(spliced, jsx)
  const res = await shell.writeUiFile(ui.sourcePath, newSource)
  if (res.ok) {
    // imports are added BEFORE the JSX, so shift the span by the added length
    const delta = newSource.length - spliced.length
    ui.sourceText = newSource
    ui.jsxStart += delta
    ui.jsxEnd = ui.jsxStart + jsx.length
  }
  return res
}

// Ensure the file imports everything the regenerated JSX references: the
// @dcl/sdk/react-ecs named components (UiEntity/Label/Input/Dropdown) and Color4
// from @dcl/sdk/math. Pure string transform on the import lines (always at the top,
// before the JSX) so the round-trip span only shifts, never breaks.
export function ensureImports(source: string, jsx: string): string {
  let out = source
  const needed = (['UiEntity', 'Label', 'Input', 'Dropdown'] as const).filter((t) => new RegExp(`<${t}[\\s/>]`).test(jsx))

  const namedRe = /import\s+ReactEcs\s*,\s*\{([^}]*)\}\s*from\s*(['"])@dcl\/sdk\/react-ecs\2/
  const bareRe = /import\s+ReactEcs\s+from\s*(['"])@dcl\/sdk\/react-ecs\1/
  if (namedRe.test(out)) {
    out = out.replace(namedRe, (_full, names: string, q: string) => {
      const set = new Set(names.split(',').map((s) => s.trim()).filter(Boolean))
      needed.forEach((n) => set.add(n))
      return `import ReactEcs, { ${[...set].join(', ')} } from ${q}@dcl/sdk/react-ecs${q}`
    })
  } else if (bareRe.test(out) && needed.length > 0) {
    out = out.replace(bareRe, (_full, q: string) => `import ReactEcs, { ${needed.join(', ')} } from ${q}@dcl/sdk/react-ecs${q}`)
  } else if (!/from\s*['"]@dcl\/sdk\/react-ecs['"]/.test(out) && needed.length > 0) {
    out = `import ReactEcs, { ${needed.join(', ')} } from '@dcl/sdk/react-ecs'\n` + out
  }

  if (/\bColor4\b/.test(jsx)) {
    const mathRe = /import\s*\{([^}]*)\}\s*from\s*(['"])@dcl\/sdk\/math\2/
    const m = mathRe.exec(out)
    if (m) {
      if (!/\bColor4\b/.test(m[1])) {
        out = out.replace(mathRe, (_full, names: string, q: string) => {
          const set = new Set(names.split(',').map((s) => s.trim()).filter(Boolean))
          set.add('Color4')
          return `import { ${[...set].join(', ')} } from ${q}@dcl/sdk/math${q}`
        })
      }
    } else {
      const afterReactEcs = /(import[^\n]*@dcl\/sdk\/react-ecs[^\n]*\n)/
      out = afterReactEcs.test(out)
        ? out.replace(afterReactEcs, `$1import { Color4 } from '@dcl/sdk/math'\n`)
        : `import { Color4 } from '@dcl/sdk/math'\n` + out
    }
  }
  return out
}
