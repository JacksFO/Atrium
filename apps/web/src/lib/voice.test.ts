import { describe, expect, it } from 'vitest'
import { identityToId, sourceOf } from './voice'
import { keyOf } from './call'

describe('what a track is', () => {
  it('a microphone is a voice, a camera is a camera', () => {
    expect(sourceOf('microphone')).toBe('voice')
    expect(sourceOf('camera')).toBe('cam')
  })

  /*
   * The one that bit. A screen and the sound coming out of it are the same
   * thing to the person watching, and both are a *share* — not the sharer's
   * voice. Filed as a voice, somebody's game and somebody's talking land in
   * one slot and the second to arrive replaces the first, so ending a share
   * took the voice with it.
   */
  it('and a screen and its sound are both the share', () => {
    expect(sourceOf('screen_share')).toBe('share')
    expect(sourceOf('screen_share_audio')).toBe('share')
  })

  it('so a share never lands where a voice lives', () => {
    expect(keyOf(sourceOf('screen_share_audio')!, 'u7'))
      .not.toBe(keyOf(sourceOf('microphone')!, 'u7'))
  })

  it('and anything unrecognised is filed nowhere rather than guessed at', () => {
    expect(sourceOf('unknown')).toBe(null)
    expect(sourceOf('')).toBe(null)
  })
})

describe('who a participant is', () => {
  /* Turned into a number by hand in four places in the old client, and a
     uuid does not survive that — it comes back NaN and matches nobody. */
  it('keeps a uuid whole', () => {
    const id = '3c42a3f0-1e2b-4c5d-8a9f-000000000001'
    expect(identityToId(id)).toBe(id)
  })
})
