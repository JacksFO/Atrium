import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SETTINGS_INDEX, findSettings } from './settingsIndex'

/**
 * The index cannot quietly stop matching the screen.
 *
 * It is written out by hand, because the panes render one at a time and there
 * is no moment when the app can see all of its own settings. A hand-written
 * list is a list that drifts: a row renamed leaves a result that opens the
 * right pane and points at nothing, which is worse than not finding it.
 */
const settings = readFileSync(join(__dirname, '..', 'ui', 'Settings.tsx'), 'utf8')
const mePane = readFileSync(join(__dirname, '..', 'ui', 'MePane.tsx'), 'utf8')

describe('the settings index', () => {
  it('names panes that exist', () => {
    const panes = new Set(
      [...settings.matchAll(/id === '([a-z]+)'/g)].map((m) => m[1]),
    )
    for (const entry of SETTINGS_INDEX) {
      expect(panes, `${entry.title} points at a pane that is drawn`).toContain(entry.pane)
    }
  })

  /*
   * Every title is a row somebody can actually land on. Checked against the
   * source of the two files that draw them rather than against a second list,
   * which would only be the same list twice.
   */
  it('and titles that are drawn somewhere', () => {
    const drawn = settings + mePane
    const missing = SETTINGS_INDEX
      .filter((e) => !drawn.includes(`"${e.title}"`) && !drawn.includes(`>${e.title}<`))
      .map((e) => e.title)
    expect(missing, 'these are indexed but no longer on screen').toEqual([])
  })
})

describe('finding one', () => {
  it('finds a setting by its own name', () => {
    expect(findSettings('noise')[0]?.title).toBe('Noise suppression')
  })

  /* The case the whole thing is for: the word somebody uses is not the word
     on the row. */
  it('and by a word somebody would use instead', () => {
    expect(findSettings('ptt').map((f) => f.title)).toContain('Hold a key to talk')
    expect(findSettings('spotify')[0]?.title).toBe('Show what you are listening to')
    expect(findSettings('logout')[0]?.title).toBe('Sign out')
  })

  /* A title that starts with what was typed beats one that merely contains
     it: "mic" is Microphone, not Automatic gain. */
  it('and offers the closest one first', () => {
    expect(findSettings('mic')[0]?.title).toBe('Microphone')
  })

  it('and offers nothing for nonsense', () => {
    expect(findSettings('xyzzy')).toEqual([])
    expect(findSettings('   ')).toEqual([])
  })
})
