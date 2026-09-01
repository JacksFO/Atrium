import { describe, expect, it } from 'vitest'
import { Held } from './held'
import { CONVERSATION_PERMISSIONS } from './permissions'

describe('what the server said you may do', () => {
  it('is answered per server', () => {
    const h = new Held()
    h.replace({ s1: ['send_messages'], s2: ['manage_roles'] }, {})
    expect(h.in('s1', 'c1')).toEqual(['send_messages'])
    expect(h.in('s2', 'c9')).toEqual(['manage_roles'])
  })

  /* Only the channels that differ are sent, so a channel that is not in the
     list is not a channel with no permissions — it is one where the server's
     own answer holds. Read the other way, every ordinary channel in the app
     would go read-only. */
  it('falls back to the server for a channel nobody has overridden', () => {
    const h = new Held()
    h.replace({ s1: ['send_messages'] }, { s1: { c2: ['read_history'] } })
    expect(h.in('s1', 'c1')).toEqual(['send_messages'])
    expect(h.in('s1', 'c2')).toEqual(['read_history'])
  })

  it('and a conversation is granted its fixed set', () => {
    expect(new Held().in(null, 'd1')).toEqual(CONVERSATION_PERMISSIONS)
  })
})

describe('one server’s answer arriving again', () => {
  it('replaces that server and leaves the others alone', () => {
    const h = new Held()
    h.replace({ s1: ['send_messages'], s2: ['send_messages'] }, {})
    h.setSpace('s1', ['send_messages', 'manage_messages'], {})
    expect(h.in('s1', null)).toContain('manage_messages')
    expect(h.in('s2', null)).not.toContain('manage_messages')
  })

  /*
   * The one that made this per server rather than one flat map of channels.
   *
   * A replacement carries only the channels that still differ. Held flat,
   * a rule somebody had just deleted would have nothing to overwrite it —
   * the channel is simply absent from the new list — so the channel would
   * keep a restriction the server had already been told to drop.
   */
  it('clears an override the new answer no longer carries', () => {
    const h = new Held()
    h.replace({ s1: ['send_messages'] }, { s1: { c2: [] } })
    expect(h.in('s1', 'c2')).toEqual([])

    h.setSpace('s1', ['send_messages'], {})
    expect(h.in('s1', 'c2')).toEqual(['send_messages'])
  })
})
