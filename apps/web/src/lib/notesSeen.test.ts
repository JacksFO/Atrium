import { beforeEach, describe, expect, it } from 'vitest'
import { markNotesSeen, unseenCount, type Note } from './notes'

/**
 * Which of the small changes arrived since somebody was last here.
 *
 * Marked against the newest note they were already shown, by its own words
 * rather than by a date: several land on the same day, and a date can only
 * say "today" - which would mark all of that day's or none of them.
 */

const notes = (...said: string[]): Note[] =>
  said.map((s, i) => ({ at: `2026-08-${29 - i}`, said: s }))

beforeEach(() => localStorage.clear())

describe('what is new since last time', () => {
  /* Everything being new on a first visit is technically true and useless:
     the tag means "since you were last here", and there is no last time. */
  it('is nothing at all on a first visit', () => {
    expect(unseenCount(notes('c', 'b', 'a'))).toBe(0)
  })

  it('and nothing when nothing has been added since', () => {
    const list = notes('c', 'b', 'a')
    markNotesSeen(list)
    expect(unseenCount(list)).toBe(0)
  })

  /* The list is newest first, so what is new is however many sit above the
     one they last saw. */
  it('and counts the ones added on top', () => {
    const before = notes('c', 'b', 'a')
    markNotesSeen(before)
    expect(unseenCount(notes('e', 'd', 'c', 'b', 'a'))).toBe(2)
  })

  it('and remembers again once they have been shown', () => {
    const before = notes('c', 'b', 'a')
    markNotesSeen(before)
    const after = notes('e', 'd', 'c', 'b', 'a')
    expect(unseenCount(after)).toBe(2)
    markNotesSeen(after)
    expect(unseenCount(after)).toBe(0)
  })

  /*
   * The marker naming something that has since been trimmed off the end.
   * Guessing would mean marking the whole list, which is the loud way to be
   * wrong about something nobody asked to be told twice.
   */
  it('and marks nothing when it cannot tell where they got to', () => {
    markNotesSeen(notes('long-gone'))
    expect(unseenCount(notes('c', 'b', 'a'))).toBe(0)
  })

  /* Several on the same day is the case a date could not tell apart, and the
     reason this is keyed on the words. */
  it('and tells apart several that landed on the same day', () => {
    const before: Note[] = [{ at: '2026-08-29', said: 'b' }, { at: '2026-08-29', said: 'a' }]
    markNotesSeen(before)
    const after: Note[] = [
      { at: '2026-08-29', said: 'c' }, { at: '2026-08-29', said: 'b' },
      { at: '2026-08-29', said: 'a' },
    ]
    expect(unseenCount(after)).toBe(1)
  })

  /* A private window refuses storage. Nothing marked is the right answer;
     throwing on the home page is not. */
  it('and says nothing rather than throwing where storage is refused', () => {
    const real = Storage.prototype.getItem
    Storage.prototype.getItem = () => { throw new Error('refused') }
    try {
      expect(unseenCount(notes('c', 'b', 'a'))).toBe(0)
      expect(() => markNotesSeen(notes('c'))).not.toThrow()
    } finally {
      Storage.prototype.getItem = real
    }
  })
})
