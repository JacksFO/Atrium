import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * "This build" is the last group, whatever else is in the list.
 *
 * It is about the copy of Atrium you are running rather than about you or
 * about anywhere you are, so it belongs at the end. Merging a server's
 * settings in appended them after it, which put a server's panes below the
 * version number and read as something stuck on the bottom.
 */
/* Normalised, so a CRLF working copy does not silently change what a slice
   between two markers contains. */
const read = (name: string) =>
  readFileSync(join(__dirname, name), 'utf8').split('\r\n').join('\n')

const src = read('SettingsWindow.tsx')

describe('the order of the groups', () => {
  it('keeps the build last when a server is added', () => {
    /* The server is spliced in before the final group rather than pushed
       onto the end - which is the whole of the fix. */
    expect(src).toContain('const build = GROUPS[GROUPS.length - 1]!')
    expect(src).toContain('const rest = GROUPS.slice(0, -1)')
    const at = src.indexOf('const rest = GROUPS.slice(0, -1)')
    const after = src.slice(at, at + 400)
    /* The server's own group is between them. */
    expect(after.indexOf('space.name')).toBeLessThan(after.indexOf('build,'))
  })

  it('and that group really is the build one', () => {
    const list = read('Settings.tsx')
    const from = list.indexOf('export const GROUPS')
    const groups = list.slice(from, list.indexOf('\n]\n', from))
    const names = [...groups.matchAll(/\['([^']+)', \[/g)].map((m) => m[1])
    expect(names[names.length - 1]).toBe('This build')
  })
})
