/**
 * What to do when the app stops answering.
 *
 * Reported, with a screenshot of a window that would not take a click. There
 * was nothing to find afterwards: no log, no crash file, no record of any
 * kind - so the only honest thing that could be said about it was that it had
 * happened. A freeze nobody can read about is a freeze that gets guessed at
 * every time, and guessing was exactly what happened.
 *
 * Three things go wrong in an Electron app and they are not the same thing:
 *
 *   unresponsive        the page is still there and is not answering. Usually
 *                       it comes back on its own, which is why this waits.
 *   render-process-gone the page died. Nothing is coming back, and the window
 *                       is a picture of what was on screen when it went.
 *   child-process-gone  something else died - most often the GPU, which is
 *                       the commonest cause of a window that looks frozen and
 *                       is the one thing here somebody can act on.
 *
 * Its own file and pure, because the decisions are all about time and
 * repetition and none of them need Electron to be true: how long to wait
 * before saying anything, when to stop asking, and what a log line says. The
 * wiring in main.ts is then short enough to read in one go.
 */

/**
 * How long the page has to be silent before anybody is told.
 *
 * Electron says "unresponsive" for a stall that is often over before somebody
 * has finished reading a dialog about it - a long paint, a big message list,
 * a garbage collection. Ten seconds is past all of those and well short of
 * what anybody would sit through.
 */
export const HANG_GRACE_MS = 10_000

/**
 * And how often it is worth asking.
 *
 * An app that is properly stuck raises this over and over; a dialog that
 * comes back the moment it is dismissed is worse than the freeze, because at
 * least the freeze can be ignored.
 */
export const ASK_AGAIN_MS = 60_000

export type Hang = {
  /** When the page went quiet, or 0 if it is answering. */
  since: number
  /** When somebody was last asked about it, or 0 for never. */
  asked: number
}

export const NOT_HUNG: Hang = { since: 0, asked: 0 }

/** The page has gone quiet. Keeps the first moment, not the latest. */
export function wentQuiet(hang: Hang, now: number): Hang {
  return hang.since > 0 ? hang : { ...hang, since: now }
}

/** It answered again. Forgets the hang, and the fact anybody was asked. */
export function cameBack(): Hang {
  return NOT_HUNG
}

/**
 * Whether to say something about it now.
 *
 * Quiet for long enough, and not asked recently. Both halves matter: without
 * the first this fires on every stall, and without the second it fires again
 * every time Electron repeats itself, which for a properly stuck page is
 * about once a second.
 */
export function shouldAsk(hang: Hang, now: number,
  grace = HANG_GRACE_MS, again = ASK_AGAIN_MS): boolean {
  if (hang.since === 0) return false
  if (now - hang.since < grace) return false
  if (hang.asked > 0 && now - hang.asked < again) return false
  return true
}

/** Somebody has been asked. */
export function asked(hang: Hang, now: number): Hang {
  return { ...hang, asked: now }
}

/**
 * How long it has been stuck, in words, for the dialog.
 *
 * With a number in it. "Atrium is not responding" says nothing somebody
 * cannot already see; how long it has been is the part that says whether to
 * wait or to reload.
 */
export function stuckFor(hang: Hang, now: number): string {
  const secs = Math.max(0, Math.round((now - hang.since) / 1000))
  if (secs < 90) return `${secs} seconds`
  const mins = Math.round(secs / 60)
  return `${mins} minute${mins === 1 ? '' : 's'}`
}

/** One line for the log, with the moment first so a file of them sorts. */
export function logLine(what: string, detail: string, now = Date.now()): string {
  const when = new Date(now).toISOString()
  /* Newlines out: one event is one line, or nothing can read the file back
     by lines - and a crash reason is somebody else's string. */
  const clean = detail.replace(/[\r\n]+/g, ' ').slice(0, 500)
  return `${when}  ${what}${clean ? '  ' + clean : ''}`
}

/**
 * Keep the log to a readable size.
 *
 * Trimmed to whole lines from the end: half a line at the top of a log reads
 * as corruption, and the oldest entries are the ones worth losing. Cheap
 * because it only ever runs after a write that pushed it over.
 */
export function trimmed(text: string, most = 64_000): string {
  if (text.length <= most) return text
  const cut = text.slice(text.length - most)
  const nl = cut.indexOf('\n')
  return nl === -1 ? cut : cut.slice(nl + 1)
}

/**
 * What a dead child process means, in a sentence somebody can act on.
 *
 * The GPU is the one worth naming. A window that looks frozen is far more
 * often a lost GPU process than a stuck page, and turning hardware
 * acceleration off is a real fix that is already a setting - so somebody who
 * hits it twice should be told where that switch is rather than left to find
 * it.
 */
export function whatDied(kind: string, reason: string): string {
  if (kind === 'GPU') {
    return `The graphics process stopped (${reason}). `
      + 'If this keeps happening, turning off hardware acceleration in Settings usually fixes it.'
  }
  return `A ${kind} process stopped (${reason}).`
}

/**
 * How many times it is worth bringing the window back by itself.
 *
 * A page that dies once is an accident and reloading it is the right answer.
 * A page that dies on the way up - a bad build, a corrupt cache, running out
 * of memory while it starts - dies again the moment it is reloaded, and an
 * app that answers that by reloading forever is a machine-heater that also
 * writes to disk on every turn. After a few goes the honest thing is to stop
 * and leave what is on screen, which at least stays still long enough to be
 * read.
 */
export const RELOAD_CAP = 3
export const RELOAD_WINDOW_MS = 60_000

/** The reloads still worth counting, oldest dropped. */
export function recentReloads(
  had: readonly number[], now: number, window = RELOAD_WINDOW_MS,
): number[] {
  return had.filter((at) => now - at < window)
}

/**
 * Whether to bring it back again.
 *
 * Counted over a window rather than for ever: three crashes in a minute is a
 * loop, and three over an afternoon is three separate bad moments, each of
 * which deserves the window back.
 */
export function shouldReload(
  had: readonly number[], now: number, cap = RELOAD_CAP, window = RELOAD_WINDOW_MS,
): boolean {
  return recentReloads(had, now, window).length < cap
}

/**
 * Whether a dead renderer is worth reacting to at all.
 *
 * A clean exit is the page being closed on purpose - which is what happens
 * every time the app quits, and reloading the window on the way out is how
 * an app comes back from the dead as it is being shut down.
 */
export function worthReloading(reason: string, quitting: boolean): boolean {
  if (quitting) return false
  return reason !== 'clean-exit'
}
