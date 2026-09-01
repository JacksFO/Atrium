import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Messages } from './Messages'
import { emptyWorld, remember, type World } from '../lib/world'
import type { Message, User } from '../lib/wire'

const user = (id: string, over: Partial<User> = {}): User => ({
  id, username: id, discriminator: '0001', verified: 0, display_name: id,
  bio: '', accent: '', accent_2: '', name_font: 'default',
  name_effect: 'none', avatar_path: null, banner_path: null,
  status_text: '', presence: 'online', created_at: 0, ...over,
})

const at = Date.UTC(2026, 7, 29, 12, 0, 0)
const msg = (id: string, over: Partial<Message> = {}): Message => ({
  id, channel_id: 'c1', author_id: 'pat', body: 'hello', created_at: at,
  edited_at: null, deleted_at: null, kind: 'text', reply_to: null,
  pinned_at: null, reactions: [], attachments: [], ...over,
})

function world(): World {
  const w = emptyWorld(user('me'))
  remember(w, user('pat', { display_name: 'Pat' }))
  return w
}

const html = (messages: Message[], w = world()) =>
  renderToStaticMarkup(<Messages world={w} space={null} messages={messages} />)

describe('a run of messages from one person', () => {
  /* A list that repeats somebody's name six times is a list about the names. */
  it('names them once and shows a time on the rest', () => {
    const out = html([msg('m1'), msg('m2'), msg('m3')])
    expect((out.match(/class="mh"/g) ?? []).length).toBe(1)
    expect((out.match(/msg cont/g) ?? []).length).toBe(2)
  })

  it('but starts again for somebody else', () => {
    const w = world()
    remember(w, user('sam', { display_name: 'Sam' }))
    const out = html([msg('m1'), msg('m2', { author_id: 'sam' })], w)
    expect((out.match(/class="mh"/g) ?? []).length).toBe(2)
  })

  /* A reply is a reason to see who is speaking again. */
  it('and starts again for a reply', () => {
    const out = html([msg('m1'), msg('m2', { reply_to: 'm1' })])
    expect((out.match(/class="mh"/g) ?? []).length).toBe(2)
  })
})

describe('the body', () => {
  /* The body is pre-wrap, so whitespace in the markup is content. The old
     renderer put a newline between the text and the "(edited)" marker for
     readability and gave every message in the app a blank line on the end —
     reported three times as "the spacing is wrong". */
  it('has nothing between the words and the edited marker', () => {
    const out = html([msg('m1', { body: 'hello', edited_at: at })])
    expect(out).toContain('hello<span class="edited">(edited)</span>')
  })

  it('and no marker at all when it was never edited', () => {
    expect(html([msg('m1')])).not.toContain('(edited)')
  })

  it('draws a message of nothing but emoji big', () => {
    expect(html([msg('m1', { body: '🔥🔥' })])).toContain('bd jumbo')
    expect(html([msg('m1', { body: 'hi 🔥' })])).not.toContain('jumbo')
  })
})

describe('a message that is trying something', () => {
  /* The whole reason for the renderer being a tree. Asserted here as well as
     on the renderer itself, because this is the component that actually puts
     somebody else's words on your screen. */
  it('cannot open a tag through the body', () => {
    const out = html([msg('m1', { body: '<img src=x onerror=alert(1)>' })])
    expect(out).not.toContain('<img src=x')
    expect(out).toContain('&lt;img')
  })

  it('cannot open one through a display name either', () => {
    const w = emptyWorld(user('me'))
    remember(w, user('pat', { display_name: '<script>alert(1)</script>' }))
    const out = html([msg('m1')], w)
    expect(out).not.toContain('<script')
  })

  it('and an unknown author is somebody rather than a crash', () => {
    const out = html([msg('m1', { author_id: 'nobody-has-heard-of-them' })])
    expect(out).toContain('Someone')
  })
})

describe('what came with it', () => {
  it('shows a picture that was attached', () => {
    const out = html([msg('m1', {
      attachments: [{
        id: 'a1', message_id: 'm1', filename: 'x.png', mime: 'image/png',
        bytes: 1, width: null, height: null, path: '/uploads/x.png?e=1&s=2',
        is_gif: 0,
      }],
    })])
    expect(out).toContain('/uploads/x.png?e=1&amp;s=2')
  })

  it('and the reactions people left', () => {
    const out = html([msg('m1', { reactions: [{ emoji: '🔥', count: 2, me: true }] })])
    expect(out).toContain('rc mine')
    expect(out).toContain('🔥')
  })
})

describe('an empty channel', () => {
  it('says so rather than showing nothing at all', () => {
    /* Nothing, because the opener above it already says this is the start
       of a conversation — two ways of saying so is one too many. */
    expect(html([])).toBe('')
  })
})
