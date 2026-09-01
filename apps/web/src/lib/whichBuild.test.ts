import { describe, expect, it } from 'vitest'
import { versionLabel } from './whichBuild'

/**
 * What the corner of the settings screen says.
 *
 * It is read out loud in bug reports, so it has to be true: the desktop app
 * has a real version and a page has a build stamp, and saying "version" about
 * a page would be inventing one.
 */

describe('the desktop app', () => {
  it('says its version', () => {
    expect(versionLabel('0.2.40', 'e76099024e40')).toBe('Version 0.2.40')
  })

  it('and its version beats the stamp, because it is the thing people mean', () => {
    expect(versionLabel('1.2.3', 'abcdef123456')).toBe('Version 1.2.3')
  })
})

describe('a page', () => {
  it('says which build it is', () => {
    expect(versionLabel(undefined, 'e76099024e40')).toBe('Build e760990')
  })

  it('shortened enough to read out, and long enough to tell two apart', () => {
    const a = versionLabel(null, 'aaaaaaa111111')
    const b = versionLabel(null, 'aaaaaaa222222')
    expect(a).toBe(b)
    expect(versionLabel(null, 'abcdefg1').length).toBeLessThan(20)
  })
})

describe('the placeholder version', () => {
  it('is not printed as though it were true', () => {
    /*
     * Every packaged copy reported 0.1.0 for a while - the fallback for a
     * build that never had its version defined. It is not an answer, so the
     * stamp is used instead of repeating it.
     */
    expect(versionLabel('0.1.0', 'e76099024e40')).toBe('Build e760990')
  })

  it('and with nothing at all, says what that means', () => {
    expect(versionLabel('0.1.0', '')).toBe('Development build')
    expect(versionLabel(undefined, undefined)).toBe('Development build')
    expect(versionLabel('', '')).toBe('Development build')
  })
})

describe('whatever it is given', () => {
  it('is always something a person can read', () => {
    for (const [v, b] of [
      ['0.2.40', 'abc'], [undefined, 'abc'], ['', ''], ['  ', '  '],
      [null, null], ['0.1.0', undefined],
    ] as Array<[string | null | undefined, string | null | undefined]>) {
      const said = versionLabel(v, b)
      expect(said.length, `${v} / ${b}`).toBeGreaterThan(0)
      expect(said.trim()).toBe(said)
    }
  })
})
