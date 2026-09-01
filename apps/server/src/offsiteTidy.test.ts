import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The copy-on-arrival mode cleans up after itself.
 *
 * It encrypts the upload into a staging file before sending it, and the first
 * version put the removal in a `finally` beside a `process.exit()`. exit ends
 * the process there and then - the finally never runs - so every successful
 * copy left a full-size encrypted duplicate of somebody's upload in the
 * backups folder, for ever, on a home PC with a 100MB upload limit.
 *
 * Found by looking in the folder rather than by reading the code: two were
 * sitting there from the tests that proved the feature worked. The nightly
 * run's own staging cleanup carries a comment about exactly this failure,
 * two hundred lines below where it was reintroduced.
 */

const src = readFileSync(join(__dirname, '..', '..', '..', 'scripts', 'backup.mjs'), 'utf8')
  .split('\r\n').join('\n')

const mode = (() => {
  const from = src.indexOf("const one = process.argv.indexOf('--upload')")
  const to = src.indexOf('\nmkdirSync(OUT', from)
  return { from, to, body: src.slice(from, to) }
})()

describe('copying one upload as it arrives', () => {
  it('is one block, bounded at both ends', () => {
    expect(mode.from).toBeGreaterThan(-1)
    expect(mode.to).toBeGreaterThan(mode.from)
    expect(mode.body.length).toBeLessThan(4000)
  })

  it('stages an encrypted copy beside the backups', () => {
    expect(mode.body).toContain('.one-${process.pid}-${name}.enc')
  })

  /*
   * The assertion that matters: no finally, because there is an exit in every
   * arm and a finally after one of those is dead code that reads as cleanup.
   */
  it('and does not rely on a finally it will never reach', () => {
    expect(mode.body).not.toContain('} finally {')
  })

  it('and removes the staged copy on the way out of both arms', () => {
    const tidies = [...mode.body.matchAll(/\btidy\(\)/g)]
    /* One call per arm - the one that sent it, and the one that could not. */
    expect(tidies.length).toBe(2)

    /*
     * Measured from the send, not from the first exit in the block.
     *
     * The first draft of this took the first process.exit(0) and failed,
     * because the guards above it - offsite not configured, the file not on
     * disk - leave before anything has been staged and correctly tidy
     * nothing. The staged file exists only after the encrypt, so the window
     * that matters is between sending it and leaving.
     */
    const sent = mode.body.indexOf('const sent = await r2Put')
    expect(sent).toBeGreaterThan(-1)
    const leaves = mode.body.indexOf('process.exit(0)', sent)
    expect(leaves).toBeGreaterThan(sent)
    expect(mode.body.slice(sent, leaves)).toContain('tidy()')

    /* And on the way out of a failure, which is the arm most likely to have
       a half-written file to get rid of. */
    const failed = mode.body.indexOf('process.exit(1)')
    expect(mode.body.lastIndexOf('tidy()', failed)).toBeGreaterThan(leaves)
  })

  /* And it only ever removes something it made. The source file is the
     person's actual upload and must not be touched by a backup. */
  it('and never removes the upload itself', () => {
    expect(mode.body).toContain('if (sending !== source) rmSync(sending, { force: true })')
  })
})

/**
 * And the name it is handed is checked before it becomes a path or a key.
 *
 * It arrives as a command-line argument from the server, which validates it
 * too. Two cheap checks in two processes, because the cost of both is nothing
 * and the cost of being wrong once is a write outside the uploads folder.
 */
describe('the name it is given', () => {
  it('must look like one this server generated', () => {
    expect(mode.body).toMatch(/\^\[A-Za-z0-9\]\[A-Za-z0-9\._-\]\{0,127\}\$/)
    expect(mode.body).toContain("name.includes('..')")
  })

  it('and must be on disk before anything is sent', () => {
    expect(mode.body.indexOf('existsSync(source)'))
      .toBeLessThan(mode.body.indexOf('r2Put('))
  })
})
