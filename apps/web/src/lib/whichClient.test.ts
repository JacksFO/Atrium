import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Everything points at the client people actually use.
 *
 * apps/client is the one that came before this one. It is still in the repo
 * for exactly one reason - the page the desktop app falls back to when it
 * cannot reach a server - and every other thing that ever pointed at it now
 * points here.
 *
 * That is worth a test rather than a note, because the failure is silent in
 * the worst way. The browser suite built apps/client for months after nobody
 * ran it: every spec passed, in detail, about a DOM that was not on anybody's
 * screen. It was found by writing a spec for a feature that only exists here
 * and watching it fail to find a single panel - not by anything going wrong.
 *
 * So: if something starts building or serving the old client again, this says
 * so on the next run instead of in six months.
 */

const root = resolve(process.cwd(), '..', '..')
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')

describe('the browser suite', () => {
  const runner = read('test/ui/run.mjs')

  it('builds this client, not the old one', () => {
    expect(runner, 'the browser suite builds the old client')
      .toContain("join(ROOT, 'apps', 'web')")
    expect(runner).not.toContain("join(ROOT, 'apps', 'client')")
  })
})

describe('the server', () => {
  const index = read('apps/server/src/index.ts')

  it('serves this client by default', () => {
    /* It used to default to apps/client/dist and be fed by a copy after every
       build - a hand step nothing checked and nobody would notice going
       stale. */
    expect(index).toContain("'../../web/dist'")
    expect(index).not.toContain("'../../client/dist'")
  })
})

/*
 * And the desktop app, which was the last thing pointing at the old one.
 *
 * It packages a copy of a client to open before it knows which server to
 * ask, and when it cannot reach one. That copy had to come from apps/client
 * because this client had no way to carry an address baked in at build time -
 * a packaged copy of it would have opened with nothing to talk to.
 *
 * It reads one now, so the copy is built from here and the old client has
 * nothing left pointing at it.
 */
describe('the desktop app', () => {
  const desktop = JSON.parse(read('apps/desktop/package.json')) as {
    scripts: Record<string, string>
    build: { extraResources: Array<{ from: string }> }
  }

  it('packages this client', () => {
    expect(desktop.build.extraResources[0]?.from).toBe('../web/dist-desktop')
  })

  it('and builds it from here', () => {
    expect(desktop.scripts.build).toContain('@atrium/web')
    expect(desktop.scripts.build).not.toContain('@atrium/client')
  })

  /* The thing that made that possible, and the thing to keep: without it the
     packaged copy has no server to ask. */
  it('because this client can carry a built-in address', () => {
    expect(read('apps/web/src/lib/server.ts')).toContain('VITE_DEFAULT_SERVER')
  })
})
