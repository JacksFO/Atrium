import { describe, expect, it } from 'vitest'
import { nextExpiry, statusOf, statusUntil, STATUS_FOR } from './status'

const at = (text: string, until = 0) => ({ status_text: text, status_until: until })
const NOON = new Date('2026-08-31T12:00:00').getTime()

describe('what a status says now', () => {
  it('says what it says, with no timer on it', () => {
    expect(statusOf(at('back in 20'), NOON)).toBe('back in 20')
  })

  it('and goes when its moment passes', () => {
    expect(statusOf(at('back in 20', NOON - 1), NOON)).toBe('')
  })

  it('but not a moment before', () => {
    expect(statusOf(at('back in 20', NOON + 1), NOON)).toBe('back in 20')
  })

  it('and a status without the field at all still reads', () => {
    /* Anything written before status timers existed, and anybody on an older
       client that does not send the field. */
    expect(statusOf({ status_text: 'hello' }, NOON)).toBe('hello')
  })
})

describe('when to look again', () => {
  it('is nothing when nobody has a timer', () => {
    expect(nextExpiry([at('hi'), at('there')], NOON)).toBe(null)
  })

  it('is the soonest one still to come', () => {
    const soon = NOON + 60_000
    expect(nextExpiry([at('a', NOON + 500_000), at('b', soon)], NOON)).toBe(soon)
  })

  it('ignores ones that have already been and gone', () => {
    /* They already read as empty; waking to clear them again is a wake for
       nothing. */
    expect(nextExpiry([at('a', NOON - 1)], NOON)).toBe(null)
  })

  it('and ignores a timer on a status with nothing in it', () => {
    expect(nextExpiry([at('', NOON + 60_000)], NOON)).toBe(null)
  })
})

describe('the moment a choice lands on', () => {
  it('is never, for "Don’t clear"', () => {
    expect(statusUntil(0, NOON)).toBe(0)
  })

  it('is that much later, for a length of time', () => {
    expect(statusUntil(30 * 60_000, NOON)).toBe(NOON + 30 * 60_000)
  })

  it('and the end of the day for "Today", not a day from now', () => {
    /* Set in the morning, it should be gone tomorrow - not still there at
       eleven the next morning. */
    const end = statusUntil(-1, NOON)
    expect(new Date(end).getHours(), 'midnight').toBe(0)
    expect(new Date(end - 1).getDate(), 'the last moment is still today')
      .toBe(new Date(NOON).getDate())
    expect(end - NOON).toBeLessThan(24 * 60 * 60_000)
  })

  it('and every offer maps to something sane', () => {
    for (const choice of STATUS_FOR) {
      const until = statusUntil(choice.ms, NOON)
      if (choice.ms === 0) expect(until).toBe(0)
      else expect(until, choice.label).toBeGreaterThan(NOON)
    }
  })
})
