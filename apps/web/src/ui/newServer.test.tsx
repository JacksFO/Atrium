import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NewServer } from './NewServer'
import type { Api } from '../lib/api'

/**
 * Making a server, or walking into somebody else's.
 *
 * Both routes have existed since servers did and nothing in this client
 * called either of them, so an account could be in the servers it happened to
 * be added to and could do nothing about it - no button in the rail, none on
 * the home page, none anywhere. Reported as exactly that.
 */

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

function type(box: HTMLInputElement, text: string) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype, 'value')!.set!
  act(() => {
    setter.call(box, text)
    box.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

/* The dialog is drawn through a portal to the body, so it is not inside the
   element it was rendered into - asking that element finds nothing. */
const boxes = () =>
  [...document.querySelectorAll('.joinrow input')] as HTMLInputElement[]
const buttons = () =>
  [...document.querySelectorAll('.joinrow button')] as HTMLButtonElement[]

const fake = (post: ReturnType<typeof vi.fn>) => ({ post } as unknown as Api)

describe('making a server', () => {
  it('asks the route that makes one, and goes into it', async () => {
    const post = vi.fn(async () => ({ space: { id: 's-new' } }))
    const onDone = vi.fn()
    draw(<NewServer server={fake(post)} onDone={onDone} onClose={() => {}} />)

    type(boxes()[0]!, 'Somewhere')
    await act(async () => { buttons()[0]!.click() })

    expect(post).toHaveBeenCalledWith('/api/spaces', { name: 'Somewhere' })
    expect(onDone).toHaveBeenCalledWith('s-new')
  })

  /* A button that does nothing is worse than a disabled one. */
  it('and offers nothing until it has a name', () => {
    draw(<NewServer server={fake(vi.fn())} onDone={() => {}} onClose={() => {}} />)
    expect(buttons()[0]!.disabled).toBe(true)
  })
})

describe('joining one', () => {
  it('accepts a code and goes into it', async () => {
    const post = vi.fn(async () => ({ spaceId: 's-theirs' }))
    const onDone = vi.fn()
    draw(<NewServer server={fake(post)} onDone={onDone} onClose={() => {}} />)

    type(boxes()[1]!, 'jc-abc123')
    await act(async () => { buttons()[1]!.click() })

    expect(post).toHaveBeenCalledWith('/api/invites/jc-abc123/accept', {})
    expect(onDone).toHaveBeenCalledWith('s-theirs')
  })

  /*
   * A whole link is what people actually paste. Somebody handed a link and
   * told to enter a code has been given a puzzle.
   */
  it('and takes a whole invite link, not only the code', async () => {
    const post = vi.fn(async () => ({ spaceId: 's-theirs' }))
    draw(<NewServer server={fake(post)} onDone={() => {}} onClose={() => {}} />)

    type(boxes()[1]!, 'https://atriumapp.duckdns.org/invite/jc-abc123/')
    await act(async () => { buttons()[1]!.click() })

    expect(post).toHaveBeenCalledWith('/api/invites/jc-abc123/accept', {})
  })

  /* A refusal has to be visible, and must not close the dialog on the words
     somebody just typed. */
  it('and says so when the invite is not valid', async () => {
    const post = vi.fn(async () => { throw new Error('That invite is not valid.') })
    const onClose = vi.fn()
    draw(<NewServer server={fake(post)} onDone={() => {}} onClose={onClose} />)

    type(boxes()[1]!, 'nope')
    await act(async () => { buttons()[1]!.click() })

    expect(document.body.textContent).toContain('That invite is not valid.')
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('and the ways in', () => {
  const shell = readFileSync(resolve(process.cwd(), 'src/ui/Shell.tsx'), 'utf8')
  const home = readFileSync(resolve(process.cwd(), 'src/ui/Home.tsx'), 'utf8')

  it('are in the rail and on the home page', () => {
    expect(shell).toContain('rl rlnew')
    expect(home).toContain('Make or join a server')
  })

  /* The home one is for an account that has just arrived. Somebody already in
     servers has the rail and does not need telling twice. */
  it('and the home one only where there are none yet', () => {
    expect(home).toContain('world.spaces.length === 0 &&')
  })
})
