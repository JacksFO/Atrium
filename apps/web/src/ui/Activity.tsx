import {
  activityHeading, activityParts, elapsedSince, trackProgress, trackTime,
  type Heard,
} from '../lib/activity'
import { artUrl } from '../lib/artwork'
import { Icon } from './Icon'
import type { Activity } from '../lib/wire'

/**
 * What somebody is doing, in the two places it is shown.
 *
 * One line in a list of names, and a card on their profile. The line takes
 * the game where there is one, because everybody's music says the same thing
 * and only one of them is in a raid; the card shows both, game above music,
 * always in that order so two profiles do not disagree about which comes
 * first depending on which arrived first.
 */

/** The one line under a name in a member list. */
export function ActivityLine({ activity }: { activity: Activity | null }) {
  const parts = activityParts(activity)
  if (!parts || !activity) return null
  return (
    <span className="acl">
      <Icon name={activity.kind === 'game' ? 'game' : 'vol'} size={11} />
      {/* The space is in the text and not only in the gap between the two
          boxes. Read out or copied, "Playing" and the name of the game ran
          together into one word. */}
      <span className="acl-v">{parts.verb}{' '}</span>
      <b>{parts.what}</b>
    </span>
  )
}

/**
 * Standing in a voice room, in the same slot.
 *
 * Under a name rather than beside it, because it is the same one line the
 * game and the music use and a row cannot afford a second. Which room is
 * deliberately not said: the member list is a column of forty names about a
 * hundred pixels wide, and "In voice" is the part somebody scanning it is
 * reading for. The room, and a way into it, are on the card.
 */
export function InVoiceLine() {
  return (
    <span className="acl">
      <Icon name="vol" size={11} />
      <span className="acl-v">In voice</span>
    </span>
  )
}

/**
 * One activity, on a profile.
 *
 * The picture is the thing that makes it read as a real object rather than a
 * line of text - a game's icon or an album cover - and it is fetched by name
 * from this server, which already has it: the shell uploaded it once when it
 * first saw it rather than sending it to everybody on every track change.
 */
function Card({ a, ran }: { a: Heard; ran: number }) {
  const progress = trackProgress(a, ran)
  /* Counted from when this was first heard, not from when the card opened. */
  const elapsed = a.kind === 'game' && a.since !== undefined
    ? elapsedSince(a.since)
    : ''

  return (
    <div className="act">
      <p className="act-h">{activityHeading(a)}</p>
      <div className="act-row">
        {a.art
          ? <img className="act-art" src={artUrl(a.art)} alt="" />
          : (
            <span className="act-art none">
              <Icon name={a.kind === 'game' ? 'game' : 'vol'} size={18} />
            </span>
          )}
        <span className="act-txt">
          <span className="act-name">{a.name}</span>
          {/* The artist, where the player gave one. A bare "by" with nothing
              after it is worse than no line. */}
          {a.kind === 'music' && a.detail && (
            <span className="act-by">by {a.detail}</span>
          )}
          {elapsed && <span className="act-by">{elapsed}</span>}
          {progress && (
            <>
              <span className="act-bar">
                <span style={{ width: `${progress.pct}%` }} />
              </span>
              <span className="act-times">
                <span>{trackTime(progress.at)}</span>
                <span>{trackTime(progress.length)}</span>
              </span>
            </>
          )}
        </span>
      </div>
    </div>
  )
}

/** Everything they are doing, in order, for a profile. */
export function ActivityCards({ heard, ran }: { heard: readonly Heard[]; ran: number }) {
  if (heard.length === 0) return null
  /*
   * Game above music, decided here rather than trusted from the caller.
   *
   * The hook that stamps these orders them too, so in the app this changes
   * nothing - but the guarantee is that two profiles never disagree about
   * which comes first, and a guarantee that depends on every caller
   * remembering is not one.
   */
  const rank = { game: 0, music: 1 } as const
  const order = [...heard].sort((a, b) => rank[a.kind] - rank[b.kind])
  return (
    <div className="acards">
      {order.map((a, i) => <Card key={`${a.kind}-${a.name}-${i}`} a={a} ran={ran} />)}
    </div>
  )
}
