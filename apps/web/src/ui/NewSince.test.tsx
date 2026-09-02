import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { NewSince } from './NewSince'

/**
 * What arrived in this channel while somebody was away.
 *
 * The list already draws a line where they came in, and it is the right thing
 * once they are looking at the place it marks - but it is inside the list. A
 * channel with forty new messages opens showing the end of them, with the
 * line somewhere above and off screen, and nothing saying it is there. The
 * count somebody wants is the one they want before scrolling anywhere.
 *
 * This channel, and no other. It reads the open channel's count, says when
 * that channel was last read, and clears that channel - there is nothing
 * here about the app as a whole, which is a different thing that would want
 * a different place to live.
 */

const draw = (props: Parameters<typeof NewSince>[0]) =>
  renderToStaticMarkup(<NewSince {...props} />)

const noop = () => {}
const AT_10_06 = new Date('2026-09-02T10:06:00').getTime()

describe('the bar', () => {
  it('says how many, and since when', () => {
    const out = draw({ count: 16, since: Date.now() - 60_000, onGo: noop, onRead: noop })
    expect(out).toContain('16 new messages')
    expect(out).toContain('since')
  })

  /* One is one, not "1 new messages". */
  it('and counts one properly', () => {
    expect(draw({ count: 1, since: Date.now() - 60_000, onGo: noop, onRead: noop }))
      .toContain('1 new message since')
  })

  /*
   * Absent when there is nothing new, rather than there saying zero.
   *
   * A strip that is always on screen costs a band of every channel for the
   * case where it has nothing to say, and the list moving down is the honest
   * signal that something is being announced.
   */
  it('and is not there at all when nothing is new', () => {
    expect(draw({ count: 0, since: Date.now(), onGo: noop, onRead: noop })).toBe('')
    expect(draw({ count: -1, since: Date.now(), onGo: noop, onRead: noop })).toBe('')
  })

  /*
   * And does not claim a number it cannot know.
   *
   * The server stops counting at a hundred, so a channel with five hundred
   * waiting reports a hundred - and "100 new messages" reads as an exact
   * number somebody could scroll back through. The same ceiling the badge
   * uses, from the same function, so the bar and the rail cannot disagree.
   */
  it('and says roughly, once it is past what the server counts', () => {
    const out = draw({ count: 100, since: Date.now(), onGo: noop, onRead: noop })
    expect(out).toContain('99+ new messages')
    expect(out, 'a ceiling read as an exact number').not.toContain('100 new')
  })

  it('and an exact number below that', () => {
    expect(draw({ count: 99, since: Date.now(), onGo: noop, onRead: noop }))
      .toContain('99 new messages')
  })

  /* And still says the count when the server has never said when - the
     number is the part somebody is reading. */
  it('and manages without a time', () => {
    const out = draw({ count: 4, since: null, onGo: noop, onRead: noop })
    expect(out).toContain('4 new messages')
    /* The word with a space either side, because the class is called
       `newsince` and a plain search for it matches the markup. */
    expect(out).not.toMatch(/ since /)
  })
})

describe('the time it shows', () => {
  /*
   * A clock for something from today, a date for anything older.
   *
   * Everything this is about happened while somebody was away, which is
   * hours rather than weeks - and "since 09:14" on something from a
   * fortnight ago is worse than useless, because it reads as this morning.
   */
  it('is a clock for something recent', () => {
    const out = draw({ count: 2, since: Date.now() - 3 * 60 * 60_000, onGo: noop, onRead: noop })
    expect(out).toMatch(/since \d{1,2}[:.]\d{2}/)
  })

  it('and a date for something old', () => {
    const out = draw({ count: 2, since: AT_10_06 - 40 * 24 * 60 * 60_000, onGo: noop, onRead: noop })
    expect(out).toContain('since')
    expect(out, 'a month-old message read as a time this morning')
      .not.toMatch(/since \d{1,2}[:.]\d{2}\b/)
  })
})

describe('the two things it offers', () => {
  /*
   * Both are buttons, and the strip is the larger of the two.
   *
   * Going back to where you left off is what somebody reaches for, so it
   * takes the room; clearing it is the other decision and has to be its own
   * control, or pressing it would also jump.
   */
  it('are separate controls', () => {
    const out = draw({ count: 3, since: Date.now(), onGo: noop, onRead: noop })
    expect(out.match(/<button/g) ?? []).toHaveLength(2)
    expect(out).toContain('Mark as read')
  })
})

/**
 * And it is about one channel.
 *
 * Every number in it comes from the channel that is open, and clearing it
 * clears that channel. A bar that said what the whole app had missed would
 * be a different feature living somewhere else, and one that quietly marked
 * everything read would be the same button doing far more than it says.
 */
describe('where it gets its numbers', () => {
  const shell = readFileSync(join(__dirname, 'Shell.tsx'), 'utf8').split('\r\n').join('\n')
  const used = (() => {
    const at = shell.indexOf('<NewSince')
    expect(at, 'the bar is not drawn anywhere').toBeGreaterThan(-1)
    return shell.slice(at, shell.indexOf('/>', shell.indexOf('onRead=', at)))
  })()

  it('counts only what is unread in the open channel', () => {
    expect(used).toContain('count={markFrom ?? 0}')
    /* markFrom is taken from world.unread for the open channel, on the way
       in - the same number the line in the list is drawn from. */
    expect(shell).toContain('setMarkFrom(openId ? world.unread.get(openId) ?? null : null)')
  })

  it('and asks when that channel was read, not the app', () => {
    expect(used).toContain('world.lastRead.get(openId)')
  })

  /* One channel. readFrame takes a channel id, and there is a separate
     "read everything" elsewhere that this must not become. */
  it('and marks that channel read, and nothing else', () => {
    expect(used).toContain('send(readFrame(openId))')
    expect(used, 'it reaches for more than the open channel')
      .not.toMatch(/onReadAll|for \(const id of/)
  })
})
