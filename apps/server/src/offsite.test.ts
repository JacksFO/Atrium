import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  copyOffsite, enableOffsite, offsiteQueueLength, offsiteLogTo, forgetOffsiteQueue,
  type Run,
} from './offsite.js'

/**
 * The second copy, made when the file lands rather than at three in the
 * morning.
 *
 * What is worth testing is not that a child process starts. It is the three
 * properties that decide whether this is safe to have in the upload path at
 * all: it does nothing unless a server turned it on, it never puts anything
 * but a name we generated on a command line, and a burst of uploads does not
 * become a burst of processes in the app serving the chat.
 */

afterEach(() => { enableOffsite(false); offsiteLogTo(() => {}); forgetOffsiteQueue() })

/** A stand-in for the real spawn, holding each call open until released. */
function watcher() {
  const started: string[] = []
  const finish: Array<(ok: boolean) => void> = []
  const run: Run = (name, done) => { started.push(name); finish.push(done) }
  return { started, finish, run }
}

describe('copying a file offsite', () => {
  /*
   * Off unless a server says otherwise.
   *
   * Every test file in this project imports db.ts, which calls this on every
   * remembered upload. If the default were on, running the suite would fire
   * real copies at the real bucket - so the default is the assertion.
   */
  it('does nothing until a server turns it on', () => {
    const w = watcher()
    copyOffsite('a1b2c3d4.png', w.run)
    expect(w.started).toEqual([])
  })

  it('and copies once it has been', () => {
    enableOffsite(true)
    const w = watcher()
    copyOffsite('a1b2c3d4.png', w.run)
    expect(w.started).toEqual(['a1b2c3d4.png'])
    w.finish[0]!(true)
  })

  /*
   * The name reaches a command line and an object key. It is always one this
   * server generated, and it is checked anyway - the script checks it too,
   * because the cost of both is nothing and the cost of being wrong once is
   * a path outside the uploads folder.
   */
  it('and refuses anything that is not a name we generated', () => {
    enableOffsite(true)
    const w = watcher()
    for (const bad of [
      '../../data/atrium.db', '..\\atrium.db', '', '-rf', '/etc/passwd',
      'a'.repeat(200), 'name with spaces.png', 'x;rm -rf y.png',
    ]) {
      copyOffsite(bad, w.run)
    }
    expect(w.started).toEqual([])
  })

  /*
   * Twenty pictures dragged in at once must not become twenty node processes
   * on a machine that is also running the chat and the voice server.
   */
  it('and runs one at a time however many arrive', () => {
    enableOffsite(true)
    const w = watcher()
    for (let i = 0; i < 20; i += 1) copyOffsite(`file-${i}.png`, w.run)

    expect(w.started).toEqual(['file-0.png'])
    expect(offsiteQueueLength()).toBe(20)

    w.finish[0]!(true)
    expect(w.started).toEqual(['file-0.png', 'file-1.png'])

    /* And it keeps going after one fails, or a single bad file would stop
       every copy after it for as long as the server stays up. */
    w.finish[1]!(false)
    expect(w.started[2]).toBe('file-2.png')

    for (let i = 2; i < 20; i += 1) w.finish[i]!(true)
    expect(offsiteQueueLength()).toBe(0)
  })

  /* The same file can be sent twice - an imported GIF is stored under a name
     taken from its own contents - and one copy of it is enough. */
  it('and does not queue the same file twice', () => {
    enableOffsite(true)
    const w = watcher()
    copyOffsite('same.gif', w.run)
    copyOffsite('same.gif', w.run)
    expect(w.started).toEqual(['same.gif'])
    expect(offsiteQueueLength()).toBe(1)
    w.finish[0]!(true)
  })

  /* Callers are half way through answering somebody's upload. */
  it('and never throws at whoever called it', () => {
    enableOffsite(true)
    const angry: Run = () => { throw new Error('no') }
    expect(() => copyOffsite('boom.png', angry)).not.toThrow()
    /* And the queue is not left jammed against every later upload. */
    const w = watcher()
    copyOffsite('after.png', w.run)
    expect(w.started).toEqual(['after.png'])
    w.finish[0]!(true)
  })
})

/**
 * And something actually calls it.
 *
 * This is the failure that would leave no trace: the module works, its tests
 * pass, and no upload is ever copied because nothing reached it. There is
 * one choke point - every stored file is written down by rememberUpload -
 * and the point of putting the call there is that the next upload route
 * cannot forget it.
 */
describe('the wiring', () => {
  const db = readFileSync(join(__dirname, 'db.ts'), 'utf8')
  const from = db.indexOf('export function rememberUpload')
  const to = db.indexOf('\nexport function', from + 10)
  const fn = db.slice(from, to)

  it('is one function, bounded at both ends', () => {
    expect(from).toBeGreaterThan(-1)
    expect(to).toBeGreaterThan(from)
    expect(fn.length).toBeLessThan(2000)
  })

  it('and every file this server stores is copied offsite', () => {
    expect(fn).toContain('copyOffsite(name)')
  })

  /* After the row, not before: a copy of a file the database does not know
     about is a file nothing can ever put back in the right place. */
  it('and only after it has been written down', () => {
    expect(fn.indexOf('INSERT OR IGNORE INTO uploads'))
      .toBeLessThan(fn.indexOf('copyOffsite(name)'))
  })
})
