import { describe, expect, it } from 'vitest'
import { fileNotes, NOTES, noteTime, type Published } from './notes'

/**
 * The real list against the real releases.
 *
 * The rule is tested on its own elsewhere; this is the "and what does that
 * actually do to what is on the page" check, with the versions that exist.
 * It is here because the fault was only ever visible with real data: the code
 * was perfectly happy showing six changes under "Since" that three releases
 * had already carried out to everybody.
 */
const REAL: Published[] = [
  { version: '0.2.29', published: '2026-08-29T15:30:17Z' },
  { version: '0.2.28', published: '2026-08-29T15:17:22Z' },
  { version: '0.2.27', published: '2026-08-29T08:12:07Z' },
  { version: '0.2.26', published: '2026-08-27T22:55:12Z' },
  { version: '0.2.25', published: '2026-08-26T14:19:02Z' },
]

describe('the notes as they stand today', () => {
  it('leave Since as soon as a release carries them', () => {
    /* Which is the whole complaint: they used to stay there for ever. So
       nothing older than the newest release may still be waiting, and what
       is waiting must genuinely be newer than it. */
    const newest = Date.parse(REAL[0]!.published)
    const { since } = fileNotes(REAL, NOTES)
    for (const n of since) expect(noteTime(n.at)).toBeGreaterThan(newest)

    const carried = NOTES.filter((n) => noteTime(n.at) <= newest)
    expect(carried.length).toBeGreaterThan(0)
    for (const n of carried) expect(since).not.toContain(n)
  })

  it('and every one of them is filed somewhere rather than dropped', () => {
    const { since, byVersion } = fileNotes(REAL, NOTES)
    const filed = since.length + Object.values(byVersion).flat().length
    expect(filed).toBe(NOTES.length)
  })

  it('never under a release that had not shipped when they landed', () => {
    const { byVersion } = fileNotes(REAL, NOTES)
    for (const [version, list] of Object.entries(byVersion)) {
      const shipped = Date.parse(REAL.find((r) => r.version === version)!.published)
      for (const n of list) expect(noteTime(n.at)).toBeGreaterThanOrEqual(shipped)
    }
  })
})
