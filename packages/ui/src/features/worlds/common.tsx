// Shared bits of the worlds feature (also used by the publish modal).
import type { ProjectInfo } from '@dcl-editor/contract'
import type { WorldEntry } from './inventory'
import { newestScene } from './scene-label'

export const NAME_MARKETPLACE = 'https://decentraland.org/marketplace/names/claim'

export const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/

export function openExternal(url: string): void {
  void window.editorShell?.openExternal?.(url)
}

export const shortAddr = (a: string): string => `${a.slice(0, 6)}…${a.slice(-4)}`

export const GlobeIcon = (props: { size?: number }): JSX.Element => (
  <svg width={props.size ?? 15} height={props.size ?? 15} viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <circle cx="8" cy="8" r="6.2" stroke="currentColor" strokeWidth="1.3" />
    <path d="M1.8 8h12.4M8 1.8c-4.4 4.1-4.4 8.3 0 12.4 4.4-4.1 4.4-8.3 0-12.4Z" stroke="currentColor" strokeWidth="1.3" />
  </svg>
)

// world "cover", most-truthful first: the world's own thumbnail (set in the
// Settings tab — the one image that belongs to the world rather than to a scene
// on it), then the NEWEST scene's thumbnail, then the linked local scene's, then
// the places-API preview (often a generic placeholder), then a globe tile.
//
// crossOrigin is load-bearing: the page is COEP-isolated and the content
// servers send no CORP, so only a CORS request gets through.
export function WorldCover(props: { w: WorldEntry; local?: string | null }): JSX.Element {
  const src =
    props.w.settings?.thumbnail ?? newestScene(props.w.scenes)?.thumbnail ?? props.local ?? props.w.image ?? null
  return src !== null ? (
    <img className="eui-world-cover" src={src} alt="" crossOrigin="anonymous" loading="lazy" />
  ) : (
    <div className="eui-world-cover fallback">
      <GlobeIcon size={26} />
    </div>
  )
}

export function linkedScenes(projects: ProjectInfo[], world: string): ProjectInfo[] {
  return projects.filter((p) => p.world !== null && p.world.toLowerCase() === world && p.missing !== true)
}

export function publishFirstNote(lead: string, world: string): string {
  return `${lead} Publish a scene to ${world} first.`
}

export function PublishFirst(props: { lead: string; world: string }): JSX.Element {
  return (
    <section className="eui-world-block">
      <p className="eui-world-hint">{publishFirstNote(props.lead, props.world)}</p>
    </section>
  )
}
