// Which deployed entity in a world came out of THIS project folder.
//
// A scene has no name inside a world — its identity there is the parcel set — so
// "my own scene" cannot be read off a deployment. Wallet + parcel set is not an
// identity either, and treating it as one is a data-loss bug: every project
// Studio creates starts on `0,0`, so a second project of yours looks exactly
// like a republish of the first, and the conflict dialog that should have said
// "this replaces it" never opens.
//
// The entity id is the one thing that says "this deployment came out of this
// folder", and we know it because we signed it: the linker's `rootCID` IS the
// entity id the world stores (sdk-commands passes `entityId` as `rootCID`), and
// it comes back as `entityId` on every row of /world/{name}/scenes.
//
// Losing the memory — a new machine, cleared storage, a folder that published
// from the CLI — costs exactly one confirmation on the next publish. That is the
// safe direction: an extra dialog, never a silent replacement.
const KEY = 'dcl-editor:published-entities'
// One entry per project/world pair. The cap only exists so a decade of scratch
// projects can't grow the value without bound; oldest inserted goes first.
const MAX = 200

type Memory = Record<string, string>

function entryKey(dir: string, world: string): string {
  return `${dir}\n${world.toLowerCase()}`
}

function read(): Memory {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw === null) return {}
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    const out: Memory = {}
    for (const [k, v] of Object.entries(parsed)) if (typeof v === 'string') out[k] = v
    return out
  } catch {
    return {} // unreadable memory is the same as no memory: one extra dialog
  }
}

export function lastPublishedEntity(dir: string, world: string): string | null {
  return read()[entryKey(dir, world)] ?? null
}

export function rememberPublishedEntity(dir: string, world: string, entityId: string): void {
  if (entityId === '') return
  const mem = read()
  const key = entryKey(dir, world)
  delete mem[key] // re-insert so a republished project is the youngest entry
  mem[key] = entityId
  const keys = Object.keys(mem)
  for (const stale of keys.slice(0, Math.max(0, keys.length - MAX))) delete mem[stale]
  try {
    localStorage.setItem(KEY, JSON.stringify(mem))
  } catch {
    // storage full or unavailable — the next publish just asks once more
  }
}
