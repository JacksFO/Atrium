import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * What closes the drawer on a phone, and what must not.
 *
 * The rail and the list beside it *are* the drawer - `data-slid="nav"` slides
 * both of them in. So there are two kinds of press, and they are opposites:
 *
 *   changing what the drawer shows - Home, or another server - must leave it
 *   up, or it shuts over the very thing that was just asked for. Reported as
 *   pressing Home closing the panel, so the conversations it had just gone to
 *   fetch were behind a panel you had to open again.
 *
 *   picking something to read finishes with the drawer, and closes it.
 *
 * Said in the source because the difference lives in which handler calls
 * what, and there is no phone here to press.
 */
describe('the drawer on a phone', () => {
  const shell = readFileSync(join(__dirname, 'Shell.tsx'), 'utf8')

  /** The body of a handler, from its first line to the end of that arrow. */
  const after = (mark: string, lines = 26) => {
    const at = shell.indexOf(mark)
    expect(at, `${mark} is still in Shell.tsx`).toBeGreaterThan(0)
    return shell.slice(at, at + lines * 90)
  }

  it('stays up when Home changes what it shows', () => {
    const body = after('onPage={(which) =>', 12)
    expect(body).toContain('setPage(which)')
    expect(body.slice(0, body.indexOf('}}')), 'Home must not close it')
      .not.toContain('setSlid(null)')
  })

  it('and closes when something is opened to read', () => {
    /* The one door everything that opens a channel or a conversation goes
       through - so this is the whole of the closing rule. */
    const body = after('const openToRead = useCallback', 8)
    expect(body).toContain('setSlid(null)')
  })

  it('and comes back when a server has nothing to open', () => {
    /* Picking a server goes through that same door to restore what you were
       reading in it. First time in, there is nothing to restore, so the door
       would shut the drawer over an empty middle. */
    const body = after('const back = lastChannelIn.current.get(id)', 20)
    expect(body).toContain('openToRead(back)')
    expect(body).toContain("if (!back && wasOpen) setSlid('nav')")
  })

  it('and stays up when Home is pressed on the rail', () => {
    /*
     * Reported twice. The first fix was to the Home in the list, which goes
     * through onPage - but the tile on the rail is a different button with
     * its own handler, and that one restores what you were reading through
     * the door that closes the drawer. So Home opened the conversations and
     * covered them up in the same press, and the panel had to be opened again
     * to reach the thing Home was pressed for.
     *
     * Unlike picking a server, this puts it back whether or not there was
     * something to restore: picking a server is asking to open what is in it,
     * pressing Home is asking for the list.
     */
    /*
     * Bounded by where the handler ends, not by a count of lines.
     *
     * It was a window of thirty lines' worth of characters, and the handler
     * grew past it when Home learned to come back to the friends list and the
     * greeting as well as to a conversation - so the line being asserted fell
     * outside the window and read as having been removed. Widening the count
     * was worse: it ran off the end of this handler into the next one, which
     * legitimately contains the very line the last assertion here forbids.
     *
     * The prop after it is a fixed point that moves with the handler.
     */
    const at = shell.indexOf('onHome={() => {')
    expect(at, 'onHome is still in Shell.tsx').toBeGreaterThan(0)
    const ends = shell.indexOf('onPick={', at)
    expect(ends, 'and onPick still follows it').toBeGreaterThan(at)
    const body = shell.slice(at, ends)
    expect(body).toContain("const wasOpen = slid === 'nav'")
    const upTo = body
    expect(upTo, 'put back unconditionally, not only when there is nothing to open')
      .toContain("if (wasOpen) setSlid('nav')")
    expect(upTo).not.toContain('if (!back && wasOpen)')
  })

  it('and the scrim over it still closes it', () => {
    expect(shell).toContain("className=\"scrim slidscrim\" onClick={() => setSlid(null)}")
  })
})
