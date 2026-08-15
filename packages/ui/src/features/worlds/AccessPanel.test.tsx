import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as InventoryModule from './inventory'
import { scopeKey, type WorldPermission, type WorldPermissions, type WorldScene } from './inventory'
import { mount } from '../../test/render'

// Only the two network calls are replaced. narrowedScope stays real, so these
// tests exercise the same "is this grant narrowed" rule the escalation guard is
// built on rather than a copy of it.
const perms = vi.fn()

vi.mock('./inventory', async (importOriginal) => {
  const actual = await importOriginal<typeof InventoryModule>()
  return {
    ...actual,
    fetchWorldPermissions: () => perms(),
    setWorldPermission: () => Promise.resolve()
  }
})
vi.mock('./signed-fetch', () => ({ signedFetch: () => Promise.reject(new Error('no network in a render test')) }))
vi.mock('../account/auth', () => ({ getAccount: () => '0xowner' }))

import { AccessPanel } from './AccessPanel'

const WALLET = '0x1111111111111111111111111111111111111111'

const gate = (over: Partial<WorldPermission> = {}): WorldPermission => ({
  type: 'unrestricted',
  raw: 'unrestricted',
  wallets: [],
  communities: [],
  ...over
})

const list = (over: Partial<WorldPermission> = {}): WorldPermission =>
  gate({ type: 'allow-list', raw: 'allow-list', ...over })

const permissions = (over: Partial<WorldPermissions> = {}): WorldPermissions => ({
  owner: '0xowner',
  deployment: gate(),
  access: gate(),
  streaming: gate(),
  scopes: new Map(),
  ...over
})

const scene = (x: number, y: number, over: Partial<WorldScene> = {}): WorldScene => ({
  x,
  y,
  parcels: [`${x},${y}`],
  title: null,
  deployer: null,
  timestamp: null,
  thumbnail: null,
  entityId: null,
  size: null,
  status: 'DEPLOYED',
  authoritativeMultiplayer: false,
  ...over
})

beforeEach(() => {
  perms.mockReset()
})

describe('AccessPanel gates', () => {
  it('names the gate a world is actually behind, and edits only the one it can', async () => {
    perms.mockResolvedValue(
      permissions({ access: gate({ type: 'nft-ownership', raw: 'nft-ownership' }), deployment: list() })
    )
    const view = mount(<AccessPanel world="boedo.dcl.eth" wallet="0xOWNER" />)
    await view.settle()

    expect(view.byText('NFT holders')).not.toBeNull()
    expect(view.text()).toContain(
      'Only wallets holding a particular NFT can enter this world. That rule is set outside Decentraland Studio.'
    )
    // the add-wallet row belongs to the allow-list only — an NFT gate has no list to add to
    expect(view.all('.eui-perm-add')).toHaveLength(1)
    view.unmount()
  })

  it('says a password world needs a password instead of printing the server word', async () => {
    perms.mockResolvedValue(permissions({ access: gate({ type: 'shared-secret', raw: 'shared-secret' }) }))
    const view = mount(<AccessPanel world="boedo.dcl.eth" wallet="0xOWNER" />)
    await view.settle()

    expect(view.byText('Password')).not.toBeNull()
    expect(view.byText('shared-secret')).toBeNull()
    expect(view.text()).toContain('Only people who know the password can enter this world.')
    view.unmount()
  })

  it('names a gate it does not recognise rather than calling it open', async () => {
    perms.mockResolvedValue(permissions({ access: gate({ type: 'unknown', raw: 'moon-phase' }) }))
    const view = mount(<AccessPanel world="boedo.dcl.eth" wallet="0xOWNER" />)
    await view.settle()

    expect(view.byText('moon-phase')).not.toBeNull()
    expect(view.text()).toContain("a rule Decentraland Studio doesn't recognise")
    expect(view.text()).not.toContain('Anyone can enter this world.')
    view.unmount()
  })

  it('keeps an empty allow-list reading exactly as it did', async () => {
    perms.mockResolvedValue(permissions({ access: list(), deployment: list() }))
    const view = mount(<AccessPanel world="boedo.dcl.eth" wallet="0xOWNER" />)
    await view.settle()

    // an empty visit list locks the world; an empty publish list still lets the owner publish
    expect(view.byText('Allow list (0)')).not.toBeNull()
    expect(view.byText('Only the owner')).not.toBeNull()
    view.unmount()
  })

  it('surfaces the communities an allow-list admits, so the wallets are not read as the whole list', async () => {
    perms.mockResolvedValue(permissions({ access: list({ communities: ['c-1', 'c-2'] }) }))
    const view = mount(<AccessPanel world="boedo.dcl.eth" wallet="0xOWNER" />)
    await view.settle()

    expect(view.text()).toContain('Members of 2 communities can also enter this world.')
    expect(view.byText('c-1')).not.toBeNull()
    expect(view.byText('c-2')).not.toBeNull()
    view.unmount()
  })
})

