import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The box that names something says what it is naming.
 *
 * One modal names four different things - a category, a channel, a rename and
 * somebody's nickname - and its words were a two-way branch: a category, or
 * else the channel copy. So right-clicking a person to give them a nickname
 * explained that "a channel name is an address, so it is lowercased and
 * hyphenated", offered "Board games" as an example of what to call them, and
 * put Create on the button.
 *
 * Reported by Jack from a screenshot. It is the sort of thing nothing catches:
 * every branch renders, nothing throws, and the words are only wrong if you
 * read them.
 *
 * Asked of the source rather than a render because the modal needs most of
 * the app around it to draw at all, and what is being checked is that each
 * kind is named in the branch - a fall-through is exactly the bug.
 */

const src = readFileSync(join(__dirname, 'Shell.tsx'), 'utf8')

/** The naming modal, from where it opens to where it closes. */
function modal(): string {
  const at = src.indexOf('{naming && space && (')
  expect(at, 'the naming modal is still there').toBeGreaterThan(0)
  const end = src.indexOf('{deleting && (', at)
  expect(end, 'and still followed by the delete one').toBeGreaterThan(at)
  return src.slice(at, end)
}

describe('naming something', () => {
  it('tells a nickname apart from a channel', () => {
    const body = modal()
    /* The hint has to mention the kind at all. Before, it did not: nickname
       fell through to the channel sentence. */
    expect(body).toContain("naming.kind === 'nickname'")
    /* And the channel sentence must not be what a nickname falls back to. */
    const hint = body.slice(body.indexOf('<p className="hint">'))
    expect(hint).toContain("naming.kind === 'nickname'")
  })

  it('and does not offer a channel example for a person', () => {
    const body = modal()
    /* The placeholder was the literal string for every kind. */
    expect(body).not.toMatch(/placeholder="Board games"/)
    expect(body).toContain('naming.was')
  })

  it('and does not say Create when nothing is being created', () => {
    const body = modal()
    expect(body).toContain("naming.kind === 'nickname' ? 'Save'")
  })

  /*
   * Clearing the box is how a nickname comes off, and the route reads an
   * empty name that way - but the button was disabled while the box was
   * empty, so the one thing the code documents could not be done.
   */
  it('and lets a nickname be cleared, which is how you remove one', () => {
    const body = modal()
    expect(body).toContain("disabled={!newName.trim() && naming.kind !== 'nickname'}")
  })
})
