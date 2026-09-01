import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Api } from '../lib/api'
import { MemberRow } from './Shell'
import { Profile } from './Profile'
import { emptyWorld, remember, type World } from '../lib/world'
import type { Activity, Channel, Space, User } from '../lib/wire'

/**
 * Being in a call, said in the two places somebody looks.
 *
 * One line under a name in the list, and a section on the card with the room
 * named and a way into it. The list has room for one line and the card has
 * room for the rest, which is the same division the game and the music
 * already follow.
 *
 * What decides the line is an order rather than a switch: a game, then music,
 * then a call, then the sentence they typed about themselves. Being in a call
 * while playing something is the ordinary case, so a call cannot be allowed
 * to take the line off the more interesting half.
 */

const person = (id: string, over: Partial<User> = {}): User => ({
  id, username: id, discriminator: '0001', verified: 0, display_name: id,
  bio: '', accent: '', accent_2: '', name_font: 'default',
  name_effect: 'none', avatar_path: null, banner_path: null,
  status_text: '', presence: 'online', created_at: 0, ...over,
})

const space: Space = {
  id: 'sp', name: 'Banana', description: '', icon_path: null, banner_path: null,
  owner_id: 'me', created_at: 0,
} as Space

const room = {
  id: 'vc', space_id: 'sp', name: 'General', kind: 'voice', position: 0,
} as unknown as Channel

const playing: Activity = { kind: 'game', name: 'Rocket League' } as Activity
const listening: Activity = {
  kind: 'music', name: 'Spotify', details: 'A song', state: 'An artist',
} as Activity

function world(): World {
  const w = emptyWorld(person('me', { display_name: 'Me' }))
  remember(w, person('pingu', { display_name: 'Pingu' }))
  w.spaces = [space]
  w.channels = [room]
  /* Offline draws no line at all, whatever they are doing, so the row would
     say nothing here for a reason that is not the one being tested. */
  w.presence.setHere('pingu', true)
  return w
}

/** Standing in the voice room, as the server describes it. */
function standing(w: World, who = 'pingu') {
  w.voice.set(who, {
    channelId: 'vc', muted: false, deafened: false,
    serverMuted: false, serverDeafened: false, sharing: false,
  })
  return w
}

const row = (u: User, w: World) =>
  renderToStaticMarkup(
    <MemberRow u={u} world={w} space={space} onOpen={() => {}} onWho={() => {}} />,
  )

describe('the line under a name', () => {
  it('says they are in voice', () => {
    const w = standing(world())
    expect(row(person('pingu', { display_name: 'Pingu' }), w)).toContain('In voice')
  })

  it('and does not when they are not', () => {
    expect(row(person('pingu', { display_name: 'Pingu' }), world())).not.toContain('In voice')
  })

  /*
   * The order, which is the whole of the design.
   *
   * Both of these are true at once for most people in a call, so this is not
   * an edge: it is what the row looks like on an ordinary evening.
   */
  it('but a game takes the line instead', () => {
    const w = standing(world())
    w.activities.set('pingu', [playing])
    const drawn = row(person('pingu', { display_name: 'Pingu' }), w)
    expect(drawn).toContain('Rocket League')
    expect(drawn).not.toContain('In voice')
  })

  it('and so does music', () => {
    const w = standing(world())
    w.activities.set('pingu', [listening])
    const drawn = row(person('pingu', { display_name: 'Pingu' }), w)
    expect(drawn).toContain('Spotify')
    expect(drawn).not.toContain('In voice')
  })

  /* And it beats the sentence they wrote, for the reason a game does: one is
     true now and the other was true whenever they last thought about it. */
  it('while beating what they wrote about themselves', () => {
    const w = standing(world())
    const drawn = row(person('pingu', { display_name: 'Pingu', status_text: 'I dont know' }), w)
    expect(drawn).toContain('In voice')
    expect(drawn).not.toContain('I dont know')
  })

  /*
   * A room this account cannot see is not in world.voice at all - the server
   * filters the occupancy per client through canAccessChannel before sending
   * it. So there is nothing to hide here, and this is the assertion that says
   * the client is not making a second, weaker copy of that rule.
   */
  it('and says nothing about somebody the server never mentioned', () => {
    const w = world()
    expect(row(person('osiris', { display_name: 'Osiris' }), w)).not.toContain('In voice')
  })
})

const quiet = new Api({
  fetch: (async () => ({
    ok: true, status: 200, json: async () => ({ spaces: [], friends: [] }),
  })) as unknown as typeof fetch,
})

const card = (w: World, over: Partial<Parameters<typeof Profile>[0]> = {}) =>
  renderToStaticMarkup(
    <Profile
      user={w.people.get('pingu')!}
      server={quiet} world={w} space={space} anchor={null} phone={false}
      activities={[]} onClose={() => {}}
      {...over}
    />,
  )

describe('the section on their card', () => {
  it('names the room and the server it is in', () => {
    const drawn = card(standing(world()))
    expect(drawn).toContain('In voice')
    expect(drawn).toContain('General')
    expect(drawn).toContain('in Banana')
  })

  it('and is not there when they are not in one', () => {
    expect(card(world())).not.toContain('In voice')
  })

  /*
   * A room this client has never heard of is a room not to talk about.
   *
   * It should not happen - the same filter that decides the occupancy
   * decides the channel list - but "should not happen" is how a name gets
   * drawn from an id nobody checked.
   */
  it('and says nothing about a room it does not know', () => {
    const w = world()
    w.channels = []
    standing(w)
    expect(card(w)).not.toContain('In voice')
  })

  /* Absent rather than inert: Shell hands the callback over only when
     pressing it would actually take you somewhere. */
  it('offers a way in when there is one', () => {
    expect(card(standing(world()), { onOpenVoice: () => {} })).toContain('Open Voice')
  })

  it('and no button at all when there is not', () => {
    expect(card(standing(world()))).not.toContain('Open Voice')
  })
})
