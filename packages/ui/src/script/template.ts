// Script scaffolding + path conventions. The class template mirrors the
// Creator Hub's ScriptInspector (constructor params after src/entity become
// the inspector's typed inputs), but scripts live under src/scripts — easier
// to find than the Hub's assets/scene/Scripts, and always inside the scene
// tsconfig's `src` include. Hub-authored scripts under assets keep working
// (the component stores the full path).

export const SCRIPTS_DIR = 'src/scripts'

export function isScriptFile(value: string): boolean {
  return value.endsWith('.ts') || value.endsWith('.tsx')
}

export function buildScriptPath(name: string): string {
  if (name.startsWith(SCRIPTS_DIR)) return name
  const scriptName = isScriptFile(name) ? name : `${name}.ts`
  return `${SCRIPTS_DIR}/${scriptName}`
}

export function toPascalCase(value: string, suffix = ''): string {
  const words = value
    .replace(/\.tsx?$/, '')
    .split(/[^a-zA-Z0-9]+/)
    .filter((w) => w.length > 0)
  const base = words.map((w) => w[0].toUpperCase() + w.slice(1)).join('')
  if (base === '') return ''
  return base.endsWith(suffix) ? base : base + suffix
}

// Verbatim port of the Creator Hub's class template
// (@dcl/inspector ScriptInspector/templates.ts) so scripts scaffolded here look
// exactly like Hub-scaffolded ones.
export function getScriptTemplateClass(scriptName: string): string {
  const pascal = toPascalCase(scriptName, 'Script')
  const className = pascal !== '' ? pascal : 'Script'
  return `import { engine, Entity } from '@dcl/sdk/ecs'

export class ${className} {
  constructor(
    public src: string,
    public entity: Entity
  ) {}

  /**
   * Start function - called when the script is initialized
   */
  start() {
    // Script initialization
    console.log("${className} initialized for entity:", this.entity);
  }

  /**
   * Update function - called every frame
   * @param dt - Delta time since last frame (in seconds)
   */
  update(dt: number) {
    // Called every frame
  }
}
`
}
