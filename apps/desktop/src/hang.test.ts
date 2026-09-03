import { describe, expect, it } from 'vitest'
import {
  ASK_AGAIN_MS, asked, cameBack, HANG_GRACE_MS, logLine, NOT_HUNG, recentReloads,
  RELOAD_CAP, RELOAD_WINDOW_MS, shouldAsk, shouldReload, stuckFor, trimmed, whatDied,
  wentQuiet, worthReloading,
} from './hang.js'

/**
 * What to do when the app stops answering.
 *
 * Reported with a screenshot of a window that would not take a click, and
 * there was nothing to find afterwards - no log, no crash file, no record of
 * any kind. A freeze nobody can read about is one that gets guessed at every
 * time.
 *
 * The decisions are all about time and repetition, which is why they are here
 * rather than tangled into the event handlers: how long to wait before saying
 * anything, when to stop asking, and what survives in the log.
 */

const T = 1_000_000

describe('waiting before saying anything', () => {
  /*
   * Electron calls a page unresponsive for stalls that are over before
   * anybody could read a dialog about them - a long paint, a big list, a
   * garbage collection. Saying something immediately would mean a box in
   * somebody's face for something they never noticed.
   */
  it('says nothing about a short stall', () => {
    const hang = wentQuiet(NOT_HUNG, T)
    expect(shouldAsk(hang, T + 2000)).toBe(false)
  })

  it('and speaks up once it has gone on', () => {
    const hang = wentQuiet(NOT_HUNG, T)
    expect(shouldAsk(hang, T + HANG_GRACE_MS + 1)).toBe(true)
  })

  it('and says nothing at all when the page is fine', () => {
    expect(shouldAsk(NOT_HUNG, T + 999_999)).toBe(false)
  })

  /* The first moment, not the latest. Electron repeats itself about once a
     second while a page is stuck, and taking the newest each time would keep
     resetting the clock so the grace never elapsed. */
  it('and times it from when the silence started', () => {
    let hang = wentQuiet(NOT_HUNG, T)
    hang = wentQuiet(hang, T + 5000)
    hang = wentQuiet(hang, T + 9000)
    expect(hang.since).toBe(T)
    expect(shouldAsk(hang, T + HANG_GRACE_MS + 1), 'the clock was reset').toBe(true)
  })
})

describe('not asking twice', () => {
  /*
   * A properly stuck page raises this over and over. A dialog that comes back
   * the moment it is dismissed is worse than the freeze itself - the freeze
   * can at least be ignored.
   */
  it('waits a while before asking again', () => {
    let hang = wentQuiet(NOT_HUNG, T)
    hang = asked(hang, T + HANG_GRACE_MS)
    expect(shouldAsk(hang, T + HANG_GRACE_MS + 1000)).toBe(false)
  })

  it('but does ask again if it is still stuck much later', () => {
    let hang = wentQuiet(NOT_HUNG, T)
    hang = asked(hang, T + HANG_GRACE_MS)
    expect(shouldAsk(hang, T + HANG_GRACE_MS + ASK_AGAIN_MS + 1)).toBe(true)
  })

  /* And coming back forgets everything, so the next hang is treated as new
     rather than as a continuation of the last one an hour ago. */
  it('and forgets it all once the page answers', () => {
    let hang = wentQuiet(NOT_HUNG, T)
    hang = asked(hang, T + HANG_GRACE_MS)
    hang = cameBack()
    expect(hang).toEqual(NOT_HUNG)
    expect(shouldAsk(hang, T + 999_999)).toBe(false)
  })
})

describe('what somebody is told', () => {
  /* With a number in it. "Atrium is not responding" says nothing they cannot
     already see; how long says whether to wait or to reload. */
  it('says how long it has been stuck', () => {
    expect(stuckFor({ since: T, asked: 0 }, T + 12_000)).toBe('12 seconds')
  })

  /*
   * Minutes once seconds stop being readable, and not before: the changeover
   * is at ninety rather than sixty because "90 seconds" reads perfectly well
   * and "1.5 minutes" does not.
   */
  it('and in minutes once seconds stop being readable', () => {
    expect(stuckFor({ since: T, asked: 0 }, T + 60_000)).toBe('60 seconds')
    expect(stuckFor({ since: T, asked: 0 }, T + 240_000)).toBe('4 minutes')
    expect(stuckFor({ since: T, asked: 0 }, T + 120_000)).toBe('2 minutes')
  })
})

