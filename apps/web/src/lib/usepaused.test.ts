import { act, createElement, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { usePausedWhenAway } from './usepaused'
import { watchAttention } from './attention'

/**
 * A video that stops while nobody is looking at the window.
 *
 * Mounted for real and driven through the real listener in attention.ts,
 * because the bug was never in the pausing - it was that nothing in a message
 * was subscribed at all. A test that calls a pause function and watches it
 * pause would have passed against the broken app.
 *
 * The providers hand over mp4 rather than .gif, so every GIF in every
 * conversation is a <video> with autoPlay and loop on it. Nothing stopped
 * them, so a handful on screen decoded and composited for as long as the app
 * was open: minimised, on another monitor, behind a game, all night.
 */

let root: Root | null = null
let host: HTMLDivElement | null = null

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  /* Looked at, to begin with. */
  Object.defineProperty(document, 'visibilityState', {
    value: 'visible', configurable: true,
  })
  document.hasFocus = () => true
  watchAttention()
})
afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = null; host = null
})

/**
 * jsdom has no video pipeline, so play and pause are counted rather than
 * performed. What is being proved is that the element was told - which is the
 * whole of what was missing.
 */
function countingVideo() {
  const el = document.createElement('video') as HTMLVideoElement & {
    plays: number; pauses: number; stopped: boolean
  }
  el.plays = 0; el.pauses = 0; el.stopped = false
  el.play = () => { el.plays++; el.stopped = false; return Promise.resolve() }
  el.pause = () => { el.pauses++; el.stopped = true }
  return el
}

/** Mounts the hook against one element, the way Attachment does. */
function mount(el: HTMLVideoElement) {
  const Probe = () => {
    const ref = usePausedWhenAway<HTMLVideoElement>()
    const put = useRef(false)
    if (!put.current) {
      put.current = true
      ;(ref as { current: HTMLVideoElement | null }).current = el
    }
    return null
  }
  act(() => { root?.render(createElement(Probe)) })
}

/** What the window losing and regaining attention actually looks like. */
const lookAway = () => {
  document.hasFocus = () => false
  act(() => { window.dispatchEvent(new Event('blur')) })
}
const lookBack = () => {
  document.hasFocus = () => true
  act(() => { window.dispatchEvent(new Event('focus')) })
}

describe('a GIF in a message', () => {
  it('stops when the window is no longer being looked at', () => {
    const el = countingVideo()
    mount(el)
    expect(el.stopped, 'it should be playing while somebody is looking').toBe(false)

    lookAway()
    expect(el.stopped).toBe(true)
    expect(el.pauses).toBeGreaterThan(0)
  })

  it('and plays again on coming back', () => {
    const el = countingVideo()
    mount(el)
    lookAway()
    lookBack()
    expect(el.stopped).toBe(false)
    expect(el.plays).toBeGreaterThan(0)
  })

  /*
   * The case the picture version was caught out by: a conversation opened
   * while the app is already on another monitor mounts its videos with
   * autoPlay, so they start themselves - and nothing would stop them until
   * the window had been looked at and looked away from again.
   */
  it('and stops one that appeared while the app was already away', () => {
    document.hasFocus = () => false
    act(() => { window.dispatchEvent(new Event('blur')) })

    const el = countingVideo()
    mount(el)
    expect(el.stopped, 'it was never told to stop').toBe(true)
  })

  /* And it lets go: a conversation scrolled past should not leave a listener
     behind for every GIF that was ever on screen. */
  it('and stops listening once it is gone', () => {
    const el = countingVideo()
    mount(el)
    act(() => root?.unmount())
    const before = el.pauses
    lookAway()
    expect(el.pauses, 'it was still listening after being unmounted').toBe(before)
  })
})
