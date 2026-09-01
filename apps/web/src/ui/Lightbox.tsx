import { useEffect } from 'react'
import { Over } from './Over'
import { Icon } from './Icon'

/**
 * One picture, as big as the window will allow.
 *
 * A picture in a conversation is drawn small enough that several fit, which
 * is right for reading past them and wrong for looking at one. Clicking did
 * nothing at all — the picture was a button with no handler, which is the
 * shape of a control that looks like it works.
 *
 * Escape closes it, and so does clicking anywhere: with the picture filling
 * the window there is nowhere obvious to aim, and hunting for a close button
 * is not what somebody who just wants the conversation back is doing.
 */
export function Lightbox({ src, alt, onClose }: {
  src: string
  alt: string
  onClose: () => void
}) {
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', on)
    return () => document.removeEventListener('keydown', on)
  }, [onClose])

  return (
    <Over>
      <div className="lightbox" onClick={onClose}>
        {/* Stopped here so that clicking the picture itself does not close
            it — dragging to select or right-clicking to save are both things
            somebody does to a picture they opened on purpose. */}
        <img src={src} alt={alt} onClick={(e) => e.stopPropagation()} />
        <button className="cl icb" onClick={onClose} aria-label="Close">
          <Icon name="x" size={20} />
        </button>
      </div>
    </Over>
  )
}
