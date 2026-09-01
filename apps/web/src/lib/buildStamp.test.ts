import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isStale } from './stale'

/**
 * Saying which build this is.
 *
 * The app tells somebody a newer build is being served by comparing the id
 * baked into the page against the one in /version.json. Neither existed:
 * index.html had no build meta at all, so runningBuild() returned nothing,
 * the check gave up on its first line, and the banner could not appear
 * however old the tab was. version.json was written only by deploy.mjs, so
 * any deploy that copied the folder by hand left an old id sitting there.
 *
 * Reported as not having seen the reload banner in a while. It had not been
 * possible to see it.
 */

const config = readFileSync(resolve(process.cwd(), 'vite.config.ts'), 'utf8')

describe('the build stamp', () => {
  it('is written by the build, not by whoever deploys', () => {
    expect(config).toContain('atrium-build-stamp')
    expect(config).toContain("apply: 'build'")
  })

  /* Both, from one value. Two things that have to agree and are written in
     two places are two things that can disagree. */
  it('and writes both places from the same value', () => {
    const plugin = config.slice(config.indexOf('function stampBuild'))
    expect(plugin).toContain('name="build"')
    expect(plugin).toContain('version.json')
    /* One id, used twice. */
    expect(plugin.match(/const id = /g)).toHaveLength(1)
  })

  /*
   * From the asset names, which Vite already derives from their contents - so
   * the id moves when the bundle moves and not when a build simply ran again.
   * A stamp that changed on every build would show the banner to everybody
   * every time anything was rebuilt.
   */
  it('and into the directory it actually built', () => {
    /*
     * It was the literal 'dist'. A build sent anywhere else - --outDir, which
     * is how a copy is made without disturbing the one being served - wrote
     * its stamp into a directory it had not built and left the one it had
     * built unstamped. A page with no stamp can never be told a newer one
     * exists, which is the fault this plugin exists to prevent, arriving
     * through the way somebody chose to build.
     */
    expect(config).toContain('config.build.outDir')
    expect(config).not.toMatch(/const dir = 'dist'/)
  })

  it('and from what is in the bundle rather than from the clock', () => {
    const plugin = config.slice(config.indexOf('function stampBuild'))
    expect(plugin).not.toContain('Date.now')
    /* Escaped in the source, because it is inside a regular expression. */
    expect(plugin).toContain('assets')
  })

  /* Built here, so this can check the two really do agree. Skipped where
     nothing has been built, which is an ordinary state for a checkout. */
  it('and the built page and version.json say the same thing', () => {
    const dir = resolve(process.cwd(), 'dist')
    const page = resolve(dir, 'index.html')
    const json = resolve(dir, 'version.json')
    if (!existsSync(page) || !existsSync(json)) return

    const inPage = /<meta name="build" content="([^"]+)"/.exec(readFileSync(page, 'utf8'))
    const inJson = JSON.parse(readFileSync(json, 'utf8')) as { build?: string }
    expect(inPage, 'the built page carries no build id').not.toBeNull()
    expect(inJson.build).toBe(inPage![1])
  })
})

describe('and the comparison it feeds', () => {
  it('says nothing when this page has no id', () => {
    /* Which is development, where every reload is a different build and
       saying so on each one is a banner that never goes away. */
    expect(isStale('', 'abc')).toBe(false)
  })

  it('and nothing when the server did not answer with one', () => {
    expect(isStale('abc', undefined)).toBe(false)
    expect(isStale('abc', '')).toBe(false)
  })

  it('but yes when they are different', () => {
    expect(isStale('abc', 'def')).toBe(true)
  })

  it('and no when they are the same', () => {
    expect(isStale('abc', 'abc')).toBe(false)
  })
})
