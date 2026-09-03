import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { logLine, trimmed } from './hang.js'

/**
 * A small file of what went wrong, so the next freeze can be read about.
 *
 * The whole reason this exists: the app froze, and afterwards there was
 * nothing at all to look at - no log, no crash file, no record. The only
 * honest thing that could be said was that it had happened.
 *
 * Its own file so it can be tested with a real directory. The decisions
 * inside it are the ones that make a log worth having when somebody finally
 * reads it: that it appends rather than replaces, that it cannot grow without
 * limit, and that it never throws - a thing that exists to explain a bad
 * moment must not be able to cause one.
 */

/** What the file is called, wherever it is put. */
export const TROUBLE_LOG = 'atrium-trouble.log'

/**
 * Write one line, keeping the file to a readable size.
 *
 * Read-then-write rather than an append, because the trimming has to see the
 * whole file - and this happens a handful of times in the life of an install,
 * so the cost of reading it is nothing anybody could measure.
 */
export function noteTrouble(
  dir: string, what: string, detail = '', now = Date.now(),
): void {
  try {
    const file = join(dir, TROUBLE_LOG)
    const had = existsSync(file) ? readFileSync(file, 'utf8') : ''
    writeFileSync(file, trimmed(had + logLine(what, detail, now) + '\n'), 'utf8')
  } catch {
    /*
     * Never fatal, and deliberately silent.
     *
     * A read-only folder, a full disk, a file somebody has open in an editor.
     * None of those are worth a crash, and none of them are worth a second
     * message on top of the one being logged.
     */
  }
}
