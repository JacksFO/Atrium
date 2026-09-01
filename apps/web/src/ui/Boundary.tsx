import { reloadApp } from '../lib/reload'
import { Component, type ErrorInfo, type ReactNode } from 'react'

/**
 * Something to show when the app throws.
 *
 * React unmounts the whole tree when a render throws and nothing catches it,
 * which on screen is the entire window going black — no message, no way back,
 * nothing to report but "everything went blank". That is the worst possible
 * outcome of a bug: it destroys the evidence along with the app.
 *
 * So this catches it, says what broke, and offers the two ways out that
 * actually work. It also prints the whole thing to the console, because the
 * stack is the only part of this that says *where*.
 */
type State = { err: Error | null }

export class Boundary extends Component<{ children: ReactNode }, State> {
  override state: State = { err: null }

  static getDerivedStateFromError(err: Error): State {
    return { err }
  }

  override componentDidCatch(err: Error, info: ErrorInfo): void {
    /* Kept where it can be copied out of. A screenshot of a stack is worth
       more than a description of a blank screen. */
    console.error('Atrium crashed:', err, info.componentStack)
  }

  override render(): ReactNode {
    const { err } = this.state
    if (!err) return this.props.children

    return (
      <div className="gate">
        <div className="gatebox" style={{ gridTemplateColumns: 'minmax(0,1fr)' }}>
          <div className="gbd">
            <h2>That broke</h2>
            <p className="sub">
              Something on this screen threw and the app stopped drawing. It is
              worth telling somebody what you had just done — that is usually
              the whole of the bug.
            </p>
            <pre className="mdpre" style={{ maxHeight: 200, overflow: 'auto' }}>
              {err.message}
            </pre>
            <div style={{ display: 'flex', gap: 8 }}>
              {/* Back to a screen that works, without losing the session —
                  most of these are one screen misbehaving, not the app. */}
              <button className="btn p" onClick={() => this.setState({ err: null })}>
                Try again
              </button>
              <button className="btn" onClick={reloadApp}>Reload</button>
            </div>
          </div>
        </div>
      </div>
    )
  }
}
