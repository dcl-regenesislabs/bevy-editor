// Script scaffolding + path conventions. The class template mirrors the
// Creator Hub's ScriptInspector (constructor params after src/entity become
// the inspector's typed inputs), but scripts live under src/scripts — easier
// to find than the Hub's assets/scene/Scripts, and always inside the scene
// tsconfig's `src` include. Hub-authored scripts under assets keep working
// (the component stores the full path).

export const SCRIPTS_DIR = 'src/scripts'

/** Where a placed trigger zone carries the zone bus, relative to src/scripts. */
export const ZONE_BUS_IMPORT = '../../custom/trigger_zone/scripts/runtime/zoneBus'

export function isScriptFile(value: string): boolean {
  return value.endsWith('.ts') || value.endsWith('.tsx')
}

const ATTACHABLE = new RegExp(`(?:^|/)(${SCRIPTS_DIR}/[^/]+\\.tsx?)$`)

// A path the assistant reported writing → the project path to attach, or null
// when it isn't a per-entity Script. The CLIs report paths absolute and
// symlink-resolved (main's rel() trims most of that; a Windows turn can still
// arrive with backslashes). src/index.ts and anything outside SCRIPTS_DIR
// attach to nothing.
export function attachablePath(reported: string): string | null {
  const m = ATTACHABLE.exec(reported.replace(/\\/g, '/'))
  return m === null ? null : m[1]
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

// The reaction half of a trigger zone: scaffolded straight onto the zone, so the
// creator's answer to "what happens here" lives on the thing they placed.
//
// NO zone param. The script is attached to the zone, so zoneOf() reads the name off
// this entity — asking the creator to also type it would be a second source of
// truth for something the attachment already settled.
//
// All three shapes are present because enter is only a third of the story: most
// behaviour is really "while someone is inside" (a door with two people in it must
// not close when one leaves), which is what isInZone answers. It listens through the
// bus rather than triggerAreaEventsSystem because the SDK keeps ONE callback per
// (entity, event) — subscribing directly here would silently replace the detector.
export function getZoneReactionTemplate(scriptName: string): string {
  const pascal = toPascalCase(scriptName, '')
  const className = pascal !== '' ? pascal : 'ZoneReaction'
  return `import { Entity } from '@dcl/sdk/ecs'
import { isInZone, onZone, zoneOf } from '${ZONE_BUS_IMPORT}'

export class ${className} {
  private zone = ''
  private off: (() => void) | null = null

  constructor(
    public src: string,
    public entity: Entity
  ) {}

  start() {
    this.zone = zoneOf(this.entity)

    // event.local is true when the avatar is this player's.
    this.off = onZone(this.zone, 'any', (event) => {
      if (!event.local) return
      if (event.kind === 'enter') {
        // What happens when they walk in.
      } else {
        // What happens when they leave.
      }
    })
  }

  update(dt: number) {
    // For anything that should hold WHILE someone is inside, ask occupancy
    // instead of counting entries and exits yourself:
    // if (isInZone(this.zone)) { ... } else { ... }
  }
}
`
}
