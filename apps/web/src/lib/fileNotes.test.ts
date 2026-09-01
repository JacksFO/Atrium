import { describe, expect, it } from 'vitest'
import { fileNotes, noteTime, type Note, type Published } from './notes'

/**
 * Small changes finding their way into the release that carried them.
 *
 * The shape asked for, in the words it was asked in: a release goes out;
 * small changes trickle out after it and collect in a box of their own; the
 * next release goes out and that box empties into the one before it, leaving
 * a fresh box for whatever comes next.
 *
 * Before this nothing compared a note to a release at all - the box showed
 * the newest six, full stop - so the same six sat under "Since" through three
 * releases in one afternoon, describing work those releases had shipped.
 */

const rel = (version: string, published: string): Published => ({ version, published })
const note = (at: string, said = at): Note => ({ at, said })

describe('which release a small change went out under', () => {
  it('leaves it waiting while nothing has shipped since', () => {
    const releases = [rel('v2', '2026-08-10T10:00:00Z')]
    const got = fileNotes(releases, [note('2026-08-11T09:00')])
    expect(got.since.map((n) => n.said)).toEqual(['2026-08-11T09:00'])
    expect(got.byVersion).toEqual({})
  })

  it('and files it under the release it lived through, once a newer one ships', () => {
    /* The example: v1, then small changes, then v2 - and the changes go into
       v1's box, not v2's. They were what v1 became while it was current. */
    const releases = [
      rel('v2', '2026-08-12T10:00:00Z'),
      rel('v1', '2026-08-10T10:00:00Z'),
    ]
    const got = fileNotes(releases, [note('2026-08-11T09:00', 'a small change')])
    expect(got.since).toEqual([])
    expect(got.byVersion['v1']?.map((n) => n.said)).toEqual(['a small change'])
    expect(got.byVersion['v2']).toBeUndefined()
  })

  it('and the box is fresh again for what comes after the new one', () => {
    const releases = [
      rel('v2', '2026-08-12T10:00:00Z'),
      rel('v1', '2026-08-10T10:00:00Z'),
    ]
    const got = fileNotes(releases, [
      note('2026-08-13T09:00', 'after v2'),
      note('2026-08-11T09:00', 'between them'),
    ])
    expect(got.since.map((n) => n.said)).toEqual(['after v2'])
    expect(got.byVersion['v1']?.map((n) => n.said)).toEqual(['between them'])
  })

  it('puts three releases in one afternoon in the right order', () => {
    /* The case that made this visible - and the reason a bare date is not
       enough to say which side of a release something fell on. */
    const releases = [
      rel('0.2.29', '2026-08-29T15:30:00Z'),
      rel('0.2.28', '2026-08-29T15:17:00Z'),
      rel('0.2.27', '2026-08-29T08:10:00Z'),
    ]
    const got = fileNotes(releases, [
      note('2026-08-29T16:40Z', 'after everything'),
      note('2026-08-29T15:20Z', 'while 0.2.28 was current'),
      note('2026-08-29T09:00Z', 'while 0.2.27 was current'),
    ])
    expect(got.since.map((n) => n.said)).toEqual(['after everything'])
    expect(got.byVersion['0.2.28']?.map((n) => n.said)).toEqual(['while 0.2.28 was current'])
    expect(got.byVersion['0.2.27']?.map((n) => n.said)).toEqual(['while 0.2.27 was current'])
  })

  it('takes a bare date as the start of its day', () => {
    /* The earliest it could have been. Guessing late would file work under a
       version that had not shipped when it happened. */
    const releases = [
      rel('0.2.29', '2026-08-29T15:30:00Z'),
      rel('0.2.26', '2026-08-28T22:54:00Z'),
    ]
    const got = fileNotes(releases, [note('2026-08-29', 'no time on it')])
    expect(got.byVersion['0.2.26']?.map((n) => n.said)).toEqual(['no time on it'])
    expect(got.since).toEqual([])
    expect(noteTime('2026-08-29')).toBeLessThan(noteTime('2026-08-29T23:00'))
  })

  it('and reads a time written without a zone as the local one', () => {
    /* These are hand-written, and somebody writing one writes the time they
       saw on their own clock. */
    const local = new Date('2026-08-29T12:00:00')
    expect(noteTime('2026-08-29T12:00')).toBe(local.getTime())
  })

  it('keeps everything, wherever it goes', () => {
    /* A note that fell through every branch would simply disappear off the
       page, which is the one failure nobody would report as a bug. */
    const releases = [rel('v2', '2026-08-12T10:00:00Z'), rel('v1', '2026-08-10T10:00:00Z')]
    const notes = [
      note('2026-08-13T09:00'), note('2026-08-11T09:00'), note('2026-08-09T09:00'),
    ]
    const got = fileNotes(releases, notes)
    const filed = got.since.length + Object.values(got.byVersion).flat().length
    expect(filed).toBe(notes.length)
  })

  it('and shows them all as waiting when there are no releases to file against', () => {
    /* The server could not reach GitHub - which must not swallow the list. */
    const got = fileNotes([], [note('2026-08-13T09:00'), note('2026-08-11T09:00')])
    expect(got.since).toHaveLength(2)
  })
})
