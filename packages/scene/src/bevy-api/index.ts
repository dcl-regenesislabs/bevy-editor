import { type BevyApiInterface } from './interface'

// eslint-disable-next-line @typescript-eslint/naming-convention
let __BevyApiFound = false
// eslint-disable-next-line @typescript-eslint/naming-convention, @typescript-eslint/ban-types
let __BevyApi: BevyApiInterface | {} = {}
try {
  __BevyApi = (globalThis as any).require('~system/BevyExplorerApi')
  __BevyApiFound = true
} catch (e) {
  __BevyApi = {}
  console.error('BevyExplorerApi not found')
}

export const BevyApi = new Proxy(__BevyApi, {
  get(target, prop) {
    if (__BevyApiFound) {
      if (prop in target) {
        return target[prop as keyof typeof target]
      } else {
        return (...args: any[]) => {
          console.log('BevyApi method not found', prop, args)
        }
      }
    } else {
      return (...args: any[]) => {
        console.log('BevyApi not found', prop, args)
      }
    }
  }
}) as BevyApiInterface
