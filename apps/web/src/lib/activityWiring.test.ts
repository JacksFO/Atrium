import { describe, expect, it } from 'vitest'
import { apply, applyReady, emptyWorld } from './world'
import { activityLine, primaryActivity } from './activity'
import type { ReadyFrame, User } from './wire'

/**
 * Rich presence, connected.
 *
 * Every piece of it was built: the opening frame carries what everybody is
 * doing, the socket sends changes to it, and there are two functions deciding
 * how to word it in a list and on a card. The world threw both the frame's
 * copy and every update away — `case 'activity': return NOTHING` — and the
 * profile was passed a hard-coded empty list. So the feature existed
 * end to end and was joined to nothing in the middle, which reads exactly
 * like a feature nobody wrote.
 */

const me: User = {
  id: 'me', username: 'me', discriminator: '0001', verified: 0,
  display_name: 'Me', bio: '', accent: '', accent_2: '',
  name_font: 'default', name_effect: 'none', avatar_path: null,
  banner_path: null, status_text: '', presence: 'online',
  created_at: 0,
}

const frame = (activities: ReadyFrame['activities']): ReadyFrame => ({
  t: 'ready', user: me, members: [], channels: [], categories: [], roles: [],
  assignments: [], online: [], voice: [], unread: [], channelPrefs: [],
  permissionsBySpace: {}, channelPermissions: {}, looseOrder: {}, activities,
})

describe('what the world does with what people are doing', () => {
  it('keeps what the opening frame said', () => {
    const w = emptyWorld(me)
    applyReady(w, frame({ u1: [{ kind: 'game', name: 'Factorio' }] } as never))
    expect(activityLine(primaryActivity(w.activities.get('u1')))).toBe('Playing Factorio')
  })

  it('and keeps up with changes to it', () => {
    const w = emptyWorld(me)
    applyReady(w, frame({}))
    apply(w, { t: 'activity', userId: 'u1', activities: [{ kind: 'game', name: 'Elden Ring' }] } as never)
    expect(activityLine(primaryActivity(w.activities.get('u1')))).toBe('Playing Elden Ring')
  })

  /* Stopping is a deletion, not an empty entry: "doing nothing" and "not
     saying" should not draw the same line. */
  it('and forgets somebody who has stopped', () => {
    const w = emptyWorld(me)
    apply(w, { t: 'activity', userId: 'u1', activities: [{ kind: 'game', name: 'X' }] } as never)
    expect(w.activities.has('u1')).toBe(true)
    apply(w, { t: 'activity', userId: 'u1', activities: [] } as never)
    expect(w.activities.has('u1')).toBe(false)
  })

  /* A new frame replaces what was known rather than adding to it — a
     reconnection should not leave somebody playing a game they quit. */
  it('and a fresh frame replaces what it knew', () => {
    const w = emptyWorld(me)
    apply(w, { t: 'activity', userId: 'gone', activities: [{ kind: 'game', name: 'X' }] } as never)
    applyReady(w, frame({ u2: [{ kind: 'music', name: 'Spotify' }] } as never))
    expect(w.activities.has('gone')).toBe(false)
    expect(w.activities.has('u2')).toBe(true)
  })
})
