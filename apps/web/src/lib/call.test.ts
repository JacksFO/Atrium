import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  audible, emptyCall, keyOf, partsOf, pipKey, pipList, tilesOf, volumeOf, watched,
  withoutPerson, withoutStream, withStream,
  type Call, type CallMember, type StreamKey,
} from './call'

const member = (id: string, over: Partial<CallMember> = {}): CallMember => ({
  id, identity: id, name: id, muted: false, sharing: false, cam: false, ...over,
})

const stream = () => ({}) as MediaStream

function call(over: Partial<Call> = {}): Call {
  return { ...emptyCall(), ...over }
}

describe('a person’s two sounds', () => {
  /*
   * The bug this whole shape exists to prevent. A voice and the sound of a
   * shared game are two sounds from one person, and the old client removed
   * them by an id built from the person alone — so ending a screen share
   * deleted the element carrying that person's *voice*, and they went silent
   * to everybody until they rejoined.
   */
  it('are separate, so losing one keeps the other', () => {
    let sounds = new Map<StreamKey, MediaStream>()
    sounds = withStream(sounds, keyOf('voice', 'u7'), stream())
    sounds = withStream(sounds, keyOf('share', 'u7'), stream())

    sounds = withoutStream(sounds, keyOf('share', 'u7'))

    expect(sounds.has(keyOf('voice', 'u7'))).toBe(true)
    expect(sounds.has(keyOf('share', 'u7'))).toBe(false)
  })

  it('and a key says which of the two it is', () => {
    expect(partsOf(keyOf('share', 'u7'))).toEqual({ source: 'share', id: 'u7' })
    expect(keyOf('voice', 'u7')).not.toBe(keyOf('share', 'u7'))
  })

  /* Ids are uuids and carry colons in nothing, but a key is split at the
     first one so that a person whose id did could never rename a source. */
  it('and an id is read back whole', () => {
    expect(partsOf(keyOf('cam', 'a:b:c')).id).toBe('a:b:c')
  })
})

describe('leaving', () => {
  it('takes everything that person was sending', () => {
    let v = new Map<StreamKey, MediaStream>()
    v = withStream(v, keyOf('share', 'u7'), stream())
    v = withStream(v, keyOf('cam', 'u7'), stream())
    v = withStream(v, keyOf('cam', 'u8'), stream())

    v = withoutPerson(v, 'u7')

    expect([...v.keys()]).toEqual([keyOf('cam', 'u8')])
  })

  it('and leaves the map alone when they were sending nothing', () => {
    const v = withStream(new Map(), keyOf('cam', 'u8'), stream())
    expect(withoutPerson(v, 'u7')).toBe(v)
  })
})

describe('being deafened', () => {
  /*
   * Every sound in the call, not every voice. The old client selected the
   * voices only, so deafening yourself silenced the people and left four
   * people's games playing — which is the one thing deafening is for.
   */
  it('silences a shared game as well as a voice', () => {
    const c = call({ deaf: true, watching: new Set([keyOf('share', 'u7')]) })
    expect(audible(c, keyOf('voice', 'u7'), 'me')).toBe(false)
    expect(audible(c, keyOf('share', 'u7'), 'me')).toBe(false)
  })

  it('while hearing normally leaves a voice audible', () => {
    expect(audible(call(), keyOf('voice', 'u7'), 'me')).toBe(true)
  })

  /* A screen and its sound are one thing to whoever is watching, so the sound
     follows the picture. Heard without being watched, a room of four with two
     shares is four games playing at once at nobody's request. */
  it('and a share is heard only while it is being watched', () => {
    expect(audible(call(), keyOf('share', 'u7'), 'me')).toBe(false)
    const c = call({ watching: new Set([keyOf('share', 'u7')]) })
    expect(audible(c, keyOf('share', 'u7'), 'me')).toBe(true)
  })

  /* Your own microphone comes back from the room like anybody else's, and
     playing it is hearing yourself talk a fraction of a second late. */
  it('and you never hear yourself', () => {
    expect(audible(call(), keyOf('voice', 'me'), 'me')).toBe(false)
  })
})

