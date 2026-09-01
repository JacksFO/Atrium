import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Which addresses the window itself is allowed to become.
 *
 * This matters more than it looks. The preload bridge is exposed to whatever
 * page is loaded in the window - clipboard, notifications, the screen-share
 * picker, the address of the server itself - and this check is the only thing
 * that decides which pages those are.
 *
 * It compared with startsWith, and the stored address has its trailing slash
 * stripped, so `https://atriumapp.duckdns.org` allowed
 * `https://atriumapp.duckdns.org.evil.example/` - a different site that
 * merely begins with the right letters.
 */

const main = readFileSync(join(__dirname, 'main.ts'), 'utf8')

/** The comparison as the source now makes it. */
const sameHost = (url: string, base: string): boolean => {
  try {
    const a = new URL(url)
    const b = new URL(base)
    return a.protocol === b.protocol && a.host === b.host
  } catch {
    return false
  }
}

const server = 'https://atriumapp.duckdns.org'
const allowed = ['app://atrium', server]
const permitted = (url: string) => allowed.some((base) => sameHost(url, base))

describe('the address the window may become', () => {
  it('is the server it was pointed at', () => {
    expect(permitted('https://atriumapp.duckdns.org/')).toBe(true)
    expect(permitted('https://atriumapp.duckdns.org/settings')).toBe(true)
  })

  it('and the copy inside the installer', () => {
    expect(permitted('app://atrium/index.html')).toBe(true)
  })

  it('but never a host that merely begins with it', () => {
    /* The bug. Both of these are somebody else's site. */
    expect(permitted('https://atriumapp.duckdns.org.evil.example/')).toBe(false)
    expect(permitted('https://atriumapp.duckdns.org.attacker.test/steal')).toBe(false)
    expect(permitted('app://atrium-evil/')).toBe(false)
  })

  it('nor the same name over plain http', () => {
    /* A downgrade is a different origin and must not inherit the bridge. */
    expect(permitted('http://atriumapp.duckdns.org/')).toBe(false)
  })

  it('nor an unrelated site', () => {
    expect(permitted('https://evil.test/')).toBe(false)
    expect(permitted('file:///C:/Windows/System32/')).toBe(false)
  })

  it('and refuses anything that is not an address at all', () => {
    expect(permitted('not a url')).toBe(false)
    expect(permitted('')).toBe(false)
  })
})

describe('the source itself', () => {
  it('no longer decides this with startsWith', () => {
    /* Said against the file because the rule is only as good as the call
       site, and the obvious thing to write here is the broken one. */
    const at = main.indexOf("win.webContents.on('will-navigate'")
    expect(at, 'the guard is still there').toBeGreaterThan(0)
    const guard = main.slice(at, at + 1600)
    expect(guard).toContain('sameHost(url, base)')
    expect(guard, 'a prefix match is not an origin match')
      .not.toContain('url.startsWith(base)')
  })

  it('and compares scheme and host rather than origin', () => {
    /*
     * `new URL('app://atrium').origin` is the string "null", and two of those
     * match each other - which would make every custom scheme the same place.
     *
     * The comparison lives in placeOf now, shared with the check that decides
     * who gets the preload bridge, so the two cannot drift apart.
     */
    expect(main).toContain('function placeOf(')
    const of = main.slice(main.indexOf('function placeOf('), main.indexOf('function placeOf(') + 260)
    expect(of).toContain('${u.protocol}//${u.host}')
    expect(of, 'origin is the trap this avoids').not.toContain('u.origin')
  })
})
