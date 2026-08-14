import { describe, expect, it } from 'vitest'
import { RELAY_HOSTS } from '@dcl-editor/contract'
import { assertRelayHost } from './relay-host'

describe('pinning the CORS relay to its listed hosts', () => {
  it('passes every host the contract lists, and hands back the parsed URL', () => {
    for (const host of RELAY_HOSTS) {
      expect(assertRelayHost(`https://${host}/v2/metrics`).pathname).toBe('/v2/metrics')
    }
  })

  it('refuses http — relaying a signed request in clear would leak the auth chain', () => {
    expect(() => assertRelayHost('http://storage.decentraland.org/hi')).toThrow('host not allowed')
  })

  it('refuses a host that only ends with an allowed one — the suffix-match bug', () => {
    expect(() => assertRelayHost('https://storage.decentraland.org.attacker.net/hi')).toThrow('host not allowed')
  })

  it('refuses a host that merely contains decentraland.org', () => {
    expect(() => assertRelayHost('https://decentraland.org.evil.com/hi')).toThrow('host not allowed')
  })

  it('refuses the bare org domain — the allow-list is hosts, not the organisation', () => {
    expect(() => assertRelayHost('https://decentraland.org/hi')).toThrow('host not allowed')
  })

  it('refuses a subdomain of an allowed host', () => {
    expect(() => assertRelayHost('https://cdn.creators-data.decentraland.org/hi')).toThrow('host not allowed')
  })
})
