// Preview-on-phone. The scene dev server (sdk-commands start) binds 0.0.0.0,
// so a phone on the same network can already join the running preview — with
// the same hot reload the editor gets, since it's the same server rebuilding
// on save. This module only derives what the UI shows: the LAN address, the
// decentraland:// deep link the Decentraland mobile client opens (the exact
// shape sdk-commands' own --mobile QR emits), and that link as a QR data URL.
import os from 'node:os'
import QRCode from 'qrcode'
import type { MobilePreview } from '@dcl-editor/contract'

// first non-internal IPv4 — the same heuristic sdk-commands uses
export function lanIp(ifaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces()): string | undefined {
  return Object.values(ifaces)
    .flat()
    .find((i) => i?.family === 'IPv4' && !i.internal)?.address
}

// `preview` is deliberately not URL-encoded — the mobile client parses the
// link with the raw http://ip:port value, matching sdk-commands' QR
export function previewDeepLink(lanUrl: string, position: string): string {
  return `decentraland://open?preview=${lanUrl}&position=${encodeURIComponent(position)}`
}

// The hosted bevy web explorer, pointed at the local scene server. Loopback
// (not the LAN IP) on purpose: Chrome treats ws://127.0.0.1 as trustworthy, so
// the dev server's hot-reload websocket works from the https page; a LAN IP
// would be blocked as mixed content. `realm`/`position` stay raw, matching the
// URL sdk-commands' own --bevy-web opens.
export function webPreviewUrl(port: number, position: string): string {
  return `https://decentraland.org/bevy-web/?preview=true&realm=http://127.0.0.1:${port}&position=${position}`
}

// Deep link for the official (Unity) desktop client — the query string glued
// straight onto the scheme, no host/path, exactly as sdk-commands' default
// explorer-alpha launch builds it.
export function unityDeepLink(port: number, position: string): string {
  const params = new URLSearchParams({
    realm: `http://127.0.0.1:${port}`,
    position,
    dclenv: 'org',
    'local-scene': 'true'
  })
  return `decentraland://${params.toString()}`
}

export async function mobilePreview(
  port: number,
  position: string,
  ifaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces()
): Promise<MobilePreview> {
  const ip = lanIp(ifaces)
  if (ip === undefined) return { ok: false, reason: 'no-network' }
  const deepLink = previewDeepLink(`http://${ip}:${port}`, position)
  const qr = await QRCode.toDataURL(deepLink, { width: 480, margin: 2 })
  return { ok: true, deepLink, qr }
}
