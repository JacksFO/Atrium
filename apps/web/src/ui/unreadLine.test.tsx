import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { AWHILE, Messages } from './Messages'
import { emptyWorld, remember, type World } from '../lib/world'
import type { Message, User } from '../lib/wire'

/**
 * When the line saying what you missed is drawn, and when it is not.
 *
 * It is for finding your place again after being away. Three things it was
 * doing that are not that: counting your own messages, appearing above one
 * message that arrived while you stepped into another channel, and staying
 * there after you had scrolled down and read the lot.
 */

const user = (id: string, over: Partial<User> = {}): User => ({
  id, username: id, discriminator: '0001', verified: 0, display_name: id,
  bio: '', accent: '', accent_2: '', name_font: 'default',
  name_effect: 'none', avatar_path: null, banner_path: null,
  status_text: '', presence: 'online', created_at: 0, ...over,
})

const LONG_AGO = Date.now() - AWHILE - 60_000
const JUST_NOW = Date.now() - 5_000

const msg = (id: string, over: Partial<Message> = {}): Message => ({
  id, channel_id: 'c1', author_id: 'pat', body: 'hello', created_at: LONG_AGO,
  edited_at: null, deleted_at: null, kind: 'text', reply_to: null,
  pinned_at: null, reactions: [], attachments: [], ...over,
})

function world(): World {
  const w = emptyWorld(user('me'))
  remember(w, user('pat', { display_name: 'Pat' }))
  return w
}

const draw = (messages: Message[], unreadFrom: number | null) =>
  renderToStaticMarkup(
    <Messages world={world()} space={null} messages={messages} unreadFrom={unreadFrom} />,
  )

const line = (html: string) => {
  const m = /<div class="unread-line"><span>([^<]*)<\/span>/.exec(html)
  return m ? m[1] : null
}

describe('what counts as missed', () => {
  it('is what somebody else said while you were away', () => {
    const html = draw([msg('m1'), msg('m2'), msg('m3')], 2)
    expect(line(html)).toBe('2 new messages')
  })

  it('and one of them says so in the singular', () => {
    expect(line(draw([msg('m1'), msg('m2')], 1))).toBe('1 new message')
  })

  it('but never your own', () => {
    /*
     * Sent from another device, or from this one before a reload, they come
     * back counted as unread - so a line saying "1 new message" appeared
     * above something you had just typed.
     */
    const html = draw([msg('m1'), msg('m2', { author_id: 'me' })], 1)
    expect(line(html)).toBe(null)
  })

  it('and counts only theirs when it is a mix', () => {
    const html = draw(
      [msg('m1'), msg('m2', { author_id: 'me' }), msg('m3')], 2,
    )
    expect(line(html)).toBe('1 new message')
  })

  it('nor anything that arrived while you were sitting here', () => {
    /* Stepping into another channel and coming straight back is not having
       missed anything, and a line about it is noise. */
    const html = draw([msg('m1'), msg('m2', { created_at: JUST_NOW })], 1)
    expect(line(html)).toBe(null)
  })

  it('though a long gap with a fresh message after it still counts', () => {
    /* Measured from the oldest one not read, which is when you left - not
       from the newest, which is only when they stopped talking. */
    const html = draw(
      [msg('m1'), msg('m2'), msg('m3', { created_at: JUST_NOW })], 2,
    )
    expect(line(html)).toBe('2 new messages')
  })

  it('and with nothing unread there is no line', () => {
    expect(line(draw([msg('m1'), msg('m2')], 0))).toBe(null)
    expect(line(draw([msg('m1'), msg('m2')], null))).toBe(null)
  })
})

describe('where the line sits', () => {
  it('above the first one you have not read, not above your own', () => {
    const html = draw(
      [msg('m1'), msg('m2', { author_id: 'me' }), msg('m3')], 2,
    )
    const at = html.indexOf('unread-line')
    expect(at).toBeGreaterThan(0)
    expect(html.indexOf('data-msg="m3"'), 'the line comes first').toBeGreaterThan(at)
    expect(html.indexOf('data-msg="m2"'), 'and your own is above it').toBeLessThan(at)
  })
})

describe('and when it goes away', () => {
  /*
   * Read out of the source: it lives in the chat's scroll handler, and there
   * is no scrolling in a static render to do it with.
   */
  const shell = readFileSync(join(__dirname, 'Shell.tsx'), 'utf8')
  const onScroll = shell.slice(shell.indexOf('onScroll={(e) => {'), shell.indexOf('onScroll={(e) => {') + 1800)

  it('reaching the end clears it', () => {
    expect(onScroll).toContain('setMarkFrom(null)')
  })

  it('but the app putting the list where it belongs does not', () => {
    /*
     * A channel left at the end opens at the end, which is a scroll to the
     * bottom before anybody has looked at anything - so without this the line
     * was taken away in the frame it appeared in and was never once seen.
     */
    expect(onScroll).toMatch(/openedAt\.current > \d+\) setMarkFrom\(null\)/)
    expect(shell, 'and the stamp is taken when a conversation opens')
      .toContain('openedAt.current = Date.now()')
  })
})

/**
 * What the line looks like, which was asked for against a reference.
 *
 * A red rule with the badge at the end of it, and where the boundary falls on
 * a new day, that day's date as the label in the middle of the same rule
 * rather than a second divider underneath. Both are headings for the same
 * message, and two rules for one boundary read as two things having happened.
 */
describe('the shape of it', () => {
  const DAY = 24 * 60 * 60 * 1000

  it('carries a badge saying which line this is', () => {
    const html = draw([msg('m1'), msg('m2')], 1)
    expect(html).toContain('class="upill"')
    expect(html).toMatch(/<b class="upill">New<\/b>/)
  })

  it('and says how many were missed when there is no date to show', () => {
    expect(line(draw([msg('m1'), msg('m2'), msg('m3')], 2))).toBe('2 new messages')
  })

  /*
   * A message from the day before, so the unread one starts a new day. The
   * date becomes the label, and there is no separate day divider for it -
   * which is the whole of what was asked for.
   */
  it('takes the date as its label where the day changes', () => {
    const html = draw([
      msg('m1', { created_at: LONG_AGO - DAY }),
      msg('m2', { created_at: LONG_AGO }),
    ], 1)
    /* The rule is there, and it is the only divider above that message. */
    const at = html.indexOf('unread-line')
    expect(at).toBeGreaterThan(0)
    const between = html.slice(at, html.indexOf('data-msg="m2"'))
    expect(between, 'no second divider under the rule').not.toContain('class="day"')
    /* And its label is a date rather than a count. */
    expect(line(html)).not.toMatch(/new messages?$/)
    expect(line(html)).toBeTruthy()
  })

  /* A day divider with nothing unread about it is left exactly as it was. */
  it('while an ordinary day divider is untouched', () => {
    const html = draw([
      msg('m1', { created_at: LONG_AGO - DAY }),
      msg('m2', { created_at: LONG_AGO }),
    ], null)
    expect(html).toContain('class="day"')
    expect(html).not.toContain('unread-line')
  })
})
