import { Api } from '../lib/api'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Profile } from './Profile'
import { MemberRow } from './Shell'
import { emptyWorld, type World } from '../lib/world'
import type { User } from '../lib/wire'

/* Nothing in common, so these stay about what they were about. */
const quiet = new Api({
  fetch: (async () => ({
    ok: true, status: 200, json: async () => ({ spaces: [], friends: [] }),
  })) as unknown as typeof fetch,
})

/**
 * Saying something from somebody's card.
 *
 * The card is where you decide to say something, so it is where you can say
 * it. A button that takes you somewhere else to start typing loses the
 * sentence you already had in your head.
 *
 * The stylesheet has had a section headed "writing to somebody from their
 * card" for a while with a comment in it and no rules - the idea was written
 * down and never built.
 */

const person = (id: string, over: Partial<User> = {}): User => ({
  id, username: id, discriminator: '0001', verified: 0, display_name: id,
  bio: '', accent: '', accent_2: '', name_font: 'default',
  name_effect: 'none', avatar_path: null, banner_path: null,
  status_text: '', presence: 'online', created_at: 0, ...over,
})

function world(): World {
  const w = emptyWorld(person('me'))
  w.people.set('them', person('them', { display_name: 'Morticia' }))
  return w
}

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


/**
 * Type into a controlled input the way a person does.
 *
 * Setting .value and firing an input event is not enough: React tracks the
 * value through its own setter and treats a value it did not see change as
 * not having changed, so onChange never runs and the test watches a box that
 * never filled in. The native setter is what it is watching.
 */
function type(box: HTMLInputElement, text: string) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype, 'value')!.set!
  act(() => {
    setter.call(box, text)
    box.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const card = (over: Record<string, unknown> = {}) => (
  <Profile server={quiet} user={person('them', { display_name: 'Morticia' })} world={world()}
    space={null} anchor={null} phone={false} activities={[]}
    onClose={() => {}} {...over} />
)

const someSpace = {
  id: 'sp', name: 'Somewhere', description: '', icon_path: null, banner_path: null,
  owner_id: 'me', created_at: 0,
} as unknown as Parameters<typeof MemberRow>[0]['space']

describe('the box on a card', () => {
  it('names who it is for', () => {
    const el = draw(card({ onSay: async () => {} }))
    const box = el.querySelector('.saybox input') as HTMLInputElement
    expect(box).not.toBeNull()
    expect(box.placeholder).toBe('Message Morticia')
  })

  /* Talking to yourself is not a feature. */
  it('and is not on your own card', () => {
    const w = world()
    const el = draw(
      <Profile server={quiet} user={w.me} world={w} space={null} anchor={null} phone={false}
        activities={[]} onClose={() => {}} onSay={async () => {}} />,
    )
    expect(el.querySelector('.saybox')).toBeNull()
  })

  /* Nor where there is nothing to send with - a box that cannot send is a
     box that lies about what pressing Enter will do. */
  it('and not where there is no way to send', () => {
    const el = draw(card())
    expect(el.querySelector('.saybox')).toBeNull()
  })

  /* An enabled button beside an empty box is a button that does nothing. */
  it('and offers no send button until there is something to send', () => {
    const el = draw(card({ onSay: async () => {} }))
    expect(el.querySelector('.saybox button')).toBeNull()

    const box = el.querySelector('.saybox input') as HTMLInputElement
    type(box, 'hello')
    expect(el.querySelector('.saybox button')).not.toBeNull()
  })

  it('sends what was typed', async () => {
    const onSay = vi.fn(async () => {})
    const el = draw(card({ onSay }))
    const box = el.querySelector('.saybox input') as HTMLInputElement
    type(box, '  hello there  ')
    await act(async () => {
      el.querySelector('.saybox')!.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }))
    })
    /* Trimmed: a message that is only spaces is not a message. */
    expect(onSay).toHaveBeenCalledWith('hello there')
  })

  it('and nothing at all when it is only spaces', async () => {
    const onSay = vi.fn(async () => {})
    const el = draw(card({ onSay }))
    const box = el.querySelector('.saybox input') as HTMLInputElement
    type(box, '   ')
    await act(async () => {
      el.querySelector('.saybox')!.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }))
    })
    expect(onSay).not.toHaveBeenCalled()
  })

  /* A refusal has to be visible. Closing the card on a failure would lose
     both the message and the reason. */
  it('and says so when it would not send, keeping the words', async () => {
    const onClose = vi.fn()
    const el = draw(card({
      onSay: async () => { throw new Error('They are not accepting messages.') },
      onClose,
    }))
    const box = el.querySelector('.saybox input') as HTMLInputElement
    type(box, 'hello')
    await act(async () => {
      el.querySelector('.saybox')!.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }))
    })
    expect(el.textContent).toContain('They are not accepting messages.')
    expect(onClose).not.toHaveBeenCalled()
    expect((el.querySelector('.saybox input') as HTMLInputElement).value).toBe('hello')
  })
})

describe('what it is wired to', () => {
  const shell = readFileSync(resolve(process.cwd(), 'src/ui/Shell.tsx'), 'utf8')

  /* There may be no conversation yet - saying something to somebody for the
     first time is exactly the case this is for. */
  it('opens the conversation first, then sends into it', () => {
    const at = shell.indexOf('onSay={async (body)')
    expect(at).toBeGreaterThan(0)
    const body = shell.slice(at, at + 700)
    expect(body).toContain("'/api/dms'")
    expect(body.indexOf("'/api/dms'")).toBeLessThan(body.indexOf("t: 'send'"))
  })
})

/**
 * Their status, whether or not they are here.
 *
 * A member list hides it when somebody is offline, and should: a column of
 * yesterday's statuses beside forty grey dots says nothing about who is about
 * to read what you write. A profile is the opposite - you opened it to find
 * out about them, and "back in an hour" is exactly the thing you came for.
 */
describe('the status on a card', () => {
  it('shows even when they are offline', () => {
    const w = world()
    const them = person('them', { display_name: 'Morticia', status_text: 'back in an hour' })
    w.people.set('them', them)
    w.presence.setHere('them', false)

    const el = draw(
      <Profile server={quiet} user={them} world={w} space={null} anchor={null} phone={false}
        activities={[]} onClose={() => {}} />,
    )
    expect(el.textContent).toContain('back in an hour')
  })

  /*
   * And a member list still does not, which is the other half of the ask.
   *
   * Asked of the row rather than of the text of Shell.tsx. This read the
   * source for one expression, so rewording the line it was checking failed
   * the test while the behaviour was untouched - and, worse, the same test
   * would have passed on a row that had stopped drawing anything at all.
   */
  it('and the member list still hides it while they are away', () => {
    const w = world()
    const them = person('them', { display_name: 'Morticia', status_text: 'back in an hour' })
    w.people.set('them', them)
    w.presence.setHere('them', false)

    const away = draw(
      <MemberRow u={them} world={w} space={someSpace} onOpen={() => {}} onWho={() => {}} />,
    )
    expect(away.textContent).not.toContain('back in an hour')

    /* And shows it when they are here, so this cannot pass by drawing nothing. */
    w.presence.setHere('them', true)
    const here = draw(
      <MemberRow u={them} world={w} space={someSpace} onOpen={() => {}} onWho={() => {}} />,
    )
    expect(here.textContent).toContain('back in an hour')
  })
})