describe('AccessPanel narrowed grants', () => {
  it('opens a read-only map of the parcels a narrowed grant covers', async () => {
    perms.mockResolvedValue(
      permissions({
        deployment: list({ wallets: [WALLET] }),
        scopes: new Map([[scopeKey('deployment', WALLET), { worldWide: false, parcelCount: 2, parcels: ['1,2', '1,3'] }]])
      })
    )
    const view = mount(<AccessPanel world="boedo.dcl.eth" wallet="0xOWNER" scenes={[scene(0, 0)]} />)
    await view.settle()

    view.click(view.byText('2 parcels', 'button'))
    expect(view.find('.eui-modal')).not.toBeNull()
    expect(view.text()).toContain('0x1111…1111 can publish on the 2 lit parcels and nowhere else in boedo.dcl.eth.')

    const labels = view.all('.eui-ds-map-cell').map((c) => c.getAttribute('aria-label'))
    expect(labels).toContain('Granted to 0x1111…1111 · 1,2')
    expect(labels).toContain('Granted to 0x1111…1111 · 1,3')
    // the world's own ground is drawn under the grant, never as part of it — and
    // this is a world-level tab, so the ground is named for the world, not for a
    // scene standing on it
    expect(labels).toContain('boedo.dcl.eth · 0,0')
    view.unmount()
  })

  it('leaves the chip inert when the server said how wide the grant is but not where', async () => {
    perms.mockResolvedValue(
      permissions({
        deployment: list({ wallets: [WALLET] }),
        scopes: new Map([[scopeKey('deployment', WALLET), { worldWide: false, parcelCount: 3, parcels: [] }]])
      })
    )
    const view = mount(<AccessPanel world="boedo.dcl.eth" wallet="0xOWNER" scenes={[scene(0, 0)]} />)
    await view.settle()

    expect(view.byText('3 parcels')).not.toBeNull()
    expect(view.byText('3 parcels', 'button')).toBeNull()
    view.unmount()
  })

  // A narrowing belongs to ONE grant: the same wallet may publish on two parcels
  // and stream across the whole world. Keyed by address alone the last kind read
  // wins and its scope is then stated of all three rows — the publish row loses
  // its narrowing (and its re-grant guard), or the visit row grows a parcel map
  // for a rule the platform does not have.
  it('keeps a narrowing on the grant it belongs to', async () => {
    perms.mockResolvedValue(
      permissions({
        deployment: list({ wallets: [WALLET] }),
        access: list({ wallets: [WALLET] }),
        scopes: new Map([[scopeKey('deployment', WALLET), { worldWide: false, parcelCount: 2, parcels: ['1,2', '1,3'] }]])
      })
    )
    const view = mount(<AccessPanel world="boedo.dcl.eth" wallet="0xOWNER" scenes={[scene(0, 0)]} />)
    await view.settle()

    const rows = view.all('.eui-perm')
    expect(rows[0].textContent).toContain('2 parcels')
    expect(rows[1].textContent).not.toContain('parcels')
    expect(rows[1].textContent).toContain('Remove')
    view.unmount()
  })

  it('still refuses to re-grant a narrowed wallet from here', async () => {
    perms.mockResolvedValue(
      permissions({
        deployment: list({ wallets: [WALLET] }),
        scopes: new Map([[scopeKey('deployment', WALLET), { worldWide: false, parcelCount: 2, parcels: ['1,2', '1,3'] }]])
      })
    )
    const view = mount(<AccessPanel world="boedo.dcl.eth" wallet="0xOWNER" />)
    await view.settle()

    view.type(view.find('.eui-perm-add .eui-input'), WALLET)
    expect(view.text()).toContain('Adding it would widen that to the whole world')
    expect(view.byText('Add', 'button')?.hasAttribute('disabled')).toBe(true)
    view.unmount()
  })
})
