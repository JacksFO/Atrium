/**
 * What two people have in common, in the panel beside a conversation.
 *
 * Mounted for real and re-rendered, not rendered once to a string. The thing
 * being added is a fetch inside a component that sits behind three early
 * returns, and a hook in the wrong place survives a single render perfectly
 * well - it fails on the second one.
 */
import { describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Api } from '../lib/api'
import { PeerCard } from './Shell'
import { emptyWorld } from '../lib/world'
import type { User } from '../lib/wire'

const person = (id: string, name: string): User => ({
  id, username: name, discriminator: '0001', verified: 0, display_name: name,
  bio: '', accent: '', accent_2: '', name_font: 'default',
  name_effect: 'none', avatar_path: null, banner_path: null,
  status_text: '', presence: 'online', created_at: 0,
})

function serverThatSays(body: unknown, seen: string[]) {
  const s = new Api({
    fetch: (async (url: string) => {
      seen.push(String(url))
      return { ok: true, status: 200, json: async () => body } as unknown as Response
    }) as unknown as typeof fetch,
  })
  s.setToken('t')
  return s
}

async function draw(body: unknown, seen: string[], peer = person('them', 'Baileyyy')) {
  const world = emptyWorld(person('me', 'Me'))
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => {
    root.render(
      <PeerCard server={serverThatSays(body, seen)} world={world}
        peer={peer} grip={null} onOpen={() => {}} />,
    )
  })
  return { host, root, world }
}

describe('the panel beside a conversation', () => {
  it('asks the server what the two of you have in common', async () => {
    const seen: string[] = []
    const { root } = await draw({ spaces: [], friends: [] }, seen)
    expect(seen.some((u) => u.includes('/api/users/them/mutual'))).toBe(true)
    await act(async () => { root.unmount() })
  })

  it('names the servers it is told about, not the ones it has visited', async () => {
    /* Nothing has been loaded into this world at all - no roster, no
       membership. The old count was worked out from exactly that and would
       have said none. */
    const seen: string[] = []
    const { host, root } = await draw({
      spaces: [{ id: 's1', name: 'Somewhere', icon_path: null, banner_path: null }],
      friends: [],
    }, seen)

    expect(host.textContent).toContain('1 mutual server')
    expect(host.textContent).toContain('Somewhere')
    await act(async () => { root.unmount() })
  })

  it('and the people you both know, which it never showed', async () => {
    const seen: string[] = []
    const { host, root } = await draw({
      spaces: [],
      friends: [
        { id: 'f1', username: 'papapk', display_name: 'papapk', avatar_path: null },
        { id: 'f2', username: 'morticia', display_name: 'Morticia', avatar_path: null },
      ],
    }, seen)

    expect(host.textContent).toContain('2 mutual friends')
    expect(host.textContent).toContain('Morticia')
    await act(async () => { root.unmount() })
  })

  it('says nothing at all when there is nothing in common', async () => {
    const seen: string[] = []
    const { host, root } = await draw({ spaces: [], friends: [] }, seen)
    expect(host.textContent).not.toContain('mutual')
    await act(async () => { root.unmount() })
  })

  it('survives being drawn again for somebody else', async () => {
    /* The re-render a hook in the wrong place would fail on - and the answer
       must follow the person, not stay on the first one asked about. */
    const seen: string[] = []
    const world = emptyWorld(person('me', 'Me'))
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)

    const srv = new Api({
      fetch: (async (url: string) => {
        seen.push(String(url))
        const body = String(url).includes('them')
          ? { spaces: [{ id: 's1', name: 'Somewhere', icon_path: null, banner_path: null }], friends: [] }
          : { spaces: [{ id: 's2', name: 'Attic', icon_path: null, banner_path: null }], friends: [] }
        return { ok: true, status: 200, json: async () => body } as unknown as Response
      }) as unknown as typeof fetch,
    })
    srv.setToken('t')

    const show = async (p: User) => {
      await act(async () => {
        root.render(<PeerCard server={srv} world={world} peer={p} grip={null} onOpen={() => {}} />)
      })
    }

    await show(person('them', 'Baileyyy'))
    expect(host.textContent).toContain('Somewhere')

    await show(person('other', 'papapk'))
    expect(host.textContent).toContain('Attic')
    expect(host.textContent).not.toContain('Somewhere')

    await act(async () => { root.unmount() })
  })
})
