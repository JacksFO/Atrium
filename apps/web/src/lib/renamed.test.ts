import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { BLOB, carryOverPreferences, KEPT, PER_TAB } from './renamed'
import { DEFAULTS } from './settings'

/**
 * Renaming the constants renames where the app looks, not what is already on
 * somebody's disk. Without this the app forgets which server it talks to -
 * which is being sent back to the first-run screen for no reason you did.
 */

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

describe('carrying preferences across the change of name', () => {
  it('brings a value over', () => {
    localStorage.setItem('jackscord.server', 'https://example.test')
    carryOverPreferences()
    expect(localStorage.getItem('atrium.server')).toBe('https://example.test')
  })

  it('and leaves the old one where it is', () => {
    /* A browser with an older copy of the client cached goes on working
       rather than being signed out by a page nobody asked for. */
    localStorage.setItem('jackscord.server', 'https://example.test')
    carryOverPreferences()
    expect(localStorage.getItem('jackscord.server')).toBe('https://example.test')
  })

  it('never over the top of something newer', () => {
    localStorage.setItem('jackscord.server', 'https://old.test')
    localStorage.setItem('atrium.server', 'https://now.test')
    carryOverPreferences()
    expect(localStorage.getItem('atrium.server')).toBe('https://now.test')
  })

  it('brings all of them, not only the first', () => {
    for (const k of ['server', 'voice.resume', 'lastdm', 'notes.seen', 'pip',
      'shareQuality', 'getapp.snoozed']) {
      localStorage.setItem(`jackscord.${k}`, k)
    }
    carryOverPreferences()
    for (const k of ['server', 'voice.resume', 'lastdm', 'notes.seen', 'pip',
      'shareQuality', 'getapp.snoozed']) {
      expect(localStorage.getItem(`atrium.${k}`), k).toBe(k)
    }
  })

  it('including the one kept per tab rather than per browser', () => {
    sessionStorage.setItem('jackscord.session', 'abc')
    carryOverPreferences()
    expect(sessionStorage.getItem('atrium.session')).toBe('abc')
  })

  it('says nothing when there is nothing to carry', () => {
    carryOverPreferences()
    expect(localStorage.length).toBe(0)
  })

  it('and can be run twice without harm', () => {
    localStorage.setItem('jackscord.server', 'https://example.test')
    carryOverPreferences()
    localStorage.setItem('atrium.server', 'https://changed.test')
    carryOverPreferences()
    expect(localStorage.getItem('atrium.server')).toBe('https://changed.test')
  })
})

describe('the preferences, which are all of them in one value', () => {
  /*
   * Reported as an update losing the panel arrangement. The panel widths, the
   * theme, whether your game shows, whether what you are listening to shows -
   * all of it is one stored value, and that value was the one key the change
   * of name did not carry. So an update looked like a fresh install of
   * everything except which server you were on.
   */
  const mine = JSON.stringify({ ...DEFAULTS, showGame: false, sideWidth: 401 })

  it('comes across', () => {
    localStorage.setItem('jackscord.settings', mine)
    carryOverPreferences()
    expect(localStorage.getItem('atrium.settings')).toBe(mine)
  })

  it('and comes across even now the defaults are sitting in its place', () => {
    /*
     * The build that renamed everything found nothing under the new name,
     * started everybody on the defaults and wrote those defaults back. Only
     * carrying when the new name is empty would therefore never fire again
     * for anybody who has already updated - which is everybody this is for.
     */
    localStorage.setItem('jackscord.settings', mine)
    localStorage.setItem('atrium.settings', JSON.stringify(DEFAULTS))
    carryOverPreferences()
    expect(localStorage.getItem('atrium.settings')).toBe(mine)
  })

  it('even when a setting has been added since it was stored', () => {
    /* The blob under the new name is this build's defaults; the one under the
       old name was written by a build with fewer settings in it. Compared
       field by field, the new one is still untouched. */
    const { theme: _theme, ...fewer } = DEFAULTS as Record<string, unknown>
    localStorage.setItem('jackscord.settings', JSON.stringify(fewer))
    localStorage.setItem('atrium.settings', JSON.stringify(DEFAULTS))
    carryOverPreferences()
    expect(localStorage.getItem('atrium.settings')).toBe(JSON.stringify(fewer))
  })

  it('but never over a setting somebody has changed since', () => {
    /* That change is newer than anything under the old name, and they meant
       it. Losing the old arrangement is worse than nothing; undoing what
       somebody just chose is worse than that. */
    const chosen = JSON.stringify({ ...DEFAULTS, theme: 'light' })
    localStorage.setItem('jackscord.settings', mine)
    localStorage.setItem('atrium.settings', chosen)
    carryOverPreferences()
    expect(localStorage.getItem('atrium.settings')).toBe(chosen)
  })

  it('and is not upset by a stored value that is not preferences at all', () => {
    localStorage.setItem('jackscord.settings', 'not json')
    localStorage.setItem('atrium.settings', 'also not json')
    expect(() => carryOverPreferences()).not.toThrow()
    expect(localStorage.getItem('atrium.settings')).toBe('also not json')
  })
})

describe('nothing the client stores is left behind', () => {
  /*
   * The list was written by hand and three keys were missed - the
   * preferences, the sign-in and the recent emoji. Counted here instead,
   * against the source, so the next key added to the client cannot be missed
   * the same way.
   */
  it('every name the client reads or writes is carried', () => {
    const src = ['lib', 'ui'].flatMap((dir) =>
      readdirSync(join(__dirname, '..', dir))
        .filter((f) => /\.(ts|tsx)$/.test(f) && !f.includes('.test.'))
        .map((f) => readFileSync(join(__dirname, '..', dir, f), 'utf8')))
      .join('\n')

    const used = new Set<string>()
    for (const m of src.matchAll(/'atrium\.([A-Za-z.]+)'/g)) used.add(m[1]!)
    expect(used.size, 'found the storage keys').toBeGreaterThan(5)

    const carried = new Set<string>([...KEPT, ...PER_TAB, BLOB])
    for (const name of used) {
      expect(carried.has(name), `atrium.${name} is not carried across the rename`).toBe(true)
    }
  })
})
