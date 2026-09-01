import { describe, expect, it } from 'vitest'
import type { Activity } from './wire'
import {
  activityHeading, activityLine, elapsedSince, orderedActivities,
  primaryActivity, stamp, trackProgress, trackTime,
} from './activity'

const game: Activity = { kind: 'game', name: 'Tarkov', since: 0 }
const music: Activity = { kind: 'music', name: 'Ghosts N Stuff', detail: 'deadmau5' }

describe('the line under a name', () => {
  it('names a game, because the name is the interesting part', () => {
    expect(activityLine(game)).toBe('Playing Tarkov')
  })

  /* Reported as "it shows the whole song". Forty people each showing a
     different title is a wall of text nobody reads. */
  it('says what music is rather than what it is playing', () => {
    expect(activityLine(music)).toBe('Listening to Spotify')
  })

  it('and never leaks the artist into it either', () => {
    expect(activityLine({ ...music, detail: 'somebody' })).toBe('Listening to Spotify')
  })

  it('carries no duration — that belongs on the card', () => {
    expect(activityLine(game)).not.toMatch(/for |elapsed/)
  })

  it('says nothing at all for nothing at all', () => {
    expect(activityLine(null)).toBe('')
  })
})

describe('doing two things at once', () => {
  it('gives the one line to the game', () => {
    expect(primaryActivity([music, game])?.kind).toBe('game')
  })

  it('and the profile puts the game card above the music one', () => {
    expect(orderedActivities([music, game])[0]?.kind).toBe('game')
  })

  it('with nothing to say when there is nothing', () => {
    expect(primaryActivity([])).toBeNull()
    expect(primaryActivity(undefined)).toBeNull()
  })
})

describe('the card', () => {
  it('names the player for music and the kind for a game', () => {
    expect(activityHeading(music)).toBe('Listening to Spotify')
    expect(activityHeading(game)).toBe('Playing a game')
  })

  it('counts up rather than describing', () => {
    expect(elapsedSince(0, 63_000)).toBe('01:03 elapsed')
  })

  it('with hours only once there are any', () => {
    expect(elapsedSince(0, 3_723_000)).toBe('1:02:03 elapsed')
  })

  it('writes a track time the way a person would', () => {
    expect(trackTime(31_000)).toBe('0:31')
    expect(trackTime(213_000)).toBe('3:33')
  })
})

describe('the progress bar', () => {
  const track: Activity = { kind: 'music', name: 'x', at: 30_000, length: 120_000 }

  /* A bar that sits where the last report left it looks like the app has
     stopped, which is worse than not showing one. */
  it('moves on by however long ago the player spoke', () => {
    expect(trackProgress(track, 10_000)?.at).toBe(40_000)
  })

  it('and never past its own end', () => {
    expect(trackProgress(track, 999_999)?.at).toBe(120_000)
  })

  /* A position with no length would fill a bar to a fraction of nothing.
     That bar is a lie rather than a missing feature. */
  it('refuses to draw one for a player that gave no length', () => {
    expect(trackProgress({ kind: 'music', name: 'x', at: 30_000 })).toBeNull()
  })

  it('and there is no bar on a game', () => {
    expect(trackProgress(game)).toBeNull()
  })
})

describe('when it was first heard', () => {
  /* Kept in the card, closing a profile and opening it again started the
     count from nothing and showed 0:00 forty seconds into a song. */
  it('keeps the moment for a track that is still the same one', () => {
    const first = stamp([{ kind: 'music', name: 'x', at: 1 }], [], 1000)
    const later = stamp([{ kind: 'music', name: 'x', at: 1 }], first, 9000)
    expect(later[0]?.heardAt).toBe(1000)
  })

  it('and starts again when the track changes', () => {
    const first = stamp([{ kind: 'music', name: 'x', at: 1 }], [], 1000)
    const next = stamp([{ kind: 'music', name: 'y', at: 1 }], first, 9000)
    expect(next[0]?.heardAt).toBe(9000)
  })

  /* A game starting beside a song must not reset the song's bar. */
  it('does not disturb a track when something else appears', () => {
    const first = stamp([{ kind: 'music', name: 'x', at: 1 }], [], 1000)
    const both = stamp(
      [{ kind: 'music', name: 'x', at: 1 }, { kind: 'game', name: 'g' }],
      first, 9000,
    )
    expect(both.find((a) => a.kind === 'music')?.heardAt).toBe(1000)
    expect(both.find((a) => a.kind === 'game')?.heardAt).toBe(9000)
  })
})
