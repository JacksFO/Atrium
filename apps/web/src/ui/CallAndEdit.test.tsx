import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CallRow, callSaid, howLong } from './CallRow'
import { MessageEditor } from './MessageEditor'
import type { Message, User } from '../lib/wire'

/**
 * A call, and editing where the message is.
 *
 * The server has written call rows all along — a `call` message carrying when
 * it ended and whether it was ever picked up — and this client drew them as
 * ordinary messages, which with an empty body is a blank line where a call
 * should be.
 */

const me: User = {
  id: 'me', username: 'me', discriminator: '0001', verified: 0,
  display_name: 'Me', bio: '', accent: '', accent_2: '',
  name_font: 'default', name_effect: 'none', avatar_path: null,
  banner_path: null, status_text: '', presence: 'online',
  created_at: 0,
}
const them: User = { ...me, id: 'pat', username: 'pat', display_name: 'Pat' }

const call = (over: Partial<Message> = {}): Message => ({
  id: 'c1', channel_id: 'd1', author_id: 'pat', body: '',
  created_at: 1_000_000, edited_at: null, deleted_at: null, kind: 'call',
  reply_to: null, pinned_at: null, reactions: [], attachments: [],
  call_ended_at: null, call_missed: 1, ...over,
})

let root: Root | null = null
let host: HTMLDivElement | null = null
afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = null; host = null
})
function mount(ui: React.ReactNode) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => { root?.render(ui) })
  return host
}

describe('how long a call went on', () => {
  /* Not a stopwatch: nobody wants to know a call was 00:11, they want to
     know it barely happened. */
  it('is said the way a person would say it', () => {
    expect(howLong(11_000)).toBe('a few seconds')
    expect(howLong(60_000)).toBe('about a minute')
    expect(howLong(9 * 60_000)).toBe('9 minutes')
    expect(howLong(60 * 60_000)).toBe('an hour')
    expect(howLong(95 * 60_000)).toBe('1h 35m')
  })
})

describe('what a call row says', () => {
  it('while it is still going', () => {
    expect(callSaid(call(), 'Pat', false)).toBe('Pat started a call.')
  })

  /* The person who started it reads "you", so it does not tell them somebody
     else is calling when it is them. */
  it('and to the person who started it', () => {
    expect(callSaid(call(), 'You', true)).toBe('You started a call.')
  })

  it('and when nobody picked up', () => {
    const m = call({ call_ended_at: 1_010_000, call_missed: 1 })
    expect(callSaid(m, 'Pat', false)).toBe('Missed call from Pat.')
    expect(callSaid(m, 'You', true)).toBe('No answer.')
  })

  it('and when it happened', () => {
    const m = call({ call_ended_at: 1_000_000 + 9 * 60_000, call_missed: 0 })
    expect(callSaid(m, 'Pat', false)).toBe('Pat started a call that lasted 9 minutes.')
  })
})

describe('walking into a call from its row', () => {
  /* Offered, never taken: opening the app on a second device should not drag
     you into a call nobody asked it to join. */
  it('offers a way in while the call is open', () => {
    const onJoin = vi.fn()
    const el = mount(
      <CallRow message={call()} author={them} me={me} canJoin onJoin={onJoin} />,
    )
    const join = el.querySelector('.calljoin') as HTMLElement
    expect(join?.textContent).toBe('Join call')
    act(() => { join.click() })
    expect(onJoin).toHaveBeenCalled()
  })

  it('but not once it is over', () => {
    const el = mount(
      <CallRow message={call({ call_ended_at: 1_010_000, call_missed: 0 })}
        author={them} me={me} canJoin onJoin={vi.fn()} />,
    )
    expect(el.querySelector('.calljoin')).toBe(null)
  })

  /* And not when nothing was offered — a button that cannot do what it says
     is worse than no button. */
  it('and not when there is nothing to join', () => {
    const el = mount(<CallRow message={call()} author={them} me={me} />)
    expect(el.querySelector('.calljoin')).toBe(null)
  })
})

describe('editing a message where the message is', () => {
  it('starts with what was written, and saves it changed', () => {
    const onSave = vi.fn()
    const el = mount(
      <MessageEditor body="hello" onSave={onSave} onCancel={vi.fn()} />,
    )
    const box = el.querySelector('textarea') as HTMLTextAreaElement
    expect(box.value).toBe('hello')
    const setValue = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype, 'value',
    )?.set as (v: string) => void
    act(() => {
      setValue.call(box, 'hello there')
      box.dispatchEvent(new Event('input', { bubbles: true }))
    })
    act(() => {
      box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    expect(onSave).toHaveBeenCalledWith('hello there')
  })

  it('and Escape stops without saving', () => {
    const onSave = vi.fn()
    const onCancel = vi.fn()
    const el = mount(
      <MessageEditor body="hello" onSave={onSave} onCancel={onCancel} />,
    )
    act(() => {
      (el.querySelector('textarea') as HTMLElement)
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(onCancel).toHaveBeenCalled()
    expect(onSave).not.toHaveBeenCalled()
  })

  /* Shift+Enter is a new line, here as everywhere else. */
  it('and Shift+Enter does not save', () => {
    const onSave = vi.fn()
    const el = mount(<MessageEditor body="a" onSave={onSave} onCancel={vi.fn()} />)
    act(() => {
      (el.querySelector('textarea') as HTMLElement).dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }),
      )
    })
    expect(onSave).not.toHaveBeenCalled()
  })

  it('and says which keys do what', () => {
    const el = mount(<MessageEditor body="a" onSave={vi.fn()} onCancel={vi.fn()} />)
    expect(el.textContent).toContain('escape to cancel')
    expect(el.textContent).toContain('enter to save')
  })
})
