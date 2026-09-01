import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FACE_CAP, facesShown, occupantsByRoom, type Face } from './voiceRoom'
import { emptyWorld, remember, type World } from './world'
import type { User } from './wire'

/**
 * A voice room with a lot of people in it.
 *
 * The card says who is in there before you decide to go in, which is useful
 * for the handful a room usually holds and nonsense for fifty: the panel goes
 * down to two hundred pixels and the faces grow with it, so a row of fifty
 * would push the Join button out of its own card.
 */

const face = (id: string, sharing = false): Face => ({ id, name: id, sharing })
const many = (n: number) => Array.from({ length: n }, (_, i) => face(`p${i}`))

describe('how many faces are drawn', () => {
  it('is all of them, for a room the size rooms usually are', () => {
    const { shown, more } = facesShown(many(4))
    expect(shown).toHaveLength(4)
    expect(more).toBe(0)
  })

  it('and all of them right up to the cap', () => {
    const { shown, more } = facesShown(many(FACE_CAP))
    expect(shown).toHaveLength(FACE_CAP)
    expect(more).toBe(0)
  })

  it('with one over drawn rather than counted', () => {
    /* "+1" takes the room a face would have taken and says less than it. */
    const { shown, more } = facesShown(many(FACE_CAP + 1))
    expect(shown).toHaveLength(FACE_CAP + 1)
    expect(more).toBe(0)
  })

  it('and the rest become a number', () => {
    const { shown, more } = facesShown(many(50))
    expect(shown).toHaveLength(FACE_CAP)
    expect(more).toBe(50 - FACE_CAP)
  })

  it('which always adds up to everybody in the room', () => {
    for (const n of [0, 1, 9, 10, 11, 30, 200]) {
      const { shown, more } = facesShown(many(n))
      expect(shown.length + more, `${n} people`).toBe(n)
    }
  })

  it('and never draws more than the cap once it is counting', () => {
    for (const n of [12, 40, 500]) {
      expect(facesShown(many(n)).shown.length).toBeLessThanOrEqual(FACE_CAP)
    }
  })

  it('keeps the order it was given, so the faces do not shuffle', () => {
    expect(facesShown(many(20)).shown.map((f) => f.id))
      .toEqual(many(20).slice(0, FACE_CAP).map((f) => f.id))
  })

  it('and does not touch what it was given', () => {
    const all = many(20)
    facesShown(all)
    expect(all).toHaveLength(20)
  })
})

const user = (id: string, name: string): User => ({
  id, username: id, discriminator: '0001', verified: 0, display_name: name,
  bio: '', accent: '', accent_2: '', name_font: 'default',
  name_effect: 'none', avatar_path: null, banner_path: null,
  status_text: '', presence: 'online', created_at: 0,
})

function peopled(): World {
  const w = emptyWorld(user('me', 'Me'))
  remember(w, user('pat', 'Pat'))
  remember(w, user('sam', 'Sam'))
  w.voice.set('pat', { channelId: 'v1', sharing: false } as never)
  w.voice.set('sam', { channelId: 'v1', sharing: true } as never)
  w.voice.set('me', { channelId: 'v2', sharing: false } as never)
  return w
}

describe('grouping who is where', () => {
  /*
   * Each card used to scan the whole occupancy looking for its own room -
   * every person in a call multiplied by every room in the server, every time
   * the list drew. One pass answers all of them.
   */
  it('puts each person in the room they are in', () => {
    const rooms = occupantsByRoom(peopled())
    expect(rooms.get('v1')?.map((f) => f.id).sort()).toEqual(['pat', 'sam'])
    expect(rooms.get('v2')?.map((f) => f.id)).toEqual(['me'])
  })

  it('and an empty room is simply absent', () => {
    expect(occupantsByRoom(peopled()).get('v3')).toBe(undefined)
  })

  it('carries the name to show and whether they are sharing', () => {
    const v1 = occupantsByRoom(peopled()).get('v1') ?? []
    expect(v1.find((f) => f.id === 'sam')).toMatchObject({ name: 'Sam', sharing: true })
  })

  it('and names somebody it has never heard of rather than dropping them', () => {
    /* Occupancy arrives for people whose row has not: a room that says three
       people and shows two is worse than a face with no name. */
    const w = peopled()
    w.voice.set('ghost', { channelId: 'v1', sharing: false } as never)
    const v1 = occupantsByRoom(w).get('v1') ?? []
    expect(v1.map((f) => f.id).sort()).toEqual(['ghost', 'pat', 'sam'])
    expect(v1.find((f) => f.id === 'ghost')?.name).toBe('Someone')
  })
})

describe('the row of faces, in the stylesheet', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/app.css'), 'utf8')
  const stack = css.slice(css.indexOf('.stack{'), css.indexOf('.stack{') + 700)

  it('wraps rather than running out of the card', () => {
    /* Any fixed number of faces overflows at some panel width, because the
       panel is draggable and the faces scale with it. */
    expect(stack).toContain('flex-wrap:wrap')
  })

  it('and tucks them under each other in a way that survives wrapping', () => {
    /*
     * `:first-child` is the first of the whole stack, not the first of each
     * line, so cancelling the tuck there put every line after the first nine
     * pixels outside the card. The padding gives the tuck back to all of them.
     */
    expect(stack).toContain('padding-left:9px')
    expect(stack).toContain('.stack .av,.stack .more{margin-left:-9px}')
    expect(stack, 'the first-child cancel is what wrapping breaks')
      .not.toContain('.stack .av:first-child{margin-left:0}')
  })

  it('and the button to go in cannot be pushed out by them', () => {
    expect(css).toContain('.vcard .row .stack{flex:1;min-width:0}')
    expect(css).toContain('.vcard .join{flex:none}')
  })
})
