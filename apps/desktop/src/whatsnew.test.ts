import { describe, expect, it } from 'vitest'
import { whatsNewFor } from './whatsnew'

describe('whether to say what changed', () => {
  const NOTES = '<li>The ring is a marimba now</li>'

  it('says it once, on the launch the notes belong to', () => {
    expect(whatsNewFor({ version: '0.2.30', notes: NOTES }, '0.2.30'))
      .toEqual({ version: '0.2.30', notes: NOTES })
  })

  /* Which is every launch, for anybody who has not just updated. */
  it('and says nothing when there is nothing saved', () => {
    expect(whatsNewFor(null, '0.2.30')).toBeNull()
    expect(whatsNewFor(undefined, '0.2.30')).toBeNull()
  })

  /*
   * An update that was downloaded and never installed - the app was closed
   * some other way, or a later update landed on top of it. Either way these
   * are notes about a version nobody is running, and showing them would
   * describe changes that are not there.
   */
  it('and nothing when the notes are for a version this is not', () => {
    expect(whatsNewFor({ version: '0.2.31', notes: NOTES }, '0.2.30')).toBeNull()
    expect(whatsNewFor({ version: '0.2.29', notes: NOTES }, '0.2.30')).toBeNull()
  })

  it('and nothing when the release was published with an empty body', () => {
    expect(whatsNewFor({ version: '0.2.30', notes: '' }, '0.2.30')).toBeNull()
    expect(whatsNewFor({ version: '0.2.30', notes: '   \n  ' }, '0.2.30')).toBeNull()
  })

  /*
   * The file is on disk and can be anything by the time it is read back - a
   * half-written write, an older shape, somebody having a look. None of that
   * is worth an exception on a launch.
   */
  it('and survives a file that is not what it should be', () => {
    expect(whatsNewFor({} as never, '0.2.30')).toBeNull()
    expect(whatsNewFor({ version: 7, notes: NOTES } as never, '0.2.30')).toBeNull()
    expect(whatsNewFor({ version: '0.2.30', notes: { a: 1 } } as never, '0.2.30')).toBeNull()
    expect(whatsNewFor('nonsense' as never, '0.2.30')).toBeNull()
    expect(whatsNewFor([] as never, '0.2.30')).toBeNull()
  })

  /*
   * The version has to match exactly. A prefix match would show 0.2.3's notes
   * to somebody running 0.2.30, which is the sort of thing that works for a
   * year and then does not.
   */
  it('and will not take a version that merely starts the same', () => {
    expect(whatsNewFor({ version: '0.2.3', notes: NOTES }, '0.2.30')).toBeNull()
    expect(whatsNewFor({ version: '0.2.30', notes: NOTES }, '0.2.3')).toBeNull()
  })
})
