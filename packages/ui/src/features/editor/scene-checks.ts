// Scene checks: the authoring-time lints that catch a game which cannot work,
// before Play does. Deliberately NOT scene-health.ts — that one parses the dev
// server's log stream (what the compiler said about the code), this one reads
// what the project holds (what the creator wired together). The two answer
// different questions and share nothing but a feature folder.
//
// A check is a pure function over a context object, so every rule is unit
// testable and none can reach the data layer on its own. Collecting the context
// (prefab folders, script texts) is scene-check-context.ts's job; the rules live
// in scene-check-rules.ts; SceneChecksCard renders the result.
//
// The registry is the plugin point: a package that ships a new authoring hazard
// registers its rule here instead of growing another bespoke banner.
import { useSyncExternalStore } from 'react'
import { log } from '../../log'
import type { PrefabComposite, PrefabData, PrefabSnapshot } from '../../prefabs/format'
import type { GameConfigValue } from '../../gameconfig/normalize'
import { BUILTIN_SCENE_CHECKS } from './scene-check-rules'

// 'blocker'      — the scene is wired wrong; it also blocks Play
// 'play-blocker' — correct to author, wrong to run right now (unsaved drift)
// 'warning'      — worth saying, never in the way
export type SceneCheckLevel = 'blocker' | 'play-blocker' | 'warning'

export interface SceneCheckPrefab {
  folder: string
  data: PrefabData
  composite: PrefabComposite
}

export interface SceneCheckContext {
  /** authored scene entities; runtime-spawned ones are filtered out upstream */
  snapshot: PrefabSnapshot
  prefabs: SceneCheckPrefab[]
  /** every project script's text, keyed by project-relative path */
  scripts: Record<string, string>
  gameConfig: GameConfigValue | null
}

export interface SceneFinding {
  id: string
  level: SceneCheckLevel
  title: string
  detail: string
  entityId?: string
  folder?: string
  /** one-click repair label + action id, dispatched by SceneChecksCard */
  fix?: { label: string; action: string }
}

export type SceneCheck = (ctx: SceneCheckContext) => SceneFinding[]

const registry = new Map<string, SceneCheck>()

export function registerSceneCheck(id: string, check: SceneCheck): void {
  registry.set(id, check)
}

export function registeredSceneChecks(): string[] {
  return [...registry.keys()]
}

const SEVERITY: Record<SceneCheckLevel, number> = { blocker: 0, 'play-blocker': 1, warning: 2 }

// A rule that throws is a bug in that rule, never a broken card: log it and let
// every other check still report.
export function runSceneChecks(ctx: SceneCheckContext): SceneFinding[] {
  const found: SceneFinding[] = []
  for (const [id, check] of registry) {
    try {
      found.push(...check(ctx))
    } catch (e) {
      log.warn('scene check failed', id, e)
    }
  }
  return found.sort((a, b) => SEVERITY[a.level] - SEVERITY[b.level])
}

// --- the published findings ---

let findings: SceneFinding[] = []
let flash = 0
const listeners = new Set<() => void>()

function notify(): void {
  for (const l of listeners) l()
}

function findingKey(finding: SceneFinding): string {
  return [finding.id, finding.level, finding.entityId ?? '', finding.folder ?? '', finding.detail].join('|')
}

// Identity is the re-render trigger, so an unchanged run must keep the array it
// already published — the context refresh runs on a timer and would otherwise
// repaint the card (and re-collapse nothing) every few seconds.
export function setSceneFindings(next: SceneFinding[]): void {
  const same =
    next.length === findings.length && next.every((f, i) => findingKey(f) === findingKey(findings[i]))
  if (same) return
  findings = next
  notify()
}

export function sceneFindings(): SceneFinding[] {
  return findings
}

/** Play consults this alongside awaitFreshBundle(): anything but a warning stops it. */
export function playBlockingFindings(): SceneFinding[] {
  return findings.filter((finding) => finding.level !== 'warning')
}

// Bumped when something (a refused Play) wants the card in front of the creator
// even though they collapsed it.
export function revealSceneChecks(): void {
  flash += 1
  notify()
}

// The escape hatch. A rule that fires wrongly must never trap a creator outside
// their own scene, so the card can wave one Play through — one, and only the
// next one, so the card comes back the moment the reason is gone or is not.
let playOverride = false

export function allowBlockedPlay(): void {
  playOverride = true
}

export function consumePlayOverride(): boolean {
  const allowed = playOverride
  playOverride = false
  return allowed
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useSceneFindings(): SceneFinding[] {
  return useSyncExternalStore(subscribe, () => findings)
}

export function useSceneChecksFlash(): number {
  return useSyncExternalStore(subscribe, () => flash)
}

export interface FindingsSummary {
  blocking: number
  warnings: number
  text: string
}

// What the collapsed card says. Blockers lead: a creator who reads nothing else
// should still learn that Play will refuse.
export function findingsSummary(list: SceneFinding[]): FindingsSummary {
  const blocking = list.filter((finding) => finding.level !== 'warning').length
  const warnings = list.length - blocking
  const plural = (n: number, one: string): string => `${n} ${n === 1 ? one : `${one}s`}`
  if (blocking === 0) return { blocking, warnings, text: `${plural(warnings, 'thing')} to look at` }
  const tail = warnings === 0 ? '' : ` · ${plural(warnings, 'warning')}`
  return { blocking, warnings, text: `${plural(blocking, 'problem')} blocking Play${tail}` }
}

export function resetSceneChecksForTest(): void {
  findings = []
  flash = 0
  playOverride = false
}

for (const [id, check] of BUILTIN_SCENE_CHECKS) registerSceneCheck(id, check)
