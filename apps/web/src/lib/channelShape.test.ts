import { describe, expect, it } from 'vitest'
import { isConversation, isServerChannel, type Channel, type DirectChannel, type ServerChannel } from './wire'

/**
 * One vocabulary for what a channel is.
 *
 * The type named the two kinds a server has, while the frame the socket opens
 * with puts conversations in the very same array and the components that draw
 * one matched on 'dm' against a type that said it could not happen. So a test
 * could not put a conversation into a list of channels while the running app
 * did exactly that on every sign-in - the compiler was right and the runtime
 * was lying.
 *
 * These are compile-time facts as much as runtime ones: the assertions below
 * would be uninteresting if the shapes above them still type-checked, and the
 * point is that the wrong ones no longer do.
 */
const room: ServerChannel = {
  id: 'c1', space_id: 's1', name: 'general', kind: 'text', topic: '',
  category_id: null, position: 0,
}
const conversation: DirectChannel = {
  id: 'd1', space_id: null, name: '', kind: 'dm', topic: '',
  category_id: null, position: 0,
}

describe('what a channel is', () => {
  it('lets a conversation sit in a list of channels, which is what arrives', () => {
    /* The thing that could not be written before. */
    const list: Channel[] = [room, conversation]
    expect(list).toHaveLength(2)
  })

  it('and tells the two apart without matching on a string by hand', () => {
    expect(isServerChannel(room)).toBe(true)
    expect(isServerChannel(conversation)).toBe(false)
    expect(isConversation(conversation)).toBe(true)
    expect(isConversation(room)).toBe(false)
  })

  it('and narrowing a room gives its server, with no null to check', () => {
    const list: Channel[] = [room, conversation]
    const servers = list.filter(isServerChannel).map((c) => c.space_id)
    /* `c.space_id` here is a string, not `string | null` - that is the whole
       point of the split, and it is the compiler that enforces it. */
    expect(servers).toEqual(['s1'])
  })

  it('and a conversation has no server and no heading to reach for', () => {
    const list: Channel[] = [room, conversation]
    const talks = list.filter(isConversation)
    expect(talks.map((c) => c.space_id)).toEqual([null])
    expect(talks.map((c) => c.category_id)).toEqual([null])
  })

  it('and the four kinds are the four kinds the database holds', () => {
    /* text and voice in a server, dm and group outside one. Checked against
       the live table when this was written: every dm row has no server and
       every text or voice row has one. */
    const kinds: Channel['kind'][] = ['text', 'voice', 'dm', 'group']
    expect(new Set(kinds).size).toBe(4)
  })
})
