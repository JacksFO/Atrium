import { useEffect, useState } from 'react'
import { oneLine } from '../lib/markdown'
import type { Api } from '../lib/api'
import type { Id, Message } from '../lib/wire'
import type { World } from '../lib/world'
import { Icon } from './Icon'
import { useEscape } from './useEscape'

/**
 * Search, across everything this account can reach.
 *
 * The server decides what that is, on every result: a search box is the
 * easiest place in an app to hand back exactly what a channel just withheld,
 * so being able to see a channel and being allowed to read what was said in
 * it before you arrived are asked separately there. Nothing is filtered here
 * — a client that filtered would be a second opinion, and the one on screen
 * would be the one that was wrong.
 */
export function Search({ server, world, onGoto, onClose }: {
  server: Api
  world: World
  onGoto: (id: Id, channelId: Id) => void
  onClose: () => void
}) {
  /* Escape shuts it, like every other thing that opens over the
     conversation. It had a scrim to click past and nothing on the keyboard,
     so the one way out was with the mouse. */
  useEscape(onClose, true)

  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Message[]>([])
  const [state, setState] = useState<'idle' | 'looking' | 'done'>('idle')
  const [error, setError] = useState('')

  useEffect(() => {
    /* Two letters, which is what the route asks for as well — one letter
       matches most of everything and is a search nobody meant to run. */
    if (q.trim().length < 2) {
      setHits([])
      setState('idle')
      return
    }
    let alive = true
    setState('looking')
    setError('')
    const timer = setTimeout(() => {
      server.get<{ results?: Message[] }>(`/api/search?q=${encodeURIComponent(q.trim())}`)
        .then((r) => { if (alive) { setHits(r.results ?? []); setState('done') } })
        .catch((e: unknown) => {
          if (!alive) return
          setState('done')
          setError(e instanceof Error ? e.message : 'That search would not run.')
        })
    }, 260)
    return () => { alive = false; clearTimeout(timer) }
  }, [server, q])

  return (
    <div className="pane side">
      <div className="chd" style={{ height: 52 }}>
        <span className="tt t" style={{ fontSize: '1em' }}>
          <Icon name="search" size={16} /> Search
        </span>
        <span className="gw" />
        <button className="icb" onClick={onClose} aria-label="Close">
          <Icon name="x" size={15} />
        </button>
      </div>

      <div className="searchp">
        <input
          placeholder="Search everything you can read"
          value={q}
          autoFocus
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onClose() } }}
        />
        <p className="hint">
          {error ? error
            : state === 'idle' ? 'Two letters or more.'
              : state === 'looking' ? 'Looking…'
                : `${hits.length} ${hits.length === 1 ? 'message' : 'messages'}`}
        </p>
      </div>

      <div className="mem" style={{ padding: '0 12px 12px' }}>
        {/* What a blocked person said stays hidden when it is searched for
            as well as when it is scrolled past. A result is the message,
            in a list with nothing around it to explain itself, so it is
            left out rather than collapsed the way one in the conversation
            is - there is no thread here for a gap to confuse. */}
        {hits.filter((m) => !world.blocked.has(m.author_id)).map((m) => (
          <button className="pinc hit" key={m.id}
            onClick={() => onGoto(m.id, m.channel_id)}>
            <div className="w">
              {world.people.get(m.author_id)?.display_name ?? 'Someone'}
              <span className="gw" />
              <span className="at">{when(m.created_at)}</span>
            </div>
            <div className="b">{oneLine(m.body, 200) || 'a picture'}</div>
          </button>
        ))}
      </div>
    </div>
  )
}

const when = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
