import { partsOf, volumeOf, type Call, type StreamKey } from '../lib/call'
import { useRef } from 'react'
import { Over } from './Over'
import {
  SHARE_PRESETS, viewerHint, type SharePreset,
} from '../lib/sharequality'
import type { Id } from '../lib/wire'
import { useEscape } from './useEscape'

/**
 * The options for one tile.
 *
 * Behind one button rather than along the bottom of every tile: three
 * controls each is more furniture than picture once four people are in a
 * call. A right-click opens the same thing, because that is where anybody
 * looks for options on a thing.
 *
 * What is in it depends on whose tile it is. Somebody else's screen has a
 * volume, because it is making noise at you. Your own has none — your own
 * screen played back is feedback — and every tile can be made to fill the
 * display, or put in a window of its own where the browser has somewhere to
 * put one.
 */
export function TileMenu({
  streamKey, call, me, label, master, onClose, onVolume, onWatch, onFull, onPopOut,
  onQuality, quality,
}: {
  streamKey: StreamKey
  call: Call
  me: Id
  label: string
  master: number
  onClose: () => void
  onVolume: (level: number) => void
  /** Only ever your own share: nobody else's is yours to re-encode. */
  onQuality?: (preset: SharePreset) => void
  /** What a share is going out at now, so the list can say which. */
  quality: SharePreset
  onWatch: (on: boolean) => void
  onFull: () => void
  onPopOut: () => void
}) {
  /* Escape shuts it, like every other thing that opens over the call. It had
     a sheet to click past and nothing on the keyboard. */
  useEscape(onClose, true)

  const { source, id } = partsOf(streamKey)
  const mine = id === me
  const screen = source === 'share'
  /* Somebody's microphone, with no picture behind it. Everything in here
     about a picture - filling the screen, popping out, watching - is absent
     rather than disabled, because there is nothing for any of them to act
     on. */
  const justAVoice = source === 'voice'
  const watching = call.watching.has(streamKey)
  /* Whether there is a sound to set a volume for, asked of the sounds this
     call actually has. The old client asked whether an <audio> element with a
     guessed-at id was in the document, and that element was never removed —
     so it offered a volume slider for a share that had ended. */
  /*
   * Any sound that is not yours, rather than only a share's.
   *
   * A person's microphone arrives as its own sound under its own key and has
   * always been played at its own volume - the only thing missing was the
   * slider, because this asked for a share before offering one. One friend
   * being twice as loud as everybody else is the ordinary case, and the
   * setting in this menu was the one place it could have been fixed.
   */
  const hasSound = !mine && call.sounds.has(streamKey)
  const level = Math.round(volumeOf(call, streamKey, master) * 100)
  const quiet = level === 0
  /* Where it was before it was muted, so unmuting is not a guess. */
  const before = useRef(level || 100)
  /* Handed in rather than read out of storage: see the same line in the bar
     at the bottom. */
  const preset = quality

  return (
    <Over>
      <div className="scrim" style={{ background: 'transparent' }} onClick={onClose} />
      <div className="tilem">
        <p className="hd2">
          {mine
            ? justAVoice ? 'You' : screen ? 'Your screen' : 'Your camera'
            : `${label}${justAVoice ? '' : screen ? "'s screen" : "'s camera"}`}
        </p>

        {hasSound ? (
          <>
            <Row what={justAVoice ? 'How loud they are' : 'Its volume'}
              note={quiet ? 'Muted' : `${level}%`}>
              <input
                type="range" className="rng" min={0} max={100} value={level}
                onChange={(e) => onVolume(Number(e.target.value))}
              />
            </Row>
            {/*
              * Muting, which is not the same as sliding to nought.
              *
              * Nought is a level somebody chose and has to un-choose by
              * finding the same slider and guessing where it was; this
              * remembers where it was and puts it back. One game too loud
              * during a conversation is the whole of what this is for.
              */}
            <Row what={justAVoice ? 'Hearing them' : 'Its sound'} note={quiet ? 'Off' : 'On'}>
              <button className="btn" onClick={() => {
                if (quiet) { onVolume(before.current || 100); return }
                before.current = level
                onVolume(0)
              }}>
                {quiet ? 'Unmute' : 'Mute'}
              </button>
            </Row>
          </>
        ) : !mine && screen && watching ? (
          <p className="hint" style={{ margin: '2px 0 8px' }}>
            This share has no sound in it.
          </p>
        ) : null}

        {/*
          * What your own share is worth sending, changed while it is being
          * sent. The capture stays exactly as it is — what moves is the
          * ceiling and what the encoder gives up first when the line cannot
          * carry it. Named in the two numbers people think in, because
          * "Balanced" tells nobody whether their text will be readable.
          */}
        {mine && screen && onQuality && (
          <Row what="Quality" note={viewerHint(preset)}>
            <select
              className="lab"
              value={preset.id}
              onChange={(e) => {
                const next = SHARE_PRESETS.find((x) => x.id === e.target.value)
                if (next) onQuality(next)
              }}
            >
              {/* The name IS the two numbers — there is nothing else worth
                  calling these, and "Balanced" told nobody whether their
                  text would be readable. */}
              {SHARE_PRESETS.map((x) => (
                <option key={x.id} value={x.id}>{x.name}</option>
              ))}
            </select>
          </Row>
        )}

        {!justAVoice && (
          <Row what="Fill the screen" note="Everything else gets out of the way">
            <button className="btn" onClick={() => { onFull(); onClose() }}>Full screen</button>
          </Row>
        )}

        {/* Only where the browser has somewhere to put one. Offered
            regardless, it is a button that does nothing on a phone. */}
        {!justAVoice && typeof document !== 'undefined' && document.pictureInPictureEnabled && (
          <Row what="A window of its own" note="For a second monitor, or beside something else">
            <button className="btn" onClick={() => { onPopOut(); onClose() }}>Pop out</button>
          </Row>
        )}

        {!mine && !justAVoice && (
          <Row what={screen ? 'Watching it' : 'Showing it'}
            note={watching ? 'You are' : 'Nothing is being sent'}>
            <button className="btn" onClick={() => { onWatch(!watching); onClose() }}>
              {watching ? 'Stop watching' : 'Watch'}
            </button>
          </Row>
        )}
      </div>
    </Over>
  )
}

function Row({ what, note, children }: {
  what: string
  note: string
  children: React.ReactNode
}) {
  return (
    <div className="row">
      <span>
        <b>{what}</b>
        <span className="s">{note}</span>
      </span>
      <span className="gw" />
      {children}
    </div>
  )
}
