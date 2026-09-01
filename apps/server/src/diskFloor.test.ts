import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Uploads stop before the disk does.
 *
 * Everything on this machine shares one disk: the database, its write-ahead
 * log, the uploads, the nightly backups and Windows itself. The health page
 * has read the free space since it was written and nothing ever acted on it,
 * so uploads were accepted until a write failed - and the write that fails
 * need not be the upload. SQLite writing a message is just as likely to be
 * the thing that runs out of room, and losing messages to make space for a
 * picture is the wrong way round.
 *
 * The second half is the error. Everything that was not a format complaint
 * came back as "that file is larger than we allow", so a full disk told
 * somebody their file was too big - sending them to shrink a file that was
 * never the problem, on a server where no file of any size would have
 * worked. An error that lies is worse than one that says nothing.
 */

const src = readFileSync(join(__dirname, 'index.ts'), 'utf8').split('\r\n').join('\n')

const fn = (() => {
  const from = src.indexOf('async function streamToDisk')
  const to = src.indexOf('\napp.', from)
  return { from, to, body: src.slice(from, to) }
})()

describe('streaming an upload to disk', () => {
  it('is one function, bounded at both ends', () => {
    expect(fn.from).toBeGreaterThan(-1)
    expect(fn.to).toBeGreaterThan(fn.from)
    expect(fn.body.length).toBeLessThan(6000)
  })

  it('asks how much room is left', () => {
    expect(fn.body).toContain('statfs(config.uploadDir)')
    expect(fn.body).toContain('FREE_SPACE_FLOOR')
  })

  /*
   * Before the write, not after it. Checking afterwards is the same as not
   * checking: the bytes are already on the disk being protected.
   */
  it('and does so before anything is written', () => {
    expect(fn.body.indexOf('FREE_SPACE_FLOOR'))
      .toBeLessThan(fn.body.indexOf('createWriteStream(target)'))
  })

  /* Comfortably larger than any single upload, because it is a floor for the
     database and the backups rather than headroom for one more file. */
  it('and keeps back far more than one upload could take', () => {
    const floor = /const FREE_SPACE_FLOOR = ([^\n]+)/.exec(src)
    expect(floor, 'the floor is a named constant').toBeTruthy()
    /* Multiplied out by hand rather than evaluated: a test that runs a
       string out of the source it is checking is a test that can be made to
       pass by the thing it is checking. */
    const bytes = floor![1]!.split('*').map((n) => Number(n.trim()))
      .reduce((a, b) => a * b, 1)
    expect(bytes).toBeGreaterThanOrEqual(1024 * 1024 * 1024)
    /* Twenty-five megabytes is the upload ceiling; this is many times it. */
    expect(bytes).toBeGreaterThan(26_214_400 * 10)
  })

  /*
   * And a filesystem that will not answer is not a refusal. statfs fails on
   * some mounts, and an upload path that treats "I do not know" as "no room"
   * would break uploading on those for a reason nobody could see.
   */
  it('but does not refuse when the filesystem will not say', () => {
    const guard = fn.body.slice(fn.body.indexOf('const room = await statfs'))
    /* By identity, not by prefix: the message is control flow as well as a
       sentence, and matching a fragment of it is what let a reword break
       the check silently. */
    expect(guard).toContain('err.message === NO_ROOM')
  })
})

describe('when the disk does run out mid-write', () => {
  it('says so instead of blaming the file', () => {
    expect(fn.body).toContain("code === 'ENOSPC'")
    expect(fn.body).toContain('throw new Error(NO_ROOM)')
  })

  /* The rewrite that produced the lie must not catch the honest message on
     its way back out. */
  it('and the honest message survives the rewrite below it', () => {
    expect(fn.body, 'the catch-all is still there').toMatch(/\.test\(err\.message\)/)
    /* The refusal is let through by identity rather than by a fragment of
       its own words, which is what broke when it was reworded. */
    expect(fn.body).toContain('err.message === NO_ROOM || ')
  })

  /* And the two real complaints still read as themselves. */
  it('while a too-large file and a fake one still say what they are', () => {
    expect(fn.body).toContain('that file is larger than we allow')
    expect(fn.body).toContain('too short to be what it says it is')
  })
})