describe('the log', () => {
  it('puts the moment first, so a file of them sorts', () => {
    const line = logLine('unresponsive', 'ten seconds', Date.UTC(2026, 8, 3, 12, 0, 0))
    expect(line.startsWith('2026-09-03T12:00:00')).toBe(true)
    expect(line).toContain('unresponsive')
  })

  /*
   * One event, one line. A crash reason is somebody else's string, and a
   * newline in it would split one event into two - after which nothing can
   * read the file back by lines.
   */
  it('and keeps one event on one line', () => {
    const line = logLine('gone', 'crashed\nat the bottom\r\nof somewhere')
    expect(line.split('\n')).toHaveLength(1)
  })

  it('and does not let one entry run away with the file', () => {
    expect(logLine('gone', 'x'.repeat(5000)).length).toBeLessThan(600)
  })
})

describe('keeping the log a readable size', () => {
  it('leaves a small one alone', () => {
    expect(trimmed('one\ntwo\n', 1000)).toBe('one\ntwo\n')
  })

  /*
   * Trimmed from the end and to a whole line: the oldest entries are the ones
   * worth losing, and half a line at the top of a log reads as corruption
   * rather than as a file that was tidied.
   */
  it('and cuts the oldest of a big one, at a line', () => {
    const many = Array.from({ length: 500 }, (_, i) => `line ${i}`).join('\n')
    const out = trimmed(many, 200)
    expect(out.length).toBeLessThanOrEqual(200)
    expect(out.startsWith('line '), 'it cut through the middle of a line').toBe(true)
    expect(out.endsWith('line 499')).toBe(true)
  })
})

describe('what died', () => {
  /*
   * The GPU is the one worth naming. A window that looks frozen is far more
   * often a lost graphics process than a stuck page, and turning hardware
   * acceleration off is a real fix that is already a setting.
   */
  it('names the graphics process and where the switch is', () => {
    const said = whatDied('GPU', 'crashed')
    expect(said).toContain('graphics')
    expect(said, 'the one fix somebody can act on is not mentioned')
      .toContain('hardware acceleration')
  })

  it('and says plainly what else it was', () => {
    expect(whatDied('Utility', 'killed')).toContain('Utility')
  })
})

/**
 * And bringing the window back without doing it forever.
 *
 * A page that dies once is an accident, and reloading it is right. A page
 * that dies on the way up dies again the moment it is reloaded - so an app
 * that answers that by reloading is a loop that heats the machine and writes
 * to disk on every turn. This is the thing that exists to explain a bad
 * moment, so it must not be able to cause one.
 */
describe('bringing it back', () => {
  it('is worth doing the first few times', () => {
    let had: number[] = []
    for (let i = 0; i < RELOAD_CAP; i++) {
      expect(shouldReload(had, T + i * 1000)).toBe(true)
      had = [...had, T + i * 1000]
    }
  })

  it('and stops once it is plainly a loop', () => {
    const had = Array.from({ length: RELOAD_CAP }, (_, i) => T + i * 1000)
    expect(shouldReload(had, T + 4000), 'it would reload for ever').toBe(false)
  })

  /*
   * Counted over a window rather than for ever. Three crashes in a minute is
   * a loop; three across an afternoon is three separate bad moments, and each
   * of those deserves the window back.
   */
  it('but starts again once the loop is well behind it', () => {
    const had = Array.from({ length: RELOAD_CAP }, (_, i) => T + i * 1000)
    expect(shouldReload(had, T + RELOAD_WINDOW_MS + 5000)).toBe(true)
  })

  it('and forgets the ones outside the window', () => {
    const had = [T, T + RELOAD_WINDOW_MS + 1000]
    expect(recentReloads(had, T + RELOAD_WINDOW_MS + 2000)).toHaveLength(1)
  })
})

describe('a renderer that went on purpose', () => {
  /*
   * The one that would be felt every time. A clean exit is the page being
   * closed deliberately, which happens on every quit - and reloading the
   * window then is an app coming back from the dead as it is shut down.
   */
  it('is not brought back', () => {
    expect(worthReloading('clean-exit', false)).toBe(false)
  })

  it('and nothing is, while the app is quitting', () => {
    expect(worthReloading('crashed', true)).toBe(false)
    expect(worthReloading('oom', true)).toBe(false)
  })

  it('but a crash is', () => {
    expect(worthReloading('crashed', false)).toBe(true)
    expect(worthReloading('oom', false)).toBe(true)
  })
})
