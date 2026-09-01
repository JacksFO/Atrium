import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { HomeNotice } from './HomeNotice'

/**
 * The notice at the top of the home page.
 *
 * The first version of this had a table, three routes and an editor gated
 * behind the instance owner - which quietly invented the one thing this app
 * is built not to have. Nobody owns Atrium: every account is another
 * account, and every server belongs to whoever made it. An account that can
 * write to everybody's home page is an owner however carefully the word is
 * avoided.
 *
 * So it is a constant, changed in a commit by whoever is deploying, which is
 * the same authority as changing anything else here. These tests exist to
 * stop it growing a runtime editor again.
 */

const src = {
  notice: readFileSync(resolve(process.cwd(), 'src/lib/notice.ts'), 'utf8'),
  card: readFileSync(resolve(process.cwd(), 'src/ui/HomeNotice.tsx'), 'utf8'),
  home: readFileSync(resolve(process.cwd(), 'src/ui/Home.tsx'), 'utf8'),
}

let root: Root | null = null
let host: HTMLDivElement | null = null

function draw(node: React.ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root!.render(node) })
  return host
}

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
})

describe('where the notice comes from', () => {
  it('is written in the source', () => {
    expect(src.notice).toContain('export const NOTICE')
  })

  /*
   * The whole point of it. Nobody gets a switch nobody else has.
   *
   * The notice is a constant in the source and the app only ever reads it -
   * so there is no route to write it and nothing to decide who may. This
   * used to also forbid the two ways an account could once have been asked
   * whether it was special; neither exists to be asked any more, so what is
   * left is the thing that matters: it is read, never written.
   */
  it('and nothing in the app can write it', () => {
    for (const [where, text] of Object.entries(src)) {
      expect(text, `${where} still writes the notice`).not.toMatch(/home-notice/)
    }
  })

  it('and it is not fetched, so there is nothing to gate', () => {
    expect(src.card).not.toContain('server.get')
    expect(src.card).not.toContain('useState')
  })
})

describe('the card', () => {
  it('says what the notice says', () => {
    const el = draw(<HomeNotice />)
    expect(el.textContent).toContain('Atrium')
  })

  /* An empty card announcing that there is no announcement is worse than the
     space it takes. */
  it('and draws nothing at all when there is nothing to say', () => {
    /* The component reads the constant, so this checks the branch exists
       rather than re-importing with a different value. */
    expect(src.card).toContain('if (!notice) return null')
  })

  /* Outbound, like every other link here: away from the app, and without
     handing the app over with it. */
  it('and a link on it opens away without passing the app along', () => {
    expect(src.card).toContain('rel="noreferrer noopener"')
    expect(src.card).toContain('target="_blank"')
  })
})
