import { useState } from 'react'
import type { Api } from '../lib/api'
import { shell } from '../lib/shell'
import { toast } from '../lib/toast'
import { Icon } from './Icon'
import { Menu } from './Menu'
import { Modal } from './Modal'

/**
 * Telling us something, from wherever you are.
 *
 * Always there, in the corner, because the moment somebody wants to report a
 * thing is the moment it happened - and a report that needs finding is a
 * report nobody makes. Two kinds, asked first: what somebody meant it as is
 * worth more than guessing it afterwards from the words.
 *
 * Nothing about this is visible to anybody else. What is written here goes to
 * the server and stays there; no screen in the app can ask for it back.
 */

/** As long as a report may be. Matches the server, which refuses more. */
export const REPORT_MAX = 200

type Kind = 'feedback' | 'bug'

const ASKED: Record<Kind, { title: string; hint: string; placeholder: string }> = {
  feedback: {
    title: 'Feedback',
    hint: 'What would make this better?',
    placeholder: 'It would be good if…',
  },
  bug: {
    title: 'Bugs & issues',
    hint: 'What happened, and what did you expect instead?',
    placeholder: 'I clicked … and …',
  },
}

export function Report({ server }: { server: Api }) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null)
  const [kind, setKind] = useState<Kind | null>(null)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [said, setSaid] = useState('')

  const close = () => { setKind(null); setText(''); setSaid('') }

  const send = () => {
    const it = shell()
    setSending(true)
    setSaid('')
    void server.post<{ ok?: true; error?: string }>('/api/feedback', {
      kind,
      text,
      /* What every report needs and nobody remembers to include. Nothing
         about where they were or what anybody was saying. */
      version: it?.version ?? '',
      platform: it?.platform ?? 'web',
      desktop: !!it,
    })
      .then((r) => {
        setSending(false)
        if (r?.error) { setSaid(r.error); return }
        close()
        toast('Thank you - that has been sent')
      })
      .catch((e: unknown) => {
        setSending(false)
        setSaid(e instanceof Error ? e.message : 'That would not send.')
      })
  }

  const left = REPORT_MAX - text.length

  return (
    <>
      {/* no-drag: the bar it sits in is the window's drag region on the
          desktop, and everything in one is handed to the window manager
          before the page sees it. */}
      <button className="reportb" title="Feedback and bugs"
        aria-label="Send feedback or report a bug"
        onClick={(e) => {
          const box = (e.currentTarget as HTMLElement).getBoundingClientRect()
          setAt({ x: box.left, y: box.bottom + 4 })
        }}>
        <Icon name="chat" size={15} />
      </button>

      {at && (
        <Menu
          x={at.x} y={at.y}
          onClose={() => setAt(null)}
          items={[
            {
              kind: 'item', label: 'Feedback', icon: 'smile',
              onPick: () => { setAt(null); setKind('feedback') },
            },
            {
              kind: 'item', label: 'Bugs & issues', icon: 'info',
              onPick: () => { setAt(null); setKind('bug') },
            },
          ]}
        />
      )}

      {kind && (
        <Modal
          title={ASKED[kind].title}
          onClose={close}
          actions={
            <>
              <button className="btn" onClick={close}>Cancel</button>
              <button className="btn p" disabled={!text.trim() || sending || left < 0}
                onClick={send}>
                {sending ? 'Sending…' : 'Send'}
              </button>
            </>
          }
        >
          <div className="fld">
            <label htmlFor="report-text">{ASKED[kind].hint}</label>
            <textarea id="report-text" rows={4} value={text}
              placeholder={ASKED[kind].placeholder}
              onChange={(e) => setText(e.target.value.slice(0, REPORT_MAX))} />
            <p className="hint">
              {said || (
                <>
                  <span className={left < 20 ? 'reportleft low' : 'reportleft'}>
                    {left}
                  </span>
                  {' characters left. Only we see this.'}
                </>
              )}
            </p>
          </div>
        </Modal>
      )}
    </>
  )
}
