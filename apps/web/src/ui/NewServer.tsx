import { useState } from 'react'
import { Modal } from './Modal'
import { Icon } from './Icon'
import type { Api } from '../lib/api'
import type { Id } from '../lib/wire'

/**
 * Making a server, or walking into somebody else's.
 *
 * Both routes have existed on the server since servers did, and nothing in
 * this client called either of them - so an account could be in the servers
 * it happened to be added to and could not make one, join one, or do anything
 * about it. The rail had no way in and neither did anywhere else.
 *
 * One dialog with two halves rather than two dialogs, because they are the
 * same decision from two directions: somebody who came here to join with a
 * code and finds they have not been given one wants the other half without
 * going back.
 */
export function NewServer({ server, onDone, onClose }: {
  server: Api
  /** Where to go afterwards. */
  onDone: (spaceId: Id) => void
  onClose: () => void
}) {
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState('')

  const make = () => {
    const clean = name.trim()
    if (!clean || busy) return
    setBusy(true)
    setSaid('')
    void server.post<{ space?: { id?: Id } }>('/api/spaces', { name: clean })
      .then((r) => {
        const id = r?.space?.id
        if (!id) throw new Error('That would not be made.')
        onDone(id)
        onClose()
      })
      .catch((e: unknown) => {
        setSaid(e instanceof Error ? e.message : 'That would not be made.')
        setBusy(false)
      })
  }

  const join = () => {
    /*
     * A whole invite link is what people actually paste, so the last part of
     * it is taken rather than refused. Somebody handed a link and told to
     * enter a code has been given a puzzle.
     */
    const clean = code.trim().replace(/\/+$/, '').split('/').pop() ?? ''
    if (!clean || busy) return
    setBusy(true)
    setSaid('')
    void server.post<{ spaceId?: Id }>(
      `/api/invites/${encodeURIComponent(clean)}/accept`, {},
    )
      .then((r) => {
        if (!r?.spaceId) throw new Error('That invite is not valid.')
        onDone(r.spaceId)
        onClose()
      })
      .catch((e: unknown) => {
        setSaid(e instanceof Error ? e.message : 'That invite is not valid.')
        setBusy(false)
      })
  }

  return (
    <Modal
      title="Servers"
      onClose={onClose}
      actions={<button className="btn" onClick={onClose}>Close</button>}
    >
      <div className="fld">
        <label>Make one</label>
        <div className="joinrow">
          <input value={name} maxLength={48} autoFocus
            placeholder="What is it called?"
            onKeyDown={(e) => { if (e.key === 'Enter') make() }}
            onChange={(e) => setName(e.target.value)} />
          <button className="btn p" disabled={!name.trim() || busy} onClick={make}>
            <Icon name="plus" size={14} /> Make
          </button>
        </div>
        {/* "Including whoever runs the app" was the point of the
            sentence and is the half that had to go: it is true, and saying
            it tells somebody making a server that there is an operator
            somewhere, which is not what they are thinking about. */}
        <span className="hint">
          Yours. You decide who is in it, what it is called, and who can do
          what — and nobody outside it has any say.
        </span>
      </div>

      <div className="fld">
        <label>Or join one</label>
        <div className="joinrow">
          <input value={code} maxLength={120}
            placeholder="An invite code, or the whole link"
            onKeyDown={(e) => { if (e.key === 'Enter') join() }}
            onChange={(e) => setCode(e.target.value)} />
          <button className="btn" disabled={!code.trim() || busy} onClick={join}>
            Join
          </button>
        </div>
      </div>

      {said && <p className="hint">{said}</p>}
    </Modal>
  )
}
