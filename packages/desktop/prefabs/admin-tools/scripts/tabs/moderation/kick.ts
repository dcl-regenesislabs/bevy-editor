// Kick: `moderationControl.kickCoordinates` is a scene-relative spot the creator
// authors in the inspector, and a scene can only move ITS OWN player. So a kick is a
// comms command — the targeted client is the one that calls movePlayerTo on itself.
//
// The listener is registered at module load (admin.tsx imports the tab statically),
// not when the tab mounts: the player being kicked is by definition not the admin
// looking at the panel, so nothing of the panel UI is mounted on their client.
//
// Trust: the receiver re-reads /scene-admin and checks the sender against it rather
// than the panel's cached list, which only admins ever populate. Sending goes
// through communicationsController.send() for the same reason as message-bus.ts —
// MessageBus.emit()'s internal flush queue drops follow-up messages.
import { engine } from '@dcl/sdk/ecs'
import { MessageBus } from '@dcl/sdk/message-bus'
import { getPlayer } from '@dcl/sdk/players'
import { send as commsSend } from '~system/CommunicationsController'
import { movePlayerTo } from '~system/RestrictedActions'
import { getSceneAdmins, isPreview, toSceneAdmins } from '../../api'
import { AdminTools } from '../../components'

const KICK = 'admin:kick'

interface KickTarget {
  address: string
  name: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readTarget(payload: unknown): KickTarget | null {
  if (!isRecord(payload)) return null
  const address = typeof payload.address === 'string' ? payload.address.toLowerCase() : ''
  const name = typeof payload.name === 'string' ? payload.name.toLowerCase() : ''
  if (address === '' && name === '') return null
  return { address, name }
}

function isLocalPlayer(target: KickTarget): boolean {
  const player = getPlayer()
  if (player === null) return false
  if (target.address !== '' && player.userId.toLowerCase() === target.address) return true
  return target.name !== '' && player.name.toLowerCase() === target.name
}

function kickCoordinates(): { x: number; y: number; z: number } | null {
  for (const [, config] of engine.getEntitiesWith(AdminTools)) {
    if (!config.moderationControl.isEnabled) return null
    const { x, y, z } = config.moderationControl.kickCoordinates
    return { x, y, z }
  }
  return null
}

async function senderIsAdmin(sender: string): Promise<boolean> {
  if (isPreview()) return true
  if (sender === 'self') return false
  const [error, response] = await getSceneAdmins()
  if (error !== null) return false
  return toSceneAdmins(response).some((admin) => admin.address === sender.toLowerCase())
}

async function handleKick(payload: unknown, sender: string): Promise<void> {
  const target = readTarget(payload)
  if (target === null || !isLocalPlayer(target)) return
  const position = kickCoordinates()
  if (position === null) return
  if (!(await senderIsAdmin(sender))) return
  try {
    await movePlayerTo({ newRelativePosition: position })
  } catch (error) {
    console.log('admin-tools: kick could not move the player', error)
  }
}

// Constructed on first listen, never at module load: MessageBus subscribes to
// the legacy comms event, which the Multiplayer Server does not implement — and
// this module loads on the server too, where the constructor would throw
// "not implemented" and take the rest of the scene's construction with it.
let receiver: MessageBus | null = null

/** Client only. Arms the kick listener; a second call is a no-op. */
export function listenForKicks(): void {
  if (receiver !== null) return
  receiver = new MessageBus()
  receiver.on(KICK, (payload: unknown, sender: string) => {
    void handleKick(payload, sender)
  })
}

export function kickUser(value: string, byAddress: boolean): void {
  const payload = byAddress ? { address: value } : { name: value }
  commsSend({ message: JSON.stringify({ message: KICK, payload }) }).catch(() => {})
}
