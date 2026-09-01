import { useEffect, useState } from 'react'
import type { Api } from '../lib/api'
import { Still } from './Still'

/**
 * An invite in a conversation, as something to press.
 *
 * Asked for as wanting a button in the DM rather than a code to copy out and
 * type into a box somewhere else. The invite already arrives as a message -
 * sending one from the member list posts "Join Somewhere: at-1a2b3c4d" into
 * the conversation - so nothing new has to be sent. What was missing was the
 * reading of it.
 *
 * It says which server before it offers to join it. A button that says Join
 * and nothing else is asking somebody to agree to something they have not
 * been told, and the answer to "what is this invite for" is not private:
 * whoever is looking is holding the invite.
 */

type Preview = {
  space: {
    id: string | null
    name: string
    icon: string | null
    description: string
    members: number
  }
  already: boolean
  /* Barred from this one. Said by the server so the card can say it
     instead of offering a button that is about to be refused. */
  banned?: boolean
}

/*
 * One request per code for the life of the page.
 *
 * The same invite can appear in several messages - sent twice, or quoted back
 * - and each of those is a card. Without this they each ask, and a
 * conversation scrolled through twice asks again every time the messages are
 * drawn.
 */
const cache = new Map<string, Promise<Preview | null>>()

function load(server: Api, code: string): Promise<Preview | null> {
  const hit = cache.get(code)
  if (hit) return hit
  const p = server.get<Preview>(`/api/invites/${encodeURIComponent(code)}`)
    .catch(() => null)
  cache.set(code, p)
  return p
}

/** The letters to show when a server has no picture of its own. */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase()
  return (words[0]![0]! + words[1]![0]!).toUpperCase()
}

export function InviteCard({ server, code }: { server: Api; code: string }) {
  const [preview, setPreview] = useState<Preview | null | 'loading'>('loading')
  const [joining, setJoining] = useState(false)
  const [joined, setJoined] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    void load(server, code).then((p) => { if (!cancelled) setPreview(p) })
    return () => { cancelled = true }
  }, [server, code])

  // Nothing at all while it is being looked up, rather than a box that
  // changes size a moment later and pushes the conversation about.
  if (preview === 'loading') return null

  /*
   * An invite that has been used up, expired, or was never real.
   *
   * Said plainly rather than hidden. A message that obviously contains an
   * invite, with nothing under it, reads as the app having failed to notice -
   * and the person who sent it will be asked why their link is broken.
   */
  if (!preview) {
    return (
      <div className="invite-card is-dead">
        <span className="invite-icon dead">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="9" /><path d="M9 12h6" />
          </svg>
        </span>
        <div className="invite-words">
          <b>Invite expired</b>
          <span>This one has run out or been used up. Ask for another.</span>
        </div>
      </div>
    )
  }

  const { space } = preview
  const here = preview.already || joined
  /*
   * Barred is not the same as expired, and is worth its own words.
   *
   * The card still names the server, because "you cannot join this" is not
   * an answer without the place - and there is nothing here they did not
   * already know: they hold the invite, and the ban is about them.
   */
  const barred = Boolean(preview.banned) && !here

  const join = async () => {
    setJoining(true)
    setError('')
    try {
      await server.post(`/api/invites/${encodeURIComponent(code)}/accept`)
      /*
       * Nothing else to do. The server pushes a change, the rail reloads
       * itself and the server appears - so this only has to stop offering to
       * do it again.
       */
      setJoined(true)
      cache.delete(code)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not join')
    } finally {
      setJoining(false)
    }
  }

  return (
    <div className="invite-card">
      {space.icon
        ? <Still className="invite-icon is-icon" path={space.icon} />
        : <span className="invite-icon">{initials(space.name)}</span>}

      <div className="invite-words">
        <span className="invite-lede">
          {here
            ? 'You are in this server'
            : barred ? 'You cannot join' : 'You have been invited to'}
        </span>
        <b>{space.name}</b>
        <span className="invite-meta">
          {space.members} {space.members === 1 ? 'member' : 'members'}
          {space.description ? ` · ${space.description}` : ''}
        </span>
        {error && <span className="invite-err">{error}</span>}
      </div>

      {here ? (
        <span className="invite-in">Joined</span>
      ) : barred ? (
        <span className="invite-in">Banned</span>
      ) : (
        <button className="invite-join" disabled={joining} onClick={() => void join()}>
          {joining ? 'Joining…' : 'Join'}
        </button>
      )}
    </div>
  )
}
