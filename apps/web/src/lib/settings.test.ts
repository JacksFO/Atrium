import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULTS, fitWidth, readSettings } from './settings'

/** A storage that behaves, and one that does not. */
function storage(initial?: string, broken = false) {
  const store = new Map<string, string>()
  if (initial !== undefined) store.set('atrium.settings', initial)
  return {
    getItem: (k: string) => {
      if (broken) throw new Error('site data is blocked')
      return store.get(k) ?? null
    },
    setItem: (k: string, v: string) => {
      if (broken) throw new Error('site data is blocked')
      store.set(k, v)
    },
    removeItem: (k: string) => { store.delete(k) },
  }
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    value: storage(), configurable: true, writable: true,
  })
})

describe('reading what somebody chose', () => {
  it('is the defaults when they have chosen nothing', () => {
    expect(readSettings()).toEqual(DEFAULTS)
  })

  it('keeps what they did choose', () => {
    globalThis.localStorage = storage('{"theme":"dusk","fontSize":24}') as never
    const s = readSettings()
    expect(s.theme).toBe('dusk')
    expect(s.fontSize).toBe(24)
  })

  /* A value written by an older version is missing whatever has been added
     since, and an undefined setting is a feature quietly switched off. */
  it('fills in anything the version that wrote it had never heard of', () => {
    globalThis.localStorage = storage('{"theme":"dusk"}') as never
    const s = readSettings()
    expect(s.density).toBe(DEFAULTS.density)
    expect(s.previews).toBe(DEFAULTS.previews)
  })

  /* Storage throws rather than returning nothing in a private window and
     wherever site data is blocked. An unguarded read there takes the whole
     app down before anything has drawn. */
  it('starts anyway where storage refuses to be read', () => {
    globalThis.localStorage = storage(undefined, true) as never
    expect(readSettings()).toEqual(DEFAULTS)
  })

  it('and where what is stored is not JSON at all', () => {
    globalThis.localStorage = storage('half a file') as never
    expect(readSettings()).toEqual(DEFAULTS)
  })
})

describe('a width across an update', () => {
  it('is used exactly as they left it', () => {
    expect(fitWidth(300, 200, 480, 278)).toBe(300)
  })

  /* The number was written by whichever build was running when they dragged
     it; the limits belong to the build reading it. */
  it('is brought back to the limit this build allows', () => {
    expect(fitWidth(9000, 200, 480, 278)).toBe(480)
    expect(fitWidth(12, 200, 480, 278)).toBe(200)
  })

  it('falls back when there is nothing sensible stored', () => {
    expect(fitWidth(Number.NaN, 200, 480, 278)).toBe(278)
    expect(fitWidth(0, 200, 480, 278)).toBe(278)
  })
})
