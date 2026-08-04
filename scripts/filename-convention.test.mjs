// The naming rule's decision, tested on BOTH path styles.
//
// It shipped splitting only on '/', which is fine on the macOS runner and wrong
// on the Windows one: eslint passes a native path, so `D:\a\repo\src\attach.ts`
// never split, the whole path became the "basename", the leading drive letter
// read as PascalCase, and the rule reported all 250 source files. Only CI caught
// it — hence a test that names the platform difference explicitly.
import { describe, it, expect } from 'vitest'
import { baseNameOf, filenameProblem } from '../eslint-local/index.mjs'

const WIN = 'D:\\a\\bevy-editor\\bevy-editor\\packages\\ui\\src'
const NIX = '/home/runner/bevy-editor/packages/ui/src'

describe('baseNameOf', () => {
  it('takes the last segment of a windows path', () => {
    expect(baseNameOf(`${WIN}\\script\\attach.ts`)).toBe('attach.ts')
  })
  it('takes the last segment of a posix path', () => {
    expect(baseNameOf(`${NIX}/script/attach.ts`)).toBe('attach.ts')
  })
})

describe('filenameProblem', () => {
  for (const [style, join] of [
    ['windows', (rest) => `${WIN}\\${rest.replace(/\//g, '\\')}`],
    ['posix', (rest) => `${NIX}/${rest}`]
  ]) {
    describe(style, () => {
      it('accepts a kebab-case logic module', () => {
        expect(filenameProblem(join('script/attach.ts'), new Set(['attachScript']))).toBeNull()
      })

      it('accepts a PascalCase file exporting its namesake', () => {
        expect(filenameProblem(join('features/ai/Composer.tsx'), new Set(['Composer']))).toBeNull()
      })

      it('rejects a PascalCase file that does not export its namesake', () => {
        expect(filenameProblem(join('panels/Bogus.tsx'), new Set(['SomethingElse']))?.kind).toBe(
          'pascal-without-namesake'
        )
      })

      it('rejects snake_case and camelCase', () => {
        expect(filenameProblem(join('panels/bogus_snake.ts'), new Set())?.kind).toBe('not-kebab')
        expect(filenameProblem(join('panels/bogusCamel.ts'), new Set())?.kind).toBe('not-kebab')
      })

      it('ignores declaration files and tests, whatever they are called', () => {
        expect(filenameProblem(join('vite-env.d.ts'), new Set())).toBeNull()
        expect(filenameProblem(join('ds/ds-contract.test.ts'), new Set())).toBeNull()
        expect(filenameProblem(join('panels/Thing.test.tsx'), new Set())).toBeNull()
      })
    })
  }

  // the regression itself: a drive letter must never read as a component name
  it('does not treat a windows drive letter as PascalCase', () => {
    expect(filenameProblem(`${WIN}\\script\\parser.ts`, new Set())).toBeNull()
  })
})
