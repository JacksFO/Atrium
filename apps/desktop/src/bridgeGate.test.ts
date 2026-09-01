import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Who gets the bridge.
 *
 * A preload runs for whatever is loaded in its window, so the clipboard,
 * notifications, the screen-share picker and the stored address of the server
 * were handed to any page that got itself loaded there. The main process is
 * careful about which those are - but that left one check standing between an
 * unfamiliar page and all of it, and that check had already been wrong once.
 */

const preload = readFileSync(join(__dirname, 'preload.ts'), 'utf8')
const main = readFileSync(join(__dirname, 'main.ts'), 'utf8')

/** The rule as the preload states it, for a page at this address. */
const ours = (protocol: string, host: string, pathname: string, allowed: string[]) => {
  if (protocol === 'file:' && /\/offline\.html$/.test(pathname)) return true
  return allowed.includes(`${protocol}//${host}`)
}

const allowed = ['app://atrium', 'https://atriumapp.duckdns.org']

describe('the pages that are the app', () => {
  it('include the server it is pointed at', () => {
    expect(ours('https:', 'atriumapp.duckdns.org', '/', allowed)).toBe(true)
  })

  it('and the copy inside the installer', () => {
    expect(ours('app:', 'atrium', '/index.html', allowed)).toBe(true)
  })

  it('and the page shown when the server will not answer', () => {
    /* It needs the bridge to offer Retry and the window buttons, and it is
       loaded from disk by the main process. */
    expect(ours('file:', '', '/C:/Program%20Files/Atrium/dist/offline.html', allowed)).toBe(true)
  })
})

describe('the pages that are not', () => {
  it('include a host whose name merely begins with the server\'s', () => {
    expect(ours('https:', 'atriumapp.duckdns.org.evil.example', '/', allowed)).toBe(false)
  })

  it('and the same name over plain http', () => {
    expect(ours('http:', 'atriumapp.duckdns.org', '/', allowed)).toBe(false)
  })

  it('and any other file on the disk', () => {
    /* The navigation guard should never let one load, but this is the layer
       that is not supposed to depend on that being true. */
    expect(ours('file:', '', '/C:/Windows/System32/drivers/etc/hosts', allowed)).toBe(false)
    expect(ours('file:', '', '/C:/tmp/offline.html.evil', allowed)).toBe(false)
  })

  it('and a different custom scheme', () => {
    expect(ours('app:', 'atrium-evil', '/index.html', allowed)).toBe(false)
  })
})

describe('how it is wired', () => {
  it('the bridge is exposed behind the check, not beside it', () => {
    const at = preload.indexOf('if (partOfTheApp()) {')
    expect(at, 'the check is gone').toBeGreaterThan(-1)
    expect(preload.indexOf("exposeInMainWorld('atrium'"), 'exposed outside the check')
      .toBeGreaterThan(at)
  })

  it('and both names are behind it, not only the new one', () => {
    const after = preload.slice(preload.indexOf('if (partOfTheApp()) {'))
    expect(after).toContain("exposeInMainWorld('atrium', bridge)")
    expect(after).toContain("exposeInMainWorld('jackscord', bridge)")
  })

  it('asks the main process rather than deciding alone', () => {
    /* Only it knows which server this copy is pointed at, and that can change
       while the app is running - so a list baked in when the window was made
       would be wrong from then on. */
    expect(preload).toContain("ipcRenderer.sendSync('app:where-allowed')")
    expect(main).toContain("ipcMain.on('app:where-allowed'")
  })

  it('and the two checks share one idea of what a place is', () => {
    /* The navigation guard and this one must not drift apart. */
    expect(main).toContain('function placeOf(')
    expect(main).toContain('return from.map(placeOf)')
    const guard = main.slice(main.indexOf('const sameHost ='), main.indexOf('const sameHost =') + 200)
    expect(guard).toContain('placeOf(url)')
  })
})
