import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Files dragged onto the app.
 *
 * Nothing accepted a dropped file: the only way to attach one was the button
 * beside the message box. Dragging a picture in is what everybody tries
 * first, and the browser's own answer to a page that does not handle it is to
 * navigate away and open the file instead - so the app disappeared and was
 * replaced by the picture.
 *
 * Counted rather than toggled. Dragging over a child fires a leave for the
 * parent and an enter for the child in that order, so a boolean flickers off
 * and on across every border inside the drop zone; a depth does not.
 */
export function useFileDrop(onFiles: (files: File[]) => void) {
  const [over, setOver] = useState(false)
  const depth = useRef(0)

  /* The window, not one element: a drop anywhere in the app should land, and
     a page that only handles part of itself still loses the rest to the
     browser's own "open this file" behaviour. */
  const carryingFiles = (e: DragEvent) =>
    !!e.dataTransfer && [...e.dataTransfer.types].includes('Files')

  const reset = useCallback(() => { depth.current = 0; setOver(false) }, [])

  useEffect(() => {
    const enter = (e: DragEvent) => {
      if (!carryingFiles(e)) return
      e.preventDefault()
      depth.current += 1
      setOver(true)
    }
    const over_ = (e: DragEvent) => {
      if (!carryingFiles(e)) return
      /* Without this the browser refuses the drop and opens the file itself,
         which navigates away from the app. */
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    }
    const leave = (e: DragEvent) => {
      if (!carryingFiles(e)) return
      depth.current = Math.max(0, depth.current - 1)
      if (depth.current === 0) setOver(false)
    }
    const drop = (e: DragEvent) => {
      if (!carryingFiles(e)) return
      e.preventDefault()
      reset()
      const files = [...(e.dataTransfer?.files ?? [])]
      if (files.length) onFiles(files)
    }

    window.addEventListener('dragenter', enter)
    window.addEventListener('dragover', over_)
    window.addEventListener('dragleave', leave)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragover', over_)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('drop', drop)
    }
  }, [onFiles, reset])

  return over
}
