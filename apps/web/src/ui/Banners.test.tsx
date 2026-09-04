import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UpdateBanner } from './UpdateBanner'
import { snooze, snoozed, WHY, GetDesktopBanner } from './GetDesktop'

/**
 * The two bars that say something about the app itself.
 *
 * Both halves of each already existed: the shell has answered updateState and
 * onUpdate all along, and the server has answered /api/desktop all along. The
 * client asked neither — so an update downloaded quietly and waited for a
 * quit nobody knew to make, and somebody in a browser had no way of learning
 * there was an app at all.
 */

let root: Root | null = null
let host: HTMLDivElement | null = null

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = null; host = null
  delete (globalThis as { atrium?: unknown }).atrium
  vi.unstubAllGlobals()
})

const draw = (ui: React.ReactNode) => {
  act(() => { root?.render(ui) })
  return host as HTMLDivElement
}

/** A desktop shell that can be told what the updater last said. */
function withShell(state: {
  stage: string; version: string; percent: number; error: string
}) {
  const installUpdate = vi.fn(async () => true)
  const downloadUpdate = vi.fn(async () => true)
  const checkForUpdate = vi.fn(async () => ({ supported: true, version: '9.9.9' }))
  ;(globalThis as { atrium?: unknown }).atrium = {
    setBadge: () => {},
    updateState: async () => state,
    onUpdate: () => {},
    checkForUpdate,
    downloadUpdate,
    installUpdate,
  }
  return { installUpdate, downloadUpdate, checkForUpdate }
}

describe('the update bar', () => {
  it('says nothing in a browser', async () => {
    const el = draw(<UpdateBanner />)
    await act(async () => {})
    expect(el.querySelector('.updbar')).toBe(null)
  })

  it('and nothing when there is no update', async () => {
    withShell({ stage: 'idle', version: '', percent: 0, error: '' })
    const el = draw(<UpdateBanner />)
    await act(async () => {})
    expect(el.querySelector('.updbar')).toBe(null)
  })

  /*
   * The one that matters. An update downloaded in a previous session was
   * announced before this existed, so without catching up on what the
   * updater last said there is nothing on screen and nothing to restart into.
   */
  it('but catches up on one that is already waiting', async () => {
    withShell({ stage: 'ready', version: '0.2.27', percent: 100, error: '' })
    const el = draw(<UpdateBanner />)
    await act(async () => {})
    expect(el.textContent).toContain('0.2.27')
    expect(el.textContent).toContain('installs when you next close')
  })

  it('and offers the restart, which is the only button in the ordinary path', async () => {
    const { installUpdate } = withShell({
      stage: 'ready', version: '0.2.27', percent: 100, error: '',
    })
    const el = draw(<UpdateBanner />)
    await act(async () => {})
    const go = [...el.querySelectorAll('button')].find((b) => b.textContent === 'Restart now')
    expect(go).toBeTruthy()
    act(() => { (go as HTMLElement).click() })
    expect(installUpdate).toHaveBeenCalled()
  })

  it('and shows how far a download has got', async () => {
    withShell({ stage: 'downloading', version: '0.2.27', percent: 42, error: '' })
    const el = draw(<UpdateBanner />)
    await act(async () => {})
    expect(el.textContent).toContain('42%')
    expect(el.querySelector('.ubprog')).toBeTruthy()
  })
})

describe('the offer of the app', () => {
  const build = {
    available: true, version: '0.2.27', filename: 'Atrium-Setup-0.2.27.exe',
    bytes: 104_577_094, packageBytes: null,
  }

  it('is made where there is an installer to offer', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => build })))
    const el = draw(<GetDesktopBanner />)
    await act(async () => {})
    expect(el.textContent).toContain('runs better as an app')
    expect(el.textContent).toContain('0.2.27')
  })

  /* Never in the app itself, which would be the app offering itself. */
  it('but never inside the app', async () => {
    ;(globalThis as { atrium?: unknown }).atrium = { setBadge: () => {} }
    const fetched = vi.fn()
    vi.stubGlobal('fetch', fetched)
    const el = draw(<GetDesktopBanner />)
    await act(async () => {})
    expect(fetched).not.toHaveBeenCalled()
    expect(el.querySelector('.getapp')).toBe(null)
  })

  /* An older server has no such route: no offer, and no error either. */
  it('and says nothing when the server has no build', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => null })))
    const el = draw(<GetDesktopBanner />)
    await act(async () => {})
    expect(el.querySelector('.getapp')).toBe(null)
  })

  it('and gets out of the way when asked', async () => {
    localStorage.clear()
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => build })))
    const el = draw(<GetDesktopBanner />)
    await act(async () => {})
    act(() => { (el.querySelector('[aria-label="Hide for a week"]') as HTMLElement).click() })
    expect(el.querySelector('.getapp')).toBe(null)
  })

  /*
   * And stays away. Put away for the session alone, it was back on every
   * load - which is a thing you dismiss over and over rather than a thing
   * you dismissed.
   */
  it('and stays away for a week, not until the next load', async () => {
    localStorage.clear()
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => build })))
    const first = draw(<GetDesktopBanner />)
    await act(async () => {})
    act(() => { (first.querySelector('[aria-label="Hide for a week"]') as HTMLElement).click() })

    /* A fresh mount, as a reload is. */
    const again = draw(<GetDesktopBanner />)
    await act(async () => {})
    expect(again.querySelector('.getapp')).toBe(null)
  })

  it('but comes back once that week is up', async () => {
    localStorage.clear()
    snooze(Date.now() - 8 * 24 * 60 * 60_000)
    expect(snoozed()).toBe(false)
  })

  it('and one line, because the conversation reserves room for this strip', () => {
    /* Three lines of advertisement is a hundred pixels the conversation
       moves down by, which is what it was reported as. */
    expect(WHY.length, 'the sentence lives on the button now').toBeGreaterThan(0)
  })
})

/**
 * Getting out of a failed update.
 *
 * Try again asked for a download, and there is nothing to download until a
 * check has succeeded - so after a failed check the shell refused it outright
 * with "please check update first", and the one button offered for recovering
 * could not recover from the likeliest failure there is.
 *
 * Which is not hypothetical: the app looked for a release during the minute
 * it was being uploaded, got a 404, and every press after that said that
 * instead. Reported with a screenshot of exactly that.
 */
describe('trying again after an update went wrong', () => {
  it('looks for the update again rather than asking to download one', async () => {
    const shell = withShell({
      stage: 'error', version: '', percent: 0,
      error: 'Cannot find latest.yml in the latest release artifacts',
    })
    const el = draw(<UpdateBanner />)
    await act(async () => {})

    const again = [...el.querySelectorAll('button')]
      .find((b) => /try again/i.test(b.textContent || ''))
    expect(again, 'there is no Try again to press').toBeTruthy()

    await act(async () => { again!.click() })

    expect(shell.checkForUpdate, 'it never looked again').toHaveBeenCalled()
    expect(shell.downloadUpdate,
      'it asked to download, which is what the shell refuses after a failed check')
      .not.toHaveBeenCalled()
  })
})
