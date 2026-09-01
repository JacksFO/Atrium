import { Api } from '../lib/api'
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Profile } from './Profile'
import { emptyWorld, remember, type World } from '../lib/world'
import type { Role, Space, User } from '../lib/wire'

/* Nothing in common, so these stay about what they were about. */
const quiet = new Api({
  fetch: (async () => ({
    ok: true, status: 200, json: async () => ({ spaces: [], friends: [] }),
  })) as unknown as typeof fetch,
})

const user = (id: string, over: Partial<User> = {}): User => ({
  id, username: id, discriminator: '0001', verified: 0, display_name: id,
  bio: '', accent: '', accent_2: '', name_font: 'default',
  name_effect: 'none', avatar_path: null, banner_path: null,
  status_text: '', presence: 'online', created_at: 0, ...over,
})
const space: Space = {
  id: 'sp', name: 'Home', description: '', icon_path: null, banner_path: null,
  owner_id: 'owner', created_at: 0,
}
const role = (over: Partial<Role> & { id: string }): Role => ({
  space_id: 'sp', name: over.id, colour: '', position: 0, permissions: '[]',
  kind: 'custom', hoist: 0, created_at: 0, ...over,
})

function world(): World {
  const w = emptyWorld(user('me', { display_name: 'Me' }))
  remember(w, user('pat', { display_name: 'Pat' }))
  w.spaces = [space]
  w.roles = [
    role({ id: 'squadron', name: 'Squadron', colour: '#6FA8FF', position: 5 }),
    role({ id: 'everyone', name: 'Regulars', kind: 'everyone', position: 0 }),
  ]
  w.assignments = [{ user_id: 'pat', role_id: 'squadron' }]
  /* Who is actually in it. Shared servers used to be worked out from whether
     a server had roles at all, which is true of every server — so every
     server was listed as shared with everybody. */
  w.membersBySpace.set(space.id, new Set(['me', 'pat']))
  return w
}

/** Mounted for real, with the server's answer already in hand. */
async function drawn(who: User, w: World, says: unknown, sp: Space | null = space) {
  const srv = new Api({
    fetch: (async () => ({
      ok: true, status: 200, json: async () => says,
    })) as unknown as typeof fetch,
  })
  srv.setToken('t')
  const host = document.createElement('div')
  document.body.appendChild(host)
  await act(async () => {
    createRoot(host).render(
      <Profile user={who} server={srv} world={w} space={sp} anchor={null} phone
        activities={[]} onClose={() => {}} />,
    )
  })
  return host
}

const html = (who: User, w = world(), sp: Space | null = space) =>
  renderToStaticMarkup(
    <Profile user={who} server={quiet} world={w} space={sp} anchor={null} phone
      activities={[]} onClose={() => {}} />,
  )

describe('whose card it is', () => {
  it('shows the name they are known by here, and their account name under it', () => {
    /* "Here" is this server, and the card knows which one it was opened in.
       The nickname lives beside the records rather than on them - putting it
       on the row is what made one name follow somebody everywhere. */
    const w = world()
    w.nicknames.set(space.id, new Map([['pat', 'Patricia']]))
    const out = html(user('pat', { display_name: 'Pat' }), w)
    expect(out).toContain('Patricia')
    expect(out).toContain('@pat')
  })

  /* And not in a conversation, which belongs to no server. */
  it('and their own name where there is no server to have renamed them', () => {
    const w = world()
    w.nicknames.set(space.id, new Map([['pat', 'Patricia']]))
    const out = html(user('pat', { display_name: 'Pat' }), w, null)
    expect(out).toContain('Pat')
    expect(out).not.toContain('Patricia')
  })

  it('paints the name in their highest coloured role', () => {
    const out = html(user('pat', { display_name: 'Pat' }))
    expect(out).toContain('#6FA8FF')
  })

  it('and lists the roles they hold', () => {
    expect(html(user('pat'))).toContain('Squadron')
  })

  /* Nothing of their own, so what they are is what everybody is — named from
     the server's own @everyone, because a server that renamed it meant it. */
  it('falls back to what everybody is, by the name that server gave it', () => {
    const w = world()
    w.assignments = []
    expect(html(user('pat'), w)).toContain('Regulars')
  })
})

describe('your own card', () => {
  /* "Mutual servers" is a fact about two people and there is only one here:
     every server you are in is trivially one you share with yourself. */
  it('does not offer you a list of servers you share with yourself', () => {
    const w = world()
    expect(html(w.me, w)).not.toMatch(/servers? you share/i)
  })

  /*
   * Mounted rather than rendered to a string, because what you share is now
   * fetched. It used to be worked out from the rosters this client happened
   * to hold, which only covers servers somebody had already opened - so the
   * list on a card was a list of the servers you share AND had visited.
   */
  it('while the card of somebody else can', async () => {
    /* And from a world that has never loaded that server's roster, which is
       every server nobody has opened yet - the case the old computation got
       wrong by answering "none". */
    const w = world()
    w.membersBySpace.clear()
    const host = await drawn(user('pat'), w, {
      spaces: [{ id: 'sp', name: 'Regulars', icon_path: null, banner_path: null }], friends: [],
    })
    expect(host.textContent ?? '').toMatch(/servers? you share/i)
  })

  it('and the people you both know', async () => {
    const host = await drawn(user('pat'), world(), {
      spaces: [],
      friends: [{ id: 'f1', username: 'morticia', display_name: 'Morticia', avatar_path: null }],
    })
    expect(host.textContent ?? '').toContain('Morticia')
  })

  /* And only the ones actually shared. Somebody in none of your servers —
     a friend, or whoever wrote a message you can see — shares none. */
  it('and lists none for somebody you share nothing with', async () => {
    const w = world()
    remember(w, user('stranger', { display_name: 'Stranger' }))
    const host = await drawn(user('stranger'), w, { spaces: [], friends: [] })
    expect(host.textContent ?? '').not.toMatch(/servers? you share/i)
  })
})

describe('what they wrote about themselves', () => {
  /* Their own words, so anything in them is drawn as words. */
  it('cannot open a tag', () => {
    const out = html(user('pat', { bio: '<img src=x onerror=alert(1)>' }))
    expect(out).not.toContain('<img src=x')
    expect(out).toContain('&lt;img')
  })

  it('is drawn as the markdown it is', () => {
    expect(html(user('pat', { bio: '**hello**' }))).toContain('<b>hello</b>')
  })

  it('and nothing is drawn when there is nothing', () => {
    expect(html(user('pat'))).not.toContain('class="pab"')
  })
})

describe('outside a server', () => {
  it('says nothing about roles, because there are none to have', () => {
    const out = html(user('pat'), world(), null)
    expect(out).not.toContain('>Roles<')
    expect(out).not.toContain('Squadron')
  })
})
