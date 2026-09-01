import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PollCard, timeLeft } from './PollCard'
import { PollMaker } from './PollMaker'
import type { Poll } from '../lib/wire'

/**
 * A question in the conversation.
 *
 * The numbers are always on, before and after answering. Hiding them until
 * somebody takes part turns a question into a toll gate: everybody who only
 * wanted the answer picks something to get past it, which makes the number
 * they were curious about wrong.
 */

const poll = (over: Partial<Poll> = {}): Poll => ({
  question: 'Where tonight?',
  multi: false,
  closesAt: null,
  closed: false,
  voters: 3,
  options: [
    { idx: 0, text: 'Somewhere', votes: 2, share: 67, mine: false },
    { idx: 1, text: 'Attic', votes: 1, share: 33, mine: false },
  ],
  ...over,
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
const rows = (el: HTMLElement) => [...el.querySelectorAll('.popt')] as HTMLElement[]

describe('the numbers on a poll', () => {
  it('are shown before anybody has answered', () => {
    const el = mount(<PollCard poll={poll()} onVote={vi.fn()} />)
    expect(el.textContent).toContain('67%')
    expect(el.textContent).toContain('3 people have answered')
  })

  it('and one person reads as one person', () => {
    const el = mount(<PollCard poll={poll({ voters: 1 })} onVote={vi.fn()} />)
    expect(el.textContent).toContain('1 person has answered')
  })
})

describe('answering one that takes a single answer', () => {
  it('sends the one that was picked', () => {
    const onVote = vi.fn()
    const el = mount(<PollCard poll={poll()} onVote={onVote} />)
    act(() => { rows(el)[1]?.click() })
    expect(onVote).toHaveBeenCalledWith([1])
  })

  /* Picking what you already picked takes it back, which is the only way to
     change your mind to nothing when only one answer is allowed. */
  it('and picking it again takes the answer back', () => {
    const onVote = vi.fn()
    const chosen = poll()
    chosen.options[0]!.mine = true
    const el = mount(<PollCard poll={chosen} onVote={onVote} />)
    act(() => { rows(el)[0]?.click() })
    expect(onVote).toHaveBeenCalledWith([])
  })
})

describe('answering one that takes several', () => {
  it('adds to what is already picked rather than replacing it', () => {
    const onVote = vi.fn()
    const many = poll({ multi: true })
    many.options[0]!.mine = true
    const el = mount(<PollCard poll={many} onVote={onVote} />)
    act(() => { rows(el)[1]?.click() })
    expect(onVote).toHaveBeenCalledWith([0, 1])
  })

  it('and unticking one leaves the rest', () => {
    const onVote = vi.fn()
    const many = poll({ multi: true })
    many.options[0]!.mine = true
    many.options[1]!.mine = true
    const el = mount(<PollCard poll={many} onVote={onVote} />)
    act(() => { rows(el)[0]?.click() })
    expect(onVote).toHaveBeenCalledWith([1])
  })
})

describe('a poll that has closed', () => {
  it('takes no more answers', () => {
    const onVote = vi.fn()
    const el = mount(<PollCard poll={poll({ closed: true })} onVote={onVote} />)
    expect(rows(el)[0]?.hasAttribute('disabled')).toBe(true)
    act(() => { rows(el)[0]?.click() })
    expect(onVote).not.toHaveBeenCalled()
  })

  /* And still shows what the answers were, which is the point of keeping it. */
  it('but still says what they were', () => {
    const el = mount(<PollCard poll={poll({ closed: true })} />)
    expect(el.textContent).toContain('Somewhere')
    expect(el.textContent).toContain('67%')
    expect(el.textContent).toContain('Closed')
  })
})

describe('how long is left', () => {
  const now = 1_700_000_000_000
  it('is said the way a person would say it', () => {
    expect(timeLeft(now + 40 * 60_000, now)).toBe('40m left')
    expect(timeLeft(now + 3 * 3_600_000, now)).toBe('3h left')
    expect(timeLeft(now + 2 * 86_400_000, now)).toBe('2d left')
    expect(timeLeft(now - 1, now)).toBe('Closed')
  })
})

describe('asking a question', () => {
  const fields = (el: HTMLElement) =>
    [...el.querySelectorAll('.answer input')] as HTMLInputElement[]

  it('starts with three answers', () => {
    mount(<PollMaker onAsk={vi.fn()} onClose={vi.fn()} />)
    expect(fields(document.body)).toHaveLength(3)
  })

  it('and takes more when asked', () => {
    mount(<PollMaker onAsk={vi.fn()} onClose={vi.fn()} />)
    const add = [...document.querySelectorAll('button')]
      .find((b) => b.textContent?.includes('Add an answer')) as HTMLElement
    act(() => { add.click() })
    expect(fields(document.body)).toHaveLength(4)
  })

  /* Two is the fewest a question can have. Below that it is not a question. */
  it('and never goes below two', () => {
    mount(<PollMaker onAsk={vi.fn()} onClose={vi.fn()} />)
    const remove = () => [...document.querySelectorAll('[aria-label^="Remove answer"]')]
    act(() => { (remove()[0] as HTMLElement).click() })
    expect(fields(document.body)).toHaveLength(2)
    expect(remove()).toHaveLength(0)
  })

  it('and will not ask until there is a question and two answers', () => {
    mount(<PollMaker onAsk={vi.fn()} onClose={vi.fn()} />)
    const ask = () => [...document.querySelectorAll('button')]
      .find((b) => b.textContent === 'Ask') as HTMLButtonElement
    expect(ask().disabled).toBe(true)

    const setValue = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype, 'value',
    )?.set as (v: string) => void
    const type = (el: HTMLInputElement, text: string) => act(() => {
      setValue.call(el, text)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    })

    type(document.querySelector('.fld input') as HTMLInputElement, 'Where?')
    expect(ask().disabled).toBe(true)
    type(fields(document.body)[0]!, 'Here')
    type(fields(document.body)[1]!, 'There')
    expect(ask().disabled).toBe(false)
  })
})
