import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The channel menu asks the channel.
 *
 * Rename, Delete and Permissions are all guarded server-side with guardIn -
 * the channel's own answer - because a channel that denies manage_channels to
 * a role is not that role's to rename. The menu asked the server-wide answer,
 * so somebody denied it in one channel was still offered all three there and
 * refused on the way out.
 *
 * That is not a hole: the server is right and nothing gets through. It is the
 * rule this app keeps everywhere else - a gated control is absent rather than
 * refused - broken in the one place where the two scopes differ. Asking the
 * wrong one makes the item neither absent nor working.
 *
 * Read from the source because the alternative is mounting the whole Shell
 * with a world, a socket and a menu system to assert which of two variables
 * an if statement names.
 */

const src = readFileSync(join(__dirname, 'Shell.tsx'), 'utf8').split('\r\n').join('\n')

/** The channel menu's handler, bounded at both ends rather than to EOF. */
const menu = (() => {
  const from = src.indexOf("const channel = world.channels.find((c) => c.id === id)")
  const to = src.indexOf('setChanMenu({ items, x, y })', from)
  return { from, to, body: src.slice(from, to) }
})()

describe('the channel context menu', () => {
  it('is one handler, bounded at both ends', () => {
    expect(menu.from).toBeGreaterThan(-1)
    expect(menu.to).toBeGreaterThan(menu.from)
    expect(menu.body.length).toBeLessThan(3000)
  })

  /* The channel's own answer, worked out for the channel the menu is about. */
  it('works out what may be done in this channel', () => {
    expect(menu.body).toMatch(/world\.held\.in\([^)]*,\s*id\)/)
  })

  /*
   * And none of the three items reads the server-wide set. `here` is the
   * space-wide answer and is right for the things that happen to a server -
   * making a channel, opening server settings - and wrong for these.
   */
  it('and none of its items reads the server-wide answer', () => {
    expect(menu.body).not.toContain('here.includes(')
  })

  it('while still gating each item on the permission the route asks for', () => {
    expect(menu.body).toContain("mayHere.includes('manage_channels')")
    expect(menu.body).toContain("mayHere.includes('manage_roles')")
  })
})

/**
 * And the space-wide answer is still used where a server is the subject.
 *
 * Swapping every `here` for the channel's answer would be the same mistake
 * pointing the other way: creating a channel is guarded on the server, not on
 * any channel, so reading a channel's answer for it would hide the item
 * inside a channel that denies manage_channels - which is not what the route
 * would do.
 */
describe('the server-wide answer', () => {
  it('is still what decides the server settings panes', () => {
    expect(src).toContain('serverPanesFor(here)')
  })

  it('and what decides making a channel under a heading', () => {
    const at = src.indexOf("if (here.includes('manage_channels'))")
    expect(at, 'the category menu still asks the server').toBeGreaterThan(-1)
    expect(src.slice(at, at + 400)).toContain('New channel here')
  })
})
