import { afterEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { StartupRow } from './Settings'

/**
 * Open Atrium when I log in.
 *
 * The switch is a claim about something outside the app: a login item that
 * Windows owns, that Task Manager's Startup tab can turn off, and that a
 * locked-down profile can refuse to write. So the two things worth testing
 * are both about not lying - it shows what the shell says rather than what it
 * last remembered, and it moves when the shell confirms rather than when the
 * switch is clicked.
 */

type Fake = {
  prefs: { launchOnStartup: boolean; minimiseToTray: boolean; hardwareAcceleration: boolean }
  /** What the shell decides to do about it, which need not be what was asked. */
  answer: ((key: string, want: boolean) => boolean) | undefined
  asked: Array<[string, boolean]>
}

function shellSaying(launchOnStartup: boolean, answer?: Fake['answer']): Fake {
  const fake: Fake = {
    prefs: { launchOnStartup, minimiseToTray: true, hardwareAcceleration: true },
    answer,
    asked: [],
  }
  ;(globalThis as unknown as { atrium?: unknown }).atrium = {
    /* shell() asks for this one by name before believing any of it. */
    setBadge: () => {},
    getSystemPrefs: () => Promise.resolve({ ...fake.prefs }),
    setSystemPref: (key: string, value: boolean) => {
      fake.asked.push([key, value])
      const settled = fake.answer ? fake.answer(key, value) : value
      fake.prefs = { ...fake.prefs, launchOnStartup: settled }
      return Promise.resolve({ ...fake.prefs })
    },
  }
  return fake
}

afterEach(() => { delete (globalThis as unknown as { atrium?: unknown }).atrium })

async function draw() {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => { root.render(<StartupRow />) })
  return {
    host,
    sw: () => host.querySelector('[role="switch"]') as HTMLElement | null,
    click: async () => { await act(async () => { host.querySelector<HTMLElement>('[role="switch"]')?.click() }) },
    done: () => { act(() => root.unmount()); host.remove() },
  }
}

describe('the login-item switch', () => {
  it('shows what the shell says, not a default', async () => {
    shellSaying(true)
    const d = await draw()
    expect(d.sw()?.getAttribute('aria-checked')).toBe('true')
    d.done()
  })

  it('and off when it is off', async () => {
    shellSaying(false)
    const d = await draw()
    expect(d.sw()?.getAttribute('aria-checked')).toBe('false')
    d.done()
  })

  /*
   * Absent, not broken, where there is nothing behind it.
   *
   * The same build is served to a browser and to the desktop, and an older
   * desktop has the bridge without this call on it. Neither should be shown a
   * switch that cannot do anything.
   */
  it('and draws nothing at all in a browser', async () => {
    const d = await draw()
    expect(d.sw()).toBeNull()
    expect(d.host.textContent).toBe('')
    d.done()
  })

  it('and nothing on a shell too old to have been asked this', async () => {
    ;(globalThis as unknown as { atrium?: unknown }).atrium = { setBadge: () => {} }
    const d = await draw()
    expect(d.sw()).toBeNull()
    d.done()
  })

  it('asks the shell to turn it on', async () => {
    const fake = shellSaying(false)
    const d = await draw()
    await d.click()
    expect(fake.asked).toEqual([['launchOnStartup', true]])
    expect(d.sw()?.getAttribute('aria-checked')).toBe('true')
    d.done()
  })

  it('and to turn it off again', async () => {
    const fake = shellSaying(true)
    const d = await draw()
    await d.click()
    expect(fake.asked).toEqual([['launchOnStartup', false]])
    expect(d.sw()?.getAttribute('aria-checked')).toBe('false')
    d.done()
  })

  /*
   * The one that matters, and the first version of this test did not catch
   * it: asserting only the end state passes for an optimistic switch too,
   * because the answer arrives and corrects it before anything is measured.
   * The difference is the moment in between, so the shell is held mid-answer
   * and the switch is read there.
   *
   * Windows can refuse to write the login item - a policy, a profile with no
   * write access to that registry key - and a switch that moves on the click
   * is claiming something that has not happened yet and may never.
   */
  it('and does not move until the shell has answered', async () => {
    let release: (prefs: unknown) => void = () => {}
    ;(globalThis as unknown as { atrium?: unknown }).atrium = {
      setBadge: () => {},
      getSystemPrefs: () => Promise.resolve({
        launchOnStartup: false, minimiseToTray: true, hardwareAcceleration: true,
      }),
      setSystemPref: () => new Promise((res) => { release = res }),
    }
    const d = await draw()
    await d.click()
    /* Asked, and still off, because nothing has confirmed it. */
    expect(d.sw()?.getAttribute('aria-checked')).toBe('false')

    /* And the machine refused, so off is where it stays. */
    await act(async () => {
      release({ launchOnStartup: false, minimiseToTray: true, hardwareAcceleration: true })
    })
    expect(d.sw()?.getAttribute('aria-checked')).toBe('false')
    d.done()
  })

  /* And the ordinary case, through the same held answer: it moves when the
     shell says it moved, and not before. */
  it('and moves once the shell says it did', async () => {
    let release: (prefs: unknown) => void = () => {}
    ;(globalThis as unknown as { atrium?: unknown }).atrium = {
      setBadge: () => {},
      getSystemPrefs: () => Promise.resolve({
        launchOnStartup: false, minimiseToTray: true, hardwareAcceleration: true,
      }),
      setSystemPref: () => new Promise((res) => { release = res }),
    }
    const d = await draw()
    await d.click()
    expect(d.sw()?.getAttribute('aria-checked')).toBe('false')
    await act(async () => {
      release({ launchOnStartup: true, minimiseToTray: true, hardwareAcceleration: true })
    })
    expect(d.sw()?.getAttribute('aria-checked')).toBe('true')
    d.done()
  })
})