describe('how loud one thing is', () => {
  /* One slider for the lot means turning down a game turns down the person
     telling you about it. */
  it('follows the master volume for a voice', () => {
    expect(volumeOf(call(), keyOf('voice', 'u7'), 50)).toBeCloseTo(0.5)
  })

  it('but not for a share, which is set on its own tile', () => {
    expect(volumeOf(call(), keyOf('share', 'u7'), 50)).toBe(1)
  })

  it('and what was chosen for one thing beats both', () => {
    const c = call({ levels: new Map([[keyOf('share', 'u7'), 20]]) })
    expect(volumeOf(c, keyOf('share', 'u7'), 100)).toBeCloseTo(0.2)
    expect(volumeOf(c, keyOf('share', 'u8'), 100)).toBe(1)
  })

  it('and nothing asks an element for a volume outside 0–1', () => {
    const c = call({ levels: new Map([[keyOf('voice', 'u7'), 400]]) })
    expect(volumeOf(c, keyOf('voice', 'u7'), 100)).toBe(1)
    expect(volumeOf(call(), keyOf('voice', 'u7'), -5)).toBe(0)
  })
})

describe('the tiles', () => {
  it('put screens before cameras', () => {
    const c = call({ members: [member('u8', { cam: true }), member('u9', { sharing: true })] })
    expect(partsOf(tilesOf(c, 'me')[0]!).source).toBe('share')
  })

  /* You know what you are sharing. Yours first pushes the thing you joined to
     watch off the end of a narrow window. */
  it('and yours after theirs, within each kind', () => {
    const c = call({ members: [member('me', { sharing: true }), member('u9', { sharing: true })] })
    const out = tilesOf(c, 'me')
    expect(partsOf(out[0]!).id).toBe('u9')
    expect(partsOf(out[1]!).id).toBe('me')
  })

  /*
   * Read off who is in the room, not off the streams that have arrived.
   *
   * A share nobody has asked for has no stream — that is the whole point of
   * not asking. Drawn from the streams, a share you have not opted into is
   * invisible, so there is nothing on screen to opt in *from*, and somebody
   * sharing looks like somebody whose sharing did not work.
   */
  it('and a share with no stream still gets a tile to ask from', () => {
    const c = call({ members: [member('u9', { sharing: true })] })
    expect(c.video.size).toBe(0)
    expect(tilesOf(c, 'me')).toEqual([keyOf('share', 'u9')])
  })

  it('while somebody sending nothing gets no tile at all', () => {
    expect(tilesOf(call({ members: [member('u9')] }), 'me')).toEqual([])
  })
})

describe('what has a picture in it', () => {
  /* Nothing arrives unasked: the media server stops sending a track nobody
     is subscribed to, and dynacast stops the sender encoding it. So not
     watching is a saving for the person sharing, not a curtain here. */
  it('is what has been asked for', () => {
    const c = call({ watching: new Set([keyOf('share', 'u9')]) })
    expect(watched(c, keyOf('share', 'u9'), 'me')).toBe(true)
    expect(watched(c, keyOf('share', 'u8'), 'me')).toBe(false)
  })

  /* Yours is on your machine already and costs nobody anything. Waiting for
     it to come back from the room was a tile that never appeared, because
     the thing that would have redrawn it was the stream arriving. */
  it('and always your own, without asking', () => {
    expect(watched(call(), keyOf('share', 'me'), 'me')).toBe(true)
  })
})

