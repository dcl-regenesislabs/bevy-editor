import { describe, expect, it } from 'vitest'
import type os from 'node:os'
import { lanIp, mobilePreview, previewDeepLink } from './preview'

const iface = (address: string, over: Partial<os.NetworkInterfaceInfo> = {}): os.NetworkInterfaceInfo => ({
  address,
  netmask: '255.255.255.0',
  family: 'IPv4',
  mac: '00:00:00:00:00:00',
  internal: false,
  cidr: `${address}/24`,
  ...over
} as os.NetworkInterfaceInfo)

describe('lanIp', () => {
  it('picks the first non-internal IPv4', () => {
    expect(
      lanIp({
        lo0: [iface('127.0.0.1', { internal: true })],
        en0: [iface('fe80::1', { family: 'IPv6' }), iface('192.168.1.20')],
        en1: [iface('10.0.0.5')]
      })
    ).toBe('192.168.1.20')
  })

  it('is undefined when only loopback/IPv6 interfaces exist', () => {
    expect(
      lanIp({
        lo0: [iface('127.0.0.1', { internal: true })],
        en0: [iface('fe80::1', { family: 'IPv6' })]
      })
    ).toBeUndefined()
  })
})

describe('mobilePreview', () => {
  it('builds the sdk-commands deep link and a QR data URL', async () => {
    const p = await mobilePreview(8004, '1,2', { en0: [iface('192.168.1.20')] })
    expect(p).toMatchObject({
      ok: true,
      deepLink: 'decentraland://open?preview=http://192.168.1.20:8004&position=1%2C2'
    })
    expect(p.ok && p.qr.startsWith('data:image/png;base64,')).toBe(true)
  })

  it('reports no-network when no LAN address is found', async () => {
    expect(await mobilePreview(8004, '0,0', {})).toEqual({ ok: false, reason: 'no-network' })
  })
})

describe('previewDeepLink', () => {
  it('keeps the preview url raw and encodes only the position', () => {
    expect(previewDeepLink('http://10.0.0.5:8004', '-3,12')).toBe(
      'decentraland://open?preview=http://10.0.0.5:8004&position=-3%2C12'
    )
  })
})
