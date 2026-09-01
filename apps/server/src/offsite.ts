import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * A second copy of a file, made when the file arrives.
 *
 * The nightly backup copies whatever is on disk at three in the morning, so
 * anything uploaded after it has no second copy until the next one - up to a
 * day with exactly one copy of somebody's picture, on a home PC.
 *
 * That gap has already been paid for. The old orphan sweep deleted eight
 * files it should not have; seven of them were uploaded and gone again inside
 * the same day, so no nightly run ever saw them and they cannot be brought
 * back. The one that had survived a night was recovered from the bucket in
 * about a minute. The difference between those two outcomes is this module.
 *
 * It is best effort on purpose. The upload does not wait for it, a failure
 * changes nothing the person uploading can see, and the nightly run still
 * sweeps up whatever did not make it - so the worst case here is the old
 * behaviour rather than a broken upload.
 */

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../../..')
const SCRIPT = resolve(root, 'scripts/backup.mjs')

/**
 * A name this server generated: a UUID and an extension.
 *
 * It becomes a command-line argument and an object key, so it is checked
 * here as well as in the script. Two cheap checks in different processes are
 * the right price for the one thing in this path that comes from outside.
 */
const OURS = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

/** How the copy is actually made, so a test can watch without spawning. */
export type Run = (name: string, done: (ok: boolean) => void) => void

/*
 * Off until the server turns it on.
 *
 * Rather than sniffing for a test runner: the only thing that should ever
 * make outbound copies is a running server, and it is the only caller that
 * knows whether anywhere offsite is configured. Everything else - tests,
 * scripts, a REPL - imports this and gets a no-op, which is the safe way
 * round.
 */
let on = false

export function enableOffsite(yes: boolean): void {
  on = yes
}

/** Where the module says what happened. The server points this at its log. */
let note: (line: string) => void = () => {}

export function offsiteLogTo(fn: (line: string) => void): void {
  note = fn
}

/*
 * One at a time.
 *
 * Someone dragging in twenty pictures at once would otherwise start twenty
 * node processes on a machine that is also serving the chat and running the
 * voice server. They are queued instead, which costs a few seconds of delay
 * on a copy nobody is waiting for.
 */
const waiting: string[] = []
/*
 * The one in flight, by name, and not merely a flag.
 *
 * A flag was the first version and it made the check below useless: a name
 * is taken off the queue the moment it starts, so asking whether the queue
 * already holds it says no while it is being copied. The same file sent
 * twice in quick succession was copied twice.
 */
let inFlight: string | null = null

function spawnBackup(name: string, done: (ok: boolean) => void): void {
  let said = ''
  const child = spawn(process.execPath, [SCRIPT, '--upload', name], {
    cwd: root,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', (d: Buffer) => { said += d.toString() })
  child.stderr.on('data', (d: Buffer) => { said += d.toString() })
  /* A copy that cannot even start is the same outcome as one that fails:
     tomorrow's run does it. Never let it reach the upload. */
  child.on('error', (err) => { said += String(err); done(false) })
  child.on('close', (code) => {
    const last = said.trim().split('\n').pop()?.trim() ?? ''
    if (last) note(last)
    done(code === 0)
  })
}

function pump(run: Run): void {
  if (inFlight !== null) return
  const next = waiting.shift()
  if (next === undefined) return
  inFlight = next
  run(next, () => {
    inFlight = null
    pump(run)
  })
}

/**
 * Copy this stored file offsite, when there is a moment.
 *
 * Returns immediately and never throws: every caller is in the middle of
 * answering somebody's upload.
 */
export function copyOffsite(name: string, run: Run = spawnBackup): void {
  if (!on) return
  if (!OURS.test(name) || name.includes('..')) return
  /* Two messages can carry the same file now that an imported GIF is stored
     under a name taken from its contents, so the same name can arrive
     twice. */
  if (waiting.includes(name) || inFlight === name) return
  waiting.push(name)
  try {
    pump(run)
  } catch {
    /* Nothing here is worth an upload failing over - and the queue must not
       be left jammed against every upload after this one either. */
    inFlight = null
  }
}

/** For tests: how many copies are still queued. */
export function offsiteQueueLength(): number {
  return waiting.length + (inFlight === null ? 0 : 1)
}

/** For tests: forget everything queued, so one test cannot jam the next. */
export function forgetOffsiteQueue(): void {
  waiting.length = 0
  inFlight = null
}
