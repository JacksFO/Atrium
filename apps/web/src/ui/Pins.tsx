import { useEffect, useMemo, useState } from 'react'
import { Over } from './Over'
import { loadPins } from '../lib/load'
import { Markdown } from './Markdown'
import { renderOptions } from './Messages'
import type { RenderOptions } from '../lib/markdown'
import { Attachment } from './Attachment'
import { Lightbox } from './Lightbox'
import { anchorOf, useAnchored, type Anchor } from './useAnchored'
import type { Api } from '../lib/api'
import type { Id, Message, Space } from '../lib/wire'
import type { World } from '../lib/world'
import { Icon } from './Icon'
import { useEscape } from './useEscape'

/**
 * What has been pinned in here.
 *
 * Fetched when it is opened rather than kept in step with every change: a
 * panel nobody has open does not need to be right, and asking once when
 * somebody looks is cheaper than following every pin and unpin in every
 * channel they are not looking at.
 */
export function Pins({
  server, world, space, channelId, canUnpin, phone, onGoto, onUnpin, onClose,
}: {
  server: Api
  world: World
  /** Whose roles a mention in here is drawn against, or null in a
   *  conversation, where there are none. */
  space: Space | null
  channelId: Id
  canUnpin: boolean
  /** Where it is a sheet against the edges rather than a panel beside a
   *  button, and an inline position would fight the stylesheet for it. */
  phone: boolean
  onGoto: (id: Id) => void
  onUnpin: (id: Id) => void
  onClose: () => void
}) {
  /* Escape shuts it, like every other thing that opens over the
     conversation. It had a scrim to click past and nothing on the keyboard,
     so the one way out was with the mouse. */
  useEscape(onClose, true)

  const [list, setList] = useState<Message[] | null>(null)
  const [error, setError] = useState('')
  const [big, setBig] = useState<{ src: string; alt: string } | null>(null)

  /*
   * Beside the button it came from.
   *
   * It was `position:absolute` with nothing saying where, and it is drawn
   * through a portal onto the body - so "where it would have been" is the
   * top-left corner of the page, which is where it appeared. Found by asking
   * for the button rather than by having a position handed down through
   * three components: there is exactly one of these open at a time and it is
   * always the one in the header above it.
   */
  const [anchor, setAnchor] = useState<Anchor | null>(null)
  useEffect(() => {
    const find = () => {
      const button = document.querySelector('[aria-label="Pinned messages"]')
      const now = button ? anchorOf(button) : null
      /* Only when it has actually moved, so this cannot talk itself into a
         loop of renders that each measure the same button again. */
      setAnchor((was) => (
        was && now && was.x === now.x && was.y === now.y ? was : now
      ))
    }
    find()

    /*
     * And again when the header moves under it.
     *
     * The strip of notices above the conversation is measured after it is
     * drawn and its height handed to the stylesheet as --bars, which pushes
     * the whole conversation - header, pin button and all - down by that
     * much. That happens after this mounts. Measured once, the panel kept
     * the position the button had before it was pushed, and opened sixty-odd
     * pixels above the thing it belongs to.
     *
     * Which of the two you got came down to whether the strip was measured
     * before or after this ran, so the same app put the panel in two
     * different places on the same machine depending on how busy it was.
     */
    const moved = new MutationObserver(find)
    moved.observe(document.documentElement, {
      attributes: true, attributeFilter: ['style'],
    })
    /* And when the window changes shape, which moves it for ordinary
       reasons. */
    window.addEventListener('resize', find)
    return () => {
      moved.disconnect()
      window.removeEventListener('resize', find)
    }
  }, [])
  const { ref, at } = useAnchored(anchor, phone)

  /* The same table the conversation renders with, so a name in a pinned
     message is the name it is today rather than the id it is stored as. */
  const options = useMemo(
    () => renderOptions(world, space, true),
    [world, space],
  )

  useEffect(() => {
    let alive = true
    setList(null)
    setError('')
    loadPins(server, channelId)
      .then((r) => { if (alive) setList((r.messages ?? []) as Message[]) })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : 'Those would not load.')
      })
    return () => { alive = false }
  }, [server, channelId])

  return (
    <Over>
      <div className="scrim" style={{ background: 'transparent' }} onClick={onClose} />
      <div
        className="pinbox"
        ref={ref}
        style={at ? { left: `${at.left}px`, top: `${at.top}px` } : undefined}
      >
        <div className="pbh">
          <Icon name="pin" size={14} /> Pinned messages
          {!!list?.length && <span className="cnt2">{list.length}</span>}
        </div>
        <div className="pbl">
          {error && <p className="hint" style={{ padding: '14px 4px' }}>{error}</p>}
          {!error && list === null && (
            <p className="hint" style={{ padding: '14px 4px' }}>Reading…</p>
          )}
          {!error && list?.length === 0 && (
            <p className="hint" style={{ padding: '14px 4px' }}>
              Nothing is pinned here yet. Pin a message and it will be waiting
              here for everybody who comes looking.
            </p>
          )}
          {/* And the same for a pin. Somebody blocked can still have
              pinned something before they were, and the panel is a list of
              messages with nothing around them - so it is left out rather
              than collapsed. */}
          {list?.filter((m) => !world.blocked.has(m.author_id)).map((m) => (
            <PinRow
              key={m.id}
              message={m}
              who={world.people.get(m.author_id)?.display_name ?? 'Someone'}
              options={options}
              onOpen={(src, alt) => setBig({ src, alt })}
              canUnpin={canUnpin}
              onGoto={() => onGoto(m.id)}
              /* Off the list here as well as on the server. The panel is
                 fetched once when it opens and follows nothing afterwards,
                 which is right for pins somebody else changes - but it left
                 the row you had just unpinned sitting there until the panel
                 was closed and opened again. */
              onUnpin={() => {
                setList((was) => (was ?? []).filter((x) => x.id !== m.id))
                onUnpin(m.id)
              }}
            />
          ))}
        </div>
      </div>

      {/* Opened from a pin, the same as from the conversation: a picture in
          here is a picture, and a thumbnail nobody can open is a worse
          answer than not showing it. */}
      {big && <Lightbox src={big.src} alt={big.alt} onClose={() => setBig(null)} />}
    </Over>
  )
}

