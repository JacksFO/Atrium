import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Composer } from './Composer'
import { actionsFor } from '../lib/actions'
import type { Message } from '../lib/wire'

/**
 * What somebody cannot do is not offered to them.
 *
 * The rule for this whole app: a control somebody has no permission for is
 * absent, not disabled and not refused after the fact. Offering something
 * that will be refused wastes their time and teaches them the app is
 * unreliable; a greyed-out control does the same more quietly.
 *
 * The opposite failure is real too — a gated control reads as a feature
 * nobody built — so every one of these has both halves: gone without the
 * permission, and there with it.
 */

const msg = (author: string): Message => ({
  id: 'm1', channel_id: 'c1', author_id: author, body: 'hi',
  created_at: 1, edited_at: null, deleted_at: null, kind: 'text',
  reply_to: null, pinned_at: null, reactions: [], attachments: [],
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

describe('a channel somebody may read but not write in', () => {
  const readOnly = ['view_channels', 'read_history']

  it('has no message box, and says why', () => {
    const el = mount(
      <Composer name="general" kind="text" onSend={vi.fn()} permissions={readOnly} />,
    )
    expect(el.querySelector('textarea')).toBe(null)
    expect(el.textContent).toContain('not write in it')
  })

  /* The other half: with the permission it is an ordinary channel. */
  it('and has one the moment writing is allowed', () => {
    const el = mount(
      <Composer name="general" kind="text" onSend={vi.fn()}
        permissions={[...readOnly, 'send_messages']} />,
    )
    expect(el.querySelector('textarea')).toBeTruthy()
  })

  /* A conversation has no roles and asks nobody. */
  it('and a conversation is never gated', () => {
    const el = mount(<Composer name="Pat" kind="dm" onSend={vi.fn()} />)
    expect(el.querySelector('textarea')).toBeTruthy()
  })
})

describe('a channel that does not take files', () => {
  const noFiles = ['view_channels', 'read_history', 'send_messages']

  it('offers no way to attach one', () => {
    const el = mount(
      <Composer name="general" kind="text" onSend={vi.fn()} permissions={noFiles} />,
    )
    expect(el.querySelector('[aria-label="Attach a picture"]')).toBe(null)
  })

  it('and offers one where they are allowed', () => {
    const el = mount(
      <Composer name="general" kind="text" onSend={vi.fn()}
        permissions={[...noFiles, 'attach_files']} />,
    )
    expect(el.querySelector('[aria-label="Attach a picture"]')).toBeTruthy()
  })
})

describe('what is offered on a message', () => {
  const who = (perms: string[]) => ({ id: 'me', permissions: perms })

  /* Each of these is a permission the server checks. Offering the action
     without it is offering a refusal. */
  it('is gated on the same permissions the server checks', () => {
    expect(actionsFor(msg('pat'), who([]))).toEqual(['copy'])
    expect(actionsFor(msg('pat'), who(['send_messages']))).toContain('reply')
    expect(actionsFor(msg('pat'), who(['add_reactions']))).toContain('react')
    expect(actionsFor(msg('pat'), who(['manage_messages']))).toContain('delete')
    expect(actionsFor(msg('pat'), who(['manage_pins']))).toContain('pin')
  })

  /* And what is yours is yours, whatever the channel says. */
  it('and your own message is always yours to change', () => {
    expect(actionsFor(msg('me'), who([]))).toContain('edit')
    expect(actionsFor(msg('me'), who([]))).toContain('delete')
  })

  it('but somebody else’s is not', () => {
    expect(actionsFor(msg('pat'), who([]))).not.toContain('edit')
    expect(actionsFor(msg('pat'), who([]))).not.toContain('delete')
  })
})
