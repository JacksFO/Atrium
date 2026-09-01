import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { knownMissing, rememberMissing, newlyMissing } from './uploads.js'

/**
 * Noticing that a file has gone, rather than counting how many have.
 *
 * The count has been the same number for days - what the old orphan sweep
 * took before it was stopped - and it is said once a day at warn, in a file
 * nobody reads. It was only ever seen because a restart happened to print it.
 *
 * So the question this answers is the different one: is anything missing
 * today that was here yesterday? Nothing removes an upload now except the
 * person who put it there, so the answer being yes means something is
 * deleting again, and that is worth interrupting somebody for.
 */

const scratch = () => mkdtempSync(join(tmpdir(), 'atrium-missing-'))

describe('what is newly gone', () => {
  it('is what the last check did not know about', () => {
    expect(newlyMissing(['a.png', 'b.png'], ['a.png', 'b.png', 'c.png'])).toEqual(['c.png'])
  })

  it('and nothing at all when the same files are still missing', () => {
    expect(newlyMissing(['a.png', 'b.png'], ['b.png', 'a.png'])).toEqual([])
  })

  /* A file put back is not news, and must not read as one. */
  it('and a file coming back is not a new loss', () => {
    expect(newlyMissing(['a.png', 'b.png'], ['a.png'])).toEqual([])
  })
})

describe('the record of what was already missing', () => {
  it('comes back as it went in', () => {
    const dir = scratch()
    rememberMissing(dir, ['b.png', 'a.png'])
    expect(knownMissing(dir)?.sort()).toEqual(['a.png', 'b.png'])
  })

  /*
   * Null, not empty, when nothing has ever been written.
   *
   * These are different and the difference is the whole design: an empty
   * list means "nothing was missing last time", so every file already gone
   * would read as a fresh loss and the first start on any machine would
   * raise an alarm about old news.
   */
  it('and says it knows nothing rather than saying nothing is missing', () => {
    expect(knownMissing(scratch())).toBeNull()
    const dir = scratch()
    rememberMissing(dir, [])
    expect(knownMissing(dir)).toEqual([])
  })

  /* Damage reads as no record: raising an alarm off a half-written file is
     worse than starting the baseline again. */
  it('and treats a damaged record as no record', () => {
    for (const junk of ['', '{', 'null', '{"a":1}', '"a.png"', '[1,2,3]']) {
      const dir = scratch()
      writeFileSync(join(dir, 'uploads-missing.json'), junk)
      const got = knownMissing(dir)
      expect(got === null || got.length === 0, `for ${JSON.stringify(junk)}`).toBe(true)
    }
  })

  /* An unwritable directory must not stop a server booting. */
  it('and never throws when it cannot be written', () => {
    expect(() => rememberMissing(join(scratch(), 'no', 'such', 'place'), ['a.png'])).not.toThrow()
  })

  it('and is readable by a person looking at the folder', () => {
    const dir = scratch()
    rememberMissing(dir, ['a.png'])
    expect(readFileSync(join(dir, 'uploads-missing.json'), 'utf8')).toContain('\n')
  })
})

/**
 * And the report uses them the right way round.
 *
 * The ordering is the part that can be quietly wrong: warn the count, decide
 * what is new against the stored list, and only then write the new list. Any
 * other order either alarms on everything or alarms on nothing, and both look
 * like a working feature from the outside.
 */
describe('the daily report', () => {
  const src = readFileSync(join(__dirname, 'index.ts'), 'utf8').split('\r\n').join('\n')
  const from = src.indexOf('function reportUploads()')
  const to = src.indexOf('\nreportUploads()', from)
  const fn = src.slice(from, to)

  it('is one function, bounded at both ends', () => {
    expect(from).toBeGreaterThan(-1)
    expect(to).toBeGreaterThan(from)
    expect(fn.length).toBeLessThan(3000)
  })

  it('reads what was known before deciding what is new', () => {
    expect(fn.indexOf('knownMissing(config.dataDir)')).toBeGreaterThan(-1)
    expect(fn.indexOf('knownMissing(config.dataDir)')).toBeLessThan(fn.indexOf('newlyMissing('))
  })

  /* Written after the comparison, never before, or the list to compare
     against is the list just measured and nothing is ever new. */
  it('and writes the new list only after comparing', () => {
    expect(fn.lastIndexOf('rememberMissing(')).toBeGreaterThan(fn.indexOf('newlyMissing('))
  })

  /* A count is info; a file that has just gone is not. */
  it('and says a new loss at error, above the daily count', () => {
    expect(fn).toMatch(/newlyMissing[\s\S]{0,400}app\.log\.error/)
  })
})