/**
 * One pinned message, in the panel.
 *
 * Its own component so that what it draws can be asked about with something
 * in it. Tested through the panel, both directions of the unpin permission
 * passed — one because the button was gated and the other because a static
 * render has no rows at all, which is the same green for opposite reasons.
 */
export function PinRow({
  message, who, options, canUnpin, onGoto, onUnpin, onOpen,
}: {
  message: Message
  who: string
  /** The same names, roles and shortcodes the conversation renders with. */
  options: RenderOptions
  canUnpin: boolean
  onGoto: () => void
  onUnpin: () => void
  onOpen: (src: string, alt: string) => void
}) {
  return (
    <div className="pinc">
      <div className="w">
        {who}
        <span className="gw" />
        <button className="icb" onClick={onGoto} title="Jump to it">
          <Icon name="dn" size={14} />
        </button>
        {canUnpin && (
          <button className="icb" onClick={onUnpin} title="Unpin">
            <Icon name="x" size={14} />
          </button>
        )}
      </div>
      {/*
        * As it was said, not as one line of stripped text.
        *
        * It used to be `oneLine(body) || 'a picture'`, on the reasoning that
        * a pinned code block would turn the panel into a second conversation.
        * True of a code block, and wrong about everything else: a pinned GIF
        * read as the words "a picture", a pinned link lost the thing it
        * linked to, and the one message somebody thought worth keeping was
        * the one they could not see. Drawn through the same markdown and the
        * same attachments the conversation uses, so a pin looks like what was
        * pinned.
        */}
      {message.body && (
        <div className="b">
          <Markdown text={message.body} options={options} />
        </div>
      )}
      {message.attachments.map((a) => (
        <Attachment key={a.id} a={a} onOpen={onOpen} />
      ))}
      {!message.body && message.attachments.length === 0 && (
        <div className="b hint">Nothing but reactions.</div>
      )}
    </div>
  )
}
