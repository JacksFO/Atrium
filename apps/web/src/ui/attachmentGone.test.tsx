import { describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Attachment } from './Attachment'
import type { Attachment as Att } from '../lib/wire'

/**
 * A picture whose file is not there any more.
 *
 * There is one of these on the live server: a message from August whose
 * upload was lost in an incident that morning. The row still exists and the
 * message is still shown, so an <img> pointed at it draws a torn page with a
 * filename beside it - which is what avatars used to do before they learned
 * to draw the generated one instead.
 *
 * A picture cannot be invented, so the honest version is to say what it was
 * and that it is gone. And only once the browser has actually failed: a slow
 * picture must not be written off as a missing one.
 */
const att = (over: Partial<Att> = {}): Att => ({
  id: 'a1', message_id: 'm1', filename: 'image.png', mime: 'image/png',
  bytes: 29990, width: null, height: null, path: '/uploads/gone.png', is_gif: 0,
  ...over,
} as Att)

function draw() {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  return { host, root }
}

describe('an attachment whose file has gone', () => {
  it('is drawn as a picture until something says otherwise', async () => {
    const { host, root } = draw()
    await act(async () => { root.render(<Attachment a={att()} onOpen={() => {}} />) })
    expect(host.querySelector('img')).toBeTruthy()
    expect(host.textContent ?? '').not.toContain('no longer here')
    await act(async () => { root.unmount() })
  })

  it('and says so once the browser cannot load it', async () => {
    const { host, root } = draw()
    await act(async () => { root.render(<Attachment a={att()} onOpen={() => {}} />) })

    const img = host.querySelector('img')
    expect(img).toBeTruthy()
    await act(async () => { img!.dispatchEvent(new Event('error')) })

    expect(host.querySelector('img'), 'still pointing at a file that 403s').toBeNull()
    expect(host.textContent ?? '').toContain('image.png')
    expect(host.textContent ?? '').toContain('no longer here')
    await act(async () => { root.unmount() })
  })

  it('and a GIF that will not load says the same', async () => {
    const { host, root } = draw()
    await act(async () => { root.render(<Attachment a={att({ is_gif: 1 })} onOpen={() => {}} />) })
    const img = host.querySelector('img')
    expect(img).toBeTruthy()
    await act(async () => { img!.dispatchEvent(new Event('error')) })
    expect(host.textContent ?? '').toContain('no longer here')
    await act(async () => { root.unmount() })
  })
})
