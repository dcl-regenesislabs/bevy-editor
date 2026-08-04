// Local rules — no plugin package needed, flat config takes a plugin object inline.
const filenameConvention = {
  meta: {
    type: 'problem',
    docs: { description: 'PascalCase .tsx iff it exports its namesake component; kebab-case otherwise' },
    schema: []
  },
  create(context) {
    const file = context.filename ?? context.getFilename()
    const base = file.split('/').pop() ?? ''
    if (base.endsWith('.d.ts') || /\.test\.tsx?$/.test(base)) return {}
    const stem = base.replace(/\.tsx?$/, '')
    const pascal = /^[A-Z]/.test(stem)
    const kebab = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(stem)
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
        if (pascal) {
          if (!exported.has(stem))
            context.report({
              node,
              message: `"${base}" is PascalCase but exports no component named "${stem}". Rename the file to the component it provides, or kebab-case it if it is a collection (CONVENTIONS.md).`
            })
        } else if (!kebab) {
          context.report({
            node,
            message: `"${base}" is neither PascalCase nor kebab-case. Use kebab-case for logic and collections (CONVENTIONS.md).`
          })
        }
      }
    }
  }
}

export default { rules: { 'filename-convention': filenameConvention } }
