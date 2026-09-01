/**
 * Accepting a friend request, end to end through the hook.
 *
 * These mount the real hook against a stubbed socket and a stubbed fetch,
 * rather than checking what `apply` returns. The bug being covered was not in
 * what `apply` decided - it was that nothing carried the decision out:
 * `refetch: 'dms'` was a name in a type that no event produced and no branch
 * honoured, so a pure test of either half would have passed on its own while
 * the conversation still never appeared.
 */
import { describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Api } from '../lib/api'
import type { WebSocketLike } from '../lib/gateway'
import { useWorld } from './useWorld'
import type { World } from '../lib/world'

const me = {
  id: 'me', username: 'me', discriminator: '0001', verified: 0,
  display_name: 'Me', bio: '', accent: '', accent_2: '',
  name_font: 'default', name_effect: 'none', avatar_path: null,
  banner_path: null, status_text: '', presence: 'online',
  created_at: 0,
}
const them = { ...me, id: 'them', username: 'baileyyy', display_name: 'Baileyyy' }

/** The socket the hook opens, held so a test can push frames down it. */
let socket: WebSocketLike

function stubSocket() {
  const s: WebSocketLike = {
    send: () => {}, close: () => {},
    onopen: null, onmessage: null, onclose: null, onerror: null,
  } as unknown as WebSocketLike
  socket = s
  ;(globalThis as { WebSocket?: unknown }).WebSocket = function () { return s }
}

/** What was asked for, and what came back. */
/**
 * What the friend list answers, which a test can change part-way.
 *
 * It has to be changeable: sign-in fetches the same list, and a fixed answer
 * means the person is already known before the event under test arrives - so
 * the test passes whether or not the event did anything.
 */
const friendList = { friends: [] as unknown[], incoming: [] as unknown[], outgoing: [] as unknown[] }

/** The servers, and what is in them, both changeable part-way. */
const worldRows = { spaces: [] as unknown[], channels: [] as unknown[] }

function stubFetch(seen: string[], dms: unknown[]) {
  return (async (url: string) => {
    seen.push(String(url))
    const body =
      String(url).includes('/api/dms') ? { dms }
      : String(url).includes('/api/friends') ? { ...friendList }
      : String(url).includes('/api/channels') ? { channels: worldRows.channels }
      : String(url).includes('/api/spaces') ? { spaces: worldRows.spaces }
      : {}
    return { ok: true, status: 200, json: async () => body } as unknown as Response
  }) as unknown as typeof fetch
}

async function mount(seen: string[], dms: unknown[]) {
  friendList.friends = []; friendList.incoming = []; friendList.outgoing = []
  worldRows.spaces = []; worldRows.channels = []
  stubSocket()
  const server = new Api({ fetch: stubFetch(seen, dms) })
  server.setToken('t')
  let seenWorld: World | null = null

  function Probe() {
    const w = useWorld(server, 't')
    seenWorld = w.world
    return null
  }

  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => { root.render(<Probe />) })

  /* Open, then the frame the server opens with. */
  await act(async () => {
    socket.onopen?.(new Event('open'))
    socket.onmessage?.({ data: JSON.stringify({ t: 'ready', user: me, channels: [], roles: [], assignments: [], users: [] }) } as MessageEvent)
  })
  return { world: () => seenWorld as World | null, root }
}

