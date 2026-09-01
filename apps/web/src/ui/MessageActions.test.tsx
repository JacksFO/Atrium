import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Messages } from './Messages'
import { emptyWorld, remember, type World } from '../lib/world'
import { CONVERSATION_PERMISSIONS } from '../lib/permissions'
import type { Message, User } from '../lib/wire'

const user = (id: string, over: Partial<User> = {}): User => ({
  id, username: id, discriminator: '0001', verified: 0, display_name: id,
  bio: '', accent: '', accent_2: '', name_font: 'default',
  name_effect: 'none', avatar_path: null, banner_path: null,
  status_text: '', presence: 'online', created_at: 0, ...over,
})

const msg = (over: Partial<Message> = {}): Message => ({
  id: 'm1', channel_id: 'c1', author_id: 'pat', body: 'hello',
  created_at: Date.UTC(2026, 7, 29, 12, 0, 0),
  edited_at: null, deleted_at: null, kind: 'text', reply_to: null,
  pinned_at: null, reactions: [], attachments: [], ...over,
})

function world(): World {
  const w = emptyWorld(user('me'))
  remember(w, user('pat', { display_name: 'Pat' }))
  return w
}

const draw = (m: Message, permissions: string[]) =>
  renderToStaticMarkup(
    <Messages world={world()} space={null} messages={[m]} permissions={permissions} />,
  )

const drawAll = (messages: Message[], permissions: string[] = []) =>
  renderToStaticMarkup(
    <Messages world={world()} space={null} messages={messages} permissions={permissions} />,
  )

const reacted = msg({ reactions: [{ emoji: '\u{1F44D}', count: 1, me: false }] })

describe('reacting to a message', () => {
  it('is offered where the server allows it', () => {
    expect(draw(reacted, ['add_reactions'])).toContain('rc add')
  })

  /* A control that would be refused should not be there — but the pills
     themselves stay, because the count is worth reading either way. */
  it('and is not where it does not', () => {
    const out = draw(reacted, ['send_messages'])
    expect(out).not.toContain('rc add')
    expect(out).toContain('class="rc"')
    expect(out).toContain('disabled')
  })

  /*
   * A conversation has no server, so the client has no list from one. Read as
   * "nothing granted", every reaction control in every private conversation
   * disappears — and a gated control is absent rather than greyed, so it
   * reads as a feature that was never built rather than as a bug.
   */
  it('and is offered in a conversation, which grants a fixed set', () => {
    expect(draw(reacted, [...CONVERSATION_PERMISSIONS])).toContain('rc add')
  })
})

describe('a reaction already on a message', () => {
  it('says which way pressing it goes', () => {
    const mine = msg({ reactions: [{ emoji: '\u{1F44D}', count: 2, me: true }] })
    expect(draw(mine, ['add_reactions'])).toContain('Take back')
    expect(draw(reacted, ['add_reactions'])).toContain('React ')
  })
})

describe('the tools on a message', () => {
  /* The server allows an edit only for what you wrote, so a pencil on
     somebody else's message is a button that exists to be refused. */
  it('offer editing and deleting on your own', () => {
    const out = draw(msg({ author_id: 'me' }), [])
    expect(out).toContain('aria-label="Edit"')
    expect(out).toContain('aria-label="Delete"')
  })

  it('and neither on somebody else’s', () => {
    const out = draw(msg({ author_id: 'pat' }), [])
    expect(out).not.toContain('aria-label="Edit"')
    expect(out).not.toContain('aria-label="Delete"')
  })

  it('until the permission to delete anybody’s is held', () => {
    expect(draw(msg({ author_id: 'pat' }), ['manage_messages']))
      .toContain('aria-label="Delete"')
  })

  it('and pinning takes the permission for it', () => {
    expect(draw(msg(), [])).not.toContain('aria-label="Pin"')
    expect(draw(msg(), ['manage_pins'])).toContain('aria-label="Pin"')
  })

  /* Pressing it again unpins, so it has to say which way it goes — a pin
     button that always says "Pin" on an already-pinned message is a button
     that lies about what it does. */
  it('and say so when it is already pinned', () => {
    const out = draw(msg({ pinned_at: 1 }), ['manage_pins'])
    expect(out).toContain('aria-label="Unpin"')
    expect(out).not.toContain('aria-label="Pin"')
  })
})

describe('a reply', () => {
  const answered = msg({ id: 'm1', author_id: 'pat', body: 'the question' })
  const answer = msg({ id: 'm2', author_id: 'me', body: 'the answer', reply_to: 'm1' })

  it('shows who it is answering, and what they said', () => {
    const out = drawAll([answered, answer])
    expect(out).toContain('reply-to')
    expect(out).toContain('the question')
  })

  /*
   * A reply to something further up than the loaded page has nothing to
   * quote. Left as an ordinary quote it is a button that scrolls nowhere,
   * which reads as the app having lost the message.
   */
  it('says so plainly when what it answers is not loaded', () => {
    const out = drawAll([answer])
    expect(out).toContain('a message from further up')
    expect(out).toContain('disabled')
  })

  /* A reply is a reason to see who is speaking, even from the same person. */
  it('breaks a run', () => {
    const out = drawAll([
      msg({ id: 'm1', author_id: 'pat' }),
      msg({ id: 'm2', author_id: 'pat', reply_to: 'm1' }),
    ])
    expect(out).not.toContain('msg cont')
  })
})

describe('a shortcode in a message', () => {
  /*
   * The renderer has always known how to swap `:fire:` for the glyph, and for
   * as long as nothing handed it a table it had nothing to swap it for — so
   * the setting existed, was on by default, and did nothing. Asserted on the
   * drawn message rather than on the table, because the table was never the
   * part that was missing.
   */
  it('is drawn as the emoji, not as the text', () => {
    const out = draw(msg({ body: 'that is :fire:' }), [])
    expect(out).toContain('\u{1F525}')
    expect(out).not.toContain(':fire:')
  })

  /* Somebody writing about a shortcode, rather than using one, has the
     setting off — and then the words are the message. */
  it('unless shortcodes have been turned off', () => {
    const out = renderToStaticMarkup(
      <Messages world={world()} space={null} messages={[msg({ body: 'that is :fire:' })]}
        shortcodes={false} />,
    )
    expect(out).toContain(':fire:')
  })
})
