import { describe, expect, it } from 'vitest'
import { voiceLabel } from './voiceLabel'

describe('the line under a face in a call', () => {
  it('says what somebody is doing', () => {
    expect(voiceLabel({})).toBe('Listening')
    expect(voiceLabel({ loud: true })).toBe('Speaking')
    expect(voiceLabel({ sharing: true })).toBe('Sharing')
    expect(voiceLabel({ muted: true })).toBe('Muted')
  })

  it('says Deafened rather than Muted, which understates it', () => {
    /* Deafening mutes you too, so both are set and only one can be said. */
    expect(voiceLabel({ mine: true, deaf: true, muted: true })).toBe('Deafened')
  })

  it('but only about you, because nobody else is known to be', () => {
    expect(voiceLabel({ mine: false, deaf: true, muted: true })).toBe('Muted')
  })

  it('and being silenced outranks talking, whatever a stale level says', () => {
    expect(voiceLabel({ muted: true, loud: true })).toBe('Muted')
  })
})
