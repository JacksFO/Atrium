import { afterEach, describe, expect, it } from 'vitest'
import { badgeIcon, badgeLabel, badgeTooltip, isDesktop, shell } from './shell'

const w = globalThis as unknown as { atrium?: unknown; jackscord?: unknown }
afterEach(() => { delete w.atrium; delete w.jackscord })

describe('whether there is a shell at all', () => {
  /* The same build is served to a browser and to the app. A page that assumes
     the bridge is there is a page that throws on the web. */
  it('is no in a browser, which is not an error', () => {
    expect(shell()).toBe(null)
    expect(isDesktop()).toBe(false)
  })

  it('and yes when the app put one there', () => {
    w.atrium = { setBadge: () => {} }
    expect(isDesktop()).toBe(true)
  })

  /*
   * And under the name the app used to go by.
   *
   * The page is served by the server and the shell is installed, so somebody
   * can be running today's page inside a shell from before the rename - one
   * that offers only the old name. Reading only the new one would take push
   * to talk, the share picker, the saved password and the update itself away
   * from exactly the people who had not updated yet, and the update is how
   * they would have got the shell that fixed it.
   */
  it('and yes for a shell from before the rename', () => {
    w.jackscord = { setBadge: () => {} }
    expect(isDesktop()).toBe(true)
  })

  it('preferring the new name where a shell offers both', () => {
    w.atrium = { setBadge: () => {}, version: 'new' }
    w.jackscord = { setBadge: () => {}, version: 'old' }
    expect(shell()?.version).toBe('new')
  })

  /*
   * Asked for a method rather than for the object. An older shell that
   * predates a feature still exposes the object, and calling something it has
   * never had is the crash this is here to avoid — somebody on last month's
   * build opening the app to a white screen.
   */
  it('and no for a shell too old to have what is being asked for', () => {
    w.atrium = { version: '0.0.1', platform: 'win32' }
    expect(shell()).toBe(null)
  })
})

describe('what the tray says', () => {
  it('counts, and counts one properly', () => {
    expect(badgeTooltip(1)).toContain('1 unread message')
    expect(badgeTooltip(4)).toContain('4 unread messages')
  })

  /* A tooltip reading "0 unread messages" is a sentence somebody has to read
     to learn there is nothing to read. */
  it('and says nothing about nothing', () => {
    expect(badgeTooltip(0)).toBe('Atrium')
  })
})

describe('what the badge reads', () => {
  it('is the number', () => {
    expect(badgeLabel(7)).toBe('7')
    expect(badgeLabel(99)).toBe('99')
  })

  /*
   * Past ninety-nine it says so instead: a taskbar badge is about sixteen
   * pixels across, and "128" in that space is a smudge that says only "some".
   */
  it('and stops counting at ninety-nine', () => {
    expect(badgeLabel(100)).toBe('99+')
    expect(badgeLabel(1200)).toBe('99+')
  })
})

describe('the badge picture', () => {
  /*
   * Only this much can be asked here. jsdom has no canvas, so anything past
   * the guard draws nothing — the first version of this test mocked its way
   * around that and passed for having returned early, which is why the label
   * is its own function above.
   */
  it('is nothing at all when nothing is waiting', () => {
    expect(badgeIcon(0)).toBe(null)
  })
})
