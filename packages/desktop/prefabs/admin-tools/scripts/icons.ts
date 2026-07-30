// UI textures ship inside the prefab folder instead of the builder-items CDN, so
// a placed scene stays self-contained. The prefab folder is discovered at runtime
// from the script's own location (sdk-commands passes the script's *directory* as
// the first constructor argument) — it has to be, because placing the prefab twice
// gives the second copy a different folder (custom/admin-tools_2/…).
const SCRIPTS_SEGMENT = '/scripts'

export function assetBase(scriptSrc: string): string {
  const slash = scriptSrc.lastIndexOf('/')
  const dir = /\.tsx?$/.test(scriptSrc) && slash > -1 ? scriptSrc.slice(0, slash) : scriptSrc
  const trimmed = dir.replace(/\/+$/, '')
  if (trimmed === 'scripts') return ''
  return trimmed.endsWith(SCRIPTS_SEGMENT) ? trimmed.slice(0, -SCRIPTS_SEGMENT.length) : trimmed
}

// Every texture in the prefab lives under <assetBase>/icons/. Tabs that ship
// their own glyphs build their paths with this instead of re-deriving the root.
export function iconPath(base: string, name: string): string {
  return base === '' ? `icons/${name}` : `${base}/icons/${name}`
}

export interface AdminIcons {
  panelBackground: string
  panelToggle: string
  tabModeration: string
  tabVideo: string
  tabSmartItems: string
  tabTextAnnouncements: string
  tabRewards: string
  headerModeration: string
  headerVideo: string
  headerSmartItems: string
  headerTextAnnouncements: string
  headerRewards: string
}

export function adminIcons(base: string): AdminIcons {
  const icon = (name: string): string => iconPath(base, name)
  return {
    panelBackground: icon('admin-tool-background.png'),
    panelToggle: icon('admin-panel-control-button.png'),
    tabModeration: icon('admin-panel-moderation-control-button.png'),
    tabVideo: icon('admin-panel-video-control-button.png'),
    tabSmartItems: icon('admin-panel-smart-item-control-button.png'),
    tabTextAnnouncements: icon('admin-panel-text-announcement-control-button.png'),
    tabRewards: icon('admin-panel-rewards-control-button.png'),
    headerModeration: icon('moderation-control-icon.png'),
    headerVideo: icon('video-control.png'),
    headerSmartItems: icon('smart-item-control.png'),
    headerTextAnnouncements: icon('text-announcement-control.png'),
    headerRewards: icon('rewards-control.png')
  }
}
