import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Attachment, fileSize } from './Attachment'
import type { Attachment as Att } from '../lib/wire'

/**
 * A file somebody sent, drawn as what it is.
 *
 * Everything was an <img>, whatever it was, so a video arrived as the
 * browser's broken-image icon with its filename beside it. Reported as
 * exactly that. The mime type had been on the wire all along and nothing
 * read it.
 */

const att = (over: Partial<Att>): Att => ({
  id: 'a1', message_id: 'm1', filename: 'thing', mime: '', bytes: 1024,
  width: null, height: null, path: '/uploads/x', is_gif: 0, ...over,
} as Att)

let root: Root | null = null
let host: HTMLDivElement | null = null
function draw(node: React.ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root!.render(node) })
  return host
}
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = null; host = null })

describe('an attachment', () => {
  it('is a picture when it is a picture', () => {
    const el = draw(<Attachment a={att({ mime: 'image/png' })} onOpen={() => {}} />)
    expect(el.querySelector('img')).not.toBeNull()
  })

  /* The one that was reported. */
  it('and a player when it is a video', () => {
    const el = draw(<Attachment a={att({ mime: 'video/mp4', filename: 'monkey.mp4' })}
      onOpen={() => {}} />)
    expect(el.querySelector('video')).not.toBeNull()
    expect(el.querySelector('img')).toBeNull()
    /* And says nothing under it: the player is the thing, and a caption is
       words about something already on the screen. */
    expect(el.textContent).not.toContain('monkey.mp4')
  })

  /*
   * A channel of videos that each downloaded themselves on sight would be
   * somebody's month. Metadata is the few bytes that give a length and a
   * first frame, which is what makes the player the right size.
   */
  it('and fetches nothing until somebody presses play', () => {
    const el = draw(<Attachment a={att({ mime: 'video/mp4' })} onOpen={() => {}} />)
    expect(el.querySelector('video')?.getAttribute('preload')).toBe('metadata')
  })

  it('and a sound player when it is a sound', () => {
    const el = draw(<Attachment a={att({ mime: 'audio/mpeg' })} onOpen={() => {}} />)
    expect(el.querySelector('audio')).not.toBeNull()
  })

  /* Anything else is a file, and the honest thing to offer is the file. */
  it('and a named, sized download for anything else', () => {
    const el = draw(<Attachment
      a={att({ mime: 'application/pdf', filename: 'rules.pdf', bytes: 2_400_000 })}
      onOpen={() => {}} />)
    const link = el.querySelector('a') as HTMLAnchorElement
    expect(link).not.toBeNull()
    expect(link.getAttribute('download')).toBe('rules.pdf')
    expect(el.textContent).toContain('rules.pdf')
    expect(el.textContent).toContain('2.3 MB')
  })

  /* A file from a stranger opens away from the app, without handing the app
     over with it. */
  it('and that download does not carry the app with it', () => {
    const el = draw(<Attachment a={att({ mime: 'application/zip' })} onOpen={() => {}} />)
    expect(el.querySelector('a')?.getAttribute('rel')).toContain('noopener')
  })

  /* Only a picture has anything to open bigger. */
  it('and only a picture opens the lightbox', () => {
    const onOpen = vi.fn()
    const el = draw(<Attachment a={att({ mime: 'video/mp4' })} onOpen={onOpen} />)
    el.querySelector('video')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(onOpen).not.toHaveBeenCalled()
  })

  /* An attachment from before mime was recorded has none, and a broken image
     is the worst possible guess. */
  it('and something with no type at all is offered as a file', () => {
    const el = draw(<Attachment a={att({ mime: '' })} onOpen={() => {}} />)
    expect(el.querySelector('a')).not.toBeNull()
    expect(el.querySelector('img')).toBeNull()
  })
})

describe('the size beside it', () => {
  it('is in the words somebody would use', () => {
    expect(fileSize(900)).toBe('900 B')
    expect(fileSize(2048)).toBe('2 KB')
    expect(fileSize(2_400_000)).toBe('2.3 MB')
    expect(fileSize(48_000_000)).toBe('46 MB')
  })

  it('and says nothing when there is nothing to say', () => {
    expect(fileSize(0)).toBe('')
  })
})
