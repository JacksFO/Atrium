import { beforeEach, describe, expect, it } from 'vitest'
import {
  intendToResume, keepVoiceFresh, rememberShareSource, rememberVoice,
  shareSource, takeResumeIntent, voiceToResume,
} from './resume'

/**
 * Putting a screen share back after a reload.
 *
 * A capture does not survive the page that owns it, and starting one needs a
 * press: a page that could re-capture your screen after a reload could do it
 * after a reload it caused. So none of this resumes anything - it remembers
 * enough to offer, and the offer is one press.
 *
 * Three states, and they are not the same:
 *   absent - was not sharing, so say nothing
 *   null   - was sharing, and nothing here can say what (a browser, whose
 *            picker never tells the page what was chosen)
 *   a string - the desktop shell's source, so the same window can come back
 */

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  rememberShareSource(null)
  takeResumeIntent()
})

describe('the note left behind', () => {
  it('says nothing about sharing when nothing was shared', () => {
    rememberVoice('c1', false, false)
    expect(voiceToResume()?.share).toBeUndefined()
  })

  it('says a screen was shared even where it cannot say which', () => {
    /* A browser. Offering to share again is still the right offer. */
    rememberVoice('c1', false, false, null)
    const back = voiceToResume()
    expect(back?.share).toBe(null)
    expect('share' in (back ?? {}), 'present, not merely undefined').toBe(true)
  })

  it('and which one, where something knows', () => {
    keepVoiceFresh('c1', false, false, 'window:42:0')
    expect(voiceToResume()?.share).toBe('window:42:0')
  })

  it('and keeps the rest of the note as it was', () => {
    keepVoiceFresh('c1', true, false, 'screen:0:0')
    expect(voiceToResume()).toMatchObject({ channelId: 'c1', muted: true, deafened: false })
  })
})

describe('the source being captured', () => {
  it('is nothing until a picker says otherwise', () => {
    expect(shareSource()).toBe(null)
  })

  it('is whatever was last chosen', () => {
    rememberShareSource('window:7:0')
    expect(shareSource()).toBe('window:7:0')
  })

  it('and is let go of when the share stops', () => {
    rememberShareSource('window:7:0')
    rememberShareSource(null)
    expect(shareSource()).toBe(null)
  })
})

describe('the intent to put one back', () => {
  it('is nothing until somebody presses', () => {
    expect(takeResumeIntent()).toBe(null)
  })

  it('is read once and gone', () => {
    /* Or the next ordinary press of the share button silently re-shares
       whatever was going an hour ago instead of opening the picker. */
    intendToResume('window:7:0')
    expect(takeResumeIntent()).toBe('window:7:0')
    expect(takeResumeIntent()).toBe(null)
  })

  it('and survives having nothing to name, which a browser always has', () => {
    intendToResume(null)
    expect(takeResumeIntent()).toBe(null)
  })
})
