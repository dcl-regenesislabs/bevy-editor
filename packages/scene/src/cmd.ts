// Scene-side typed console commands, bound to the engine via BevyApi. Import
// `cmd` and call typed methods (cmd.pointerTarget(), cmd.highlight(ids), …)
// instead of raw BevyApi.consoleCommand('…').
import { BevyApi } from './bevy-api'
import { makeCommands } from './commands'

export const cmd = makeCommands((c, args) => BevyApi.consoleCommand(c, args))
