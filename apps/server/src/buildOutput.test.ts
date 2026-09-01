import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * What gets built and run, as against what gets typechecked.
 *
 * The launcher compiles the whole of src and runs dist/index.js, and src
 * includes the tests - so the directory the live server runs out of held
 * forty-two compiled test files, along with the vitest imports inside them.
 * Nothing imported them, so nothing ran; the cost was that a deleted test
 * left its compiled copy behind for ever, which is how a file naming a
 * function that no longer existed was still sitting in dist afterwards.
 *
 * Two configurations: everything is typechecked, only the app is emitted.
 */

const here = join(__dirname, '..')

describe('the build', () => {
  it('has a configuration of its own', () => {
    const build = readFileSync(join(here, 'tsconfig.build.json'), 'utf8')
    expect(build).toContain('"extends": "./tsconfig.json"')
    expect(build).toContain('**/*.test.ts')
  })

  it('and the launcher uses it', () => {
    /* The one that actually runs on this machine - a config nothing builds
       with is a config that drifts. */
    const cmd = readFileSync(join(here, '..', '..', 'scripts', 'run-server.cmd'), 'utf8')
    expect(cmd).toContain('-p tsconfig.build.json')
    expect(cmd, 'still building everything').not.toMatch(/tsc\.js" -p tsconfig\.json/)
  })

  it('and so does the package script', () => {
    const pkg = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8')) as
      { scripts?: Record<string, string> }
    expect(pkg.scripts?.build).toContain('tsconfig.build.json')
  })
})

describe('the typecheck', () => {
  it('still takes the tests, because a type error in one is worth knowing about', () => {
    const pkg = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8')) as
      { scripts?: Record<string, string> }
    expect(pkg.scripts?.typecheck).toContain('tsconfig.json')
    expect(pkg.scripts?.typecheck, 'typechecking only the app')
      .not.toContain('tsconfig.build.json')
  })
})
