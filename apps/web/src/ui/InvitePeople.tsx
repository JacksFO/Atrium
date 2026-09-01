import { useEffect, useState } from 'react'
import type { Api } from '../lib/api'
import { inviteLink } from '../lib/invitelink'
import type { User } from '../lib/wire'
import { Avatar } from './Avatar'
import { Icon } from './Icon'
import { Modal } from './Modal'

/**
 * Inviting people to a server.
 *
 * Friends first, and a link underneath. Copying a code and pasting it into a
 * conversation is two steps and a clipboard, and the clipboard is where
 * invite codes go to be lost. Most of the time the person being invited is
 * already somebody you talk to, so sending it to them directly is the short
 * path - it arrives in your conversation with them as a card with a button
 * on it. The link stays for everybody else.
 *
 * The code is made when it is asked for and not before. An invite that
 * exists because a screen was opened is a key left in a door, and this screen
 * would mint one every time anybody looked at it.
 */

/** What somebody is called, their own name before their handle. */
function nameOf(u: User): string {
  return u.display_name || u.username
}

export function InvitePeople({ server, spaceId, spaceName, onClose }: {
  server: Api
  spaceId: string
  spaceName: string
  onClose: () => void
}) {
  const [friends, setFriends] = useState<User[]>([])
  const [find, setFind] = useState('')
  const [sent, setSent] = useState<Set<string>>(new Set())
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    void server.get<{ friends?: User[] }>('/api/friends')
      .then((r) => setFriends(r.friends ?? []))
      .catch(() => { /* offline; the link below still works */ })
  }, [server])

  async function makeLink() {
    setBusy(true)
    setError('')
    try {
      const r = await server.post<{ code?: string }>(
        `/api/spaces/${encodeURIComponent(spaceId)}/invites`, { uses: 10, days: 7 },
      )
      setCode(r.code ?? '')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not make an invite')
    } finally {
      setBusy(false)
    }
  }

  async function sendTo(person: User) {
    try {
      await server.post(
        `/api/spaces/${encodeURIComponent(spaceId)}/invites/send`, { userId: person.id },
      )
      setSent((prev) => new Set(prev).add(person.id))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not send that')
    }
  }

  const shown = friends.filter(
    (f) => nameOf(f).toLowerCase().includes(find.trim().toLowerCase()),
  )

  return (
    <Modal
      title={`Invite people to ${spaceName}`}
      onClose={onClose}
      actions={<button className="btn" onClick={onClose}>Close</button>}
    >
      <div className="addspace invite">
        <p className="hint">They will land in the first channel.</p>

        <div className="fld">
          <input
            value={find}
            placeholder="Search for friends"
            onChange={(e) => setFind(e.target.value)}
          />
        </div>

        <div className="as-friends">
          {shown.map((f) => (
            <div className="as-friend" key={f.id}>
              <Avatar user={f} size="sm" />
              <div className="as-friend-who">
                <span className="as-friend-name">{nameOf(f)}</span>
                <span className="as-friend-handle">@{f.username}</span>
              </div>
              <button
                className={sent.has(f.id) ? 'fr-act' : 'fr-act p'}
                disabled={sent.has(f.id)}
                onClick={() => void sendTo(f)}
              >
                {sent.has(f.id) ? 'Sent' : 'Invite'}
              </button>
            </div>
          ))}
          {friends.length === 0 && (
            <p className="hint">
              You have no friends to invite yet. The link below works for
              anybody.
            </p>
          )}
          {friends.length > 0 && shown.length === 0 && (
            <p className="hint">Nobody by that name.</p>
          )}
        </div>

        <div className="as-rule" />
        <p className="hint">Or send an invite link to somebody</p>

        {code ? (
          <div className="as-link">
            {/*
              * An address, not eight characters.
              *
              * A bare code is fine pasted into a conversation here, where it
              * is read and turned into a card with a Join button. Sent
              * anywhere else - a text message, a phone - it is eight
              * characters with nothing to press and no way to tell what they
              * are for. Opening this link does what pressing that card does.
              */}
            <span className="as-code">{inviteLink(code)}</span>
            <button
              className="btn p"
              onClick={() => {
                void navigator.clipboard?.writeText(inviteLink(code))
                  .then(() => setCopied(true))
                  .catch(() => { /* no clipboard; the text is on screen */ })
              }}
            >
              <Icon name="copy" size={14} /> {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        ) : (
          <button className="btn" disabled={busy} onClick={() => void makeLink()}>
            {busy ? 'Making one…' : 'Make a link'}
          </button>
        )}

        {error && <p className="err">{error}</p>}
      </div>
    </Modal>
  )
}
