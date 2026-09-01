import { useEffect, useState } from 'react'
import { Modal } from './Modal'
import { shell, type ShareSource } from '../lib/shell'
import { rememberShareSource, takeResumeIntent } from '../lib/resume'

/**
 * What to share, in the desktop app.
 *
 * A browser draws this itself — Chrome's own "Choose what to share" window —
 * so screen sharing worked on the web and did nothing whatever in the desktop
 * app. Electron will not answer getDisplayMedia on its own: the main process
 * asks the page which source to use and then waits. Nothing was listening, so
 * the request never finished — no picker, no error, no refusal, just a button
 * that appeared to do nothing.
 *
 * Drawn here rather than by the platform for the sound as well: the id of the
 * window that was picked names the process, and that is what the per-program
 * audio capture needs. A picker that hands back only a stream cannot say
 * which program it came from.
 */
export function SharePicker() {
  const [sources, setSources] = useState<ShareSource[] | null>(null)
  const [chosen, setChosen] = useState<string | null>(null)
  /* On by default, which is what sharing something that makes a noise almost
     always means. */
  const [withSound, setWithSound] = useState(true)

  useEffect(() => {
    const it = shell()
    /* Absent in a browser, and absent is not broken — the same build is
       served to both, and the browser has its own. */
    if (!it?.share) return
    it.share.onChoose((list) => {
      /*
       * Putting a share back after a reload, without asking twice.
       *
       * The press that resumed it is what let the capture start at all; being
       * made to pick the same window again is that press wasted. Only if it
       * is still there - a window that has since been closed is gone, and the
       * picker is then the right answer rather than a failure.
       */
      const again = takeResumeIntent()
      if (again && list.some((s) => s.id === again)) {
        rememberShareSource(again)
        it.share.choose(again, true)
        return
      }
      setSources(list)
      setChosen(list.find((s) => s.isScreen)?.id ?? list[0]?.id ?? null)
    })
  }, [])

  if (!sources) return null

  /* Always answered, including a cancel: the main process holds the request
     open until it hears something, so a box closed in silence leaves
     getDisplayMedia waiting for the life of the app. */
  const answer = (id: string | null) => {
    setSources(null)
    /* Kept so the same one can come back after a reload. */
    rememberShareSource(id)
    shell()?.share.choose(id, withSound)
  }

  const groups: Array<[string, ShareSource[]]> = [
    ['Screens', sources.filter((s) => s.isScreen)],
    ['Windows', sources.filter((s) => !s.isScreen)],
  ]

  return (
    <Modal
      title="Share your screen"
      onClose={() => answer(null)}
      actions={
        <>
          <button className="btn" onClick={() => answer(null)}>Cancel</button>
          <button className="btn p" disabled={!chosen} onClick={() => answer(chosen)}>
            Share
          </button>
        </>
      }
    >
      <p className="sub">
        Nothing is sent until you choose. A window shares that program’s sound
        with it; a whole screen shares the machine’s.
      </p>

      {/* Only where the shell can act on it. An older desktop build always
          sends the sound and cannot be told otherwise, and drawing the switch
          anyway would be drawing a preference that gets ignored. */}
      {shell()?.share.canChooseShareAudio && (
        <label className="mrow2" style={{ marginBottom: 10 }}>
          <span className="nm">
            <span className="nm">Share the sound too</span>
            <span className="s">
              {chosen?.startsWith('window:')
                ? 'That program’s sound, and nothing else in the app.'
                : 'Everything the machine is playing.'}
            </span>
          </span>
          <button
            className={withSound ? 'sw on' : 'sw'}
            role="switch"
            aria-checked={withSound}
            aria-label="Share the sound too"
            onClick={() => setWithSound((v) => !v)}
          />
        </label>
      )}

      {groups.map(([label, list]) => list.length === 0 ? null : (
        <div key={label}>
          <p className="lab">{label}</p>
          <div className="thgrid">
            {list.map((s) => (
              <button
                key={s.id}
                className={s.id === chosen ? 'thsw on' : 'thsw'}
                onClick={() => setChosen(s.id)}
                onDoubleClick={() => answer(s.id)}
                title={s.name}
              >
                <span className="thprev">
                  {s.thumbnail && <img src={s.thumbnail} alt="" />}
                </span>
                <span className="thn">{s.name}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </Modal>
  )
}
