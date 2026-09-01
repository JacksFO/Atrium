import { useEffect, useState } from 'react'
import { whatChanged, worthShowing, type Line } from '../lib/releasenotes'
import { shell } from '../lib/shell'
import { Icon } from './Icon'

/**
 * What the update was for, once, on the first launch after it installed.
 *
 * Asked for: "when an update is pushed to the desktop app, when they open the
 * app or it restarts have a toast in the middle with what the update was for
 * ... a changelog basically."
 *
 * The desktop shell has answered this since it was written and nothing in the
 * React client ever asked, so every update kept its notes, offered them and
 * had them dropped on the floor.
 *
 * It asks exactly once, on mount. The shell answers with the release's own
 * notes if this is the first launch of the version they belong to and forgets
 * them in the same breath - so this cannot come back tomorrow, and there is
 * nothing here to remember or to store.
 *
 * Every line is rendered as text. The notes are written on a release page,
 * which is to say written somewhere else, and lib/releasenotes.ts takes them
 * apart into words before they get anywhere near this.
 */
export function WhatsNew() {
  const [shown, setShown] = useState<{ version: string; lines: Line[] } | null>(null)

  useEffect(() => {
    const bridge = shell()
    if (!bridge?.whatsNew) return
    let gone = false
    void bridge.whatsNew().then((saved) => {
      if (gone || !saved) return
      const lines = whatChanged(saved.notes)
      /* An empty release body would put an empty card in the middle of the
         app, which is worse than saying nothing. */
      if (worthShowing(lines)) setShown({ version: saved.version, lines })
    }).catch(() => {
      /* An older shell has no such handler. Nothing to show, nothing wrong. */
    })
    return () => { gone = true }
  }, [])

  useEffect(() => {
    if (!shown) return
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setShown(null) }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [shown])

  if (!shown) return null

  return (
    <div className="scrim wnscrim" onClick={() => setShown(null)}>
      <div className="wn" role="dialog"
        aria-label={`What changed in version ${shown.version}`}
        onClick={(e) => e.stopPropagation()}>
        <div className="wn-top">
          <span className="wn-badge">Updated</span>
          <span className="wn-version">{shown.version}</span>
        </div>

        <h2 className="wn-title">What changed</h2>

        <div className="wn-body">
          {shown.lines.map((line, i) => (
            line.kind === 'heading'
              ? <div className="wn-h" key={i}>{line.text}</div>
              : line.kind === 'item'
                ? <div className="wn-item" key={i}><span className="wn-dot" />{line.text}</div>
                : <p className="wn-text" key={i}>{line.text}</p>
          ))}
        </div>

        <button className="btn p wn-go" onClick={() => setShown(null)}>
          <Icon name="check" size={15} /> Get on with it
        </button>
      </div>
    </div>
  )
}
