import { describe, expect, it } from 'vitest'
import { notificationFor, shouldNotify, tabTitle, type NotifyState } from './notify'
import type { Message } from './wire'

const me = { id: 'me' }
const msg = (over: Partial<Message> = {}) =>
  ({ author_id: 'pat', channel_id: 'c1', ...over }) as Message

const state = (over: Partial<NotifyState> = {}): NotifyState => ({
  wanted: true, permission: 'granted', visible: false, openChannel: null,
  muted: new Set(), blocked: new Set(), ...over,
})

describe('whether to say anything', () => {
  it('yes, for somebody else’s message while you are away', () => {
    expect(shouldNotify(msg(), me, state())).toBe(true)
  })

  /* Notifying about your own is the app telling you what you just did. */
  it('never for your own', () => {
    expect(shouldNotify(msg({ author_id: 'me' }), me, state())).toBe(false)
  })

  it('and never for a channel or a server that is muted', () => {
    expect(shouldNotify(msg(), me, state({ muted: new Set(['c1']) }))).toBe(false)
    expect(shouldNotify(msg(), me, state({ muted: new Set(['s1']) }), 's1')).toBe(false)
  })

  /*
   * And never from somebody who has been blocked.
   *
   * The app was hiding their message in the conversation and announcing it
   * in the same breath - a notification is the furthest reach it has, making
   * a noise on a machine nobody may be sitting at, with their name and their
   * words in it. Found by auditing the block rather than by using it.
   *
   * About the person and not the place, so it holds wherever they say it.
   */
  it('and never from somebody blocked, in any channel', () => {
    const shunned = state({ blocked: new Set(['pat']) })
    expect(shouldNotify(msg(), me, shunned)).toBe(false)
    expect(shouldNotify(msg({ channel_id: 'other' }), me, shunned)).toBe(false)
  })

  /* And blocking one person does not silence everybody else. */
  it('but somebody else in the same channel still says something', () => {
    expect(shouldNotify(msg({ author_id: 'sam' }), me, state({ blocked: new Set(['pat']) })))
      .toBe(true)
  })

  /*
   * Both halves matter. A channel open in a window behind something else is
   * not being read, and a window in front showing a different channel is not
   * showing this message — but a notification for something on screen in
   * front of somebody is the one that teaches people to turn these off.
   */
  it('and never while the window is in front of them', () => {
    expect(shouldNotify(msg(), me, state({ visible: true, openChannel: 'c1' }))).toBe(false)
    expect(shouldNotify(msg(), me, state({ visible: true, openChannel: 'c2' }))).toBe(false)
  })

  it('while a channel open in a window nobody is looking at still notifies', () => {
    expect(shouldNotify(msg(), me, state({ visible: false, openChannel: 'c1' }))).toBe(true)
  })

  it('and never without being asked for, or allowed', () => {
    expect(shouldNotify(msg(), me, state({ wanted: false }))).toBe(false)
    expect(shouldNotify(msg(), me, state({ permission: 'denied' }))).toBe(false)
    expect(shouldNotify(msg(), me, state({ permission: 'default' }))).toBe(false)
    expect(shouldNotify(msg(), me, state({ permission: 'unsupported' }))).toBe(false)
  })
})

describe('what it says', () => {
  const m = (body: string, attachments: unknown[] = []) =>
    ({ body, attachments }) as unknown as Message

  it('is who, and where, and the words', () => {
    const out = notificationFor(m('hello there'), 'Pat', '#general')
    expect(out.title).toBe('Pat in #general')
    expect(out.body).toBe('hello there')
  })

  it('and leaves out where, in a conversation', () => {
    expect(notificationFor(m('hi'), 'Pat', null).title).toBe('Pat')
  })

  /* A body reading as empty looks like a notification that failed to load
     rather than one about a picture. */
  it('and says a picture is a picture', () => {
    expect(notificationFor(m('   ', [{ id: 'a' }]), 'Pat', null).body).toBe('Sent a picture')
  })

  it('and does not run on for ever', () => {
    expect(notificationFor(m('x'.repeat(400)), 'Pat', null).body).toHaveLength(140)
  })
})

describe('the count in the tab', () => {
  it('is there when there is something', () => {
    expect(tabTitle(3)).toBe('(3) Atrium')
  })

  /* "(0)" is a number somebody has to read to learn there is nothing to read. */
  it('and absent rather than a nought', () => {
    expect(tabTitle(0)).toBe('Atrium')
  })
})
