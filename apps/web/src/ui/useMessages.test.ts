import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Reading back through a channel.
 *
 * The client asked the server for a channel's messages and never asked for
 * anything older, so a channel with a thousand messages showed the most
 * recent page and nothing above it however far anybody scrolled. The server
 * had taken `before` and `limit` the whole time. The comment in the shell
 * said so out loud - "nothing pages back yet" - and the browser spec that
 * would have caught it was being run against a different client.
 *
 * The behaviour is checked in test/ui/specs/scroll-history.cjs, which scrolls
 * a real list in a real browser and counts what arrives. What is checked here
 * is the handful of details that are easy to get wrong and invisible from the
 * outside - and two of them were wrong first time.
 */
const src = readFileSync(resolve(process.cwd(), 'src/ui/useMessages.ts'), 'utf8')
const shell = readFileSync(resolve(process.cwd(), 'src/ui/Shell.tsx'), 'utf8')

describe('asking for the page before', () => {
  it('pages back from a time, not from an id', () => {
    /*
     * The first attempt sent the oldest message's id. The server reads
     * `before` as a number: an id binds as null, `created_at < null` is never
     * true, and it answers with the newest page again - which is
     * indistinguishable from having reached the beginning of the channel.
     */
    const at = src.indexOf('?before=')
    expect(at, 'nothing asks for anything older').toBeGreaterThan(-1)
    const call = src.slice(at, at + 160)
    expect(call, 'the cursor is not a time').toContain('created_at')
    expect(call).not.toContain('oldest.id')
  })

  it('and asks for the size of page the server actually sends', () => {
    /* "A full page" is the only sign there is more above. Asking for a
       different number than the server's own default makes a full page mean
       something other than what the server considers one. */
    expect(src).toContain('const PAGE = 60')
  })

  it('and stops asking once a short page comes back', () => {
    expect(src).toContain('more.current.set(channelId, got.length >= PAGE)')
  })

  it('and remembers that per channel, not once for the app', () => {
    /* One flag would let a short conversation convince a long channel it had
       reached its beginning. */
    expect(src).toContain('useRef<Map<Id, boolean>>')
  })

  it('and never asks twice at once', () => {
    /* Scrolling fires many events; without this each one starts its own
       request for the same page. */
    expect(src).toContain('if (asking.current) return false')
  })

  it('and adds nothing it already has', () => {
    expect(src).toContain('const fresh = got.filter((m) => !seen.has(m.id))')
  })
})

describe('what the reader sees while it happens', () => {
  /** The whole scroll handler, however long it grows. */
  const scrollHandler = (): string => {
    const at = shell.indexOf('onScroll={(e) => {')
    expect(at, 'the chat has no scroll handler').toBeGreaterThan(-1)
    let depth = 0
    for (let i = at + 'onScroll={'.length - 1; i < shell.length; i += 1) {
      if (shell[i] === '{') depth += 1
      else if (shell[i] === '}') { depth -= 1; if (depth === 0) return shell.slice(at, i + 1) }
    }
    throw new Error('the scroll handler never closes')
  }

  it('keeps their place when older messages go in above', () => {
    /*
     * Prepending to a scrolled list pushes everything down by the height of
     * what was added, so somebody who scrolled to the top to read backwards
     * lands in the middle of what they had just read. The height is measured
     * before and after and the scroll moved by the difference.
     */
    const at = shell.indexOf('const keepPlace =')
    expect(at, 'nothing puts the scroll back after the list grows').toBeGreaterThan(-1)
    const block = shell.slice(at, at + 320)
    expect(block, 'the scroll position is not restored').toContain('scrollHeight - was')

    /* And used on both ways the list can grow above somebody: a page from
       the server, and the window opening onto messages already held. */
    const handler = scrollHandler()
    expect((handler.match(/keepPlace/g) ?? []).length,
      'both growths must put the place back').toBeGreaterThanOrEqual(3)
  })

  it('and asks before they reach the very top', () => {
    /* At zero they have already been looking at a stationary list for a
       moment, and the messages arrive after they decided nothing was
       coming. */
    expect(shell).toContain('el.scrollTop > 240')
  })

  it('and does not ask when there is nothing older', () => {
    expect(shell).toContain('if (!hasOlder) return')
  })

  it('and draws what is already held before asking for more', () => {
    /*
     * Scrolling back is two stages now, and the instant one comes first: the
     * list drawn is the end of the channel rather than all of it, so there
     * are usually messages in hand that have not been drawn. Asking the
     * server while those are sitting there is a wait for something already
     * here.
     */
    const handler = scrollHandler()
    const grow = handler.indexOf('moreToShow(messages.length, shown)')
    const fetch = handler.indexOf('void older()')
    expect(grow, 'the window never grows').toBeGreaterThan(-1)
    expect(fetch, 'nothing fetches older messages').toBeGreaterThan(-1)
    expect(grow, 'the fetch must come after the growth').toBeLessThan(fetch)
  })
})

