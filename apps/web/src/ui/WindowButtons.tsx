import { useEffect, useState } from 'react'
import { Icon } from './Icon'
import { shell } from '../lib/shell'

/**
 * Minimise, maximise and close, drawn by the app.
 *
 * They used to be Windows'. The shell asked for a titleBarOverlay, which
 * keeps the real caption buttons and lets the page paint behind them - and
 * Windows will style three things about them: the strip's colour, the glyph
 * colour, and the height. Not the hover slab, not its corners, not the red.
 * So they stayed Windows buttons in an app that looks nothing like Windows.
 *
 * Nothing here draws in a browser, and nothing draws in a shell that still
 * has the overlay: `windowButtons` says which, and an older shell simply
 * does not have it. Anything else would be two sets of buttons on somebody's
 * window until they updated.
 *
 * The window is also maximised by things that are not this button - a
 * double-click on the bar, Win+Up, a drag to the top edge - so the glyph
 * follows the window rather than the last press.
 */
export function WindowButtons() {
  const it = shell()
  const on = !!it?.windowButtons
  const [big, setBig] = useState(false)

  useEffect(() => {
    if (!on || !it) return
    void it.isMaximised?.().then(setBig)
    it.onMaximised?.(setBig)
  }, [on, it])

  if (!on || !it) return null
  return (
    /* no-drag, because everything inside a drag region is handed to the
       window manager before the page sees it - a button in one is a button
       that cannot be pressed. */
    <div className="wbtns">
      <button className="wbtn" aria-label="Minimise" title="Minimise"
        onClick={() => it.minimise()}>
        <Icon name="winmin" size={14} />
      </button>
      <button className="wbtn" aria-label={big ? 'Restore' : 'Maximise'}
        title={big ? 'Restore' : 'Maximise'}
        onClick={() => it.toggleMaximise()}>
        <Icon name={big ? 'winrestore' : 'winmax'} size={13} />
      </button>
      {/* Closing hides to the tray rather than quitting, which is the shell's
          decision and is why this says Close rather than Quit. */}
      <button className="wbtn shut" aria-label="Close" title="Close"
        onClick={() => it.close()}>
        <Icon name="x" size={14} />
      </button>
    </div>
  )
}
