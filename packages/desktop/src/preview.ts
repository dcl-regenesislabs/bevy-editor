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
