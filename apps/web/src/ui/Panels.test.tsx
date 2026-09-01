import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { drawn } from './mount'
import { PinRow, Pins } from './Pins'
import { Row } from './Friends'
import { Search } from './Search'
import { emptyWorld, remember, type World } from '../lib/world'
import type { Api } from '../lib/api'
import type { User } from '../lib/wire'
import { renderOptions } from './Messages'

const user = (id: string, over: Partial<User> = {}): User => ({
  id, username: id, discriminator: '0001', verified: 0, display_name: id,
  bio: '', accent: '', accent_2: '', name_font: 'default',
  name_effect: 'none', avatar_path: null, banner_path: null,
  status_text: '', presence: 'online', created_at: 0, ...over,
})

function world(): World {
  const w = emptyWorld(user('me'))
  remember(w, user('pat', { display_name: 'Pat' }))
  return w
}

/* Never called during a static render — effects do not run — but the panels
   take one, and a stub says so without pretending to answer. */
const server = { get: async () => ({}), post: async () => ({}) } as unknown as Api

const noop = () => {}

/* Mounted: the panel is drawn over the window through a portal. */
const pins = (canUnpin: boolean) => drawn(
  <Pins server={server} world={world()} space={null} phone={false}
    channelId="c1" canUnpin={canUnpin}
    onGoto={noop} onUnpin={noop} onClose={noop} />,
)

const pinned = {
  id: 'm1', channel_id: 'c1', author_id: 'pat', body: 'read this', created_at: 1,
  edited_at: null, deleted_at: null, kind: 'text' as const, reply_to: null,
  pinned_at: 2, reactions: [], attachments: [],
}

/* The row, with something in it. Asked of the panel, both directions passed —
   one because the button was gated and the other because a static render has
   no rows at all, which is the same green for opposite reasons. */
const row = (canUnpin: boolean) => renderToStaticMarkup(
  <PinRow message={pinned} who="Pat" canUnpin={canUnpin}
    options={renderOptions(world(), null, true)}
    onGoto={noop} onUnpin={noop} onOpen={noop} />,
)

describe('the pins panel', () => {
  /*
   * Unpinning takes a permission, and a gated control is absent rather than
   * greyed — so its absence has to be the permission and not an oversight,
   * which is only checkable if both directions are asserted.
   */
  it('offers unpinning to somebody who may', () => {
    expect(row(true)).toContain('Unpin')
  })

  it('and not to somebody who may not', () => {
    const out = row(false)
    expect(out).not.toContain('Unpin')
    /* And is otherwise the same row — the assertion above is worth nothing
       if it passed because nothing was drawn. */
    expect(out).toContain('read this')
    expect(out).toContain('Jump to it')
  })

  /* Reading, rather than empty: a panel that says "nothing is pinned" before
     it has asked tells somebody something untrue and then corrects itself. */
  it('and says it is reading before it has an answer', () => {
    const out = pins(true)
    expect(out).toContain('Reading')
    expect(out).not.toContain('Nothing is pinned')
  })
})

describe('the search panel', () => {
  const draw = () => renderToStaticMarkup(
    <Search server={server} world={world()} onGoto={noop} onClose={noop} />,
  )

  /* One letter matches most of everything, and the route refuses it anyway —
     so the box says what it wants rather than looking broken. */
  it('asks for two letters rather than searching for one', () => {
    expect(draw()).toContain('Two letters or more')
  })

  /* The server decides what an account can reach, on every result: being able
     to see a channel and being allowed to read what was said before you
     arrived are different questions, and it asks both. A client that filtered
     as well would be a second opinion, and the one on screen would be the one
     that was wrong. */
  it('and filters nothing itself', () => {
    const src = readFileSync(join(__dirname, 'Search.tsx'), 'utf8')
    expect(src).not.toMatch(/results.*\.filter\(/)
  })
})

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('the friends page', () => {
  const friend = (id: string, state: 'accepted' | 'incoming' | 'outgoing') =>
    ({ ...user(id, { display_name: id }), state })

  const rows = (tab: 'online' | 'all' | 'pending' | 'sent', state: 'accepted' | 'incoming' | 'outgoing') =>
    renderToStaticMarkup(
      <Row friend={friend('pat', state)} tab={tab} here onOpenDm={noop}
        onAccept={noop} onRemove={noop} onWho={noop} />,
    )

  /*
   * Somebody waiting on you and somebody you are waiting on are different
   * things to be looking at, and the same row for both offers Accept on a
   * request you sent — a button that answers your own message.
   */
  it('offers accepting only on what came in', () => {
    expect(rows('pending', 'incoming')).toContain('Accept')
    expect(rows('sent', 'outgoing')).not.toContain('Accept')
  })

  it('and taking back only on what went out', () => {
    expect(rows('sent', 'outgoing')).toContain('Take it back')
    expect(rows('pending', 'incoming')).not.toContain('Take it back')
  })

  /* An accepted friend is somebody to talk to, so their row is the way in. */
  it('and a friend is a way into a conversation', () => {
    const out = rows('all', 'accepted')
    expect(out).toContain('Message')
    expect(out).not.toContain('Accept')
  })
})