/**
 * Where the cursor is when something opens.
 *
 * The shell held a counter for this, passed it to the composer, and never
 * changed it - so nothing ever asked for the focus and it stayed on the body.
 * Opening a conversation and typing put the words nowhere, which is the first
 * thing anybody does; and picking Reply left the cursor wherever it was, with
 * the reply box sitting there empty. Both were reported.
 */
describe('the cursor', () => {
  /*
   * The whole effect, found by its edges rather than by counting characters.
   *
   * These checks used a window of so many characters either side, which broke
   * the moment the effect grew a comment - and a check that stops finding what
   * it is looking for reports the feature missing.
   *
   * Anchored on what this effect is *for* rather than on asking for the
   * focus, which is no longer unique: dropping a picture asks for it too, so
   * a search for the first one found a callback near the top of the file and
   * reported three features missing at once.
   */
  const focusEffect = (() => {
    const ends = shell.indexOf('}, [openId, phone])')
    if (ends < 0) return ''
    const from = shell.lastIndexOf('useEffect(() => {', ends)
    return from < 0 ? '' : shell.slice(from, ends + '}, [openId, phone])'.length)
  })()

  it('goes to the message box when something is opened', () => {
    expect(focusEffect, 'nothing ever asks for the focus').not.toBe('')
    /* Keyed on what is open, or it fires on every render. */
    expect(focusEffect).toContain('[openId, phone]')
  })

  /*
   * And adding a picture leaves a phone alone, for the same reason.
   *
   * Putting the cursor in the box is what lets Enter send a picture on its
   * own - but a phone has no Enter waiting, and focusing there slides the
   * keyboard up over the picture just added. The rule was written once for
   * opening a channel and then not applied to the two places added later,
   * which is how a considered decision quietly stops holding.
   *
   * Replying is deliberately not on this list: opening a channel and adding a
   * picture are things somebody did for another reason, and a keyboard over
   * them is in the way. Choosing Reply is the decision to type, so there the
   * keyboard is the thing being asked for.
   */
  it('and so does adding a picture, by drop or by picker', () => {
    for (const [what, anchor] of [
      ['a drop', 'for (const f of files) void up.add(f)'],
      ['the picker', 'onPick={(f) => {'],
    ] as const) {
      const at = shell.indexOf(anchor)
      expect(at, `${what} is still here`).toBeGreaterThan(-1)
      const block = shell.slice(at, at + 900)
      const asks = block.indexOf('setFocusComposer')
      expect(asks, `${what} does not ask for the cursor`).toBeGreaterThan(-1)
      expect(block.slice(0, asks), `${what} asks for it on a phone too`)
        .toMatch(/if \(!phone\) $/)
    }
  })

  /* And once each. This was written twice for a reply, in two commits, each
     with a comment saying the same thing - so every reply focused the box
     twice and bumped the counter the effect keys on twice. */
  it('and asks once per thing that wants it', () => {
    const at = shell.indexOf('const beginReply =')
    expect(at).toBeGreaterThan(-1)
    const body = shell.slice(at, shell.indexOf('const beginEdit =', at))
    expect(body.split('setFocusComposer').length - 1).toBe(1)
  })

  /* Bounded by the function rather than by a count of characters: this read
     400 either side and stopped finding the call the moment the comment above
     it grew, which reports the feature missing. */
  it('and when a reply is started', () => {
    const at = shell.indexOf('const beginReply =')
    expect(at, 'there is no beginReply any more').toBeGreaterThan(-1)
    const body = shell.slice(at, shell.indexOf('const beginEdit =', at))
    expect(body, 'replying does not put the cursor in the box')
      .toContain('setFocusComposer')
  })

  /* Focusing a text box on a phone slides the keyboard up over the messages
     somebody just opened the channel to read. */
  it('but not on a phone, where that opens the keyboard', () => {
    expect(focusEffect).toContain('if (phone) return')
  })

  /* Switching channels mid-word in the search box took the cursor away and
     sent the next keystroke somewhere else. */
  it('and not out of somewhere they are already typing', () => {
    expect(focusEffect).toContain('typingElsewhere')
    expect(focusEffect, 'the message box itself should not count')
      .toContain("closest('.cmp')")
  })

  it('and the composer acts on being asked', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/ui/Composer.tsx'), 'utf8')
    const at = src.indexOf('focusedAt')
    expect(at, 'the composer ignores the request').toBeGreaterThan(-1)
    expect(src.slice(at, at + 300)).toContain('box.current?.focus()')
  })
})