describe('accepting a friend request', () => {
  it('fetches the conversation the server just opened', async () => {
    const seen: string[] = []
    const { world, root } = await mount(seen, [
      { id: 'dm1', name: 'Baileyyy', members: [{ id: 'me' }, { id: 'them' }], last_at: 5 },
    ])

    seen.length = 0
    await act(async () => {
      socket.onmessage?.({
        data: JSON.stringify({ t: 'friends-changed', user: them, channelId: 'dm1' }),
      } as MessageEvent)
    })

    expect(seen.some((u) => u.includes('/api/dms'))).toBe(true)
    const w = world()
    expect(w?.dms.map((d) => d.id)).toEqual(['dm1'])
    /* And where it sorts, which is what puts it at the top of the list. */
    expect(w?.lastAt.get('dm1')).toBe(5)
    await act(async () => { root.unmount() })
  })

  it('knows who accepted, from the event itself', async () => {
    const seen: string[] = []
    /* A stranger: nothing about them has ever been fetched. */
    const { world, root } = await mount(seen, [])

    await act(async () => {
      socket.onmessage?.({
        data: JSON.stringify({ t: 'friends-changed', user: them, channelId: 'dm1' }),
      } as MessageEvent)
    })

    /* Read straight out of the event. Without this the name is looked up in
       `people`, finds nothing, and draws "Someone" until a reload. */
    expect(world()?.people.get('them')?.display_name).toBe('Baileyyy')
    await act(async () => { root.unmount() })
  })

  it('knows who asked, though the event does not say', async () => {
    /* The request the server pushes carries no user at all - only "something
       about your friends changed". So the name can only come from the list
       that is fetched in answer to it, and that list was being stored without
       anybody in it being remembered. */
    const seen: string[] = []
    const { world, root } = await mount(seen, [])

    /* They only exist from here on - after sign-in has already been and gone. */
    friendList.incoming = [them]
    await act(async () => {
      socket.onmessage?.({ data: JSON.stringify({ t: 'friends-changed' }) } as MessageEvent)
    })

    expect(world()?.people.get('them')?.display_name).toBe('Baileyyy')
    expect(world()?.friends.map((f) => f.state)).toEqual(['incoming'])
    await act(async () => { root.unmount() })
  })

  it('does not ask for conversations when nothing opened one', async () => {
    const seen: string[] = []
    const { root } = await mount(seen, [])

    seen.length = 0
    await act(async () => {
      socket.onmessage?.({ data: JSON.stringify({ t: 'friends-changed' }) } as MessageEvent)
    })

    expect(seen.some((u) => u.includes('/api/dms'))).toBe(false)
    expect(seen.some((u) => u.includes('/api/friends'))).toBe(true)
    await act(async () => { root.unmount() })
  })
})

describe('a server that was not there when the socket opened', () => {
  it('comes up with its channels', async () => {
    const seen: string[] = []
    const { world, root } = await mount(seen, [])
    /* Nothing at sign-in - which is the case: it did not exist yet. */
    expect(world()?.channels).toEqual([])

    worldRows.spaces = [{ id: 's', name: 'Somewhere', owner_id: 'me' }]
    worldRows.channels = [
      { id: 'c1', space_id: 's', name: 'general', kind: 'text', position: 0 },
    ]
    await act(async () => {
      socket.onmessage?.({ data: JSON.stringify({ t: 'spaces-changed' }) } as MessageEvent)
    })

    expect(seen.some((u) => u.includes('/api/channels?spaceId=s'))).toBe(true)
    expect(world()?.channels.map((c) => c.id)).toEqual(['c1'])
    await act(async () => { root.unmount() })
  })

  it('and asks nothing for the servers it already knows', async () => {
    /* Every other way a channel list changes carries the change with it, so
       asking again here would be one request per server every time anybody
       renamed one - for an answer already held. */
    const seen: string[] = []
    const { world, root } = await mount(seen, [])

    worldRows.spaces = [{ id: 's', name: 'Somewhere', owner_id: 'me' }]
    worldRows.channels = [{ id: 'c1', space_id: 's', name: 'general', kind: 'text', position: 0 }]
    await act(async () => {
      socket.onmessage?.({ data: JSON.stringify({ t: 'spaces-changed' }) } as MessageEvent)
    })

    seen.length = 0
    await act(async () => {
      socket.onmessage?.({ data: JSON.stringify({ t: 'space-update' }) } as MessageEvent)
    })

    expect(seen.filter((u) => u.includes('/api/channels'))).toEqual([])
    /* And what was known is still known. */
    expect(world()?.channels.map((c) => c.id)).toEqual(['c1'])
    await act(async () => { root.unmount() })
  })
})