describe('what is kept in the corner while reading elsewhere', () => {
  const c = (over: Partial<Call> = {}) => call(over)

  it('is a screen you are watching that has arrived', () => {
    const k = keyOf('share', 'u9')
    expect(pipKey(c({ watching: new Set([k]), video: new Map([[k, stream()]]) }), 'me')).toBe(k)
  })

  /* Asked for and not yet sent is a black rectangle in the corner, which
     reads as the thing having broken rather than as it being on its way. */
  it('and not one that has been asked for but not arrived', () => {
    const k = keyOf('share', 'u9')
    expect(pipKey(c({ watching: new Set([k]) }), 'me')).toBe(null)
  })

  /*
   * A camera is who somebody is rather than what they are showing you, so it
   * never covers a screen - but a call where nobody is sharing and two people
   * have their cameras on had nothing in the corner at all.
   */
  it('and a camera only when no screen is being watched', () => {
    const cam = keyOf('cam', 'u9')
    const share = keyOf('share', 'u8')
    const watching = new Set([cam])
    const video = new Map([[cam, stream()]])
    expect(pipKey(c({ watching, video }), 'me')).toBe(cam)

    watching.add(share)
    video.set(share, stream())
    expect(pipKey(c({ watching, video }), 'me'), 'the screen wins').toBe(share)
  })

  /*
   * Your own was left out entirely - a mirror of the screen you are already
   * looking at. It is in now, because when you are the one sharing it is the
   * only thing there is to show. It just never comes first.
   */
  it('and your own only behind everybody else’s', () => {
    const mine = keyOf('share', 'me')
    const theirs = keyOf('share', 'u1')
    const video = new Map([[mine, stream()], [theirs, stream()]])
    expect(pipKey(c({ watching: new Set([theirs]), video }), 'me')).toBe(theirs)
  })

  it('and nothing at all when nothing is being watched', () => {
    expect(pipKey(c(), 'me')).toBe(null)
  })

  /*
   * Several at once, so there is something for the arrows to move between.
   * In the room's order rather than the set's, so the one on the right stays
   * the one on the right as streams arrive and leave.
   */
  it('offers every screen it could show, in the room’s order', () => {
    const a = keyOf('share', 'u1')
    const b = keyOf('share', 'u2')
    const call = c({
      members: [
        { id: 'u1', identity: 'u1', name: 'One', muted: false, sharing: true, cam: false },
        { id: 'u2', identity: 'u2', name: 'Two', muted: false, sharing: true, cam: false },
      ],
      watching: new Set([b, a]),
      video: new Map([[b, stream()], [a, stream()]]),
    })
    expect(pipList(call, 'me')).toEqual([a, b])
  })

  /*
   * Your own is never something you asked to watch - nothing subscribes to
   * itself - so it is read out of the streams the room says you are sending.
   * Left out entirely, the corner was empty in exactly the call where you are
   * the one sharing and there is nothing else it could show.
   */
  it('shows your own when there is nothing else to show', () => {
    const own = keyOf('share', 'me')
    expect(pipList(c({ video: new Map([[own, stream()]]) }), 'me')).toEqual([own])
  })

  it('and puts it after everybody else’s, never in front', () => {
    const own = keyOf('share', 'me')
    const theirs = keyOf('share', 'u1')
    const call = c({
      members: [{ id: 'u1', identity: 'u1', name: 'One', muted: false, sharing: true, cam: false }],
      watching: new Set([theirs]),
      video: new Map([[own, stream()], [theirs, stream()]]),
    })
    expect(pipList(call, 'me')).toEqual([theirs, own])
  })

  it('and your own face only when no screen is going at all', () => {
    const cam = keyOf('cam', 'me')
    const share = keyOf('share', 'me')
    expect(pipList(c({ video: new Map([[cam, stream()]]) }), 'me')).toEqual([cam])
    expect(pipList(c({ video: new Map([[cam, stream()], [share, stream()]]) }), 'me'))
      .toEqual([share])
  })

  it('and leaves out one that is not being watched', () => {
    const a = keyOf('share', 'u1')
    const b = keyOf('share', 'u2')
    const call = c({
      members: [
        { id: 'u1', identity: 'u1', name: 'One', muted: false, sharing: true, cam: false },
        { id: 'u2', identity: 'u2', name: 'Two', muted: false, sharing: true, cam: false },
      ],
      watching: new Set([a]),
      video: new Map([[a, stream()], [b, stream()]]),
    })
    expect(pipList(call, 'me')).toEqual([a])
  })
})

/**
 * Hanging up is not news.
 *
 * The drop handler fires on every disconnect, deliberate ones included, so
 * leaving a call put "The call ended — Dismiss" across the top of the screen:
 * the app telling you what you had just done, and asking you to acknowledge
 * it. A call ending under you is worth a word; a call you ended is not.
 */
describe('leaving a call', () => {
  const src = readFileSync(resolve(process.cwd(), 'src/ui/useCall.ts'), 'utf8')

  it('marks the disconnect as one this account asked for', () => {
    expect(src).toMatch(/leaving\.current = true/)
  })

  it('and says nothing when the drop was that one', () => {
    const at = src.indexOf('dropped()')
    expect(at).toBeGreaterThan(0)
    const body = src.slice(at, at + 900)
    /* The guard has to come before the words, or the words are said anyway. */
    const guard = body.indexOf('leaving.current')
    const says = body.indexOf("setError('The call ended')")
    expect(guard).toBeGreaterThan(0)
    expect(says).toBeGreaterThan(guard)
  })

  /* And an unexpected drop still says so — that is different information. */
  it('but still says so when the call ended on its own', () => {
    expect(src).toContain("setError('The call ended')")
  })
})

/**
 * How the connection is holding up, which had gone missing entirely.
 *
 * The client before this one listened to ConnectionQualityChanged and drew
 * four bars from it in the call bar. The rewrite kept the call and dropped
 * the event, so a call that had gone bad looked exactly like one that had
 * not, and the only clue was people asking you to repeat yourself.
 */
describe('what a call says about its connection', () => {
  it('starts saying nothing, because nothing is known yet', () => {
    /* Not 'excellent': the room has no opinion for the first second or two,
       and a browser that never reports one would leave four confident bars
       standing for ever. */
    expect(emptyCall().quality).toBe('unknown')
  })
})
