import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { conversations } from '../lib/dms'
import { apply, emptyWorld, type World } from '../lib/world'
import type { Message, User } from '../lib/wire'

/**
 * Conversations, newest first.
 *
 * The sorting was right from the start and never ran twice. `world` is one
 * mutable object changed in place - deliberately, because copying it on every
 * presence tick is the cost this app cannot afford - so its identity never
 * moves, and `useMemo(..., [world])` computed the list once and froze it for
 * the session. A DM somebody had just been talking in stayed wherever it was.
 *
 * Two halves, and both are tested, because either alone passes while the
 * feature is broken: the sort is correct, and the thing that draws it is told
 * when to sort again.
 */

const me: User = {
  id: 'me', username: 'me', discriminator: '0001', verified: 0,
  display_name: 'Me', bio: '', accent: '', accent_2: '',
  name_font: 'default', name_effect: 'none', avatar_path: null, banner_path: null,
  status_text: '', presence: 'online', created_at: 0,
}

function twoChats(): World {
  const w = emptyWorld(me)
  w.dms = [
    { id: 'd1', others: [], group: false } as never,
    { id: 'd2', others: [], group: false } as never,
  ]
  w.lastAt.set('d1', 2000)
  w.lastAt.set('d2', 1000)
  return w
}

const said = (channel: string, at: number, from = 'them'): Message => ({
  id: `m-${at}`, channel_id: channel, author_id: from, body: 'hello',
  created_at: at, edited_at: null, pinned_at: null, kind: 'text',
  reactions: [], attachments: [],
} as never)

describe('the order conversations come in', () => {
  it('is newest first', () => {
    expect(conversations(twoChats()).map((c) => c.id)).toEqual(['d1', 'd2'])
  })

  /* A message arriving lifts its conversation, whether or not anybody has
     opened it - which is why lastAt is kept for every channel rather than
     read off the messages, which are only held for channels somebody read. */
  it('and a message arriving lifts that conversation to the top', () => {
    const w = twoChats()
    apply(w, { t: 'message', message: said('d2', 3000) } as never)
    expect(conversations(w).map((c) => c.id)).toEqual(['d2', 'd1'])
  })

  /* Your own message counts too: sending something is being in the
     conversation, and it should come with you. */
  it('and one you sent yourself lifts it just the same', () => {
    const w = twoChats()
    apply(w, { t: 'message', message: said('d2', 3000, 'me') } as never)
    expect(conversations(w).map((c) => c.id)).toEqual(['d2', 'd1'])
  })

  /* A call writes an ordinary message into the conversation, so it travels
     the same path and needs no rule of its own. */
  it('and a call, which arrives as a message like any other', () => {
    const w = twoChats()
    apply(w, {
      t: 'message',
      message: { ...said('d2', 4000, 'me'), kind: 'call' },
    } as never)
    expect(conversations(w)[0]?.id).toBe('d2')
  })
})

describe('and the list that draws them', () => {
  const shell = readFileSync(resolve(process.cwd(), 'src/ui/Shell.tsx'), 'utf8')

  /*
   * The whole bug. Everything above passed while the app was broken, because
   * the sorted list was computed once and never again.
   */
  it('is told when the world changed', () => {
    const at = shell.indexOf('conversations(world)')
    expect(at).toBeGreaterThan(0)
    /* The dependency list follows the call on the same line. */
    const deps = shell.slice(at, at + 60)
    expect(deps, 'the memo does not depend on version').toContain('version')
  })

  /* And version is a number that moves, not something else that happens to
     be in scope. */
  it('and version comes from the world itself', () => {
    expect(shell).toContain('version: number')
  })
})
