import { useEffect } from 'react'

/**
 * Escape closes it.
 *
 * Both settings screens draw a key cap reading ESC beside their close button,
 * and neither of them listened for it — the label was a drawing of a
 * shortcut rather than a shortcut. Somebody who reads it and presses the key
 * learns that the app's own labels cannot be trusted, which is a worse thing
 * to teach than the shortcut is to have.
 *
 * On the document rather than on the box: nothing in a settings screen
 * reliably holds focus, and a key listener on an element that is not focused
 * never fires.
 */
export function useEscape(on: () => void, whileTyping = false): void {
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      /*
       * Not while somebody is in the middle of typing something - Escape in
       * a field is for the field, and closing the whole screen would throw
       * away what they were writing.
       *
       * Unless what is open is a panel over the conversation. The composer
       * takes the caret back whenever it can, so the box is focused
       * practically always - and a panel that only closes when nothing is
       * focused is a panel that never closes on the keyboard at all. When
       * something is open over the top of the conversation, Escape is about
       * that thing.
       */
      if (!whileTyping) {
        const at = document.activeElement
        const tag = at?.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      }
      e.preventDefault()
      on()
    }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [on, whileTyping])
}
