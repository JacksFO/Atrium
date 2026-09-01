import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearToasts, dismissToast, onToast, toast, type Toast } from './toast'

afterEach(() => { clearToasts() })

/** What a listener has been told, latest last. */
function watch(): { seen: Toast[][]; now: () => Toast[] } {
  const seen: Toast[][] = []
  onToast((live) => seen.push(live))
  return { seen, now: () => seen[seen.length - 1] ?? [] }
}

describe('saying a small thing', () => {
  it('tells whoever is listening', () => {
    const w = watch()
    toast('Your changes have been saved')
    expect(w.now().map((t) => t.said)).toEqual(['Your changes have been saved'])
  })

  it('and tells them what is already showing, the moment they listen', () => {
    /* Otherwise a line said a tick before the layer mounts is a line nobody
       ever sees. */
    toast('Saved')
    const w = watch()
    expect(w.now().map((t) => t.said)).toEqual(['Saved'])
  })

  it('does not stack the same words twice', () => {
    /* Saving three fields in a row is three saves and one thing worth
       saying; a column of identical lines says nothing the first one did. */
    const w = watch()
    toast('Saved')
    toast('Saved')
    expect(w.now()).toHaveLength(1)
  })

  it('but gives it a new id, so its time starts again', () => {
    const w = watch()
    toast('Saved')
    const first = w.now()[0]!.id
    toast('Saved')
    expect(w.now()[0]!.id).not.toBe(first)
  })

  it('and keeps two different things apart', () => {
    const w = watch()
    toast('Saved')
    toast('Copied')
    expect(w.now().map((t) => t.said)).toEqual(['Saved', 'Copied'])
  })
})

describe('getting rid of one', () => {
  it('takes it away by id', () => {
    const w = watch()
    toast('Saved')
    dismissToast(w.now()[0]!.id)
    expect(w.now()).toEqual([])
  })

  it('and shrugs at an id that has already gone', () => {
    const w = watch()
    toast('Saved')
    const id = w.now()[0]!.id
    dismissToast(id)
    dismissToast(id)
    expect(w.now()).toEqual([])
  })
})

describe('a listener that goes away', () => {
  it('stops being told', () => {
    const heard = vi.fn()
    const stop = onToast(heard)
    stop()
    toast('Saved')
    expect(heard).toHaveBeenCalledTimes(1)
  })
})
