// Local rules — no plugin package needed, flat config takes a plugin object inline.

// eslint hands back a NATIVE path, so Windows arrives as D:\a\…\Foo.tsx.
// Splitting on '/' alone left the whole path as the "basename": every file then
// looked PascalCase (the drive letter) and the rule failed all 250 of them on
// the Windows runner while macOS stayed green. Hence the separator class.
export function baseNameOf(filePath) {
  return filePath.split(/[\\/]/).pop() ?? ''
}

// The rule's whole decision, as a pure function so it can be tested off a real
// ESLint run: returns null when the name is fine, else the problem kind.
// `exported` is the set of names the file exports.
export function filenameProblem(filePath, exported) {
  const base = baseNameOf(filePath)
  if (base.endsWith('.d.ts') || /\.test\.tsx?$/.test(base)) return null
  const stem = base.replace(/\.tsx?$/, '')
  if (/^[A-Z]/.test(stem)) return exported.has(stem) ? null : { kind: 'pascal-without-namesake', base, stem }
  if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(stem)) return { kind: 'not-kebab', base, stem }
  return null
}

const filenameConvention = {
  meta: {
    type: 'problem',
    docs: { description: 'PascalCase .tsx iff it exports its namesake component; kebab-case otherwise' },
    schema: []
  },
  create(context) {
    const file = context.filename ?? context.getFilename()
    const base = baseNameOf(file)
    if (base.endsWith('.d.ts') || /\.test\.tsx?$/.test(base)) return {}
    const exported = new Set()
    const collect = (node) => {
      const d = node.declaration
      if (d == null) return
      if (d.type === 'FunctionDeclaration' && d.id != null) exported.add(d.id.name)
      if (d.type === 'VariableDeclaration')
        for (const decl of d.declarations) if (decl.id.type === 'Identifier') exported.add(decl.id.name)
      if (d.type === 'ClassDeclaration' && d.id != null) exported.add(d.id.name)
    }
    return {
      ExportNamedDeclaration: collect,
      ExportDefaultDeclaration(node) {
        const d = node.declaration
        if (d != null && (d.type === 'FunctionDeclaration' || d.type === 'ClassDeclaration') && d.id != null)
          exported.add(d.id.name)
      },
      'Program:exit'(node) {
        const problem = filenameProblem(file, exported)
        if (problem === null) return
        context.report({
          node,
          message:
            problem.kind === 'pascal-without-namesake'
              ? `"${problem.base}" is PascalCase but exports no component named "${problem.stem}". Rename the file to the component it provides, or kebab-case it if it is a collection (CONVENTIONS.md).`
              : `"${problem.base}" is neither PascalCase nor kebab-case. Use kebab-case for logic and collections (CONVENTIONS.md).`
        })
      }
    }
  }
}

export default { rules: { 'filename-convention': filenameConvention } }
