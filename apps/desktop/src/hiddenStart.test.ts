import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Started at login, and therefore not shown.
 *
 * setLoginItemSettings has passed `--hidden` since the pref existed, with a
 * comment saying the app should appear in the tray rather than throwing a
 * window at somebody who has just logged in. Nothing anywhere read
 * process.argv, so it did precisely the opposite of what its own comment
 * promised - and nobody found out, because the setting was never offered in
 * the settings window at all.
 *
 * This is source-read rather than run, for the same reason navigation.test.ts
 * is: main.ts imports electron at the top and cannot be loaded outside it. So
 * the assertions are about the four places a window can appear during a
 * launch, all of which have to agree.
 */

const src = readFileSync(join(__dirname, 'main.ts'), 'utf8').split('\r\n').join('\n')

describe('the login item', () => {
  it('still asks Windows to start the app hidden', () => {
    expect(src).toContain("args: ['--hidden']")
  })

  it('and something now reads it', () => {
    expect(src).toMatch(/process\.argv\.includes\('--hidden'\)/)
  })
})

/**
 * The four ways a window gets on screen during a launch. Each is checked
 * against the flag; the point of listing them together is that missing one
 * makes the whole feature not work while looking implemented.
 */
describe('nothing appears on a login start', () => {
  /** The body of one function, bounded rather than run to the end of file. */
  function fn(name: string, ends = '\n}'): string {
    const from = src.indexOf(name)
    expect(from, `${name} exists`).toBeGreaterThan(-1)
    const to = src.indexOf(ends, from)
    expect(to, `${name} is bounded`).toBeGreaterThan(from)
    return src.slice(from, to)
  }

  /* The splash is a window too, and a splash on a login start is the exact
     thing this is meant to prevent - it just disappears afterwards. */
  it('not the splash', () => {
    expect(src).toMatch(/if \(!openedByLogin\) createSplash\(\)/)
  })

  it('nor the main window when it becomes ready', () => {
    const reveal = fn('function revealMainWindow')
    expect(reveal).toContain('if (openedByLogin) return')
    /* Before the show, or the guard is decoration. */
    expect(reveal.indexOf('if (openedByLogin) return'))
      .toBeLessThan(reveal.indexOf('win.show()'))
  })

  /*
   * Nor the half-minute fallback, which exists for a window that never
   * becomes ready and shows it regardless. That is right for an ordinary
   * launch and wrong for this one - and it is the one that would have made
   * the feature look like it worked, then thrown a window up thirty seconds
   * into somebody's login.
   */
  it('nor the fallback that shows a window that never became ready', () => {
    const from = src.indexOf('setTimeout(() => {\n    if (!splash) return')
    expect(from).toBeGreaterThan(-1)
    const guard = src.slice(from, src.indexOf('}, 30_000)', from))
    expect(guard).toContain('if (openedByLogin) return')
  })
})

/**
 * And it is a start, not a mode.
 *
 * Held open past the launch, this would be an app that could never show its
 * window - so every route by which a person asks for it clears the flag, and
 * they all go through one function so that a new one cannot forget.
 */
describe('asking for the window', () => {
  it('goes through one place', () => {
    expect(src).toContain('function showMainWindow()')
    expect(src).toMatch(/function showMainWindow\(\): void \{\s*openedByLogin = false/)
  })

  it('and the tray uses it, both ways in', () => {
    expect(src).toContain("{ label: 'Open Atrium', click: showMainWindow }")
    expect(src).toContain("tray.on('double-click', showMainWindow)")
  })

  /* Clicking the icon while it is already running arrives here. Somebody
     who just double-clicked the shortcut is asking for a window. */
  it('and so does a second launch', () => {
    const from = src.indexOf("app.on('second-instance'")
    expect(from).toBeGreaterThan(-1)
    expect(src.slice(from, src.indexOf('})', from))).toContain('showMainWindow()')
  })

  /* Nothing else may show the window behind the flag's back, or the flag is
     true while a window is on screen and the next reveal is wrong. */
  it('and nothing else calls win.show() directly', () => {
    const direct = [...src.matchAll(/win\??\.show\(\)/g)]
    expect(direct.length, 'only revealMainWindow and showMainWindow').toBeLessThanOrEqual(3)
  })
})
