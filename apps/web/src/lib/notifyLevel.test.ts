import { describe, expect, it } from 'vitest'
import {
  levelFor, SPACE_DEFAULT, tellMeAbout, wantsTelling,
  type ChannelSetting, type SpaceSetting,
} from './notifyLevel'

/**
 * How much somebody is told about, and where the answer comes from.
 *
 * There were two settings and only one did anything. A channel could be set
 * to Only @mentions - it was written down, it came back when the menu was
 * opened again - and the code behind it only ever asked "is this channel
 * silenced", which that setting is not. It changed nothing.
 *
 * And "Use my default" had no default to use.
 */

const T = 1_000_000
const chan = (over: Partial<ChannelSetting> = {}): ChannelSetting =>
  ({ level: 'default', mutedUntil: null, ...over })
const space = (over: Partial<SpaceSetting> = {}): SpaceSetting =>
  ({ ...SPACE_DEFAULT, ...over })

describe('which level applies', () => {
  it('is the channel’s, when it has one', () => {
    expect(levelFor(chan({ level: 'mentions' }), space(), T)).toBe('mentions')
  })

  /* The whole of what was missing: a channel deferring now has something to
     defer to. */
  it('and the server’s, when the channel defers', () => {
    expect(levelFor(chan({ level: 'default' }), space({ level: 'mentions' }), T))
      .toBe('mentions')
  })

  it('and everything, when nobody has said otherwise', () => {
    expect(levelFor(undefined, undefined, T)).toBe('all')
    expect(levelFor(chan(), space(), T)).toBe('all')
  })

  /* More specific wins: somebody who has said "all messages" about one
     channel means it, even in a server set to mentions only. */
  it('and the channel beats the server both ways round', () => {
    expect(levelFor(chan({ level: 'all' }), space({ level: 'nothing' }), T)).toBe('all')
    expect(levelFor(chan({ level: 'nothing' }), space({ level: 'all' }), T)).toBe('nothing')
  })
})

describe('a mute', () => {
  /*
   * The loudest thing anybody can say, and always temporary. Somebody muting
   * a channel for an hour means that hour, whatever else is set.
   */
  it('silences the channel while it runs', () => {
    expect(levelFor(chan({ level: 'all', mutedUntil: T + 5000 }), space(), T)).toBe('nothing')
  })

  it('and a whole server while it runs', () => {
    expect(levelFor(chan(), space({ mutedUntil: T + 5000 }), T)).toBe('nothing')
  })

  /* And stops the moment it lapses, without anything having to sweep it. */
  it('and stops on its own', () => {
    expect(levelFor(chan({ level: 'all', mutedUntil: T - 1 }), space(), T)).toBe('all')
    expect(levelFor(chan(), space({ mutedUntil: T - 1, level: 'all' }), T)).toBe('all')
  })

  /*
   * A channel somebody has deliberately set to All still speaks through a
   * muted server. Muting a server is "quieten this place down", not "and
   * ignore the exceptions I have already made".
   */
  it('but a server mute does not override a channel that was set on purpose', () => {
    expect(levelFor(chan({ level: 'all' }), space({ mutedUntil: T + 5000 }), T)).toBe('all')
  })
})

describe('whether to make a noise', () => {
  const nobody = { me: false, everyone: false }
  const named = { me: true, everyone: false }
  const everybody = { me: false, everyone: true }

  it('about anything, on all messages', () => {
    expect(wantsTelling('all', nobody)).toBe(true)
  })

  it('about nothing, on nothing', () => {
    expect(wantsTelling('nothing', named)).toBe(false)
    expect(wantsTelling('nothing', everybody)).toBe(false)
  })

  /* The setting that did nothing until now. */
  it('and only about you, on mentions', () => {
    expect(wantsTelling('mentions', nobody)).toBe(false)
    expect(wantsTelling('mentions', named)).toBe(true)
  })

  /*
   * @everyone counts as being named, because it is - and can be turned off,
   * which is the one thing a level cannot express. Somebody on Only @mentions
   * with it suppressed is asking for what is about them and not what is about
   * everybody.
   */
  it('and about @everyone, unless it has been suppressed', () => {
    expect(wantsTelling('mentions', everybody, false)).toBe(true)
    expect(wantsTelling('mentions', everybody, true)).toBe(false)
  })

  it('but suppressing it never hides something addressed to you', () => {
    expect(wantsTelling('mentions', { me: true, everyone: true }, true)).toBe(true)
  })

  /* And it is not a mute: on All messages, an @everyone still arrives,
     because everything does. */
  it('and does not quieten a server set to all messages', () => {
    expect(wantsTelling('all', everybody, true)).toBe(true)
  })
})

describe('the whole question at once', () => {
  it('answers a plain message in a server set to mentions', () => {
    expect(tellMeAbout(
      { me: false, everyone: false }, chan(), space({ level: 'mentions' }), T,
    )).toBe(false)
  })

  it('and the same message when it names you', () => {
    expect(tellMeAbout(
      { me: true, everyone: false }, chan(), space({ level: 'mentions' }), T,
    )).toBe(true)
  })

  it('and takes the suppression from the server the channel is in', () => {
    expect(tellMeAbout(
      { me: false, everyone: true },
      chan(), space({ level: 'mentions', suppressEveryone: true }), T,
    )).toBe(false)
  })
})
