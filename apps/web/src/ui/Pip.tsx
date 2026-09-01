import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { nameIn, spaceOfChannel } from '../lib/names'
import { partsOf, pipList, type Call, type StreamKey } from '../lib/call'
import {
  clamp, movedBy, remember, remembered, resizedBy, restingPlace,
  type Box, type Edge, type Ratio,
} from '../lib/pipbox'
import type { World } from '../lib/world'
import { Avatar } from './Avatar'
import { Icon } from './Icon'

/**
 * What you were watching, while you are reading something else.
 *
 * Closing the stage to go and read a channel is not the same as no longer
 * wanting to see the thing you joined to watch — but the tile it was in has
 * gone, and the stream is still being sent because you are still subscribed
 * to it. So it goes in a corner: still watching, still paying for it, and
 * still able to stop.
 *
 * One at a time, because two of these is a second stage in the corner of the
 * first — but which one is now something you can say, rather than whichever
 * the set happened to yield.
 *
 * Moved by dragging its bar and resized from any edge, and it remembers where
 * it was left. The arithmetic for all of that is in `pipbox`, where it can be
 * checked without a browser; what is left here is which pointer did what.
 */

/** Every edge and corner. Written once here, placed by the stylesheet. */
const EDGES: Edge[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']

const viewport = () => ({
  w: typeof window === 'undefined' ? 1280 : window.innerWidth,
  h: typeof window === 'undefined' ? 800 : window.innerHeight,
})

export function Pip({ call, world, onOpen, onStop }: {
  call: Call
  world: World
  onOpen: () => void
  onStop: (key: StreamKey) => void
}) {
  const keys = pipList(call, world.me.id)
  const [picked, setPicked] = useState<StreamKey | null>(null)
  const [box, setBox] = useState<Box>(() => remembered(viewport()) ?? restingPlace(viewport()))
  /*
   * The shape of what is playing, which the window is then kept in.
   *
   * A window resized freely stops being the shape of the picture, and
   * `object-fit: contain` letterboxes the difference - reported as black bars
   * down a window stretched wide. Cropping instead would hide part of
   * somebody's screen, so the window is the thing that gives.
   *
   * Read off the element rather than guessed: a shared window is whatever
   * shape that window is, a phone is taller than it is wide, and 16:9 is only
   * the common case.
   */
  const [ratio, setRatio] = useState<Ratio>(null)
  const el = useRef<HTMLVideoElement>(null)

  /* Otherwise it is dragged off the screen by the screen getting smaller. */
  useEffect(() => {
    const onResize = () => setBox((b) => clamp(b, viewport(), ratio))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [ratio])

  /*
   * Both events, because a stream arrives without dimensions and a shared
   * window can be resized by the person sharing it while you watch.
   */
  useEffect(() => {
    const v = el.current
    if (!v) return
    const read = () => {
      if (!v.videoWidth || !v.videoHeight) return
      setRatio(v.videoWidth / v.videoHeight)
    }
    read()
    v.addEventListener('loadedmetadata', read)
    v.addEventListener('resize', read)
    return () => {
      v.removeEventListener('loadedmetadata', read)
      v.removeEventListener('resize', read)
    }
  })

  /* And the window follows it, keeping the width somebody chose. */
  useEffect(() => {
    if (!ratio) return
    setBox((b) => clamp(b, viewport(), ratio))
  }, [ratio])

  /*
   * Whose face the corner follows, when it is showing faces.
   *
   * Asked for: with several cameras on, the corner should be whoever is
   * talking. Only for cameras - a screen is being watched deliberately and
   * must not be swapped out from under somebody because a person spoke.
   *
   * And not once somebody has chosen with the arrows: an app that overrules
   * the choice you just made a second later is worse than one that never
   * followed anybody.
   */
  const showing = keys.includes(picked as StreamKey) ? picked! : keys[0] ?? null
  const faces = showing ? partsOf(showing).source === 'cam' : false
  /* Never onto your own face: following yourself the moment you speak is
     the corner showing you a mirror for as long as you are talking. */
  const talking = keys.find((k) => {
    const at = partsOf(k)
    return at.id !== world.me.id && call.speaking.has(at.id)
  })

  useEffect(() => {
    if (!faces || picked || !talking) return
    setPicked(talking)
  }, [faces, picked, talking])

  /*
   * Forget a choice once what was chosen has gone.
   *
   * Otherwise stopping the share you had picked leaves `picked` naming a
   * stream nobody is sending, and the corner falls back to the first one for
   * ever while still believing you had chosen.
   */
  useEffect(() => {
    if (picked && !keys.includes(picked)) setPicked(null)
  }, [picked, keys])

  const stream = showing ? call.video.get(showing) : undefined
  useEffect(() => {
    const v = el.current
    if (v && stream && v.srcObject !== stream) v.srcObject = stream
  }, [stream])

  /*
   * What the pointer is doing, and to which edge.
   *
   * In a ref because a drag is not something to draw - only its result is -
   * and holding it in state would re-render on every pointer move for the
   * sake of a number nothing reads.
   */
  const drag = useRef<{ from: Box; x: number; y: number; edge: Edge | null } | null>(null)

  const begin = (e: ReactPointerEvent, edge: Edge | null) => {
    /* Not a button. The whole window is a grip, so everything on it that is
       not a grip has to say so - otherwise pressing an arrow drags. */
    if (!edge && (e.target as Element).closest('button')) return
    if (edge) e.stopPropagation()
    /* An edge is a child of the window, so its pointerdown reaches the
       window's handler too - which would immediately replace the resize with
       a move. */
    e.preventDefault()
    drag.current = { from: box, x: e.clientX, y: e.clientY, edge }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }

  const moving = (e: ReactPointerEvent) => {
    const at = drag.current
    if (!at) return
    const dx = e.clientX - at.x
    const dy = e.clientY - at.y
    setBox(at.edge
      ? resizedBy(at.from, at.edge, dx, dy, viewport(), ratio)
      : movedBy(at.from, dx, dy, viewport()))
  }

  const done = (e: ReactPointerEvent) => {
    if (!drag.current) return
    drag.current = null
    e.currentTarget.releasePointerCapture?.(e.pointerId)
    remember(box)
  }

  if (!showing || !stream) return null
  const id = partsOf(showing).id
  const person = world.people.get(id)
  /* In the server whose room this is, like every other place a person is
     named. Null for a conversation's call, which is nobody's server. */
  const label = (person ? nameIn(world, spaceOfChannel(world, call.channel), person) : null)
    ?? call.members.find((m) => m.id === id)?.name
    ?? 'Someone'

  /** The next one along, wrapping, so two shares are one press apart. */
  const step = (by: number) => {
    const at = keys.indexOf(showing)
    setPicked(keys[(at + by + keys.length) % keys.length] ?? null)
  }

  return (
    <div className="pip2" style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
      onPointerDown={(e) => begin(e, null)}
      onPointerMove={moving}
      onPointerUp={done}
      onPointerCancel={done}>
      {/* Muted, like every other picture in a call: the sound is coming out
          of its own element already, and a second one plays it twice a
          fraction apart. */}
      <video ref={el} autoPlay playsInline muted />
      {/* Only when there is somewhere to go. One share and these are two
          buttons that do nothing but take up the picture. */}
      {keys.length > 1 && (
        <>
          <button className="pipnav l" onClick={() => step(-1)}
            aria-label="Watch the previous one">
            <Icon name="chev" size={16} />
          </button>
          <button className="pipnav r" onClick={() => step(1)}
            aria-label="Watch the next one">
            <Icon name="chev" size={16} />
          </button>
        </>
      )}
      {EDGES.map((edge) => (
        <div key={edge} className="piph" data-edge={edge}
          onPointerDown={(e) => begin(e, edge)}
          onPointerMove={moving}
          onPointerUp={done}
          onPointerCancel={done} />
      ))}
      {/* Who it is, and what to do about it - over the picture rather than
          under it. It was a bar of its own because it was the only thing you
          could drag the window by; the whole window drags now, so a permanent
          strip was taking a tenth of the picture to say a name. */}
      <div className="pipbar">
        {person && <Avatar user={person} size="xs" />}
        <span className="pipwho">{label}</span>
        {keys.length > 1 && (
          <span className="pipof">{keys.indexOf(showing) + 1}/{keys.length}</span>
        )}
        <span className="gw" />
        <button className="icb" onClick={onOpen} title="Back to the stage">
          <Icon name="up" size={15} />
        </button>
        {/* Only for somebody else's. You are not subscribed to your own, so
            there is nothing to stop - the button would do nothing at all. */}
        {id !== world.me.id && (
          <button className="icb" onClick={() => onStop(showing)} title="Stop watching">
            <Icon name="x" size={15} />
          </button>
        )}
      </div>
    </div>
  )
}
