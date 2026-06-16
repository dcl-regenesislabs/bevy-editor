// Host-UI-side typed console commands, bound to the engine console transport.
// Same typed surface as the scene's cmd, different transport. Import `cmd` and
// call typed methods instead of raw consoleCommand('…').
import { makeCommands } from '../../scene/src/commands'
import { consoleCommand } from './console'

export const cmd = makeCommands(consoleCommand)
