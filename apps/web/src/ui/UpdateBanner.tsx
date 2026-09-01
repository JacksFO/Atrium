import { useEffect, useRef, useState } from 'react'
import { shell } from '../lib/shell'
import { nextUpdate, showUpdate, canDownload, NO_UPDATE } from '../lib/updates'
import { Icon } from './Icon'

/**
 * Update prompt.
 *
 * Nothing installs behind anyone's back, and nothing asks permission either.
 * The download starts on its own - the honest answer to "would you like the
 * new version" is always yes, so asking is a question with one answer - and
 * it applies on the next quit rather than closing on you mid-sentence.
 *
 * So the only button in the ordinary path is Restart now, once there is
 * something to restart into. A Download button appears only when the
 * automatic download has actually failed, which is the one moment there is a
 * real decision to make.
 *
 * The reasoning lives in lib/updates, because both faults this had were
 * faults of reasoning rather than markup: a stage that could never be
 * entered, and news that arrived before anything was listening.
 */
export function UpdateBanner() {
  const [state, setState] = useState(NO_UPDATE)
  const bar = useRef<HTMLDivElement>(null)
  const apply = (event: string, payload?: unknown) =>
    setState((cur) => nextUpdate(cur, event, payload as never))

  useEffect(() => {
    if (!shell()) return

    /*
     * Catch up on anything said before this existed.
     *
     * This banner lives inside the chat view, which does not exist until
     * somebody has signed in, and the first check runs eight seconds after
     * launch. So an update found on the sign-in screen was announced to
     * nobody, and nothing appeared until the next hourly check came round.
     * One downloaded in a previous session was never mentioned again at all -
     * it just sat there, waiting to install, with nothing on screen saying so.
     */
    void shell()?.updateState?.()
      .then((seed) => apply('state', seed))
      .catch(() => { /* an older shell has no such call */ })

    shell()?.onUpdate?.((event, payload) => apply(event, payload))
  }, [])

  /*
   * Tell the document a bar is showing, and how tall it is.
   *
   * Measured rather than assumed: the text wraps to two lines on a narrow
   * window, and a hard-coded height would either leave a gap or let the bar
   * sit over the strip it is meant to be above. Cleaned up on the way out, so
   * a dismissed banner does not leave the app pushed down for ever.
   */
  useEffect(() => {
    const root = document.documentElement
    const showing = !!shell() && showUpdate(state)
    if (!showing) {
      root.classList.remove('has-updbar')
      root.style.removeProperty('--updbar')
      return
    }
    root.classList.add('has-updbar')
    const height = bar.current?.getBoundingClientRect().height
    if (height) root.style.setProperty('--updbar', `${Math.round(height)}px`)
    return () => {
      root.classList.remove('has-updbar')
      root.style.removeProperty('--updbar')
    }
  /* The four fields this reads, rather than the object holding them: the
     object is new on every poll and the height only moves when one of
     these does. */
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.stage, state.version, state.percent, state.dismissed])

  if (!shell() || !showUpdate(state)) return null

  const { stage, version, percent, error } = state

  return (
    <div ref={bar} className={`updbar${stage === 'error' ? ' bad' : ''}`}>
      <Icon name="up" size={15} />

      <div className="ubtx">
        {/* "Available" is a moment, not a state to sit in: the download
            starts on its own, so this is what it looks like before the first
            progress event arrives rather than something to act on. */}
        {stage === 'available' && <>Updating to <b>{version}</b>…</>}
        {/* The percentage had nowhere to show before this: progress arrived
            and was recorded, but the stage never moved off 'available', so
            the banner sat on one line for the whole download. */}
        {stage === 'downloading' && <>Updating to <b>{version}</b>… <b>{percent}%</b></>}
        {stage === 'ready' && (
          <>Version <b>{version}</b> is ready. It installs when you next close Atrium.</>
        )}
        {stage === 'error' && <>Could not update: {error}</>}
      </div>

      {/* The bar is there from the announcement, because that is when the
          downloading actually begins - waiting for the first percentage would
          make it appear a beat late, which reads as a stall. */}
      {(stage === 'available' || stage === 'downloading') && (
        <div className={`ubprog${stage === 'available' ? ' waiting' : ''}`}>
          <i style={{ width: `${percent}%` }} />
        </div>
      )}

      <div className="ubacts">
        {stage === 'ready' && (
          <button className="btn p" onClick={() => void shell()?.installUpdate()}>
            Restart now
          </button>
        )}
        {/*
          * Only when the automatic download has failed. Offering it while one
          * is already running would be a button for something that is already
          * happening; offering it here is the difference between waiting an
          * hour for the next check and trying again now.
          */}
        {canDownload(state) && (
          <button className="btn p" onClick={() => {
            apply('download')
            void shell()?.downloadUpdate()
          }}>
            Try again
          </button>
        )}
        {stage !== 'downloading' && stage !== 'available' && (
          <button className="btn" onClick={() => apply('dismiss')}>
            {stage === 'error' ? 'Dismiss' : 'Later'}
          </button>
        )}
      </div>
    </div>
  )
}
