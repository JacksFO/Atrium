import { useEffect, useRef, useState } from 'react'

/**
 * Editing a message where the message is.
 *
 * It used to happen in the box at the bottom: the message stayed where it
 * was, unchanged, while its words appeared a screen away above a bar saying
 * an edit was in progress. Two places showing the same sentence, and the one
 * being changed was not the one being looked at.
 *
 * Enter saves and Escape stops, which the line underneath says out loud —
 * there is no button, because reaching for one is slower than the two keys
 * everybody already uses here.
 */
export function MessageEditor({ body, onSave, onCancel }: {
  body: string
  onSave: (body: string) => void
  onCancel: () => void
}) {
  const [text, setText] = useState(body)
  const box = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const el = box.current
    if (!el) return
    el.focus()
    /* At the end of what is already there, not the start: an edit is almost
       always somebody adding to or fixing the end of a sentence. */
    el.setSelectionRange(el.value.length, el.value.length)
    grow(el)
  }, [])

  /*
   * Escape stops the edit from wherever the cursor happens to be.
   *
   * It was on the box, so clicking anything else - a message, the member
   * list, the channel list - left an editor open that Escape no longer
   * closed. The only ways out were to find the box again or to press the
   * cancel link, and neither is what anybody's hand does.
   *
   * On the window, and capturing, so it runs before anything that might stop
   * the event on its way up.
   */
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      onCancel()
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [onCancel])

  /*
   * And clicking away closes one nobody has typed in.
   *
   * Only an untouched one. A half-written edit is work, and losing it to a
   * stray click on the wrong side of the window is the kind of thing people
   * remember - so that one stays open and waits, and Escape or cancel is how
   * it goes. An edit with nothing changed in it has nothing to lose.
   */
  const untouched = text === body
  useEffect(() => {
    if (!untouched) return
    const away = (e: MouseEvent) => {
      const on = e.target
      if (on instanceof Node && box.current?.closest('.msgedit')?.contains(on)) return
      onCancel()
    }
    /*
     * mousedown, which is what a click past something starts with.
     *
     * pointerup seemed tidier - a drag that starts in the box and ends
     * outside it is a selection, not a click elsewhere - but a mouse press is
     * how every other "click past this to close it" in the app is heard, and
     * it is what a press on another message begins with. The untouched-only
     * rule is what protects a selection drag: there is nothing typed to lose.
     */
    window.addEventListener('mousedown', away)
    return () => window.removeEventListener('mousedown', away)
  }, [untouched, onCancel])

  return (
    <div className="msgedit">
      <textarea
        ref={box}
        className="mecin"
        rows={1}
        value={text}
        onChange={(e) => { setText(e.target.value); grow(e.target) }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            onSave(text)
          }
          if (e.key === 'Escape') {
            e.preventDefault()
            onCancel()
          }
        }}
      />
      <p className="editnote">
        escape to <button className="linky" onClick={onCancel}>cancel</button>
        {' · '}
        enter to <button className="linky" onClick={() => onSave(text)}>save</button>
      </p>
    </div>
  )
}

/* Grows with what is in it, up to a point past which it scrolls — an edit of
   forty lines should not push the conversation off the screen. */
function grow(el: HTMLTextAreaElement): void {
  el.style.height = 'auto'
  /*
   * And the border, which scrollHeight does not count.
   *
   * Everything here is border-box, so a height of exactly scrollHeight is
   * the content plus its padding and nothing for the 1px line around it -
   * which leaves the box two pixels short of what is in it, for ever. It
   * grew correctly and then showed a scrollbar for two pixels at every size,
   * on every edit.
   */
  const edges = el.offsetHeight - el.clientHeight
  el.style.height = `${Math.min(el.scrollHeight + edges, 320)}px`
}
