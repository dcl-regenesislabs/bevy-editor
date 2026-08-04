'use strict'
// Minimal event-emitter registry — the one asset-packs API the SDK's script
// runtime uses (script params of type "action" emit into these). With no
// smart-items runtime subscribed, emits are harmless no-ops.
Object.defineProperty(exports, '__esModule', { value: true })

function mitt() {
  const all = new Map()
  return {
    all,
    on(type, handler) {
      const handlers = all.get(type)
      if (handlers) handlers.push(handler)
      else all.set(type, [handler])
    },
    off(type, handler) {
      const handlers = all.get(type)
      if (handlers) {
        if (handler) {
          const i = handlers.indexOf(handler)
          if (i > -1) handlers.splice(i, 1)
        } else {
          all.set(type, [])
        }
      }
    },
    emit(type, evt) {
      for (const h of [...(all.get(type) ?? [])]) h(evt)
      for (const h of [...(all.get('*') ?? [])]) h(type, evt)
    }
  }
}

const actionEvents = new Map()
const triggerEvents = new Map()

function fromRegistry(registry) {
  return (entity) => {
    if (!registry.has(entity)) registry.set(entity, mitt())
    return registry.get(entity)
  }
}

exports.getActionEvents = fromRegistry(actionEvents)
exports.getTriggerEvents = fromRegistry(triggerEvents)
