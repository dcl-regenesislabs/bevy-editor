// The folder list behind "Move to…" — which folders a selection may be filed
// into, and how they nest. Pure, so the rules that decide a destination is
// illegal are testable without mounting the picker.
import { parentOf, type Snapshot } from '@scene/state'
import { entityName } from '@scene/custom-components'
// straight from where the constant is defined, not via actions/folders: that
// route drags the action layer (and through it the bus, and window) into a
// module whose whole point is being testable without a DOM
import { FOLDER_COMPONENT } from '../prefabs/format'

export interface FolderNode {
  id: string
  name: string
  /** folders nested directly inside this one, already sorted */
  children: FolderNode[]
  /** false when this folder can't take the selection — see blockedReason */
  enabled: boolean
  blockedReason?: string
}

const UNNAMED = 'Folder'

// A folder can't be moved into itself, and it can't be moved into anything it
// contains — that would cut the subtree out of the scene tree entirely, since the
// new parent travels with it. The whole descendant set has to go, not just the
// direct children: two hops down is the same cycle with more steps.
function descendantsOf(snapshot: Snapshot, roots: string[]): Set<string> {
  const blocked = new Set(roots)
  // A tree this shape is small, but a malformed snapshot can carry a parent
  // cycle; the visited guard is what stops that hanging the picker.
  const seen = new Set<string>()
  for (const id of Object.keys(snapshot)) {
    if (seen.has(id)) continue
    const chain: string[] = []
    let cur: string | null = id
    for (let hops = 0; cur !== null && hops < 64; hops++) {
      if (blocked.has(cur)) {
        for (const c of chain) blocked.add(c)
        break
      }
      if (seen.has(cur)) break
      chain.push(cur)
      cur = parentOf(snapshot, cur)
    }
    for (const c of chain) seen.add(c)
  }
  return blocked
}

/**
 * Every folder in the scene, nested, with the ones `moving` may not enter marked
 * disabled rather than hidden — a destination that silently isn't listed reads as
 * a missing folder, which is a worse bug report than a greyed row that says why.
 */
export function folderTree(snapshot: Snapshot, moving: string[]): FolderNode[] {
  const folders = Object.keys(snapshot).filter((id) => snapshot[id]?.[FOLDER_COMPONENT] !== undefined)
  const blocked = descendantsOf(snapshot, moving)
  // Already there: offering it invites a click that does nothing. Only when EVERY
  // moved entity shares that parent — a mixed selection genuinely has somewhere to go.
  const parents = new Set(moving.map((id) => parentOf(snapshot, id) ?? '0'))
  const currentParent = parents.size === 1 ? [...parents][0] : null

  const node = (id: string): FolderNode => {
    const self = moving.includes(id)
    const inside = !self && blocked.has(id)
    const here = id === currentParent
    return {
      id,
      name: entityName(snapshot, id) ?? UNNAMED,
      children: [],
      enabled: !self && !inside && !here,
      blockedReason: self
        ? "A folder can't be moved into itself"
        : inside
          ? "That folder is inside what you're moving"
          : here
            ? 'Already here'
            : undefined
    }
  }

  const byId = new Map(folders.map((id) => [id, node(id)]))
  const roots: FolderNode[] = []
  for (const id of folders) {
    const self = byId.get(id) as FolderNode
    const parent = parentOf(snapshot, id)
    const under = parent === null ? undefined : byId.get(parent)
    if (under === undefined) roots.push(self)
    else under.children.push(self)
  }
  sortTree(roots)
  return roots
}

function sortTree(nodes: FolderNode[]): void {
  nodes.sort((a, b) => a.name.localeCompare(b.name))
  for (const n of nodes) sortTree(n.children)
}

/** Depth-first flatten, for searching across every level at once. */
export function flatten(nodes: FolderNode[]): FolderNode[] {
  return nodes.flatMap((n) => [n, ...flatten(n.children)])
}

// Search spans the whole tree, not the level being browsed: someone who types a
// name is asking where it is, and making them navigate to it first would defeat
// the point of a search box.
export function searchFolders(roots: FolderNode[], query: string): FolderNode[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') return []
  return flatten(roots).filter((n) => n.name.toLowerCase().includes(needle))
}

/** The folders shown for the level currently open — root level when null. */
export function levelOf(roots: FolderNode[], openId: string | null): FolderNode[] {
  if (openId === null) return roots
  return flatten(roots).find((n) => n.id === openId)?.children ?? []
}

/** Root → open folder, for the breadcrumb. Empty at the top level. */
export function trailTo(roots: FolderNode[], openId: string | null): FolderNode[] {
  if (openId === null) return []
  const walk = (nodes: FolderNode[], path: FolderNode[]): FolderNode[] | null => {
    for (const n of nodes) {
      const next = [...path, n]
      if (n.id === openId) return next
      const found = walk(n.children, next)
      if (found !== null) return found
    }
    return null
  }
  return walk(roots, []) ?? []
}
