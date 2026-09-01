import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reloadApp, resetReloadGuard } from './reload'

/**
 * Reloading, without leaving the machine holding things.
 *
 * A bare location.reload() tears the page down while a call is running: a
 * microphone and possibly a screen captured, peer connections open, a socket
 * mid-conversation. Chromium usually copes and sometimes does not, and the
 * failure is the app doing nothing for several seconds - reported as reload
 * being slow, timing out, or falling over.
 */

let reloaded = 0

beforeEach(() => {
  reloaded = 0
  resetReloadGuard()
  vi.useFakeTimers()
  /* jsdom's location cannot be assigned to, so the method is replaced. */
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, reload: () => { reloaded += 1 } },
  })
  /* rAF runs immediately, so the ordering below is about the timers. */
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => {
    fn(0)
    return 0
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

/** A media element holding a stream, the way a call leaves one. */
function playing(): { el: HTMLVideoElement; stopped: () => number } {
  let stops = 0
  const track = { stop: () => { stops += 1 } } as unknown as MediaStreamTrack
  const stream = { getTracks: () => [track] } as unknown as MediaStream
  const el = document.createElement('video')
  el.srcObject = stream
  document.body.appendChild(el)
  return { el, stopped: () => stops }
}

describe('reloading', () => {
  it('lets go of what the page is capturing first', () => {
    const one = playing()
    reloadApp()
    expect(one.stopped()).toBe(1)
    expect(one.el.srcObject).toBeNull()
  })

  it('and then reloads', () => {
    reloadApp()
    vi.advanceTimersByTime(0)
    expect(reloaded).toBe(1)
  })

  /*
   * The whole point. A teardown that hangs is the thing this is meant to
   * stop, so nothing in it may prevent the reload.
   */
  it('and reloads even when letting go throws', () => {
    const el = document.createElement('audio')
    Object.defineProperty(el, 'srcObject', {
      get() { throw new Error('gone') },
      set() { throw new Error('gone') },
    })
    document.body.appendChild(el)

    expect(() => reloadApp()).not.toThrow()
    vi.advanceTimersByTime(0)
    expect(reloaded).toBe(1)
  })

  /*
   * The button looks unpressed while the page tears down, so it gets pressed
   * again - and a second reload starting on top of the first is the shape of
   * "it crashed".
   */
  it('and only once, however many times it is asked', () => {
    reloadApp()
    reloadApp()
    reloadApp()
    vi.advanceTimersByTime(1000)
    expect(reloaded).toBe(1)
  })

  /* And a ceiling, so a hang cannot leave somebody looking at a page that
     will not come back. */
  it('and has a ceiling on how long it waits', () => {
    vi.stubGlobal('requestAnimationFrame', () => 0)
    reloadApp()
    expect(reloaded).toBe(0)
    vi.advanceTimersByTime(400)
    expect(reloaded).toBe(1)
  })
})
