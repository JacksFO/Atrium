/**
 * The line under somebody's name in a server's member list.
 *
 * What they are doing beats what they wrote about themselves: one is true
 * right now and the other was true whenever they last thought about it. The
 * panel beside a conversation has done this since it was written; this list -
 * the one with forty people in it - only ever drew the sentence they typed,
 * so a room full of people playing things looked like a room full of people
 * doing nothing.
 */
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemberRow } from './Shell'
import { emptyWorld, remember, type World } from '../lib/world'
import type { Space, User } from '../lib/wire'

const person = (id: string, over: Partial<User> = {}): User => ({
  id, username: id, discriminator: '0001', verified: 0, display_name: id,
  bio: '', accent: '', accent_2: '', name_font: 'default',
  name_effect: 'none', avatar_path: null, banner_path: null,
  status_text: '', presence: 'online', created_at: 0, ...over,
})

const space: Space = {
  id: 'sp', name: 'Somewhere', description: '', icon_path: null, banner_path: null,
  owner_id: 'me', created_at: 0,
} as Space

function world(): World {
  const w = emptyWorld(person('me', { display_name: 'Me' }))
  w.spaces = [space]
  return w
}

const drawn = (u: User, w: World) =>
  renderToStaticMarkup(
    <MemberRow u={u} world={w} space={space} onOpen={() => {}} onWho={() => {}} />,
  )

describe('what a member row says somebody is doing', () => {
  it('names the game', () => {
    const w = world()
    const them = person('pat', { display_name: 'Pat', status_text: 'brb' })
    remember(w, them)
    w.presence.setHere('pat', true)
    w.presence.setHere('pat', true)
    w.activities.set('pat', [{ kind: 'game', name: 'Battlefield 6' }])

    const out = drawn(them, w)
    expect(out).toContain('Playing')
    expect(out).toContain('Battlefield 6')
  })

  it('and says Spotify rather than the track', () => {
    /* One line among forty is the wrong place for a song title: every row
       would be a different one and none of them would be read. The track is
       on their profile, a click away. */
    const w = world()
    const them = person('pat', { display_name: 'Pat' })
    remember(w, them)
    w.presence.setHere('pat', true)
    w.activities.set('pat', [
      { kind: 'music', name: 'Teardrop', detail: 'Massive Attack' },
    ])

    const out = drawn(them, w)
    expect(out).toContain('Listening to')
    expect(out).toContain('Spotify')
    expect(out).not.toContain('Teardrop')
  })

  it('over what they wrote about themselves', () => {
    const w = world()
    const them = person('pat', { display_name: 'Pat', status_text: 'do not disturb' })
    remember(w, them)
    w.presence.setHere('pat', true)
    w.activities.set('pat', [{ kind: 'game', name: 'Battlefield 6' }])

    expect(drawn(them, w)).not.toContain('do not disturb')
  })

  it('and the game wins when they are doing both', () => {
    /* Everybody's music says the same thing and only one of them is in a
       raid. Both are on the profile, which has the room for both. */
    const w = world()
    const them = person('pat', { display_name: 'Pat' })
    remember(w, them)
    w.presence.setHere('pat', true)
    w.activities.set('pat', [
      { kind: 'music', name: 'Teardrop' },
      { kind: 'game', name: 'Battlefield 6' },
    ])

    const out = drawn(them, w)
    expect(out).toContain('Battlefield 6')
    expect(out).not.toContain('Spotify')
  })

  it('falling back to what they wrote when they are doing nothing', () => {
    const w = world()
    const them = person('pat', { display_name: 'Pat', status_text: 'do not disturb' })
    remember(w, them)
    w.presence.setHere('pat', true)
    expect(drawn(them, w)).toContain('do not disturb')
  })
})
