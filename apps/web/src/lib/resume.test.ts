import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { forgetVoice, rememberVoice, voiceToResume } from './resume'

/**
 * Being put back into the call a reload dropped you out of.
 *
 * Updating this app means reloading the page, and reloading the page drops
 * you out of voice — a rotten way to ship an update to somebody who is
 * mid-conversation. What matters here is not the happy path but the three
 * ways it could put somebody somewhere they did not ask to be.
 */

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})
afterEach(() => { vi.restoreAllMocks() })

describe('coming back after a reload', () => {
  it('remembers the room and hands it back', () => {
    rememberVoice('c1', false, false)
    expect(voiceToResume()?.channelId).toBe('c1')
  })

  it('and remembers whether you were muted', () => {
    rememberVoice('c1', true, false)
    expect(voiceToResume()?.muted).toBe(true)
  })

  /* Leaving on purpose is not something to be undone. */
  it('but not after you left on purpose', () => {
    rememberVoice('c1', false, false)
    forgetVoice()
    expect(voiceToResume()).toBe(null)
  })

  /*
   * Rejoining a call from an hour ago because a tab was left open is worse
   * than not rejoining at all. The point is to survive a reload, not to
   * follow somebody around.
   */
  it('and not one from long enough ago to be over', () => {
    rememberVoice('c1', false, false)
    const later = Date.now() + 5 * 60_000
    vi.spyOn(Date, 'now').mockReturnValue(later)
    expect(voiceToResume()).toBe(null)
  })

  /*
   * Storage is shared by every tab on this origin, so a note left by one was
   * read by all of them — open a second tab within two minutes and it joined
   * a call it had never been in.
   */
  it('and never in a tab that was not the one in the call', async () => {
    rememberVoice('c1', false, false)
    expect(voiceToResume()?.channelId).toBe('c1')

    /*
     * A second tab, properly: its own sessionStorage AND its own copy of the
     * module, because the id is cached in one. Clearing storage alone leaves
     * the cached id in place and the note is accepted — which is this test
     * passing for the wrong reason rather than the guard working.
     */
    sessionStorage.clear()
    vi.resetModules()
    const otherTab = await import('./resume')
    expect(otherTab.voiceToResume()).toBe(null)
  })

  /* Including a note with no session stamped on it at all: anything
     unstamped predates the stamping, and letting those through is letting
     through exactly the case this exists to stop. */
  it('and not one with no tab on it at all', () => {
    localStorage.setItem(
      'atrium.voice.resume',
      JSON.stringify({ channelId: 'c1', at: Date.now(), muted: false, deafened: false }),
    )
    expect(voiceToResume()).toBe(null)
  })

  /* Nothing readable is no resume rather than a crash — a private window
     throws on the first touch of storage. */
  it('and says nothing rather than throwing where storage is refused', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(() => voiceToResume()).not.toThrow()
    expect(voiceToResume()).toBe(null)
  })
})
