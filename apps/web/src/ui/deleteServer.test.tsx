import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ServerPane } from './ServerSettings'
import { emptyWorld, type World } from '../lib/world'
import type { Api } from '../lib/api'
import type { Space, User } from '../lib/wire'

/**
 * Ending a server.
 *
 * The route has existed as long as servers have and nothing called it, so a
 * server made by mistake stayed for ever.
 *
 * Typing the name is not ceremony. This deletes every channel, message and
 * role in it for everybody who was in it, and there is no undoing it - so the
 * confirmation has to be something that cannot be done by reflex.
 */

const me: User = {
  id: 'me', username: 'me', discriminator: '0001', verified: 0, display_name: 'Me',
  bio: '', accent: '', accent_2: '', name_font: 'default',
  name_effect: 'none', avatar_path: null, banner_path: null,
  status_text: '', presence: 'online', created_at: 0,
}
const space = (owner: string): Space =>
  ({ id: 's1', name: 'Somewhere', description: '', icon_path: null, banner_path: null,
     owner_id: owner, created_at: 0 } as Space)

function world(): World { return emptyWorld(me) }

let root: Root | null = null
let host: HTMLDivElement | null = null
function draw(node: React.ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root!.render(node) })
  return host
}
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = null; host = null })

const settings = (over: Record<string, unknown> = {}, owner = 'me') => (
  /* The overview pane, which is the one deleting lives on. It was reached
     through the server's own settings window; that window is gone and the
     panes are in the one settings window now, so the pane is rendered
     directly rather than through a nav that no longer exists here. */
  <ServerPane
    id="overview"
    server={{ get: async () => ({}), delete: vi.fn(async () => ({})) } as unknown as Api}
    world={world()} space={space(owner)}
    permissions={['manage_space']} onClose={() => {}} onChanged={() => {}}
    {...over} />
)

const type = (box: HTMLInputElement, text: string) => {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype, 'value')!.set!
  act(() => {
    setter.call(box, text)
    box.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const danger = () => document.querySelector('.card.danger')
const byText = (t: string) =>
  [...document.querySelectorAll('button')].find((b) => b.textContent?.includes(t))

describe('deleting a server', () => {
  it('is offered to whoever made it', () => {
    draw(settings())
    expect(danger()).not.toBeNull()
    expect(danger()!.textContent).toContain('Delete Somewhere')
  })

  /*
   * Not manage_space. Somebody can be given that to help run a server, and
   * that is not the same as being handed the ability to end it.
   */
  it('and not to somebody who merely manages it', () => {
    draw(settings({}, 'somebody-else'))
    expect(danger()).toBeNull()
  })

  it('and asks for the name before it will', () => {
    draw(settings())
    act(() => { byText('Delete Somewhere')!.click() })
    const go = byText('Delete for everybody')!
    expect(go.disabled).toBe(true)
  })

  it('and refuses a name that is not the name', () => {
    draw(settings())
    act(() => { byText('Delete Somewhere')!.click() })
    type(document.querySelector('.card.danger input') as HTMLInputElement, 'basement!')
    expect(byText('Delete for everybody')!.disabled).toBe(true)
  })

  it('but goes when it is', async () => {
    const del = vi.fn(async () => ({}))
    draw(settings({ server: { get: async () => ({}), delete: del } as unknown as Api }))
    act(() => { byText('Delete Somewhere')!.click() })
    type(document.querySelector('.card.danger input') as HTMLInputElement, 'Somewhere')

    expect(byText('Delete for everybody')!.disabled).toBe(false)
    await act(async () => { byText('Delete for everybody')!.click() })
    expect(del).toHaveBeenCalledWith('/api/spaces/s1')
  })

  /* Somebody who pasted the name has not made a different decision from
     somebody who typed it. */
  it('and accepts it with stray spaces round it', () => {
    draw(settings())
    act(() => { byText('Delete Somewhere')!.click() })
    type(document.querySelector('.card.danger input') as HTMLInputElement, '  Somewhere  ')
    expect(byText('Delete for everybody')!.disabled).toBe(false)
  })
})

describe('and the route behind it', () => {
  it('is the owner-only one', () => {
    const routes = readFileSync(
      resolve(process.cwd(), '../server/src/routes/spaces.ts'), 'utf8')
    const at = routes.indexOf("app.delete('/api/spaces/:id'")
    expect(at).toBeGreaterThan(0)
    expect(routes.slice(at, at + 900)).toContain('space.owner_id !== user.id')
  })
})
