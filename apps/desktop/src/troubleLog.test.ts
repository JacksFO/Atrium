import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { noteTrouble, TROUBLE_LOG } from './troubleLog.js'

/**
 * The file that has to exist the next time the app freezes.
 *
 * Against a real directory rather than a stubbed one, because every way this
 * can fail is about the filesystem: appending rather than replacing, growing
 * without limit, or throwing at the worst possible moment - which for a thing
 * that only runs while something is already going wrong would mean it turned
 * a bad moment into a worse one.
 */

const dirs: string[] = []
const fresh = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'atrium-trouble-'))
  dirs.push(d)
  return d
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

const read = (dir: string): string => readFileSync(join(dir, TROUBLE_LOG), 'utf8')

describe('writing down what went wrong', () => {
  it('makes the file and puts the event in it', () => {
    const dir = fresh()
    noteTrouble(dir, 'unresponsive', 'not answering for 12 seconds')
    const text = read(dir)
    expect(text).toContain('unresponsive')
    expect(text).toContain('12 seconds')
  })

  /* Appended, not replaced. A log that keeps only the last thing that went
     wrong cannot show that it has happened four times this week, which is the
     question somebody actually has. */
  it('and keeps what was already there', () => {
    const dir = fresh()
    noteTrouble(dir, 'unresponsive', 'the first time')
    noteTrouble(dir, 'render-process-gone', 'the second time')
    const text = read(dir)
    expect(text).toContain('the first time')
    expect(text).toContain('the second time')
    expect(text.trim().split('\n')).toHaveLength(2)
  })

  it('and one event stays on one line', () => {
    const dir = fresh()
    noteTrouble(dir, 'gone', 'crashed\nsomewhere\r\nelse')
    expect(read(dir).trim().split('\n')).toHaveLength(1)
  })
})

describe('and not growing without limit', () => {
  /*
   * An app that hangs repeatedly writes repeatedly, and a log nobody ever
   * clears is a file that grows for the life of the install. The oldest
   * entries are the ones worth losing.
   */
  it('drops the oldest once the file is large', () => {
    const dir = fresh()
    const file = join(dir, TROUBLE_LOG)
    writeFileSync(file, 'THE-OLDEST-LINE\n' + 'x'.repeat(200_000) + '\n', 'utf8')
    noteTrouble(dir, 'unresponsive', 'the newest')

    const text = read(dir)
    expect(text.length).toBeLessThan(100_000)
    expect(text, 'the newest entry is what it is for').toContain('the newest')
    expect(text, 'it kept the oldest and dropped the useful end').not.toContain('THE-OLDEST-LINE')
  })
})

describe('and never becoming the problem', () => {
  /*
   * A read-only folder, a full disk, a path that is not there. This runs only
   * while something is already going wrong, so it must not be able to add to
   * it - and the one way to be sure of that is to point it somewhere
   * impossible and check it comes back quietly.
   */
  it('says nothing when it cannot write at all', () => {
    const nowhere = join(fresh(), 'no', 'such', 'place')
    expect(() => noteTrouble(nowhere, 'unresponsive', 'anything')).not.toThrow()
  })
})
