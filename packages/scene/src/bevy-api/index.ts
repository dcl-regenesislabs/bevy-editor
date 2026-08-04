import { type BevyApiInterface } from './interface'

let __BevyApiFound = false
let __BevyApi: BevyApiInterface | object = {}
try {
  // the scene sandbox injects a CommonJS-style require for ~system modules
  const sandboxRequire = (globalThis as unknown as { require: (module: string) => BevyApiInterface }).require
  __BevyApi = sandboxRequire('~system/BevyExplorerApi')
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
        return (...args: unknown[]) => {
          console.log('BevyApi method not found', prop, args)
        }
      }
    } else {
      return (...args: unknown[]) => {
        console.log('BevyApi not found', prop, args)
      }
    }
  }
}) as BevyApiInterface
