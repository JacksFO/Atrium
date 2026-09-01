import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PollCard } from './PollCard'
import type { Poll } from '../lib/wire'

/**
 * Answering your own question.
 *
 * Reported as the person who posts a poll not being able to vote in it.
 * Checked against a real server first: the route has no such rule, the author
 * votes and the answer comes back marked as theirs. So nothing here excludes
 * them either, and this is the test that says so - the fault, if one comes
 * back, will be a rule somebody adds later thinking it is obviously right.
 *
 * The numbers are deliberately on before anybody answers, which is what makes
 * an unanswered poll look like a result. That is a considered choice - hiding
 * them turns a question into a toll gate - so it stays, and the card names
 * who asked instead.
 */

const poll = (over: Partial<Poll> = {}): Poll => ({
  question: 'Where tonight?',
  multi: false,
  closesAt: Date.now() + 3_600_000,
  closed: false,
  voters: 0,
  options: [
    { idx: 0, text: 'Pub', votes: 0, share: 0, mine: false },
    { idx: 1, text: 'Home', votes: 0, share: 0, mine: false },
  ],
  ...over,
}) as Poll

let root: Root | null = null
let host: HTMLDivElement | null = null

function draw(node: React.ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root!.render(node) })
  return host
}

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
})

describe('voting in a poll', () => {
  it('sends the answer when an option is pressed', () => {
    const onVote = vi.fn()
    const el = draw(<PollCard poll={poll()} onVote={onVote} />)
    const options = el.querySelectorAll('button.popt')
    /* Or the click below lands on nothing and the test passes for it. */
    expect(options).toHaveLength(2)

    act(() => { (options[0] as HTMLButtonElement).click() })
    expect(onVote).toHaveBeenCalledWith([0])
  })

  /* Nothing about the card knows or cares who asked, which is the point. */
  it('and does so for the person who asked it', () => {
    const onVote = vi.fn()
    const el = draw(<PollCard poll={poll()} onVote={onVote} asked="JacksFO" />)
    act(() => { (el.querySelector('button.popt') as HTMLButtonElement).click() })
    expect(onVote).toHaveBeenCalledWith([0])
  })

  /* Picking what you already picked takes it back - the only way to change
     your mind to nothing when a question takes one answer. */
  it('and takes an answer back when it is pressed again', () => {
    const onVote = vi.fn()
    const chosen = poll({
      options: [
        { idx: 0, text: 'Pub', votes: 1, share: 100, mine: true },
        { idx: 1, text: 'Home', votes: 0, share: 0, mine: false },
      ],
    } as Partial<Poll>)
    const el = draw(<PollCard poll={chosen} onVote={onVote} />)
    act(() => { (el.querySelector('button.popt') as HTMLButtonElement).click() })
    expect(onVote).toHaveBeenCalledWith([])
  })

  it('but a closed poll takes no more answers', () => {
    const onVote = vi.fn()
    const el = draw(<PollCard poll={poll({ closed: true })} onVote={onVote} />)
    act(() => { (el.querySelector('button.popt') as HTMLButtonElement).click() })
    expect(onVote).not.toHaveBeenCalled()
  })
})

describe('who asked', () => {
  it('is named on the card', () => {
    const el = draw(<PollCard poll={poll()} asked="JacksFO" />)
    expect(el.textContent).toContain('Asked by')
    expect(el.textContent).toContain('JacksFO')
  })

  /* A poll from before this, or one drawn somewhere with no name to hand,
     must not leave a dangling "Asked by". */
  it('and left out entirely when there is nobody to name', () => {
    const el = draw(<PollCard poll={poll()} />)
    expect(el.textContent).not.toContain('Asked by')
  })
})

/*
 * And the /poll box closes behind itself. The command list is drawn from
 * state the change handler maintains, and setting the draft from code never
 * fires one - so the picker opened and the menu stayed behind it.
 */
describe('the slash menu', () => {
  const src = readFileSync(resolve(process.cwd(), 'src/ui/Composer.tsx'), 'utf8')

  it('is cleared when a command opens something', () => {
    const at = src.indexOf('const opens = opensSomething(text)')
    expect(at).toBeGreaterThan(0)
    const body = src.slice(at, src.indexOf('return\n    }', at))
    expect(body).toContain('setDraft(\'\')')
    expect(body).toContain('setSlash(null)')
  })
})
